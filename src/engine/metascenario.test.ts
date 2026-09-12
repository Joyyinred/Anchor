// 场景22（无起步教练默认策略）与场景23（休息模式提醒）是契约里标注的"独立函数验收"
// （defaultSessionContext / restReminderDue），不走 events.json → FeatureFrame → DetectionResult
// 这条主线——integration.test.ts 的 SKIP_SCENARIO_IDS 特意跳过了这两个场景 id 并注明原因。
// 这个文件补上那两个"独立函数验收"，断言对齐 mock/frames.json 里 metaScenarios 字段的 checks 描述。
import { describe, it, expect } from 'vitest';
import {
  defaultSessionContext,
  validatePolicy,
  createInitialBState,
  DEFAULT_STUCK_LADDER,
  DEFAULT_ANCHOR_THRESHOLD,
  PROFILE_PRESETS,
  SignalPolicy,
} from './types';
import { startRest, restReminderDue, snoozeRest, RESTING_INDEFINITELY } from './detector';

describe('场景22：无起步教练默认策略', () => {
  const now = 1_000_000;

  it('默认画像是 CREATOR', () => {
    expect(defaultSessionContext(now).profile.archetype).toBe('CREATOR');
  });

  it('graceUntil = now + 2分钟', () => {
    expect(defaultSessionContext(now).graceUntil).toBe(now + 120_000);
  });

  // 08-28 回归测试：之前 graceUntil 完全没接 isDemoMode，起步教练做完（或跳过起步走这个兜底）
  // 那一刻宽限期永远是 2 个真实分钟，demo 模式压不到它——紧接着切走会被 detector.ts 的公共闸口
  // `now < ctx.graceUntil` 全部静默掉。
  // 09-11：压缩倍数从 120x 调到 30x（demo 节奏太快、边操作边讲解跟不上），2min/30=4000ms。
  it('DEMO_MODE 下 graceUntil 同样按 30x 压缩', () => {
    expect(defaultSessionContext(now, undefined, undefined, true).graceUntil).toBe(now + 4_000);
  });

  it('锚点 matchMode 是 exact', () => {
    expect(defaultSessionContext(now).anchor.matchMode).toBe('exact');
  });

  it('可以带入 A 侧推断出的锚点（当前活跃时长最久的 tab）', () => {
    const ctx = defaultSessionContext(now, { domain: 'vscode.dev', url: 'https://vscode.dev/proj' });
    expect(ctx.anchor).toEqual({ domain: 'vscode.dev', url: 'https://vscode.dev/proj', matchMode: 'exact' });
  });

  it('未传锚点时留空，不虚构一个假锚点', () => {
    expect(defaultSessionContext(now).anchor).toEqual({ domain: '', url: '', matchMode: 'exact' });
  });

  it('taskDeclaration 有默认文案，且不阻断工作（不要求用户先声明任务）', () => {
    expect(defaultSessionContext(now).taskDeclaration.length).toBeGreaterThan(0);
  });

  it('validatePolicy 对空 stuckLadderMs 有兜底默认值', () => {
    const p: SignalPolicy = {
      muteJumpPattern: false,
      mutePassiveTexture: false,
      stuckChannelEnabled: true,
      anchorDetachedThresholdMs: 8 * 60_000,
      stuckLadderMs: [],
    };
    expect(validatePolicy(p).stuckLadderMs).toEqual(DEFAULT_STUCK_LADDER);
  });

  it('validatePolicy 对非法（<=0）anchorDetachedThresholdMs 有兜底默认值', () => {
    const p: SignalPolicy = {
      muteJumpPattern: false,
      mutePassiveTexture: false,
      stuckChannelEnabled: true,
      anchorDetachedThresholdMs: -1,
      stuckLadderMs: [10 * 60_000],
    };
    expect(validatePolicy(p).anchorDetachedThresholdMs).toBe(DEFAULT_ANCHOR_THRESHOLD);
  });

  it('defaultSessionContext 内部已经过 validatePolicy 兜底（防御性处理，防止预设被改坏）', () => {
    const policy = defaultSessionContext(now).profile.policy;
    expect(policy.stuckLadderMs.length).toBeGreaterThan(0);
    expect(policy.anchorDetachedThresholdMs).toBeGreaterThan(0);
  });

  it('真正是防御性拷贝：改动返回的 policy.stuckLadderMs 不会连带改坏全局 PROFILE_PRESETS.CREATOR', () => {
    const original = [...PROFILE_PRESETS.CREATOR.stuckLadderMs];
    const policy = defaultSessionContext(now).profile.policy;
    policy.stuckLadderMs.push(999);
    expect(policy.stuckLadderMs).not.toBe(PROFILE_PRESETS.CREATOR.stuckLadderMs);
    expect(PROFILE_PRESETS.CREATOR.stuckLadderMs).toEqual(original);
  });

  it('validatePolicy 兜底空 stuckLadderMs 时也是拷贝，不会把 DEFAULT_STUCK_LADDER 这个模块常量本身暴露给调用方修改', () => {
    const p: SignalPolicy = {
      muteJumpPattern: false,
      mutePassiveTexture: false,
      stuckChannelEnabled: true,
      anchorDetachedThresholdMs: 8 * 60_000,
      stuckLadderMs: [],
    };
    const validated = validatePolicy(p);
    expect(validated.stuckLadderMs).not.toBe(DEFAULT_STUCK_LADDER);
    validated.stuckLadderMs.push(999);
    expect(DEFAULT_STUCK_LADDER).toEqual([10 * 60_000, 20 * 60_000]);
  });
});

describe('场景23：休息模式无人应答提醒（15min 首次，之后每 5min 重复）', () => {
  const restStartTs = 0;

  // startRest 就地改 BState，每条用例要一份全新的初始状态，不能互相共用。
  function buildRestState() {
    return startRest(createInitialBState('CREATOR'), restStartTs);
  }

  it('休息满 15 分钟：首次轻声提醒', () => {
    const state = buildRestState();
    expect(restReminderDue(state, restStartTs + 15 * 60_000)).toBe(true);
  });

  it('休息满 20 分钟：第二次提醒', () => {
    const state = buildRestState();
    expect(restReminderDue(state, restStartTs + 20 * 60_000)).toBe(true);
  });

  it('休息满 25 分钟：第三次提醒（持续每 5min）', () => {
    const state = buildRestState();
    expect(restReminderDue(state, restStartTs + 25 * 60_000)).toBe(true);
  });

  it('休息 17 分钟：还没到下一个提醒节拍，不提醒', () => {
    const state = buildRestState();
    expect(restReminderDue(state, restStartTs + 17 * 60_000)).toBe(false);
  });

  it('休息不满 15 分钟：还不到首次提醒时间，不提醒', () => {
    const state = buildRestState();
    expect(restReminderDue(state, restStartTs + 5 * 60_000)).toBe(false);
  });

  // 09-11：真机复现休息窗口自然到期后监控悄悄恢复、用户还没来得及真的"休息"就被 check-in
  // 打断——改成不自动到期，restUntil 变成 RESTING_INDEFINITELY 这个哨兵值，双通道保持静默直到用户
  // 显式点"Back to it"（endRest()）。20min 这个数字不再有实际含义，见 detector.ts
  // startRest() 顶部 09-11 的注释。
  it('restUntil = RESTING_INDEFINITELY，不再是"到点自动恢复"的真实时间戳，供 isDrifting/isStuck 公共闸口无限期静默', () => {
    const state = buildRestState();
    // 09-12：哨兵值从 Infinity 改成 JSON 能存的有限数（chrome.storage 会把 Infinity 存成 null，
    // 休息状态一过 SW 回收就丢——见 rest-persistence.test.ts），语义仍是"永远到不了的未来"。
    expect(state.restUntil).toBe(RESTING_INDEFINITELY);
    expect(state.restUntil).toBeGreaterThan(Date.now() + 100 * 365 * 24 * 3600 * 1000);
  });

  it('startRest 就地写 state，不是返回一个游离对象——调用方不会漏接线', () => {
    const state = createInitialBState('CREATOR');
    expect(state.restUntil).toBe(-Infinity);
    const returned = startRest(state, restStartTs);
    // 09-12：哨兵值从 Infinity 改成 JSON 能存的有限数（chrome.storage 会把 Infinity 存成 null，
    // 休息状态一过 SW 回收就丢——见 rest-persistence.test.ts），语义仍是"永远到不了的未来"。
    expect(state.restUntil).toBe(RESTING_INDEFINITELY);
    expect(state.restUntil).toBeGreaterThan(Date.now() + 100 * 365 * 24 * 3600 * 1000);
    expect(returned).toBe(state);
  });

  // 09-11 真机反馈：demo mode 下点"休息"，等了一会儿也不出现提醒——restReminderDue()
  // 原来完全没接 scaled()，15min/5min 全是真实时间的字面量，demo mode 的压缩对
  // 这条功能形同虚设。这组用例锁死"接上了"这件事，压缩系数用 types.ts 的 DEMO_TIME_SCALE
  // （09-11 当天晚些时候从 1/120 调到 1/30，见 types.ts 顶部注释——demo 节奏太快、
  // 边操作边讲解跟不上）。
  // （restUntil 本身不再参与这个压缩——见上面 09-11 的说明，只有提醒节拍还是时间驱动的。）
  describe('demo mode：15min/5min 提醒节拍要按 1/30 压缩', () => {
    it('首次提醒压缩成 15min/30 = 30s', () => {
      const state = buildRestState();
      expect(restReminderDue(state, restStartTs + 30_000, true)).toBe(true);
    });

    it('压缩后首次提醒之前不提醒', () => {
      const state = buildRestState();
      expect(restReminderDue(state, restStartTs + 20_000, true)).toBe(false);
    });

    it('不传 isDemoMode 时保持真实时间阈值，不受这次改动影响', () => {
      const state = buildRestState();
      expect(restReminderDue(state, restStartTs + 30_000)).toBe(false);
    });
  });

  // 09-11 真机反馈：提醒弹出后只有"Back to it"，没有"再休息 5 分钟"——用户不想现在回去
  // 又不想被打扰，只能放着不管，但放着不管每次评估都会重新判一次"到点了"，提醒赶不走。
  describe('snoozeRest：点"再休息 5 分钟"之后，5 分钟内不再判定"该提醒了"', () => {
    it('首次提醒时点了 snooze，当下立刻不再判定为 due', () => {
      const state = buildRestState();
      const snoozeAt = restStartTs + 15 * 60_000; // 首次提醒弹出的那一刻
      expect(restReminderDue(state, snoozeAt)).toBe(true); // 没点 snooze 之前确实是 due
      snoozeRest(state, snoozeAt);
      expect(restReminderDue(state, snoozeAt)).toBe(false); // 点完立刻不再 due
    });

    it('snooze 未满 5 分钟：仍然不提醒', () => {
      const state = buildRestState();
      const snoozeAt = restStartTs + 15 * 60_000;
      snoozeRest(state, snoozeAt);
      expect(restReminderDue(state, snoozeAt + 4 * 60_000)).toBe(false);
    });

    it('snooze 满 5 分钟：恢复正常节拍，重新提醒', () => {
      const state = buildRestState();
      const snoozeAt = restStartTs + 15 * 60_000;
      snoozeRest(state, snoozeAt);
      expect(restReminderDue(state, snoozeAt + 5 * 60_000)).toBe(true);
    });

    it('demo mode 下 snooze 时长同样按 1/30 压缩（5min/30 = 10s）', () => {
      const state = buildRestState();
      const snoozeAt = restStartTs + 15 * 60_000;
      snoozeRest(state, snoozeAt, true);
      expect(restReminderDue(state, snoozeAt + 8_000, true)).toBe(false);
      expect(restReminderDue(state, snoozeAt + 10_000, true)).toBe(true);
    });

    it('snoozeRest 就地写 state，不是返回一个游离对象', () => {
      const state = createInitialBState('CREATOR');
      expect(state.restSnoozedUntil).toBe(-Infinity);
      const returned = snoozeRest(state, restStartTs);
      expect(state.restSnoozedUntil).toBe(restStartTs + 5 * 60_000);
      expect(returned).toBe(state);
    });
  });
});