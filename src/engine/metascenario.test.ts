// 场景22（无起步教练默认策略）与场景23（休息模式提醒）是契约里标注的"独立函数验收"
// （defaultSessionContext / restReminderDue），不走 events.json → FeatureFrame → DetectionResult
// 这条主线——integration.test.ts 的 SKIP_SCENARIO_IDS 特意跳过了这两个场景 id 并注明原因。
// 这个文件补上那两个"独立函数验收"，断言对齐 mock/frames.json 里 metaScenarios 字段的 checks 描述。
import { describe, it, expect } from 'vitest';
import {
  defaultSessionContext,
  validatePolicy,
  DEFAULT_STUCK_LADDER,
  DEFAULT_ANCHOR_THRESHOLD,
  SignalPolicy,
} from './types';
import { createRestState, restReminderDue } from './detector';

describe('场景22：无起步教练默认策略', () => {
  const now = 1_000_000;

  it('默认画像是 CREATOR', () => {
    expect(defaultSessionContext(now).profile.archetype).toBe('CREATOR');
  });

  it('graceUntil = now + 2分钟', () => {
    expect(defaultSessionContext(now).graceUntil).toBe(now + 120_000);
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
});

describe('场景23：休息模式无人应答提醒（15min 首次，之后每 5min 重复）', () => {
  const restStartTs = 0;

  it('休息满 15 分钟：首次轻声提醒', () => {
    const state = createRestState(restStartTs);
    expect(restReminderDue(state, restStartTs + 15 * 60_000)).toBe(true);
  });

  it('休息满 20 分钟：第二次提醒', () => {
    const state = createRestState(restStartTs);
    expect(restReminderDue(state, restStartTs + 20 * 60_000)).toBe(true);
  });

  it('休息满 25 分钟：第三次提醒（持续每 5min）', () => {
    const state = createRestState(restStartTs);
    expect(restReminderDue(state, restStartTs + 25 * 60_000)).toBe(true);
  });

  it('休息 17 分钟：还没到下一个提醒节拍，不提醒', () => {
    const state = createRestState(restStartTs);
    expect(restReminderDue(state, restStartTs + 17 * 60_000)).toBe(false);
  });

  it('休息不满 15 分钟：还不到首次提醒时间，不提醒', () => {
    const state = createRestState(restStartTs);
    expect(restReminderDue(state, restStartTs + 5 * 60_000)).toBe(false);
  });

  it('restUntil = restStartTs + 20分钟，供 isDrifting/isStuck 公共闸口使用', () => {
    const state = createRestState(restStartTs);
    expect(state.restUntil).toBe(restStartTs + 20 * 60_000);
  });
});