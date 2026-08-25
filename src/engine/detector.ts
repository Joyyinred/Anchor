import { FeatureFrame, SignalPolicy, SessionContext } from './types';

// B 侧内部状态接口
export interface BState {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;
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
export interface RestState {
  restUntil: number;
  restStartTs: number;
}

const REST_FIRST_REMINDER_MS = 15 * 60_000; // 首次轻声提醒：休息满 15 分钟
const REST_REPEAT_REMINDER_MS = 5 * 60_000; // 之后每 5 分钟重复提醒，直到用户回来

/**
 * 用户主动点"休息"时创建 RestState：restUntil = now + 20min（契约v4 §3.8），
 * 期间 isDrifting/isStuck 的公共闸口 `state.restUntil > now` 会让双通道全静默。
 */
export function createRestState(restStartTs: number): RestState {
  return { restStartTs, restUntil: restStartTs + 20 * 60_000 };
}

/**
 * 判断此刻是否该发一次"还在休息吗"的轻声提醒。
 * 纯函数：只看 now 相对 restStartTs 的经过时长是否恰好落在提醒节拍（15/20/25...分钟）上。
 * 注：真实系统里心跳节拍要与 restStartTs 对齐（休息开始时另起一个专属 alarm，而不是复用
 * 全局 1 分钟心跳的任意相位）才能稳定命中整除点，这是已知的对齐假设，不是本函数要处理的问题。
 */
export function restReminderDue(state: Pick<RestState, 'restStartTs'>, now: number): boolean {
  const elapsed = now - state.restStartTs;
  if (elapsed < REST_FIRST_REMINDER_MS) return false;
  return (elapsed - REST_FIRST_REMINDER_MS) % REST_REPEAT_REMINDER_MS === 0;
}

/**
 * 决策入口函数
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
    return 'CHECK_IN_DRIFT';
  }
  if (isStuck(frame, policy, ctx, state, now, isDemoMode)) {
    return 'CHECK_IN_STUCK';
  }
  return 'DO_NOTHING';
}