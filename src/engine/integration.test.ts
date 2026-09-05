// J3 硬检查点：感知半（A）产出的 FeatureFrame 喂给决策半（B），端到端跑通 events.json 25 场景。
// 用「细粒度步进重放」代替 frames.json 里 B 单测用的 *SinceOffset 抄近道——
// 因为这里是从原始 SignalEvent 真实重放，证据持续器（30s 窗口）需要真实的时间推进才会满足。
import { describe, it, expect } from 'vitest';
import eventsFixture from '../mock/events.json';
import { computeFeatureFrame, cacheKey, ClassificationCache } from './perceiver';
import { evaluateFrame } from './detector';
import {
  SignalEvent,
  SessionContext,
  PROFILE_PRESETS,
  createInitialBState,
  BState,
  FeatureFrame,
} from './types';

type Archetype = 'CREATOR' | 'READER' | 'VIEWER';

// 模拟「LLM 已经判完」的分类结果——真实系统里这是 A8（Day6）异步调用+缓存写入的产物，
// 这里手工预置，等价于「demo 前预热缓存」（契约v4 §5.2 最后一句）。
// 09-05：cacheKey 带上了标题（见 perceiver.ts 顶部注释——AI 对话类页面 URL 不变但话题会飘，
// 只用 domain+path 当 key 会把第一次分类结果冻结一辈子），这里跟着改成用真实 title 走
// cacheKey() 现算，不再手写 "domain+path" 字符串——手写的话，标题跟 events.json 里的原始
// 事件对不上，缓存永远命不中，全部退回 UNKNOWN，场景不出预期结果。
const MOCK_LLM_CLASSIFICATIONS: { domain: string; url: string; title: string; verdict: 'RELEVANT' | 'IRRELEVANT' }[] = [
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=fun123', title: 'Top 10 Funny Cats', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=reacthooks', title: 'React Hooks Tutorial 2026', verdict: 'RELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=mlcourse1', title: 'MIT 6.006 Lecture 5: Sorting', verdict: 'RELEVANT' }, // 场景12 的原锚点
  { domain: 'youtube.com', url: 'https://youtube.com/', title: 'YouTube 首页', verdict: 'IRRELEVANT' }, // 首页推荐流
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=rec001', title: '推荐：搞笑合集', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=rec002', title: '自动连播：街头魔术', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=rec003', title: '自动连播：猫咪视频', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=xyz999', title: '自动连播：极限运动集锦', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=xyz998', title: '自动连播：美食探店', verdict: 'IRRELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=lec5&list=PLcourse', title: 'Lecture 5: Sorting', verdict: 'RELEVANT' },
  { domain: 'youtube.com', url: 'https://youtube.com/watch?v=lec6&list=PLcourse', title: 'Lecture 6: Trees', verdict: 'RELEVANT' },
  { domain: 'web.wechat.com', url: 'https://web.wechat.com/chat', title: '微信群聊', verdict: 'IRRELEVANT' },
  { domain: 'course.edu.cn', url: 'https://course.edu.cn/slides/ch3', title: '第3章课件 P1-20', verdict: 'RELEVANT' },
  // zhihu.com 故意不给分类结果 → 场景19「断网/LLM失败」验证 UNKNOWN 保守兜底
];

function buildCache(): ClassificationCache {
  return new Map(MOCK_LLM_CLASSIFICATIONS.map((c) => [cacheKey(c.domain, c.url, c.title), c.verdict]));
}

interface ScenarioOverride {
  graceUntil?: number;
  sessionWhitelist?: string[];
  demoMode?: boolean;
  stateOverrides?: Partial<Pick<BState, 'stuckLadderIndex' | 'stuckThresholdMs' | 'lastAnswerTs' | 'lastCheckInTs' | 'restUntil'>>;
}

// 只搬运 frames.json 里「真正的会话前情」（无法从 events.json 原始事件重建的 B 内部状态），
// 不搬运它的 *SinceOffset 证据持续器抄近道——那是 frames.json 自己单测用的省时手法，
// 这里走真实步进重放，不需要也不应该用。
const SCENARIO_OVERRIDES: Record<number, ScenarioOverride> = {
  2: { stateOverrides: { stuckLadderIndex: 1, stuckThresholdMs: 1_200_000, lastAnswerTs: 900_000 } },
  // 09-05：sessionWhitelist 存的是这条视频的完整 cacheKey（带标题），不是裸 "domain+path"——
  // 跟上面 MOCK_LLM_CLASSIFICATIONS 同一个原因，标题不对会导致 resolveContextRelevance()
  // 里 `ctx.sessionWhitelist.includes(key)` 那个分支永远命不中。
  4: { sessionWhitelist: [cacheKey('youtube.com', 'https://www.youtube.com/watch?v=fun123', 'Top 10 Funny Cats')] },
  5: { graceUntil: 120_000 },
  7: { stateOverrides: { stuckLadderIndex: 1, stuckThresholdMs: 1_200_000, lastAnswerTs: 650_000 } },
  17: { stateOverrides: { lastCheckInTs: 60_000 } },
  18: { stateOverrides: { restUntil: 1_800_000 } },
  24: { demoMode: true },
};

// 场景 22（无起步教练默认策略）与 23（休息模式提醒）是契约里的独立函数验收（defaultSessionContext /
// restReminderDue），不是「事件流 → FeatureFrame → DetectionResult」这条主线，此处不适用，跳过。
const SKIP_SCENARIO_IDS = new Set([22, 23]);

function buildContext(scenario: { id: number; profile: Archetype; events: SignalEvent[] }): SessionContext {
  const override = SCENARIO_OVERRIDES[scenario.id] ?? {};
  const anchorEvent = scenario.events.find((e) => e.isAnchor);
  const preset = PROFILE_PRESETS[scenario.profile];
  return {
    sessionId: `scenario-${scenario.id}`,
    taskDeclaration: 'mock task for scenario ' + scenario.id,
    profile: { archetype: scenario.profile, policy: preset },
    anchor: anchorEvent
      ? { domain: anchorEvent.domain, url: anchorEvent.url, matchMode: preset.matchMode }
      : { domain: '', url: '', matchMode: preset.matchMode },
    sessionWhitelist: override.sessionWhitelist ?? [],
    graceUntil: override.graceUntil ?? 0,
  };
}

function buildState(scenarioId: number): BState {
  const override = SCENARIO_OVERRIDES[scenarioId] ?? {};
  const archetype = (eventsFixture.scenarios.find((s) => s.id === scenarioId)?.profile ?? 'CREATOR') as Archetype;
  const state = createInitialBState(archetype);
  return { ...state, ...override.stateOverrides };
}

/**
 * 细粒度步进重放：按场景总时长切出采样点（含每条原始事件的时间戳），
 * 依次计算 FeatureFrame 并喂给 evaluateFrame，让证据持续器在真实时间推进下自然累积。
 */
function simulate(
  events: SignalEvent[],
  ctx: SessionContext,
  state: BState,
  demoMode: boolean
): { finalAction: string; history: { now: number; action: string }[]; triggerFrame: FeatureFrame | null } {
  const cache = buildCache();
  const lastEventTs = events[events.length - 1].timestamp;
  const stepMs = demoMode ? 50 : 10_000;
  // 真实系统里 chrome.alarms 心跳补帧会在事件静默后继续产帧（§3.1），证据持续器（30s 窗口，
  // 或连续 passive ≥60s）需要事件停止后仍有几帧机会走完累积——这里额外把采样窗口向后延伸一段，
  // 模拟"最后一条浏览器事件之后，用户没再动，心跳帧仍在继续判定"。
  const tailBufferMs = demoMode ? 2_000 : 120_000;
  const finalTs = lastEventTs + tailBufferMs;

  const timestamps = new Set<number>();
  for (let t = 0; t <= finalTs; t += stepMs) timestamps.add(t);
  timestamps.add(finalTs);
  for (const e of events) timestamps.add(e.timestamp);
  const sortedTs = Array.from(timestamps).sort((a, b) => a - b);

  let previousTexture: 'purposeful' | 'passive' | 'idle' = 'idle';
  const history: { now: number; action: string }[] = [];
  let finalAction = 'DO_NOTHING';
  let triggerFrame: FeatureFrame | null = null;

  for (const now of sortedTs) {
    const visible = events.filter((e) => e.timestamp <= now);
    const frame = computeFeatureFrame(visible, ctx, now, cache, previousTexture, demoMode);
    previousTexture = frame.texture;
    const action = evaluateFrame(frame, ctx.profile.archetype as Archetype, ctx.profile.policy, ctx, state, now, demoMode);
    history.push({ now, action });
    finalAction = action;
    if (action !== 'DO_NOTHING' && triggerFrame === null) triggerFrame = frame;
  }
  return { finalAction, history, triggerFrame };
}

describe('J3: 两半合流 —— events.json 25 场景端到端', () => {
  const scenarios = eventsFixture.scenarios.filter((s) => !SKIP_SCENARIO_IDS.has(s.id));

  for (const scenario of scenarios) {
    it(`场景 ${scenario.id}：${scenario.name}`, () => {
      const events = scenario.events as SignalEvent[];
      const ctx = buildContext({ id: scenario.id, profile: scenario.profile as Archetype, events });
      const state = buildState(scenario.id);
      const demoMode = SCENARIO_OVERRIDES[scenario.id]?.demoMode ?? false;

      const { history, triggerFrame } = simulate(events, ctx, state, demoMode);
      // fix 2（lastCheckInTs 接线）之前，这里断言的是"整条时间轴走到底时最后采样到的动作"——
      // 冷却闸门是死的，所以一旦证据满足，后面每一帧都会重复报同一个动作，"最后一帧"和"有没有
      // 报过"是一回事。冷却闸门接上之后，check-in 触发后会自然进入冷却、之后的帧合理地变回
      // DO_NOTHING（这正是修复要的效果），"只看最后一帧"就不再等价于"报没报过"，要改成：
      // 期望 DO_NOTHING 的场景整条时间轴都不该报；期望 CHECK_IN_* 的场景只要报过一次就算过。
      if (scenario.expectedAction === 'DO_NOTHING') {
        expect(history.every((h) => h.action === 'DO_NOTHING')).toBe(true);
      } else {
        expect(history.some((h) => h.action === scenario.expectedAction)).toBe(true);
      }

      if (scenario.id === 25) {
        // 场景 25 的核心断言：check-in 措辞用的 lastAnchorSnapshot 必须指向"最后一次锚点有意义
        // 交互"那一刻（t=120000 的 ACTIVE_INPUT），不是任意一帧、更不是当前（走神后）的页面。
        expect(triggerFrame?.lastAnchorSnapshot).toEqual({
          title: 'login.tsx 调试中',
          url: 'https://vscode.dev/proj',
          ts: 120_000,
        });
      }
    });
  }
});