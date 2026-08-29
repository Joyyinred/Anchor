// 08-30：STUCK 通道对 contextRelevance 的闸门单测。
// 背景（updateNote 0828 第10条 / Joy 的三段分析里的"问题1"）：STUCK 原来只挡
// `contextRelevance === 'IRRELEVANT'`，UNKNOWN（分类还没判出来）会从缝里漏过去被判"卡住"——
// 跟 DRIFT 通道对 UNKNOWN 一律保守挡住（`!== 'IRRELEVANT'` → false）的态度不一致，是契约
// 红线1"判出前一律保守"没有在 STUCK 通道落实到位。真机上表现为对着一个还没判完的娱乐视频
// 误报"是不是卡住了"。修法：STUCK 也改成只放行确认 RELEVANT（`!== 'RELEVANT'` → false），
// 跟 DRIFT 对 UNKNOWN 的保守程度对齐。
import { describe, it, expect } from 'vitest';
import { evaluateFrame } from './detector';
import { defaultSessionContext, createInitialBState, PROFILE_PRESETS, type FeatureFrame } from './types';

function baseFrame(now: number, contextRelevance: FeatureFrame['contextRelevance']): FeatureFrame {
  return {
    timestamp: now,
    sessionId: 'default',
    contextRelevance,
    anchorDetachedMs: 0,
    texture: 'idle',
    jumpPattern: 'stable',
    stillnessMs: 20 * 60_000, // 远超 CREATOR 初始阈值 15min，只测 contextRelevance 这一道闸
    entryIntent: 'unknown',
    contentFormat: 'standard',
    systemIdle: false,
    lastAnchorSnapshot: { title: '', url: '', ts: 0 },
    currentDomain: 'www.youtube.com',
    currentTitle: 'some video',
    currentContentKind: 'video',
  };
}

describe('STUCK 通道对 contextRelevance 的闸门（detector.ts isStuck）', () => {
  it('UNKNOWN：不再放行——分类还没判出来时 STUCK 也保守沉默，不误判"卡住"', () => {
    const now = 30 * 60_000;
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const frame = baseFrame(now, 'UNKNOWN');
    const action = evaluateFrame(frame, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now);
    expect(action).toBe('DO_NOTHING');
  });

  it('IRRELEVANT：仍然不放行（回归锁死，修复前后都该是 false）', () => {
    const now = 30 * 60_000;
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const frame = baseFrame(now, 'IRRELEVANT');
    const action = evaluateFrame(frame, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now);
    expect(action).toBe('DO_NOTHING');
  });

  it('RELEVANT：确认在做正事却停住不动，正常触发 CHECK_IN_STUCK（没被这次改动误伤）', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    // isStuck 的证据要靠 sustainedWithWindow 持续满 30s 才算数（stuckSustainer.since 第一次
    // 命中只是记下起点，不会当帧就触发）——喂两帧，第二帧隔了 30s 以上，才是真正的稳定证据。
    const firstNow = 30 * 60_000;
    evaluateFrame(baseFrame(firstNow, 'RELEVANT'), 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, firstNow);
    const secondNow = firstNow + 31_000;
    const action = evaluateFrame(
      baseFrame(secondNow, 'RELEVANT'),
      'CREATOR',
      PROFILE_PRESETS.CREATOR,
      ctx,
      state,
      secondNow
    );
    expect(action).toBe('CHECK_IN_STUCK');
  });
});
