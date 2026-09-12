import {
  FeatureFrame,
  SignalPolicy,
  SessionContext,
  CheckInFeedback,
  DEFAULT_STUCK_LADDER,
  CHECKIN_COOLDOWN_MS,
  DRIFTED_CHECKIN_COOLDOWN_MS,
  scaled,
} from './types';
// 08-28：scaled() 的规范实现搬到 types.ts（唯一不会产生循环依赖的叶子模块，
// defaultSessionContext 的 graceUntil 压缩也要用它）。这里重新导出，pet-state.ts（B9）
// 现有的 `import { scaled } from './detector'` 不用跟着改。
export { scaled };
// 08-30：黑名单快速通道要判断"这个域名是不是命中静态黑名单"，直接复用 perceiver.ts 已经
// 导出的这两个——不写第四份匹配逻辑（08-25 code review 已经因为这个理由把 signals.ts/
// heuristics.ts 收敛过一次）。依赖方向没有反：perceiver.ts 不 import detector.ts，不会循环。
import { domainMatches, BUILTIN_ENTERTAINMENT_BLACKLIST } from './perceiver';

// B 侧内部状态接口
export interface BState {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;
  restStartTs: number;
  // 09-11：上一次休息"真正结束"的时刻（点 Back to it 或调用 endRest() 的那一刻），
  // 跟 restUntil 是两码事——restUntil 现在是 RESTING_INDEFINITELY/-Infinity 的哨兵值
  //（见 startRest() 顶部注释），不再是一个真实时间戳，不能再拿它当"休息刚结束"的基准点用。
  restEndedTs: number;
  // 09-11：用户点了"再休息 5 分钟"——restReminderDue() 在这个时刻之前都不判定"该提醒了"，
  // 见 snoozeRest() 顶部注释。
  restSnoozedUntil: number;
  // 08-31：下一次冷却该用多久，applyCheckInFeedback() 按上一次回答写入——见 types.ts
  // BStatePersistable.checkinCooldownMs 顶部注释。
  checkinCooldownMs: number;
  driftSustainer: { since: number | null };
  stuckSustainer: { since: number | null };
  passiveSince: number | null;
}

// 持续器工具函数
function sustainedWithWindow(
  sustainer: { since: number | null },
  evidence: boolean,
  now: number,
  windowMs: number
): boolean {
  if (!evidence) {
    sustainer.since = null;
    return false;
  }
  if (sustainer.since === null) {
    sustainer.since = now;
  }
  return now - sustainer.since >= windowMs;
}

// 辅助：判断是否连续处于"非主动"纹理（passive 或 idle）。
// 08-27 修正：原来只认 'passive'，'idle' 会把 passiveSince 重置掉——但 'idle'（120s 窗口内
// 连 PASSIVE_SCROLL 都没有）语义上比 'passive'（至少还在被动滚动/僵尸连播）更"静"，是
// 更强的走神证据，不该被排除在外。契约v4 §3.4/§3.5 的参考实现原来就是这样写的（只认
// 'passive'），核对后确认这是契约本身的设计漏洞，不是刻意排除 idle 的设计边界：结果是
// "IRRELEVANT + 完全不动"这种比"IRRELEVANT + 还在被动滚动"更明确的走神场景，DRIFT 判不出来
// （STUCK 又明确排除 IRRELEVANT，见 isStuck），两个通道都接不住。只有 'purposeful'
// （用户还在主动操作）才应该打断这段连续证据。
function isContinuouslyDisengaged(
  state: BState,
  f: FeatureFrame,
  now: number,
  thresholdMs: number
): boolean {
  if (f.texture === 'purposeful') {
    state.passiveSince = null;
    return false;
  }
  if (state.passiveSince === null) {
    state.passiveSince = now;
  }
  return now - state.passiveSince >= thresholdMs;
}

/**
 * 契约v4 §3.7「冷却后持续器重置」的实现（B10，08-30 补上）。
 *
 * 要解决的问题：check-in 触发时 lastCheckInTs = now，之后 5 分钟里 isDrifting/isStuck
 * 在冷却闸口**提前 return**，压根碰不到下面的持续器——所以 driftSustainer.since 会一直
 * 停在"证据开始累积的那一刻"（check-in 之前）。冷却一过的第一帧，`now - since` 早就
 * 远超 30s 窗口，于是**同一批旧证据立刻又触发一次 check-in**，用户完全没有喘息。
 * 场景：用户看到气泡但没回答（直接忽略），5 分钟后又被同一件事问一遍。
 *
 * ★ 实现方式跟契约给的伪代码不同，但语义等价，而且更简单：
 *   契约写的是 onCooldownEnd(state)，需要"上一帧是否在冷却中"的边缘检测才能只跑一次
 *   （detector.ts 原注释也是这么记的，还说要为此往 BState 加字段）。
 *   但根本不需要边缘检测——**凡是 since 早于上次 check-in 的证据，就是已经导致过那次
 *   check-in 的旧证据，一律作废**即可。这样：
 *     · 不用往 BStatePersistable 加字段（不动持久化格式，不牵连 toPersistable/storage）
 *     · 天然幂等：清完 since=null，下一帧 sustainedWithWindow 会把它设成 now（> lastCheckInTs），
 *       之后再调用就不会重复清
 *     · lastCheckInTs 初始是 -Infinity，任何真实时间戳都不满足 <=，所以从没 check-in 过时不误伤
 */
function discardEvidenceFromBeforeCheckIn(state: BState): void {
  if (state.driftSustainer.since !== null && state.driftSustainer.since <= state.lastCheckInTs) {
    state.driftSustainer.since = null;
  }
  if (state.stuckSustainer.since !== null && state.stuckSustainer.since <= state.lastCheckInTs) {
    state.stuckSustainer.since = null;
  }
  // passiveSince 是"连续非主动纹理"的计时起点，同属 check-in 前攒下的证据，一起作废。
  if (state.passiveSince !== null && state.passiveSince <= state.lastCheckInTs) {
    state.passiveSince = null;
  }
}

/**
 * "这条通道现在不该说话" —— 清掉自己的持续器再返回 false。
 *
 * ★ 09-05 真机 bug 的统一修法。原来每一处提前 return 都是裸 `return false`，只有函数末尾
 *   那个 `sustainedWithWindow(..., evidence=false, ...)` 会真正清空持续器。问题是：
 *   **提前 return 的路径恰恰是用户回到正轨时最常命中的**（页面变相关了、开始打字了、
 *   上一次 check-in 的冷却期还没过），于是证据被冻结在飘走那一刻。
 *   而 `advancePetState()` 只看 `driftSustainer.since`/`stuckSustainer.since` 是不是非空来
 *   决定演不演 observing——"这条通道现在根本不该说话"就被桌宠读成了"证据还在累积"，
 *   用户回到专注页面之后桌宠一直是黄的，变不回绿（Jay 09-05 记录的第 10 条）。
 *
 * ★ 语义上这也是对的：持续器记的是"这个条件已经连续成立多久"。条件不成立了——不管是
 *   因为用户改好了、还是因为闸门让整条通道闭嘴——那段连续性就断了，不该留着下次接着数。
 *   discardEvidenceFromBeforeCheckIn() 保留不动：它是契约 §3.7 的字面实现，
 *   冷却为 0 之类的边界下仍然是唯一负责那一条的地方。
 */
function silence(sustainer: { since: number | null }): false {
  sustainer.since = null;
  return false;
}

/**
 * 通道一：DRIFT 走神检测
 */
export function isDrifting(
  f: FeatureFrame,
  p: SignalPolicy,
  ctx: SessionContext,
  state: BState,
  now: number,
  isDemoMode?: boolean
): boolean {
  // 08-31：冷却时长不再是写死的常量——按上一次回答变（DRIFTED 短、FOCUSED/FALSE_POSITIVE
  // 长，见 applyCheckInFeedback()/types.ts 顶部注释），从没回答过时 state.checkinCooldownMs
  // 就是 createInitialBState() 给的长冷却默认值。
  const cooldownMs = scaled(state.checkinCooldownMs, isDemoMode);
  const SUSTAINED_EVIDENCE_MS = scaled(30_000, isDemoMode); // 30s 持续窗口

  // 公共闸口。★ 全部走 silence()——闸门命中意味着这条通道此刻整个闭嘴，
  // 攒着的证据必须一起作废，否则桌宠会把"闸门挡住了"误读成"还在累积"（见 silence 注释）。
  if (state.restUntil > now) return silence(state.driftSustainer);
  if (now - state.lastCheckInTs < cooldownMs) return silence(state.driftSustainer);
  // 走到这里说明冷却已经过了——把 check-in 之前攒的旧证据作废（契约v4 §3.7），
  // 否则下面的持续器会拿着冷却前的 since 立刻判定"已持续足够久"。
  discardEvidenceFromBeforeCheckIn(state);
  if (now < ctx.graceUntil) return silence(state.driftSustainer);

  // DEMO_MODE 下 policy 里的阈值常量本身也要压缩（契约v4 §3.2），否则 demo 事件流用的是
  // 压缩后的小时间戳，而阈值仍是真实 8min/15min，比较永远不成立。
  const anchorDetachedThresholdMs = scaled(p.anchorDetachedThresholdMs, isDemoMode);

  // 1. 形态硬判：Shorts + 锚点抛弃
  if (f.contentFormat === 'short_feed' && f.anchorDetachedMs > anchorDetachedThresholdMs) {
    return sustainedWithWindow(state.driftSustainer, true, now, SUSTAINED_EVIDENCE_MS);
  }

  // 2. 域名硬判：命中静态黑名单的页面用远短于通用阈值的专属等待时间。黑名单是"确定无关"
  //   的高置信度判定，跟 LLM 判出来、多少有点不确定性的 IRRELEVANT 不是一回事，不需要陪它
  //   等 anchorDetachedThresholdMs（08-30 从 8min 调到 5min，见 types.ts CREATOR 预设的注释）
  //   那么久——但仍然要求"稳定"（标准 30s 持续窗口），不能因为一帧命中就立刻开口，防止
  //   手滑/中转页触发误报。
  //   ★ 先看 f.contextRelevance 而不是只查域名表：sessionWhitelist 的优先级比黑名单高
  //   （resolveContextRelevance 的短路顺序），域名在黑名单里但已经被用户手动纠正成
  //   "查资料"时，f.contextRelevance 会是 RELEVANT——这个分支要尊重那次纠正，不能绕过
  //   白名单去查静态表，否则用户答过一次"查资料"，下次访问同一个黑名单域名还是会被打扰。
  const BLACKLIST_ANCHOR_DETACHED_THRESHOLD_MS = scaled(15_000, isDemoMode);
  const isBlacklistedDomain =
    f.contextRelevance === 'IRRELEVANT' &&
    [...BUILTIN_ENTERTAINMENT_BLACKLIST].some((d) => domainMatches(f.currentDomain, d));
  if (isBlacklistedDomain && f.anchorDetachedMs > BLACKLIST_ANCHOR_DETACHED_THRESHOLD_MS) {
    return sustainedWithWindow(state.driftSustainer, true, now, SUSTAINED_EVIDENCE_MS);
  }

  // 非相关性短路
  if (f.contextRelevance !== 'IRRELEVANT') {
    return sustainedWithWindow(state.driftSustainer, false, now, SUSTAINED_EVIDENCE_MS);
  }

  const anchorAbandoned = f.anchorDetachedMs > anchorDetachedThresholdMs;

  // 纹理证据：连续处于非主动纹理（passive 或 idle）达到门槛——见 isContinuouslyDisengaged 注释。
  const textureEvidence =
    !p.mutePassiveTexture && isContinuouslyDisengaged(state, f, now, scaled(60_000, isDemoMode));

  // 跳转证据
  const jumpEvidence = !p.muteJumpPattern && f.jumpPattern === 'rabbit_hole';

  // feed_driven 意图加速器 (15s 窗口)
  const evidenceWindowMs =
    f.entryIntent === 'feed_driven' ? scaled(15_000, isDemoMode) : SUSTAINED_EVIDENCE_MS;

  // 综合判定逻辑
  const evidence = anchorAbandoned
    ? textureEvidence || jumpEvidence
    : p.mutePassiveTexture && f.entryIntent === 'feed_driven'; // VIEWER 降级路径

  return sustainedWithWindow(state.driftSustainer, evidence, now, evidenceWindowMs);
}

/**
 * 通道二：STUCK 卡住/卡顿检测
 */
export function isStuck(
  f: FeatureFrame,
  p: SignalPolicy,
  ctx: SessionContext,
  state: BState,
  now: number,
  isDemoMode?: boolean
): boolean {
  const cooldownMs = scaled(state.checkinCooldownMs, isDemoMode);
  const SUSTAINED_EVIDENCE_MS = scaled(30_000, isDemoMode);

  // 公共闸口。理由同 isDrifting，见 silence() 的注释。
  if (state.restUntil > now) return silence(state.stuckSustainer);
  if (now - state.lastCheckInTs < cooldownMs) return silence(state.stuckSustainer);
  // 走到这里说明冷却已经过了——把 check-in 之前攒的旧证据作废（契约v4 §3.7），
  // 否则下面的持续器会拿着冷却前的 since 立刻判定"已持续足够久"。
  discardEvidenceFromBeforeCheckIn(state);
  if (now < ctx.graceUntil) return silence(state.stuckSustainer);

  // ★ 下面这几条前置条件同样必须 silence 而不是裸 return false——它们描述的是
  //   "现在压根不是一个'卡住'的场景"，那之前攒的卡住证据当然作废。
  //   09-05 真机复现的主因就在这里：用户从不相干页面回到锚点页面并**开始打字**，
  //   `texture !== 'idle'` 提前 return，陈旧的 stuckSustainer.since 没人清 →
  //   桌宠读到"仍在累积证据" → 一直黄着变不回绿。
  if (!p.stuckChannelEnabled) return silence(state.stuckSustainer);
  if (f.systemIdle) return silence(state.stuckSustainer);
  if (f.texture !== 'idle') return silence(state.stuckSustainer);
  // 08-30：原来只挡 IRRELEVANT，UNKNOWN 会从缝里漏过去被判"卡住"——跟 DRIFT 通道
  // （`!== 'IRRELEVANT'` → false，UNKNOWN 一律保守挡住）的态度不一致，是契约红线1
  // "判出前一律保守"没有在 STUCK 通道落实到位。改成只放行确认 RELEVANT，语义变成
  // "确认在做正事、却停住不动了，才问是不是卡住了"——跟 DRIFT 通道对 UNKNOWN 一样保守。
  // 代价（0828 已记录、这次确认接受）：分类还没判出来的这段时间窗口内，两条通道都会
  // 沉默——比"对着可能无关的页面误判卡住"更能接受，是漏报换误报的取舍，不是免费修复。
  if (f.contextRelevance !== 'RELEVANT') return silence(state.stuckSustainer);
  if (f.contentFormat === 'short_feed') return silence(state.stuckSustainer);
  // ★ 09-11 真机复现：安静看一个仍在播放的相关视频（比如一节 20min 的教程），几分钟后被
  //   判"卡住"弹了 check-in。根因不在这条通道本身，是上游信号的盲区——video 的 `play` 事件
  //   只在开始播放那一刻发一次，持续播放中途不会再发，`stillnessMs`（也包括 `texture` 窗口
  //   耗尽后回落 'idle'）因此把"专心看着还在播的视频"和"人已经走开"算成同一回事。
  //   `f.mediaPlaying`（perceiver.ts computeMediaPlaying()）根据"最近一条 MEDIA_PLAY/PAUSE
  //   是不是 PLAY"推断视频当下还在播——播着就不该问"是不是卡住了"，这条通道问的是"停住不动
  //   了"，视频还在播就不是"停住"，跟 DRIFT 通道无关（DRIFT 判的是相关/不相关，不是这个）。
  if (f.mediaPlaying) return silence(state.stuckSustainer);

  // 净时长（扣除上次回答后的影响，09-11 追加扣除休息的影响）。
  // ★ 09-11 真机复现：休息结束后不久就弹出 STUCK check-in——`f.stillnessMs` 是从原始信号
  //   历史算的"距上次真实交互过了多久"（perceiver.ts computeStillnessMs()），完全不知道
  //   "休息"这件事——用户休息期间当然不会有任何交互，这段真实静止时长照样被算进
  //   stillnessMs。休息一结束，这段"休息造成的静止"立刻就够格判定"卡住"了：休息和卡住在
  //   信号层面长得一模一样（都是"没有交互"）。
  //   跟 `state.lastAnswerTs` 已经在做的事是同一个道理（"回答过 check-in 之后重新起算"）：
  //   `state.restEndedTs`（点"Back to it"/调用 endRest() 的那一刻，见 startRest() 顶部
  //   09-11 的注释——`restUntil` 现在是 Infinity/-Infinity 哨兵值，不再是真实时间戳，
  //   不能再拿它当"休息刚结束"的基准）标记的是"休息真正结束的时刻"，休息期间/刚结束这段
  //   不该被当成卡住证据，取跟 lastAnswerTs 更晚的那个作为起算点。
  const stillnessBaselineTs = Math.max(state.lastAnswerTs, state.restEndedTs);
  const effectiveStillnessMs = Math.min(f.stillnessMs, now - stillnessBaselineTs);
  const stuckThresholdMs = scaled(state.stuckThresholdMs, isDemoMode);

  return sustainedWithWindow(
    state.stuckSustainer,
    effectiveStillnessMs > stuckThresholdMs,
    now,
    SUSTAINED_EVIDENCE_MS
  );
}


// ── 休息模式提醒（契约v4 §3.8，场景23）：独立于 DRIFT/STUCK 的第三条提醒逻辑 ──
// 不产出 DetectionResult.action，只产出 UI 侧的轻声提醒事件；不经过公共闸口/持续器。

const REST_FIRST_REMINDER_MS = 15 * 60_000; // 首次轻声提醒：休息满 15 分钟
const REST_REPEAT_REMINDER_MS = 5 * 60_000; // 之后每 5 分钟重复提醒，直到用户回来
// restReminderDue 允许命中时刻在一次心跳节拍宽度内的误差（见下）。真实心跳目前是全局固定
// 1 分钟节拍，不会特意跟 restStartTs 对齐，所以判断不能要求"精确整除"——那样命中概率约等于 0。
const REST_REMINDER_TOLERANCE_MS = 60_000;

// "休息中、直到用户显式结束"的哨兵值。
// ★ 09-12 review 修的 bug：09-11 这里写的是 `Infinity`。设计意图没问题，但 BState 会经
//   setBState() 落进 chrome.storage.local，而 chrome.storage 按 JSON 语义序列化——
//   **`Infinity` 存进去变成 `null`**。SW 被回收（MV3 空闲 ~30s 就回收）再从 storage 水合
//   回来时 restUntil 是 null，`null > now` 恒为 false，双通道当场恢复监控，休息静默消失。
//   这恰恰是 09-11 要修的那个现象（"监控悄悄恢复"），只是换了条路径回来；而"休息 15 分钟
//   走开一趟"这个最典型的场景几乎必然触发它（人走开 → 没有事件 → SW 被回收）。
//   见 rest-persistence.test.ts。
//   MAX_SAFE_INTEGER 是 JSON 能原样表示的最大整数，跟任何真实时间戳比较都是"未来"，
//   语义上等价于 Infinity，但能活过存盘。
// ★ 顺带说明：其余字段用的 `-Infinity` 存盘后也会变 null——那些之所以"能用"，是因为 null
//   在 `now - null`/`null > now`/`Math.max(null, x)` 里恰好都被当成 0 处理，结果碰巧正确。
//   frame-pipeline.ts ensureBStateLoaded() 水合时已经统一用 `?? -Infinity` 把它们还原成
//   真正的初值，不再依赖这种巧合。
export const RESTING_INDEFINITELY = Number.MAX_SAFE_INTEGER;

/**
 * 用户主动点"休息"：就地把 restStartTs/restUntil 写进 BState（不再返回一个调用方需要
 * 自己记得回填的独立对象——之前 createRestState() 就是这样被落下的：返回值算对了，
 * 但从来没有任何调用方把它写回 state.restUntil，isDrifting/isStuck 的公共闸口读到的
 * 永远是初始值，"休息"点了也没用）。
 *
 * ★ 09-11：`restUntil` 不再是"now + 20min，到点自动恢复监控"——真机复现：demo mode 下这个
 *   窗口被压缩到 10s，用户还没来得及真的"休息"（开个新标签页、搜点东西）监控就已经悄悄
 *   恢复，弹出了 check-in，体验上完全不像"我说了要休息"该有的样子。改成"未来某个永远到
 *   不了的时刻"（RESTING_INDEFINITELY，09-12 从 Infinity 改成有限数，见其注释）：
 *   双通道保持静默，直到用户显式点"Back to it"（`endRest()`）——契约v4 §3.8 原文本来就是
 *   "可随时继续专注或结束专注"，从没说过"到点自动恢复"，这也更贴合契约原意，不是纯 demo
 *   mode 补丁，真实模式下同样受益（之前如果用户忘了点回去，20min 一到监控也会悄悄恢复）。
 *   15min 首次/之后每 5min 的轻声提醒不受影响——那部分只看 restStartTs（下面
 *   `restReminderDue()`），跟这里的 `restUntil` 无关，继续按 demo mode 压缩。
 */
export function startRest(state: BState, now: number): BState {
  state.restStartTs = now;
  state.restUntil = RESTING_INDEFINITELY;
  return state;
}

/**
 * 判断此刻是否该发一次"还在休息吗"的轻声提醒。
 * 只看 now 相对 restStartTs 的经过时长是否落在提醒节拍（15/20/25...分钟）附近一个心跳
 * 节拍宽度内——不能像之前那样要求经过时长精确整除：真实心跳是全局固定 1 分钟节拍，不会
 * 特意跟某次"点休息"的时刻对齐，精确取模在真实场景下基本永远不会命中。
 * 调用方约定：按心跳节拍（不要更密集地）调用本函数，节拍间隔需 ≤ REST_REMINDER_TOLERANCE_MS，
 * 这样每个提醒节拍只会落进一次心跳窗口，不会在同一节拍内被重复触发。
 */
export function restReminderDue(
  state: Pick<BState, 'restStartTs' | 'restSnoozedUntil'>,
  now: number,
  isDemoMode?: boolean
): boolean {
  // 09-11 真机反馈：首次提醒弹出后只有"Back to it"，没有"再休息 5 分钟"——用户不想现在
  // 回去、又不想被打扰，唯一的办法是放着不管，而放着不管每次心跳/RECHECK 都会重新判一次
  // "到点了吗"，答案照样是"到点了"，提醒因此形同虚设、赶都赶不走。这道闸门给了一个显式的
  // "我知道了，5 分钟后再问我"出口（snoozeRest()），在此之前不管自然节拍算出来是不是该提醒，
  // 都先不提醒。
  if (now < state.restSnoozedUntil) return false;
  const firstReminderMs = scaled(REST_FIRST_REMINDER_MS, isDemoMode);
  const repeatReminderMs = scaled(REST_REPEAT_REMINDER_MS, isDemoMode);
  // ★ 容差本身不压缩：它对应的是真实心跳节拍（chrome.alarms 硬性下限 1 分钟，demo mode
  //   改不了这个），不是这个函数自己判定用的逻辑阈值。demo mode 下 repeatReminderMs 会被
  //   压到比这个容差还小（5min/120 ≈ 2.5s < 60s），意味着"过了首次提醒点之后，只要心跳一到
  //   就一定判定为 due"——这是可以接受的代价：真实心跳的 60s 粒度本来就比压缩后的重复节拍粗，
  //   没法在这个粒度下还原"每 5min（压缩后）提醒一次"的精确节奏，demo 场景下"提醒常驻直到
  //   用户点回去"比"静默漏掉提醒"更符合这个功能本身的用途（演示/测试休息提醒确实会弹）。
  const elapsed = now - state.restStartTs;
  if (elapsed < firstReminderMs) return false;
  const sinceFirstReminder = elapsed - firstReminderMs;
  return sinceFirstReminder % repeatReminderMs < REST_REMINDER_TOLERANCE_MS;
}

/**
 * 用户在提醒里点了"再休息 5 分钟"：不结束休息（双通道仍然静默，restUntil 不变），
 * 只是让 restReminderDue() 在接下来这 5 分钟（demo mode 下按 scaled() 压缩）里都不再判定
 * "该提醒了"，snoozedUntil 一过，恢复正常节拍——如果那时用户还在休息，会照常再提醒一次。
 * 用固定时长的哨兵值而不是"往回拨 restStartTs"：后者要跟 restReminderDue() 内部的取模
 * 算法耦合在一起才能拨对（拨多拨少全看两个常量的相对大小），这里的字段直接表达意图，
 * 不用反推。
 */
export function snoozeRest(state: BState, now: number, isDemoMode?: boolean): BState {
  state.restSnoozedUntil = now + scaled(REST_REPEAT_REMINDER_MS, isDemoMode);
  return state;
}

/**
 * 决策入口函数。
 * 触发 check-in 的这一刻，就地把 state.lastCheckInTs 设成 now——这里就是"UI 真正弹出一次
 * check-in"的那个时刻，不需要再指望调用方另外记得写这一步（之前没人写，isDrifting/isStuck
 * 里 5 分钟冷却闸门读到的 lastCheckInTs 永远是初始值 -Infinity，冷却形同虚设）。
 */
export function evaluateFrame(
  frame: FeatureFrame,
  _archetype: 'CREATOR' | 'READER' | 'VIEWER', // 目前判定只依赖 policy；archetype 保留在签名里供调用方/措辞层使用
  policy: SignalPolicy,
  ctx: SessionContext,
  state: BState,
  now: number,
  isDemoMode?: boolean
): 'DO_NOTHING' | 'CHECK_IN_DRIFT' | 'CHECK_IN_STUCK' {
  if (isDrifting(frame, policy, ctx, state, now, isDemoMode)) {
    state.lastCheckInTs = now;
    return 'CHECK_IN_DRIFT';
  }
  if (isStuck(frame, policy, ctx, state, now, isDemoMode)) {
    state.lastCheckInTs = now;
    return 'CHECK_IN_STUCK';
  }
  return 'DO_NOTHING';
}


/**
 * B2：自适应退让启发式（单会话，据 CheckInFeedback 调阈值，契约v4 §3.6）。
 * 用户回答一次 check-in 后调用，就地修改 state 并返回它（方便链式/直接回存）。
 *
 * - 任何回答都算一次"有意义交互"：lastAnswerTs = now（契约v4 §2 anchor 注释——
 *   side panel 点"在专注"/"飘了"要和 STUCK 净时长共用同一个 lastAnswerTs 归零点）。
 * - STUCK 通道：
 *     答"在专注" → 阶梯前进一格，stuckThresholdMs 升到 policy.stuckLadderMs[新格]，
 *                  到最后一格（终态）后再答"在专注"不再前进（契约v4：取消 ∞ 静音，20min 封顶）。
 *     答"飘了"   → 微重启：阶梯重置回第 0 格，stuckThresholdMs 回到 policy.stuckLadderMs[0]。
 *   两种回答都清空 stuckSustainer，让 STUCK 证据从这一刻重新累计，不沿用回答前的旧计时。
 * - DRIFT 通道：DRIFT 没有阶梯，但答案同样让这一轮证据"翻篇"——清空 driftSustainer/passiveSince。
 *   FALSE_POSITIVE（"我在查资料"）要不要把当前域加入 sessionWhitelist 是 SessionContext 的事，
 *   BState 里没有这个字段，调用方自己用 FeatureFrame.currentDomain 去改 SessionContext。
 *
 * 集成待办（不在本函数职责内，留给 B9 状态机接线时处理）：
 *   契约v4 §3.7 `onCooldownEnd`（冷却期自然结束时清空两个 sustainer，防止用户完全没回答、
 *   冷却一过同一帧立刻又触发）目前还没人实现——这个需要在 state 上加一个"上一帧是否在冷却中"
 *   的边缘检测才能只触发一次，属于比本函数更深一层的改动，先记录，不在这次一并做。
 *   （`state.lastCheckInTs` 由谁来写这个问题已经解决：evaluateFrame() 触发 check-in 的那一刻
 *   就地写了，不用等这里。）
 */
export function applyCheckInFeedback(
  state: BState,
  policy: SignalPolicy,
  feedback: CheckInFeedback,
  now: number
): BState {
  state.lastAnswerTs = now;

  // 08-31 真机反馈后的产品决定：DRIFTED（"飘了"/"带我回去"）意味着用户刚承认自己走神——
  // 如果拉回去没多久又飘了，这次专注确实吃力，下一次该更快介入，不能跟"在专注"/"我在查
  // 资料"（用户主动确认没问题，值得给的信任）用同一档 5 分钟长冷却。两个通道都适用：
  // STUCK+DRIFTED 是微重启，DRIFT+DRIFTED 是真的被拉走，都算"承认走神"。
  state.checkinCooldownMs =
    feedback.answer === 'DRIFTED' ? DRIFTED_CHECKIN_COOLDOWN_MS : CHECKIN_COOLDOWN_MS;

  if (feedback.channel === 'STUCK') {
    const ladderLen = policy.stuckLadderMs.length;
    if (feedback.answer === 'FOCUSED' && ladderLen > 0) {
      state.stuckLadderIndex = Math.min(state.stuckLadderIndex + 1, ladderLen - 1);
      state.stuckThresholdMs = policy.stuckLadderMs[state.stuckLadderIndex];
    } else if (feedback.answer === 'DRIFTED') {
      // 微重启承诺的是"无条件"重置回第0格——不能因为当前 policy.stuckLadderMs 恰好是空数组
      // （比如运行时把档位切到了 STUCK 通道本就禁用的 VIEWER）就悄悄跳过，留下一个跟"已经
      // 微重启"的事实不符的旧索引/旧阈值。索引总是能归零；阈值没有数组可取时退回
      // DEFAULT_STUCK_LADDER[0]，跟 validatePolicy() 对空 stuckLadderMs 的兜底策略一致。
      state.stuckLadderIndex = 0;
      state.stuckThresholdMs = policy.stuckLadderMs[0] ?? DEFAULT_STUCK_LADDER[0];
    }
    state.stuckSustainer.since = null;
  }

  if (feedback.channel === 'DRIFT') {
    state.driftSustainer.since = null;
    state.passiveSince = null;
  }

  return state;
}