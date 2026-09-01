// B2：自适应退让启发式单测——applyCheckInFeedback（契约v4 §3.6）。
// 阶梯前进的目标值对照 integration.test.ts 的 SCENARIO_OVERRIDES（场景2/7 的"会话前情"），
// 那两个 override 就是"用户已经答过一次『在专注』之后"的状态快照，用它反推函数行为是否正确。
import { describe, it, expect } from 'vitest';
import { applyCheckInFeedback } from './detector';
import {
  createInitialBState,
  PROFILE_PRESETS,
  CheckInFeedback,
  DEFAULT_STUCK_LADDER,
  CHECKIN_COOLDOWN_MS,
  DRIFTED_CHECKIN_COOLDOWN_MS,
} from './types';

describe('B2: applyCheckInFeedback', () => {
  it('STUCK+FOCUSED：READER 从第0格推进到第1格，阈值变 20min（对照场景7 override）', () => {
    const state = createInitialBState('READER');
    expect(state.stuckThresholdMs).toBe(10 * 60_000); // READER 初始 10min
    const feedback: CheckInFeedback = { channel: 'STUCK', answer: 'FOCUSED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.READER, feedback, 700_000);
    expect(state.stuckLadderIndex).toBe(1);
    expect(state.stuckThresholdMs).toBe(20 * 60_000); // 对照 SCENARIO_OVERRIDES[7].stuckThresholdMs
    expect(state.lastAnswerTs).toBe(700_000);
  });

  it('STUCK+FOCUSED：到终态后再答一次不再前进（取消 ∞ 静音，20min 封顶）', () => {
    const state = createInitialBState('READER');
    const feedback: CheckInFeedback = { channel: 'STUCK', answer: 'FOCUSED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.READER, feedback, 700_000);
    applyCheckInFeedback(state, PROFILE_PRESETS.READER, feedback, 1_800_000); // 再答一次
    expect(state.stuckLadderIndex).toBe(1); // READER 阶梯只有两格，停在最后一格
    expect(state.stuckThresholdMs).toBe(20 * 60_000);
  });

  it('STUCK+DRIFTED：微重启，阶梯重置回第0格', () => {
    const state = createInitialBState('READER');
    state.stuckLadderIndex = 1;
    state.stuckThresholdMs = 20 * 60_000;
    const feedback: CheckInFeedback = { channel: 'STUCK', answer: 'DRIFTED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.READER, feedback, 900_000);
    expect(state.stuckLadderIndex).toBe(0);
    expect(state.stuckThresholdMs).toBe(10 * 60_000);
  });

  it('任意回答都清零 lastAnswerTs（供 STUCK 净时长 effectiveStillnessMs 使用）', () => {
    const state = createInitialBState('CREATOR');
    const feedback: CheckInFeedback = { channel: 'DRIFT', answer: 'DRIFTED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, feedback, 123_456);
    expect(state.lastAnswerTs).toBe(123_456);
  });

  it('STUCK+DRIFTED：即使 policy.stuckLadderMs 是空数组（VIEWER 档）也无条件重置索引，阈值退回 DEFAULT_STUCK_LADDER[0]', () => {
    const state = createInitialBState('CREATOR');
    state.stuckLadderIndex = 1;
    state.stuckThresholdMs = 20 * 60_000;
    const feedback: CheckInFeedback = { channel: 'STUCK', answer: 'DRIFTED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.VIEWER, feedback, 900_000);
    expect(state.stuckLadderIndex).toBe(0);
    expect(state.stuckThresholdMs).toBe(DEFAULT_STUCK_LADDER[0]);
  });

  it('DRIFT 通道回答清空 driftSustainer/passiveSince，不碰 STUCK 阶梯', () => {
    const state = createInitialBState('CREATOR');
    state.driftSustainer.since = 50_000;
    state.passiveSince = 40_000;
    const feedback: CheckInFeedback = { channel: 'DRIFT', answer: 'FALSE_POSITIVE' };
    applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, feedback, 200_000);
    expect(state.driftSustainer.since).toBeNull();
    expect(state.passiveSince).toBeNull();
    expect(state.stuckLadderIndex).toBe(0); // 未变
  });

  it('STUCK 通道回答清空 stuckSustainer，不碰 driftSustainer', () => {
    const state = createInitialBState('CREATOR');
    state.stuckSustainer.since = 50_000;
    state.driftSustainer.since = 60_000;
    const feedback: CheckInFeedback = { channel: 'STUCK', answer: 'FOCUSED' };
    applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, feedback, 200_000);
    expect(state.stuckSustainer.since).toBeNull();
    expect(state.driftSustainer.since).toBe(60_000); // 未变
  });

  // 08-31 真机反馈：拉回去没多久又飘了，5 分钟长冷却让下一次提醒太晚——DRIFTED 答案该用
  // 更短的冷却，FOCUSED/FALSE_POSITIVE（用户主动确认没问题）仍用长冷却。
  describe('checkinCooldownMs：按回答区分冷却长短', () => {
    it('从没回答过时默认长冷却', () => {
      const state = createInitialBState('CREATOR');
      expect(state.checkinCooldownMs).toBe(CHECKIN_COOLDOWN_MS);
    });

    it('DRIFT+DRIFTED（被拉回去）→ 短冷却', () => {
      const state = createInitialBState('CREATOR');
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'DRIFT', answer: 'DRIFTED' }, 100_000);
      expect(state.checkinCooldownMs).toBe(DRIFTED_CHECKIN_COOLDOWN_MS);
    });

    it('STUCK+DRIFTED（微重启）→ 短冷却', () => {
      const state = createInitialBState('CREATOR');
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'STUCK', answer: 'DRIFTED' }, 100_000);
      expect(state.checkinCooldownMs).toBe(DRIFTED_CHECKIN_COOLDOWN_MS);
    });

    it('STUCK+FOCUSED（用户确认在专注）→ 长冷却', () => {
      const state = createInitialBState('CREATOR');
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'STUCK', answer: 'FOCUSED' }, 100_000);
      expect(state.checkinCooldownMs).toBe(CHECKIN_COOLDOWN_MS);
    });

    it('DRIFT+FALSE_POSITIVE（用户确认在查资料）→ 长冷却', () => {
      const state = createInitialBState('CREATOR');
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'DRIFT', answer: 'FALSE_POSITIVE' }, 100_000);
      expect(state.checkinCooldownMs).toBe(CHECKIN_COOLDOWN_MS);
    });

    it('短冷却答过之后再答一次长冷却答案，恢复长冷却（不会卡在短冷却）', () => {
      const state = createInitialBState('CREATOR');
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'DRIFT', answer: 'DRIFTED' }, 100_000);
      expect(state.checkinCooldownMs).toBe(DRIFTED_CHECKIN_COOLDOWN_MS);
      applyCheckInFeedback(state, PROFILE_PRESETS.CREATOR, { channel: 'STUCK', answer: 'FOCUSED' }, 200_000);
      expect(state.checkinCooldownMs).toBe(CHECKIN_COOLDOWN_MS);
    });
  });
});