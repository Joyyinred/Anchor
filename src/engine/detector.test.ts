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

// 08-30 真机测试后的两处调整：①黑名单命中的域名走独立的 15s 快速通道，不用再等
// anchorDetachedThresholdMs（真机复现过：在明确黑名单的 booking.com 上停留很久，却因为要
// 凑够 8min 阈值迟迟不 check-in）；②CREATOR 的通用 anchorDetachedThresholdMs 从 8min
// 调到 5min（黑名单已经走快速通道，这个值现在只服务"LLM 判 IRRELEVANT 但不在静态黑名单
// 里"这类没那么确定的情况，调低但留了缓冲，见 types.ts CREATOR 预设的注释）。
describe('DRIFT 黑名单快速通道（detector.ts isDrifting，跳过 anchorDetachedThresholdMs）', () => {
  const BLACKLISTED_DOMAIN = 'www.booking.com';

  it('黑名单域名 + anchorDetachedMs 过 15s 且持续 30s → 触发 CHECK_IN_DRIFT，不用等 5min 通用阈值', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const base = 30 * 60_000;
    const frame1: FeatureFrame = { ...baseFrame(base, 'IRRELEVANT'), currentDomain: BLACKLISTED_DOMAIN, anchorDetachedMs: 16_000 };
    expect(evaluateFrame(frame1, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, base)).toBe('DO_NOTHING'); // 第一次只是记下持续窗口起点

    const now2 = base + 31_000;
    const frame2: FeatureFrame = { ...baseFrame(now2, 'IRRELEVANT'), currentDomain: BLACKLISTED_DOMAIN, anchorDetachedMs: 47_000 };
    expect(evaluateFrame(frame2, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now2)).toBe('CHECK_IN_DRIFT');
  });

  it('黑名单域名但 anchorDetachedMs 还没过 15s → 不触发（专属阈值本身没过）', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const now = 30 * 60_000;
    const frame: FeatureFrame = { ...baseFrame(now, 'IRRELEVANT'), currentDomain: BLACKLISTED_DOMAIN, anchorDetachedMs: 10_000 };
    expect(evaluateFrame(frame, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now)).toBe('DO_NOTHING');
  });

  it('非黑名单域名（LLM 判 IRRELEVANT）不能借道黑名单快速通道——20s 远不够，仍要等 5min 通用阈值', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const now = 30 * 60_000;
    const frame: FeatureFrame = {
      ...baseFrame(now, 'IRRELEVANT'),
      currentDomain: 'www.some-llm-judged-irrelevant-site.com',
      anchorDetachedMs: 20_000,
    };
    expect(evaluateFrame(frame, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now)).toBe('DO_NOTHING');
  });

  it('sessionWhitelist 已经把黑名单域名纠正成 RELEVANT 时，不会绕开纠正走快速通道', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const now = 30 * 60_000;
    // 模拟 resolveContextRelevance 因 sessionWhitelist 短路成 RELEVANT 之后的结果——
    // 不需要真的跑一遍分类短路链，直接构造这个 contextRelevance 就够验证 detector.ts 这道闸门。
    const frame: FeatureFrame = { ...baseFrame(now, 'RELEVANT'), currentDomain: BLACKLISTED_DOMAIN, anchorDetachedMs: 999_000 };
    expect(evaluateFrame(frame, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now)).toBe('DO_NOTHING');
  });
});

describe('DRIFT 通用 anchorDetachedThresholdMs（CREATOR：08-30 从 8min 调到 5min）', () => {
  it('CREATOR 预设值确认是 5 分钟', () => {
    expect(PROFILE_PRESETS.CREATOR.anchorDetachedThresholdMs).toBe(5 * 60_000);
  });

  it('非黑名单 IRRELEVANT 页面，跨过 5min 阈值 + 60s 纹理证据 + 30s 持续窗口后能正常触发 DRIFT', () => {
    const ctx = defaultSessionContext(0);
    const state = createInitialBState('CREATOR');
    const base = 30 * 60_000;
    const domain = 'www.some-llm-judged-irrelevant-site.com';

    // 第一帧：anchorAbandoned 已成立，但 isContinuouslyDisengaged 的 60s 窗口刚起算。
    const frame1: FeatureFrame = { ...baseFrame(base, 'IRRELEVANT'), currentDomain: domain, texture: 'idle', anchorDetachedMs: 5 * 60_000 + 1_000 };
    expect(evaluateFrame(frame1, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, base)).toBe('DO_NOTHING');

    // 第二帧：61s 后，60s 纹理证据窗口才刚好够——evidence 第一次为 true，driftSustainer 起算。
    const now2 = base + 61_000;
    const frame2: FeatureFrame = { ...baseFrame(now2, 'IRRELEVANT'), currentDomain: domain, texture: 'idle', anchorDetachedMs: 5 * 60_000 + 61_000 };
    expect(evaluateFrame(frame2, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now2)).toBe('DO_NOTHING');

    // 第三帧：再过 31s，driftSustainer 的 30s 持续窗口也够了，触发。
    const now3 = now2 + 31_000;
    const frame3: FeatureFrame = { ...baseFrame(now3, 'IRRELEVANT'), currentDomain: domain, texture: 'idle', anchorDetachedMs: 5 * 60_000 + 92_000 };
    expect(evaluateFrame(frame3, 'CREATOR', PROFILE_PRESETS.CREATOR, ctx, state, now3)).toBe('CHECK_IN_DRIFT');
  });
});
