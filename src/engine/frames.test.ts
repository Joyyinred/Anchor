// B5 · Day5 单元测试：mock/frames.json → evaluateFrame() 产出的 DetectionResult.action 是否正确。
// 依赖 B1（FeatureFrame/DetectionResult 类型定义，types.ts）、B3（evaluateFrame 判定逻辑，detector.ts）。
//
// 跟 integration.test.ts 的区别：integration.test.ts 是 J3 端到端硬检查点，从 events.json 原始
// SignalEvent 出发，走真实的 computeFeatureFrame + 细粒度步进重放（感知半+决策半两半合流）。
// 这里是纯 B 侧单测：直接拿 frames.json 里手写的 FeatureFrame 片段喂给 evaluateFrame()，
// 不经过感知半，用 frames.json 自带的 initialState.*SinceOffset 抄近道直接摆好证据持续器的
// 起始状态（frames.json 顶部 note 字段对这个抄近道有说明），配合每个 scenario 内多个 steps
// 的真实 now 推进，验证 B 自己的判定逻辑——这才是 frames.json 这份 fixture 本来的用法。
//
// metaScenarios（22/23）是契约里标注的独立函数验收（defaultSessionContext / restReminderDue），
// 不产出 DetectionResult，metascenario.test.ts 已经单独覆盖，这里只跑 frames.scenarios 数组。
import { describe, it, expect } from 'vitest';
import framesFixtureRaw from '../mock/frames.json';
import { evaluateFrame, BState } from './detector';
import { FeatureFrame, SessionContext, PROFILE_PRESETS, createInitialBState } from './types';

type Archetype = 'CREATOR' | 'READER' | 'VIEWER';

// frames.json 是手写的 JSON 字面量，不同 step/scenario 的字段集合不完全一致（比如 note 是
// 可选的、initialState 的子字段各场景用的不一样），TS 直接从字面量推断出来的是一堆形状拼成的
// 联合类型，访问"不是每个分支都有"的字段（比如 note）会报 TS2339。这里手写一个宽松的 fixture
// 接口，断言一次绕开这个问题——跟 integration.test.ts 对 events.json 做 `as SignalEvent[]`
// 断言是同一个思路。
interface InitialStateFixture {
  stuckLadderIndex?: number;
  stuckThresholdMs?: number;
  lastAnswerTs?: number;
  lastCheckInTs?: number;
  restUntil?: number;
  driftSustainerSinceOffset?: number;
  passiveSinceOffset?: number;
  stuckSustainerSinceOffset?: number;
}

interface FramesFixture {
  scenarios: Array<{
    id: number;
    desc: string;
    archetype: Archetype;
    graceUntil: number;
    demoMode?: boolean;
    initialState?: InitialStateFixture;
    steps: Array<{
      now: number;
      frame: Partial<FeatureFrame>;
      expectedAction: 'DO_NOTHING' | 'CHECK_IN_DRIFT' | 'CHECK_IN_STUCK';
      note?: string;
    }>;
  }>;
}

const framesFixture = framesFixtureRaw as unknown as FramesFixture;

// frames.json 里的 frame 字段是"只写需要用到的那几个信号"的片段，其余字段留给下面的默认值兜底。
// 默认值原则：挑不会误触发任何一条判定分支的中性值（比如 texture 默认 purposeful——
// 既不满足 STUCK 要的 idle，也不满足 DRIFT 纹理证据要的 passive）。
function buildFrame(now: number, partial: Partial<FeatureFrame>, sessionId: string): FeatureFrame {
  return {
    timestamp: now,
    sessionId,
    contextRelevance: 'RELEVANT',
    anchorDetachedMs: 0,
    texture: 'purposeful',
    jumpPattern: 'stable',
    stillnessMs: 0,
    entryIntent: 'unknown',
    contentFormat: 'standard',
    systemIdle: false,
    lastAnchorSnapshot: { title: '', url: '', ts: 0 },
    currentDomain: '',
    currentTitle: '',
    currentContentKind: 'unknown',
    currentUrl: '',
    ...partial,
  };
}

// *SinceOffset 字段（frames.json 顶部 note 的抄近道）：在 steps[0].now 之前多少 ms，
// 对应持续器就已经开始计时——换算成 sustainer.since = steps[0].now - offset。
function buildState(archetype: Archetype, initialState: InitialStateFixture | undefined, firstStepNow: number): BState {
  const state = createInitialBState(archetype);
  if (!initialState) return state;

  if (initialState.stuckLadderIndex !== undefined) state.stuckLadderIndex = initialState.stuckLadderIndex;
  if (initialState.stuckThresholdMs !== undefined) state.stuckThresholdMs = initialState.stuckThresholdMs;
  if (initialState.lastAnswerTs !== undefined) state.lastAnswerTs = initialState.lastAnswerTs;
  if (initialState.lastCheckInTs !== undefined) state.lastCheckInTs = initialState.lastCheckInTs;
  if (initialState.restUntil !== undefined) state.restUntil = initialState.restUntil;
  if (initialState.driftSustainerSinceOffset !== undefined) {
    state.driftSustainer.since = firstStepNow - initialState.driftSustainerSinceOffset;
  }
  if (initialState.passiveSinceOffset !== undefined) {
    state.passiveSince = firstStepNow - initialState.passiveSinceOffset;
  }
  if (initialState.stuckSustainerSinceOffset !== undefined) {
    state.stuckSustainer.since = firstStepNow - initialState.stuckSustainerSinceOffset;
  }
  return state;
}

function buildContext(archetype: Archetype, graceUntil: number, sessionId: string): SessionContext {
  const preset = PROFILE_PRESETS[archetype];
  return {
    sessionId,
    taskDeclaration: 'mock task for ' + sessionId,
    profile: { archetype, policy: preset },
    // evaluateFrame/isDrifting/isStuck 只读 FeatureFrame 里已经算好的 anchorDetachedMs/
    // contextRelevance，不直接读 ctx.anchor/ctx.sessionWhitelist（那是感知半的事），
    // 这里随便摆一个占位值即可，不影响判定结果。
    anchor: { domain: '', url: '', matchMode: preset.matchMode },
    sessionWhitelist: [],
    graceUntil,
  };
}

describe('B5: frames.json → evaluateFrame() 的 DetectionResult.action 断言', () => {
  for (const scenario of framesFixture.scenarios) {
    it(`场景 ${scenario.id}：${scenario.desc}`, () => {
      const archetype = scenario.archetype;
      const sessionId = `scenario-${scenario.id}`;
      const ctx = buildContext(archetype, scenario.graceUntil, sessionId);
      const state = buildState(archetype, scenario.initialState, scenario.steps[0].now);
      const isDemoMode = scenario.demoMode ?? false;

      // 同一场景内多个 steps 共用同一个 state——持续器要跟着真实 now 推进自然累积/清零，
      // 跟 detector.ts 里 sustainedWithWindow/isContinuouslyDisengaged 就地改 state 的方式一致。
      for (const step of scenario.steps) {
        const frame = buildFrame(step.now, step.frame, sessionId);
        const action = evaluateFrame(frame, archetype, ctx.profile.policy, ctx, state, step.now, isDemoMode);
        expect(action, step.note ?? `t=${step.now}`).toBe(step.expectedAction);
      }
    });
  }
});