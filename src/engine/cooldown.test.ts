// B10 单测：契约v4 §3.7「冷却后持续器重置」
//
// 要防的场景：用户看到 check-in 气泡但**没有回答**（直接忽略）。
// 没有这条规则时：check-in 触发那一刻 lastCheckInTs = now，之后 5 分钟冷却期里
// isDrifting/isStuck 在闸口提前 return、碰不到持续器，于是 driftSustainer.since 一直停在
// check-in 之前那一刻；冷却一结束的第一帧，`now - since` 早已远超 30s 窗口，
// **同一批旧证据立刻又触发一次** —— 用户被同一件事连着问两遍，中间毫无喘息。
//
// 注意这跟 applyCheckInFeedback（B2）清持续器是两条独立路径：那条只在用户**回答了**时才走。
import { describe, it, expect } from 'vitest';
import { evaluateFrame, applyCheckInFeedback, type BState } from './detector';
import {
  createInitialBState,
  PROFILE_PRESETS,
  DRIFTED_CHECKIN_COOLDOWN_MS,
  type CheckInFeedback,
  type FeatureFrame,
  type SessionContext,
} from './types';

const COOLDOWN_MS = 300_000; // 契约v4 §3.4/§3.5：5 分钟（FOCUSED/FALSE_POSITIVE 后仍是这个值）
const SUSTAIN_MS = 30_000; // 30s 持续窗口

function ctxOf(): SessionContext {
  const preset = PROFILE_PRESETS.CREATOR;
  return {
    sessionId: 'cooldown-test',
    taskDeclaration: 'test task',
    profile: { archetype: 'CREATOR', policy: preset },
    anchor: { domain: 'anchor.test', url: 'https://anchor.test/', matchMode: preset.matchMode },
    sessionWhitelist: [],
    graceUntil: 0,
  };
}

/** 一帧"确凿的 DRIFT 证据"：无关页 + 锚点早已抛弃 + 非主动纹理。 */
function driftFrame(now: number): FeatureFrame {
  return {
    timestamp: now,
    sessionId: 'cooldown-test',
    contextRelevance: 'IRRELEVANT',
    anchorDetachedMs: 30 * 60_000,
    texture: 'passive',
    jumpPattern: 'stable',
    stillnessMs: 0,
    entryIntent: 'unknown',
    contentFormat: 'standard',
    systemIdle: false,
    lastAnchorSnapshot: { title: 'work.md', url: 'https://anchor.test/', ts: now - 30 * 60_000 },
    currentDomain: 'distraction.test',
    currentTitle: 'Distraction',
    currentContentKind: 'video',
    currentUrl: 'https://distraction.test/',
  };
}

/** 从 t0 起每 10s 喂一帧，直到 endTs；返回触发过 check-in 的时刻列表。 */
function replay(state: BState, t0: number, endTs: number): number[] {
  const ctx = ctxOf();
  const fired: number[] = [];
  for (let t = t0; t <= endTs; t += 10_000) {
    const action = evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t);
    if (action !== 'DO_NOTHING') fired.push(t);
  }
  return fired;
}

describe('B10 / 契约v4 §3.7：冷却结束后不能立刻用旧证据重复触发', () => {
  const T0 = 10_000_000;

  it('★ 用户不回答时，两次 check-in 之间必须 > 冷却时长，不能冷却一过就立刻再问', () => {
    const state = createInitialBState('CREATOR');
    // 连续喂 20 分钟的确凿走神证据，全程不调用 applyCheckInFeedback（模拟用户直接忽略气泡）
    const fired = replay(state, T0, T0 + 20 * 60_000);

    expect(fired.length).toBeGreaterThanOrEqual(2); // 20 分钟里该问不止一次

    for (let i = 1; i < fired.length; i++) {
      const gap = fired[i] - fired[i - 1];
      // 冷却 5min + 重新攒满 30s 证据 ≈ 至少 5.5 分钟。
      // 没有 §3.7 时这里会是恰好 COOLDOWN_MS（冷却一过立刻触发），断言就会挂。
      expect(gap).toBeGreaterThan(COOLDOWN_MS);
      expect(gap).toBeGreaterThanOrEqual(COOLDOWN_MS + SUSTAIN_MS);
    }
  });

  it('冷却刚结束的那一帧不会触发——证据要从零重新累积', () => {
    const state = createInitialBState('CREATOR');
    const ctx = ctxOf();
    // 先喂到第一次触发
    let firstFire = -1;
    for (let t = T0; t < T0 + 5 * 60_000; t += 10_000) {
      if (evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t) !== 'DO_NOTHING') {
        firstFire = t;
        break;
      }
    }
    expect(firstFire).toBeGreaterThan(0);

    // 冷却刚过一点点的那一帧
    const justAfterCooldown = firstFire + COOLDOWN_MS + 1_000;
    const action = evaluateFrame(
      driftFrame(justAfterCooldown), 'CREATOR', ctx.profile.policy, ctx, state, justAfterCooldown
    );
    expect(action).toBe('DO_NOTHING'); // ← 没有 §3.7 时这里会是 CHECK_IN_DRIFT
  });

  it('从没触发过 check-in 时（lastCheckInTs = -Infinity）不误伤正在累积的证据', () => {
    const state = createInitialBState('CREATOR');
    // DRIFT 的证据是两段串联的：先连续 60s 非主动纹理（passiveSince），再满 30s 持续窗口
    // （driftSustainer）——所以头 60 秒里 driftSustainer 本来就该是 null，那是正常累积过程，
    // 不是被 discard 清掉的。这里验证的是"整个累积过程没被打断、最终能正常触发"。
    const fired = replay(state, T0, T0 + 3 * 60_000);
    expect(fired.length).toBeGreaterThan(0);
    // 60s 纹理 + 30s 持续 ≈ 90s，给一点余量
    expect(fired[0] - T0).toBeLessThanOrEqual(120_000);
  });

  it('冷却期内本来就不该触发（原有行为，回归保护）', () => {
    const state = createInitialBState('CREATOR');
    const ctx = ctxOf();
    let firstFire = -1;
    for (let t = T0; t < T0 + 5 * 60_000; t += 10_000) {
      if (evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t) !== 'DO_NOTHING') {
        firstFire = t;
        break;
      }
    }
    for (let t = firstFire + 10_000; t < firstFire + COOLDOWN_MS; t += 10_000) {
      expect(evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t)).toBe('DO_NOTHING');
    }
  });
});

describe('08-31：DRIFTED 答案用短冷却，不用陪 FOCUSED/FALSE_POSITIVE 那档 5 分钟长冷却', () => {
  const T0 = 20_000_000;

  it('答"飘了"（DRIFTED）之后，冷却不到 2 分钟不该再触发；过了 2 分钟该正常触发，不用等 5 分钟', () => {
    const state = createInitialBState('CREATOR');
    const ctx = ctxOf();

    // 喂到第一次触发
    let firstFire = -1;
    for (let t = T0; t < T0 + 5 * 60_000; t += 10_000) {
      if (evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t) !== 'DO_NOTHING') {
        firstFire = t;
        break;
      }
    }
    expect(firstFire).toBeGreaterThan(0);

    // 用户答"飘了"——拉回锚点、但立刻又飘回了同一个走神页面（真机复现场景）
    const feedback: CheckInFeedback = { channel: 'DRIFT', answer: 'DRIFTED' };
    applyCheckInFeedback(state, ctx.profile.policy, feedback, firstFire);
    expect(state.checkinCooldownMs).toBe(DRIFTED_CHECKIN_COOLDOWN_MS);

    // 短冷却（2min）结束前，不该再触发——即使已经远超旧的长冷却假设之前的检查点
    for (let t = firstFire + 10_000; t < firstFire + DRIFTED_CHECKIN_COOLDOWN_MS; t += 10_000) {
      expect(evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t)).toBe('DO_NOTHING');
    }

    // 短冷却结束后，正常重新累积证据、正常触发——不用像 FOCUSED/FALSE_POSITIVE 那样等满 5 分钟
    let secondFire = -1;
    for (let t = firstFire + DRIFTED_CHECKIN_COOLDOWN_MS; t < firstFire + COOLDOWN_MS; t += 10_000) {
      if (evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t) !== 'DO_NOTHING') {
        secondFire = t;
        break;
      }
    }
    expect(secondFire).toBeGreaterThan(0); // 5 分钟长冷却的旧行为会让这段区间全是 DO_NOTHING，断言会挂
    expect(secondFire - firstFire).toBeLessThan(COOLDOWN_MS); // 明确快于旧的 5 分钟长冷却
  });

  it('对照组：答"我在查资料"（FALSE_POSITIVE）之后仍然是长冷却，不受这次改动影响', () => {
    const state = createInitialBState('CREATOR');
    const ctx = ctxOf();

    let firstFire = -1;
    for (let t = T0; t < T0 + 5 * 60_000; t += 10_000) {
      if (evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t) !== 'DO_NOTHING') {
        firstFire = t;
        break;
      }
    }
    expect(firstFire).toBeGreaterThan(0);

    const feedback: CheckInFeedback = { channel: 'DRIFT', answer: 'FALSE_POSITIVE' };
    applyCheckInFeedback(state, ctx.profile.policy, feedback, firstFire);
    expect(state.checkinCooldownMs).toBe(COOLDOWN_MS);

    for (let t = firstFire + 10_000; t < firstFire + COOLDOWN_MS; t += 10_000) {
      expect(evaluateFrame(driftFrame(t), 'CREATOR', ctx.profile.policy, ctx, state, t)).toBe('DO_NOTHING');
    }
  });
});
