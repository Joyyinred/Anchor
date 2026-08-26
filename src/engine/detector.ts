import { FeatureFrame, SignalPolicy, SessionContext, CheckInFeedback, DEFAULT_STUCK_LADDER } from './types';

// B 侧内部状态接口
export interface BState {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;
  restStartTs: number;
  driftSustainer: { since: number | null };
  stuckSustainer: { since: number | null };
  passiveSince: number | null;
}

// 演示模式时间缩放因子 (Demo 模式按 120x 压缩)
const getTimeScale = (isDemoMode?: boolean) => (isDemoMode ? 1 / 120 : 1);
const scaled = (ms: number, isDemoMode?: boolean) => ms * getTimeScale(isDemoMode);

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

// 辅助：判断是否连续被动纹理
function isContinuouslyPassive(
  state: BState,
  f: FeatureFrame,
  now: number,
  thresholdMs: number
): boolean {
  if (f.texture !== 'passive') {
    state.passiveSince = null;
    return false;
  }
  if (state.passiveSince === null) {
    state.passiveSince = now;
  }
  return now - state.passiveSince >= thresholdMs;
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
  const CHECKIN_COOLDOWN_MS = scaled(300_000, isDemoMode); // 5分钟冷却
  const SUSTAINED_EVIDENCE_MS = scaled(30_000, isDemoMode); // 30s 持续窗口

  // 公共闸口
  if (state.restUntil > now) return false;
  if (now - state.lastCheckInTs < CHECKIN_COOLDOWN_MS) return false;
  if (now < ctx.graceUntil) return false;

  // DEMO_MODE 下 policy 里的阈值常量本身也要压缩（契约v4 §3.2），否则 demo 事件流用的是
  // 压缩后的小时间戳，而阈值仍是真实 8min/15min，比较永远不成立。
  const anchorDetachedThresholdMs = scaled(p.anchorDetachedThresholdMs, isDemoMode);

  // 1. 形态硬判：Shorts + 锚点抛弃
  if (f.contentFormat === 'short_feed' && f.anchorDetachedMs > anchorDetachedThresholdMs) {
    return sustainedWithWindow(state.driftSustainer, true, now, SUSTAINED_EVIDENCE_MS);
  }

  // 非相关性短路
  if (f.contextRelevance !== 'IRRELEVANT') {
    return sustainedWithWindow(state.driftSustainer, false, now, SUSTAINED_EVIDENCE_MS);
  }

  const anchorAbandoned = f.anchorDetachedMs > anchorDetachedThresholdMs;

  // 纹理证据：连续 passive 达到门槛
  const textureEvidence =
    !p.mutePassiveTexture && isContinuouslyPassive(state, f, now, scaled(60_000, isDemoMode));

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
  const CHECKIN_COOLDOWN_MS = scaled(300_000, isDemoMode);
  const SUSTAINED_EVIDENCE_MS = scaled(30_000, isDemoMode);

  // 公共闸口
  if (state.restUntil > now) return false;
  if (now - state.lastCheckInTs < CHECKIN_COOLDOWN_MS) return false;
  if (now < ctx.graceUntil) return false;

  if (!p.stuckChannelEnabled) return false;
  if (f.systemIdle) return false;
  if (f.texture !== 'idle') return false;
  if (f.contextRelevance === 'IRRELEVANT') return false;
  if (f.contentFormat === 'short_feed') return false;

  // 净时长（扣除上次回答后的影响）
  const effectiveStillnessMs = Math.min(f.stillnessMs, now - state.lastAnswerTs);
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

/**
 * 用户主动点"休息"：就地把 restStartTs/restUntil 写进 BState（不再返回一个调用方需要
 * 自己记得回填的独立对象——之前 createRestState() 就是这样被落下的：返回值算对了，
 * 但从来没有任何调用方把它写回 state.restUntil，isDrifting/isStuck 的公共闸口读到的
 * 永远是初始值，"休息"点了也没用）。restUntil = now + 20min（契约v4 §3.8），期间
 * isDrifting/isStuck 的公共闸口 `state.restUntil > now` 会让双通道全静默。
 */
export function startRest(state: BState, now: number): BState {
  state.restStartTs = now;
  state.restUntil = now + 20 * 60_000;
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
export function restReminderDue(state: Pick<BState, 'restStartTs'>, now: number): boolean {
  const elapsed = now - state.restStartTs;
  if (elapsed < REST_FIRST_REMINDER_MS) return false;
  const sinceFirstReminder = elapsed - REST_FIRST_REMINDER_MS;
  return sinceFirstReminder % REST_REPEAT_REMINDER_MS < REST_REMINDER_TOLERANCE_MS;
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