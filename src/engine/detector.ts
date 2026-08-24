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

  // 1. 形态硬判：Shorts + 锚点抛弃
  if (f.contentFormat === 'short_feed' && f.anchorDetachedMs > p.anchorDetachedThresholdMs) {
    return sustainedWithWindow(state.driftSustainer, true, now, SUSTAINED_EVIDENCE_MS);
  }

  // 非相关性短路
  if (f.contextRelevance !== 'IRRELEVANT') {
    return sustainedWithWindow(state.driftSustainer, false, now, SUSTAINED_EVIDENCE_MS);
  }

  const anchorAbandoned = f.anchorDetachedMs > p.anchorDetachedThresholdMs;

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

  return sustainedWithWindow(
    state.stuckSustainer,
    effectiveStillnessMs > state.stuckThresholdMs,
    now,
    SUSTAINED_EVIDENCE_MS
  );
}

/**
 * 决策入口函数
 */
export function evaluateFrame(
  frame: FeatureFrame,
  archetype: 'CREATOR' | 'READER' | 'VIEWER',
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