// Anchor · 09-05 真机 bug 复现：回到专注页面之后，桌宠一直停在 observing（黄）不变回 companion（绿）。
//
// 复现路径（Jay 09-05 记录的第 10 条）：飘到不相干页面 → 看到黄猫 → 主动回到专注页面 → 还是黄的。
//
// 根因是同一类缺陷的两处不同表现：**`isDrifting()`/`isStuck()` 里的每一处提前 `return false`
// 都不会清空自己的持续器**，而 `advancePetState()` 只看 `driftSustainerSince`/`stuckSustainerSince`
// 是不是非空来决定演不演 observing。于是"这条通道现在根本不该说话"被桌宠读成了"证据还在累积"。
//
// 只有走到函数末尾那个 `sustainedWithWindow(..., evidence=false, ...)` 才会真正清空——
// 而提前 return 的路径**恰恰是用户回到正轨时最常命中的**（页面变相关了、开始打字了、
// 或者上一次 check-in 的冷却期还没过）。
import { describe, it, expect } from 'vitest';
import { evaluateFrame, type BState } from './detector';
import { advancePetState, createPetStateMachine } from './pet-state';
import {
  createInitialBState,
  PROFILE_PRESETS,
  type FeatureFrame,
  type SessionContext,
} from './types';

const T0 = 10_000_000;
const CREATOR_STUCK_THRESHOLD_MS = 15 * 60_000; // PROFILE_PRESETS.CREATOR.stuckLadderMs[0]

function ctxOf(): SessionContext {
  const preset = PROFILE_PRESETS.CREATOR;
  return {
    sessionId: 'observing-stale',
    taskDeclaration: 'test task',
    profile: { archetype: 'CREATOR', policy: preset },
    anchor: { domain: 'anchor.test', url: 'https://anchor.test/', matchMode: preset.matchMode },
    sessionWhitelist: [],
    graceUntil: 0,
  };
}

function baseFrame(now: number): FeatureFrame {
  return {
    timestamp: now,
    sessionId: 'observing-stale',
    contextRelevance: 'RELEVANT',
    anchorDetachedMs: 0,
    texture: 'purposeful',
    jumpPattern: 'stable',
    stillnessMs: 0,
    entryIntent: 'unknown',
    contentFormat: 'standard',
    systemIdle: false,
    lastAnchorSnapshot: { title: 'work.md', url: 'https://anchor.test/', ts: now },
    currentDomain: 'anchor.test',
    currentTitle: 'work.md',
    currentContentKind: 'docs',
  };
}

/** 在锚点页面上安静发呆很久：STUCK 通道会开始攒证据。 */
function stillOnAnchorFrame(now: number): FeatureFrame {
  return {
    ...baseFrame(now),
    texture: 'idle',
    stillnessMs: CREATOR_STUCK_THRESHOLD_MS + 60_000,
  };
}

/** 飘到不相干页面。 */
function driftedFrame(now: number): FeatureFrame {
  return {
    ...baseFrame(now),
    contextRelevance: 'IRRELEVANT',
    anchorDetachedMs: 30 * 60_000,
    texture: 'passive',
    currentDomain: 'distraction.test',
    currentTitle: 'Distraction',
    currentContentKind: 'video',
    lastAnchorSnapshot: { title: 'work.md', url: 'https://anchor.test/', ts: now - 30 * 60_000 },
  };
}

/** 回到锚点页面并开始真正干活（主动纹理）。 */
function backAndWorkingFrame(now: number): FeatureFrame {
  return { ...baseFrame(now), texture: 'purposeful', stillnessMs: 0 };
}

function petStateFor(state: BState, frame: FeatureFrame, now: number, machine = createPetStateMachine()) {
  const ctx = ctxOf();
  const action = evaluateFrame(frame, 'CREATOR', ctx.profile.policy, ctx, state, now);
  return advancePetState(
    machine,
    action,
    {
      driftSustainerSince: state.driftSustainer.since,
      stuckSustainerSince: state.stuckSustainer.since,
      restUntil: state.restUntil,
    },
    now
  );
}

describe('09-05 真机 bug：回到专注页面后桌宠卡在 observing', () => {
  it('★ STUCK 证据不会因为"页面变相关了/开始打字了"而清空，桌宠永远变不回 companion', () => {
    const state = createInitialBState('CREATOR');
    const machine = createPetStateMachine();

    // ① 在锚点页面上安静待了很久 → STUCK 通道开始攒证据（还没满 30s 窗口，不会 check-in）
    petStateFor(state, stillOnAnchorFrame(T0), T0, machine);
    expect(state.stuckSustainer.since).not.toBeNull();

    // ② 飘走到不相干页面。isStuck 在 `contextRelevance !== 'RELEVANT'` 处提前 return，
    //    **不清空 stuckSustainer**；同时 DRIFT 通道开始攒自己的证据 → 黄猫（符合预期）
    const tDrift = T0 + 10_000;
    expect(petStateFor(state, driftedFrame(tDrift), tDrift, machine)).toBe('observing');

    // ③ 用户回神，回到锚点页面并开始打字。
    //    DRIFT 证据会被正确清空（走到了末尾的 sustainedWithWindow），
    //    但 isStuck 这次在 `texture !== 'idle'` 处提前 return，stuckSustainer 依旧没人清。
    const tBack = tDrift + 60_000; // 远超 MIN_OBSERVING_MS 迟滞窗口，不是迟滞造成的
    const petState = petStateFor(state, backAndWorkingFrame(tBack), tBack, machine);

    expect(state.driftSustainer.since).toBeNull(); // DRIFT 这条是对的
    expect(state.stuckSustainer.since).toBeNull(); // ← 修复前失败：陈旧证据留着没清
    expect(petState).toBe('companion'); // ← 修复前失败：一直停在 observing
  });

  it('★ 冷却期内回到锚点页面，DRIFT 证据同样被冻结（Jay 09-05 读代码时怀疑的那一处）', () => {
    const state = createInitialBState('CREATOR');
    const machine = createPetStateMachine();

    // 模拟"刚刚触发过一次 check-in、用户没回答"：lastCheckInTs 被置为 now，
    // 而 driftSustainer.since 停在触发前攒证据的那一刻（sustainedWithWindow 命中时不清空）。
    state.lastCheckInTs = T0;
    state.driftSustainer.since = T0 - 30_000;

    // 冷却期内（默认 5min）用户已经回到锚点页面、正常干活。
    const tBack = T0 + 60_000;
    const petState = petStateFor(state, backAndWorkingFrame(tBack), tBack, machine);

    expect(state.driftSustainer.since).toBeNull(); // ← 修复前失败：冷却闸门挡在清空之前
    expect(petState).toBe('companion'); // ← 修复前失败：整个冷却期都是黄的
  });

  it('休息期间必须是 companion（这条本来就有专门的兜底，作为对照放在这里）', () => {
    const state = createInitialBState('CREATOR');
    const machine = createPetStateMachine();
    state.driftSustainer.since = T0 - 30_000;
    state.restUntil = T0 + 10 * 60_000;

    expect(petStateFor(state, backAndWorkingFrame(T0), T0, machine)).toBe('companion');
  });
});
