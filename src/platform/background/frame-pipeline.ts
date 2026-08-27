// Anchor · A7：把 signals.ts 产出的真实 SignalEvent 接进感知半（computeFeatureFrame），
// 替换 mock events.json 那条测试专用路径
// A11（J4 一部分）：感知半产出 FeatureFrame 之后，紧接着喂进 B 的决策半（evaluateFrame，
// 已经是 B1/08-26 code review 修过的版本）算出 DetectionResult，side panel 要的就是这个，
// 不是裸 FeatureFrame——B 的纯函数本身不碰 chrome.storage，BState 的持久化/水合仍然是
// A（平台层）的职责，跟 eventHistory/currentTab 是同一套"SW 回收后重新水合"模式。
import type { SignalEvent, SessionContext, FeatureFrame, DetectionResult, BState, CheckInFeedback } from '../../engine/types';
import { createInitialBState } from '../../engine/types';
import { computeFeatureFrame, cacheKey, type ClassificationCache } from '../../engine/perceiver';
import { evaluateFrame, applyCheckInFeedback } from '../../engine/detector';
import { classifyDomainRelevance } from './classifier';

type Archetype = 'CREATOR' | 'READER' | 'VIEWER';

const HISTORY_KEY_PREFIX = 'anchor_event_history_';
const BSTATE_KEY_PREFIX = 'anchor_bstate_';
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

function bStateKey(sessionId: string): string {
  return `${BSTATE_KEY_PREFIX}${sessionId}`;
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
  const key = bStateKey(sessionId);
  const stored = await chrome.storage.local.get(key);
  bState = (stored[key] as BState | undefined) ?? createInitialBState(archetype);
  bStateLoadedForSession = sessionId;
  return bState;
}

// recordEventAndEvaluate（有新事件）和 recomputeOnHeartbeat（没有新事件，只是时间往前走了）
// 共用同一段"喂进决策半、存盘"逻辑——两条路径唯一的区别是要不要往 eventHistory 里追加一条事件，
// evaluateFrame 本身只关心 frame + now，不关心这个 now 是不是伴随着一条新事件到来。
async function evaluateAndPersist(
  frame: FeatureFrame,
  ctx: SessionContext,
  now: number,
  isDemoMode: boolean
): Promise<DetectionResult> {
  // profile.archetype 的类型比 evaluateFrame 接受的宽（还含 COMMUNICATOR/CUSTOM，阶段二才会用到），
  // 默认 SessionContext 目前永远是 CREATOR——跟 integration.test.ts 里同一处的处理方式一致。
  const archetype = ctx.profile.archetype as Archetype;
  const state = await ensureBStateLoaded(ctx.sessionId, archetype);
  const action = evaluateFrame(frame, archetype, ctx.profile.policy, ctx, state, now, isDemoMode);
  // evaluateFrame 可能就地改了 state.lastCheckInTs（触发 check-in 的那一刻）——存盘，
  // 不然下一次 SW 回收重启后冷却闸门会读回没生效前的旧值。
  void chrome.storage.local.set({ [bStateKey(ctx.sessionId)]: state });

  return {
    action,
    lastAnchorSnapshot: frame.lastAnchorSnapshot,
    currentTitle: frame.currentTitle,
  };
}

// A8：惰性触发一次真实 LLM 分类——只在感知半已经把这一页判成 UNKNOWN（DEMO_PRESET_CACHE/
// sessionWhitelist/short_feed/黑名单/缓存全部没命中）之后才触发，fire-and-forget，绝不
// 让调用方等它。结果写回 classificationCache，供"下一次"（下一条事件，或下一次心跳补帧）
// 重新计算帧时使用——不会让当前这一帧变成 RELEVANT/IRRELEVANT，只影响未来。
function triggerLazyClassification(event: SignalEvent, ctx: SessionContext, frame: FeatureFrame): void {
  if (frame.contextRelevance !== 'UNKNOWN') return;
  const key = cacheKey(event.domain, event.url);
  if (inFlightClassification.has(key) || classificationCache.has(key)) return;

  inFlightClassification.add(key);
  void classifyDomainRelevance({ taskDeclaration: ctx.taskDeclaration, url: event.url, title: event.title })
    .then((verdict) => {
      classificationCache.set(key, verdict);
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
): Promise<{ frame: FeatureFrame; result: DetectionResult }> {
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

  const result = await evaluateAndPersist(frame, ctx, event.timestamp, isDemoMode);
  return { frame, result };
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
): Promise<{ frame: FeatureFrame; result: DetectionResult } | null> {
  await ensureHistoryLoaded(ctx.sessionId);
  if (eventHistory.length === 0) return null; // 还没有任何事件，没有证据可以重新评估

  const frame = computeFeatureFrame(eventHistory, ctx, now, classificationCache, previousTexture, isDemoMode);
  previousTexture = frame.texture;

  const result = await evaluateAndPersist(frame, ctx, now, isDemoMode);
  return { frame, result };
}

/**
 * side panel 用户点了 check-in 气泡里的按钮之后，SW 收到消息调这个函数——用同一份
 * 持久化 BState 跑 applyCheckInFeedback（B2），再存盘，跟 evaluateFrame 那次持久化
 * 走的是同一把 storage key，两条路径不会互相踩。
 *
 * 已知缺口（不在这次 A11 联调范围内，先记录）：DRIFT 通道答 FALSE_POSITIVE 时，
 * detector.ts 的注释里写明"调用方自己用 FeatureFrame.currentDomain 去改
 * SessionContext.sessionWhitelist"——这里还没做，答"查资料呢"目前只会清空
 * driftSustainer，不会真正把当前域名加入白名单免打扰。
 */
export async function applyCheckInAnswer(
  ctx: SessionContext,
  feedback: CheckInFeedback,
  now: number
): Promise<void> {
  const archetype = ctx.profile.archetype as Archetype;
  const state = await ensureBStateLoaded(ctx.sessionId, archetype);
  applyCheckInFeedback(state, ctx.profile.policy, feedback, now);
  void chrome.storage.local.set({ [bStateKey(ctx.sessionId)]: state });
}
