// Anchor · A7：把 signals.ts 产出的真实 SignalEvent 接进感知半（computeFeatureFrame），
// 替换 mock events.json 那条测试专用路径
// A11（J4 一部分）：感知半产出 FeatureFrame 之后，紧接着喂进 B 的决策半（evaluateFrame，
// 已经是 B1/08-26 code review 修过的版本）算出 DetectionResult，side panel 要的就是这个，
// 不是裸 FeatureFrame——B 的纯函数本身不碰 chrome.storage，BState 的持久化/水合仍然是
// A（平台层）的职责，跟 eventHistory/currentTab 是同一套"SW 回收后重新水合"模式。
import type { SignalEvent, SessionContext, FeatureFrame, DetectionResult, BState, BStatePersistable, CheckInFeedback } from '../../engine/types';
import { createInitialBState } from '../../engine/types';
import { computeFeatureFrame, cacheKey, type ClassificationCache } from '../../engine/perceiver';
import { evaluateFrame, applyCheckInFeedback } from '../../engine/detector';
import { createPetStateMachine, advancePetState } from '../../engine/pet-state';
import type { PetState } from '../../pet/types';
import { classifyDomainRelevance } from './classifier';
import { getBState, setBState, removeBState } from './state';
import { saveSessionContext } from './session';


type Archetype = 'CREATOR' | 'READER' | 'VIEWER';

const HISTORY_KEY_PREFIX = 'anchor_event_history_';
// computeFeatureFrame 的 anchorDetachedMs/jumpPattern 理论上要看完整历史，但实际不需要无限回看：
// 一旦「距上次锚点交互」超过阈值就已经判定为脱离，再往前找没有额外信息量。留 4 小时窗口/500 条
// 上限只是防止真实长会话下这个数组和它的持久化副本无限增长，不是契约要求的精确数字。
const MAX_HISTORY_EVENTS = 500;
const MAX_HISTORY_AGE_MS = 4 * 60 * 60 * 1000;

let eventHistory: SignalEvent[] = [];
let historyLoadedForSession: string | null = null;
// texture 信号冷启动时沿用上一帧的判定（见 perceiver.ts computeTexture）；这个变量只活在内存里，
// SW 被回收重启后会掉回默认值 'idle'——可接受的降级：事件历史本身是持久化的，
// 重启后第一帧只要窗口内有真实证据就会算出正确值，不依赖这个内存变量。
let previousTexture: FeatureFrame['texture'] = 'idle';
// B9 状态机实例。跟上面的 previousTexture 一样是模块级内存状态：纯 UI 表现，SW 被回收后
// 从 'companion' 重新开始完全无害（最多少演一次"观察"），不进 chrome.storage.local。
let petStateMachine = createPetStateMachine();
// A8：真实 LLM 分类结果写在这份缓存里；未命中前 computeFeatureFrame 保守判 UNKNOWN（红线1），
// 命中前的这段时间差正是 triggerLazyClassification() 异步分类需要的窗口。
const classificationCache: ClassificationCache = new Map();
// 同一个 cacheKey 在 LLM 结果回来之前，不要因为期间又来了几条事件就重复发起分类请求。
const inFlightClassification = new Set<string>();

// evaluateFrame 需要的 BState（阶梯/冷却/持续器）跟 eventHistory 是同一个问题：只活在内存里，
// SW 被回收就归零，得单独持久化 + 水合，不能指望调用方记得。
let bState: BState | null = null;
let bStateLoadedForSession: string | null = null;

function historyKey(sessionId: string): string {
  return `${HISTORY_KEY_PREFIX}${sessionId}`;
}

// engine/types.ts 把 BState 分成两半是有意为之：BStatePersistable 那些字段该活过 SW 回收，
// driftSustainer/stuckSustainer/passiveSince（EvidenceSustainer）明确注释是"不持久化的部分"——
// 持续器记的是"这一次连续证据从什么时候开始累计"，SW 被回收重启后这个"连续"就已经断了，
// 把旧的 since 时间戳原样存盘再读回来，会让重启后第一次评估拿一个跟当前 now 差很远的旧
// 时间戳去跟阈值比，可能凭一段其实并不连续的证据就误判"已经持续够久"，提前触发。
// 落盘只存 BStatePersistable 这一半，持续器每次水合都给一份全新的（跟 createInitialBState
// 冷启动时用的初值一致），是保守但正确的选择——顶多是重启后重新攒一次证据窗口，不会误判。
function toPersistable(state: BState): BStatePersistable {
  const { driftSustainer, stuckSustainer, passiveSince, ...persistable } = state;
  return persistable;
}

function trim(events: SignalEvent[], now: number): SignalEvent[] {
  const cutoff = now - MAX_HISTORY_AGE_MS;
  const withinAge = events.filter((e) => e.timestamp >= cutoff);
  return withinAge.length > MAX_HISTORY_EVENTS ? withinAge.slice(-MAX_HISTORY_EVENTS) : withinAge;
}

// SW 每次（重新）启动后 eventHistory 这个内存数组会归零；第一次用到它之前从 chrome.storage.local
// 补一次——跟 signals.ts 里 currentTab 用 ensureCurrentTab() 补状态是同一套"SW 回收后重新水合"思路。
async function ensureHistoryLoaded(sessionId: string): Promise<void> {
  if (historyLoadedForSession === sessionId) return;
  const key = historyKey(sessionId);
  const stored = await chrome.storage.local.get(key);
  eventHistory = (stored[key] as SignalEvent[] | undefined) ?? [];
  historyLoadedForSession = sessionId;
}

// 跟 ensureHistoryLoaded 同一个模式：换会话（或 SW 刚重启）时先从 storage 补一份，
// storage 里也没有（全新会话）就用 createInitialBState 建一份新的——archetype 决定
// stuckThresholdMs 的初始值（阶梯第 0 格），跟 evaluateFrame 后续要用的 policy 对应同一个档位。
async function ensureBStateLoaded(sessionId: string, archetype: Archetype): Promise<BState> {
  if (bStateLoadedForSession === sessionId && bState) return bState;
  const persisted = await getBState(sessionId);
  // 持续器不是持久化的一部分（见 toPersistable 的注释）——不管是全新会话还是从存盘的
  // BStatePersistable 水合回来，持续器都给一份全新初值，不沿用任何"上一次 SW 实例"留下的状态。
  bState = persisted
    ? { ...persisted, driftSustainer: { since: null }, stuckSustainer: { since: null }, passiveSince: null }
    : createInitialBState(archetype);
  bStateLoadedForSession = sessionId;
  return bState;
}

/**
 * 08-30 真机测试发现的缺口：`sessionId` 一直是硬编码的 `'default'`（session.ts/onboarding.ts
 * 都这样），不管重开几次起步教练、声明几次新任务，都是同一个 sessionId——`ensureHistoryLoaded`/
 * `ensureBStateLoaded` 的"同一 session 就不重新水合"这条判断因此永远命中旧数据，`eventHistory`/
 * `BState`（`stuckThresholdMs`/`stuckLadderIndex`/`lastCheckInTs`/`lastAnswerTs`/`restUntil` 这些
 * 持久化字段）会原样跨会话延续。真机复现：手动只重置了 `taskDeclaration`（`chrome.storage.local`
 * 里的 `anchor_default_session.taskDeclaration`），没碰事件历史/BState，重新走一遍起步教练声明
 * "study neural network"后，浏览器当前活动 tab 其实还停在上一场测试收尾时的那个页面
 * （"Computer Networks"）——`computeStillnessMs()` 找"这一页最后一次真实交互"时，翻到的是
 * 上一场测试留在 `eventHistory` 里的旧交互事件（可能是几十分钟甚至几小时前），`stillnessMs`
 * 因此直接爆表，STUCK 在新会话第一帧就顶格触发，文案还是拿旧标题拼的——像是"上一场测试的
 * check-in 穿越过来了"，其实是旧证据从来没被清过。
 *
 * 起步教练每完成一次都视为"新的一场专注"，理应清空上一场攒的全部证据——不能指望调用方
 * 记得手动清 `eventHistory`/`BState`/`classificationCache` 三处不同的 storage，这里统一收口：
 * 内存态归零 + 对应的 storage key 一并删掉。分类缓存/`inFlightClassification` 也一并清空——
 * 页面相关性是相对 `taskDeclaration` 判的，换了任务，旧任务下判出来的 RELEVANT/IRRELEVANT
 * верdict 对新任务没有意义，尤其是反复用同一批 demo URL 测试时最容易踩到这个坑。
 */
export function resetSessionState(sessionId: string): void {
  eventHistory = [];
  historyLoadedForSession = sessionId; // 标记"已加载"为这份空数组，避免下一次又从 storage 读回旧数据
  void chrome.storage.local.remove(historyKey(sessionId));

  bState = null;
  bStateLoadedForSession = null;
  void removeBState(sessionId);

  previousTexture = 'idle';
  petStateMachine = createPetStateMachine();

  classificationCache.clear();
  inFlightClassification.clear();
}

// recordEventAndEvaluate（有新事件）和 recomputeOnHeartbeat（没有新事件，只是时间往前走了）
// 共用同一段"喂进决策半、存盘"逻辑——两条路径唯一的区别是要不要往 eventHistory 里追加一条事件，
// evaluateFrame 本身只关心 frame + now，不关心这个 now 是不是伴随着一条新事件到来。
async function evaluateAndPersist(
  frame: FeatureFrame,
  ctx: SessionContext,
  now: number,
  isDemoMode: boolean
): Promise<{ result: DetectionResult; petState: PetState }> {
  // profile.archetype 的类型比 evaluateFrame 接受的宽（还含 COMMUNICATOR/CUSTOM，阶段二才会用到），
  // 默认 SessionContext 目前永远是 CREATOR——跟 integration.test.ts 里同一处的处理方式一致。
  const archetype = ctx.profile.archetype as Archetype;
  const state = await ensureBStateLoaded(ctx.sessionId, archetype);
  const action = evaluateFrame(frame, archetype, ctx.profile.policy, ctx, state, now, isDemoMode);
  // evaluateFrame 可能就地改了 state.lastCheckInTs（触发 check-in 的那一刻）——存盘，
  // 不然下一次 SW 回收重启后冷却闸门会读回没生效前的旧值。只存 BStatePersistable 那一半
  // （toPersistable 剥掉持续器），不是完整 BState。
  void setBState(ctx.sessionId, toPersistable(state));

  // B9：DetectionResult 只说"要不要开口"，说不了"有没有在多看两眼"——后者的信号是 BState
  // 的两个证据持续器（见 pet-state.ts 顶部注释）。这里是全项目唯一同时拿得到 action 和
  // BState 的地方，所以状态机在这里推进，算出的 PetState 跟 DetectionResult 一起交给调用方。
  const petState = advancePetState(
    petStateMachine,
    action,
    {
      driftSustainerSince: state.driftSustainer.since,
      stuckSustainerSince: state.stuckSustainer.since,
      restUntil: state.restUntil,
    },
    now,
    isDemoMode
  );

  return {
    result: {
      action,
      lastAnchorSnapshot: frame.lastAnchorSnapshot,
      currentTitle: frame.currentTitle,
    },
    petState,
  };
}

// A8：惰性触发一次真实 LLM 分类——只在感知半已经把这一页判成 UNKNOWN（DEMO_PRESET_CACHE/
// sessionWhitelist/short_feed/黑名单/缓存全部没命中）之后才触发，fire-and-forget，绝不
// 让调用方等它。结果写回 classificationCache，供"下一次"（下一条事件，或下一次心跳补帧）
// 重新计算帧时使用——不会让当前这一帧变成 RELEVANT/IRRELEVANT，只影响未来。
function triggerLazyClassification(event: SignalEvent, ctx: SessionContext, frame: FeatureFrame): void {
  if (frame.contextRelevance !== 'UNKNOWN') return;
  // 0829 真机测试发现（Joy）：chrome://newtab/ 刚打开、tab.url 还没被真实地址补上那一小段
  // 空档期（signals.ts 的 onUpdated 只要 title 变了就会发信号，即使 url 仍是空字符串），
  // 会喂出一条 domain/url 全空的 SignalEvent。空 URL 送去分类没有任何意义——LLM 拿不到
  // 页面内容可判，白白浪费一次调用，还可能拿回一个没道理的判定（域名/URL 都是空的，
  // 不该被算作"IRRELEVANT"或任何确定结论）。domain 判空即可：cacheKey 用 domain 打头，
  // url 为空但 domain 有值的情况理论上不存在（domainOf('') === ''）。
  if (!event.domain) return;
  const key = cacheKey(event.domain, event.url);
  if (inFlightClassification.has(key) || classificationCache.has(key)) return;

  inFlightClassification.add(key);
  console.log('[Anchor SW] classifying (async)', key);
  void classifyDomainRelevance({ taskDeclaration: ctx.taskDeclaration, url: event.url, title: event.title })
    .then((verdict) => {
      classificationCache.set(key, verdict);
      console.log('[Anchor SW] classified', key, '->', verdict);
    })
    .finally(() => {
      inFlightClassification.delete(key);
    });
}

/**
 * 把一条真实信号事件计入历史（内存 + chrome.storage.local 持久化，应对 SW 回收），
 * 用完整历史跑一次感知半产出 FeatureFrame，再喂进决策半（evaluateFrame）算出
 * DetectionResult——这就是 side panel 真正要消费的东西，不是裸 FeatureFrame。
 */
export async function recordEventAndEvaluate(
  event: SignalEvent,
  ctx: SessionContext,
  isDemoMode: boolean
): Promise<{ frame: FeatureFrame; result: DetectionResult; petState: PetState }> {
  await ensureHistoryLoaded(ctx.sessionId);
  eventHistory = trim([...eventHistory, event], event.timestamp);
  void chrome.storage.local.set({ [historyKey(ctx.sessionId)]: eventHistory });

  const frame = computeFeatureFrame(
    eventHistory,
    ctx,
    event.timestamp,
    classificationCache,
    previousTexture,
    isDemoMode
  );
  previousTexture = frame.texture;
  triggerLazyClassification(event, ctx, frame);

  const { result, petState } = await evaluateAndPersist(frame, ctx, event.timestamp, isDemoMode);
  return { frame, result, petState };
}

/**
 * 契约v4 §3.1"事件静默 >60s 补帧"：心跳周期性地在没有新事件的情况下，也用当前时刻重新
 * 算一次 FeatureFrame/DetectionResult。真实浏览器里很多"什么都没做"的场景（安静看视频、
 * 停在锚点页面发呆）压根不会产生新的 SignalEvent——只靠 recordEventAndEvaluate 那条事件
 * 触发的路径，anchorDetachedMs/stillnessMs 的证据会永远停在"最后一个事件发生的那一刻"，
 * 哪怕后面又安安静静过了 20 分钟也不会被重新检查。这里复用同一份 eventHistory，只是把
 * now 换成心跳触发的当前时刻——anchorDetachedMs/stillnessMs 都是 `now - 上次活动时间戳`，
 * 换一个更晚的 now 就会正确地继续增长。
 */
export async function recomputeOnHeartbeat(
  ctx: SessionContext,
  now: number,
  isDemoMode: boolean
): Promise<{ frame: FeatureFrame; result: DetectionResult; petState: PetState } | null> {
  await ensureHistoryLoaded(ctx.sessionId);
  if (eventHistory.length === 0) return null; // 还没有任何事件，没有证据可以重新评估

  const frame = computeFeatureFrame(eventHistory, ctx, now, classificationCache, previousTexture, isDemoMode);
  previousTexture = frame.texture;

  const { result, petState } = await evaluateAndPersist(frame, ctx, now, isDemoMode);
  return { frame, result, petState };
}

/**
 * side panel 用户点了 check-in 气泡里的按钮之后，SW 收到消息调这个函数——用同一份
 * 持久化 BState 跑 applyCheckInFeedback（B2），再存盘，跟 evaluateFrame 那次持久化
 * 走的是同一把 storage key，两条路径不会互相踩。
 *
 * J6（08-28 补上的 B→A 反向缝）：DRIFT 通道答 FALSE_POSITIVE 时，detector.ts 的注释里写明
 * "调用方自己用 FeatureFrame.currentDomain 去改 SessionContext.sessionWhitelist"——这里
 * 之前一直没做，答"查资料呢"只会清空 driftSustainer，不会真正把当前域名加入白名单免打扰，
 * 下一次同一个域名照样会被判 DRIFT 重新问一遍。domain 由调用方传入（来自触发那一刻的
 * PanelState.domain，不是用户点按钮那一刻恰好在哪个域名，见 panel.ts 的注释）。
 */
export async function applyCheckInAnswer(
  ctx: SessionContext,
  feedback: CheckInFeedback,
  now: number,
  domain?: string
): Promise<void> {
  const archetype = ctx.profile.archetype as Archetype;
  const state = await ensureBStateLoaded(ctx.sessionId, archetype);
  applyCheckInFeedback(state, ctx.profile.policy, feedback, now);
  void setBState(ctx.sessionId, toPersistable(state));

  if (feedback.channel === 'DRIFT' && feedback.answer === 'FALSE_POSITIVE' && domain) {
    if (!ctx.sessionWhitelist.includes(domain)) {
      ctx.sessionWhitelist.push(domain);
      await saveSessionContext(ctx);
    }
  }
}

/**
 * 休息模式（rest.ts）/心跳的 refreshRestReminder 需要直接改 BState.restUntil/restStartTs，
 * 但持久化+水合是 frame-pipeline 内部状态（跟 eventHistory 一样只活在这个模块里）——
 * 暴露这一对函数而不是把 bState 变量导出去，调用方拿到的仍是同一个内存引用（
 * ensureBStateLoaded 命中同一 sessionId 时直接返回旧引用），改完调 persistBState
 * 存盘即可，跟 evaluateAndPersist 走的是同一把 toPersistable/setBState。
 */
export async function getBStateForSession(ctx: SessionContext): Promise<BState> {
  const archetype = ctx.profile.archetype as Archetype;
  return ensureBStateLoaded(ctx.sessionId, archetype);
}

export function persistBState(ctx: SessionContext, state: BState): void {
  void setBState(ctx.sessionId, toPersistable(state));
}
