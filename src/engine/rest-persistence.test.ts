// Anchor · 09-12 review 发现：休息状态经过 chrome.storage 一次往返之后就丢了。
//
// 09-11 把 startRest() 的 restUntil 从 `now + 20min` 改成了 `Infinity`（"休息到用户显式点
// Back to it 为止"）——设计意图是对的，但 BState 会通过 setBState() 落进 chrome.storage.local，
// 而 chrome.storage 按 JSON 语义序列化：**`Infinity` 存进去变成 `null`**。
// SW 被回收（MV3 空闲 ~30s 就会回收）再唤醒、从 storage 水合回来时，`restUntil` 是 null，
// `null > now` 恒为 false → 双通道当场恢复监控，休息静默消失。
//
// 这恰恰是 09-11 那次改动要修的现象（"监控悄悄恢复"），只是换了一条路径重新出现——
// 而且真实的"休息 15 分钟走开一趟"场景几乎必然触发（人走开 → 没有事件 → SW 被回收）。
//
// 这个文件不碰 chrome API：用 JSON.parse(JSON.stringify()) 模拟 storage 往返，
// 跟 frame-pipeline.ts 的 toPersistable/ensureBStateLoaded 走的是同一种序列化语义。
import { describe, it, expect } from 'vitest';
import { evaluateFrame, startRest, type BState } from './detector';
import { createInitialBState, PROFILE_PRESETS, type FeatureFrame, type SessionContext } from './types';


const T0 = 10_000_000;

function ctxOf(): SessionContext {
  const preset = PROFILE_PRESETS.CREATOR;
  return {
    sessionId: 'rest-persist',
    taskDeclaration: 'test task',
    profile: { archetype: 'CREATOR', policy: preset },
    anchor: { domain: 'anchor.test', url: 'https://anchor.test/', matchMode: preset.matchMode },
    sessionWhitelist: [],
    graceUntil: 0,
  };
}

/** 一帧确凿的走神证据——休息期间必须被闸门挡住，恢复监控后会立刻开始攒证据。 */
function driftFrame(now: number): FeatureFrame {
  return {
    timestamp: now,
    sessionId: 'rest-persist',
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

/** 模拟 chrome.storage.local 的一次 set → get 往返（JSON 语义）。 */
function roundTripThroughStorage(state: BState): BState {
  const { driftSustainer, stuckSustainer, passiveSince, ...persistable } = state;
  void driftSustainer; void stuckSustainer; void passiveSince;
  const hydrated = JSON.parse(JSON.stringify(persistable));
  return { ...hydrated, driftSustainer: { since: null }, stuckSustainer: { since: null }, passiveSince: null };
}

describe('09-12 review：休息状态必须活过 chrome.storage 往返', () => {
  it('★ 点了 Take a break 之后 SW 被回收再水合，双通道必须仍然静默', () => {
    const ctx = ctxOf();
    const state = createInitialBState('CREATOR');
    startRest(state, T0);

    // 回收前：闸门正常挡住
    expect(evaluateFrame(driftFrame(T0 + 60_000), 'CREATOR', ctx.profile.policy, ctx, state, T0 + 60_000)).toBe('DO_NOTHING');

    // SW 被回收、从 storage 水合回来
    const rehydrated = roundTripThroughStorage(state);

    // ← 修复前失败：restUntil 存成了 null，闸门失效，证据开始累积
    expect(rehydrated.restUntil > T0 + 60_000).toBe(true);
    evaluateFrame(driftFrame(T0 + 60_000), 'CREATOR', ctx.profile.policy, ctx, rehydrated, T0 + 60_000);
    expect(rehydrated.driftSustainer.since).toBeNull();
  });

  it('restUntil 的"休息中"哨兵值必须是 JSON 能表示的有限数', () => {
    const state = createInitialBState('CREATOR');
    startRest(state, T0);
    expect(Number.isFinite(state.restUntil)).toBe(true);
    expect(JSON.parse(JSON.stringify({ v: state.restUntil })).v).toBe(state.restUntil);
  });
});
