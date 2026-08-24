import { describe, it, expect } from 'vitest';
import { computeFeatureFrame, resolveContextRelevance, ClassificationCache } from './perceiver';
import { SignalEvent, SessionContext, PROFILE_PRESETS } from './types';

function mkCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'test',
    taskDeclaration: 'debug login flow',
    profile: { archetype: 'CREATOR', policy: PROFILE_PRESETS.CREATOR },
    anchor: { domain: 'vscode.dev', url: 'https://vscode.dev/proj', matchMode: 'exact' },
    sessionWhitelist: [],
    graceUntil: 0,
    ...overrides,
  };
}

const anchorEvent: SignalEvent = {
  timestamp: 0,
  domain: 'vscode.dev',
  url: 'https://vscode.dev/proj',
  title: 'login.tsx',
  contentKind: 'code',
  isAnchor: true,
  interactionType: 'ACTIVE_INPUT',
  entryIntent: 'direct_link',
  systemIdle: false,
};

describe('resolveContextRelevance (signal 1)', () => {
  it('demo preset cache wins even without any other data', () => {
    const ctx = mkCtx();
    const cache: ClassificationCache = new Map();
    expect(resolveContextRelevance(anchorEvent, ctx, cache)).toBe('RELEVANT');
  });

  it('sessionWhitelist short-circuits to RELEVANT (场景4：查资料后白名单)', () => {
    const ctx = mkCtx({ sessionWhitelist: ['youtube.com'] });
    const event: SignalEvent = { ...anchorEvent, domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=fun123', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('RELEVANT');
  });

  it('short_feed content is hard-ruled IRRELEVANT regardless of domain (场景10：Shorts)', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'youtube.com', url: 'https://www.youtube.com/shorts/abc', contentKind: 'short_feed', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
  });

  it('unclassified mixed-site domain defaults to UNKNOWN, never auto-upgrades (红线1，场景19)', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'zhihu.com', url: 'https://www.zhihu.com/question/123', contentKind: 'article', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('UNKNOWN');
  });

  it('LLM classification cache resolves once populated (Day6 hook point)', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=fun123', isAnchor: false };
    const cache: ClassificationCache = new Map([['youtube.com/watch?v=fun123', 'IRRELEVANT']]);
    expect(resolveContextRelevance(event, ctx, cache)).toBe('IRRELEVANT');
  });
});

describe('computeFeatureFrame: 派生字段（场景1 数据）', () => {
  const ctx = mkCtx();
  const events: SignalEvent[] = [
    anchorEvent,
    { timestamp: 45000, domain: 'react.dev', url: 'https://react.dev/reference/hooks', title: 'Hooks Reference', contentKind: 'docs', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
  ];

  it('currentDomain/currentTitle/currentContentKind 取最后一条事件', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    expect(frame.currentDomain).toBe('react.dev');
    expect(frame.currentTitle).toBe('Hooks Reference');
    expect(frame.currentContentKind).toBe('docs');
  });

  it('entryIntent 5值归约为3值：search → purposeful', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    expect(frame.entryIntent).toBe('purposeful');
  });

  it('entryIntent：feed/autoplay → feed_driven', () => {
    const feedEvent: SignalEvent = { ...anchorEvent, entryIntent: 'feed' };
    const frame = computeFeatureFrame([feedEvent], ctx, 0);
    expect(frame.entryIntent).toBe('feed_driven');
  });

  it('contentFormat：short_feed 内容 → short_feed，否则 standard', () => {
    const shortsEvent: SignalEvent = { ...anchorEvent, contentKind: 'short_feed' };
    expect(computeFeatureFrame([shortsEvent], ctx, 0).contentFormat).toBe('short_feed');
    expect(computeFeatureFrame(events, ctx, 45000).contentFormat).toBe('standard');
  });

  it('systemIdle 透传最后一条事件', () => {
    const idleEvent: SignalEvent = { ...anchorEvent, systemIdle: true };
    expect(computeFeatureFrame([idleEvent], ctx, 0).systemIdle).toBe(true);
  });

  it('anchorDetachedMs：命中锚点且为有意义交互时归零', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    // 最后一条不是锚点交互，但上一条（t=0）是 ACTIVE_INPUT+isAnchor，锚点脱离时长 = 45000-0
    expect(frame.anchorDetachedMs).toBe(45000);
  });

  it('anchorDetachedMs：PASSIVE_SCROLL 命中锚点时归零', () => {
    const scrollOnAnchor: SignalEvent = { ...anchorEvent, timestamp: 45000, interactionType: 'PASSIVE_SCROLL' };
    const frame = computeFeatureFrame([anchorEvent, scrollOnAnchor], ctx, 50000);
    expect(frame.anchorDetachedMs).toBe(5000);
  });

  it('anchorDetachedMs：MEDIA_PLAY 命中锚点不归零（契约明确排除在有意义交互之外）', () => {
    const playOnAnchor: SignalEvent = { ...anchorEvent, timestamp: 45000, interactionType: 'MEDIA_PLAY' };
    const frame = computeFeatureFrame([anchorEvent, playOnAnchor], ctx, 50000);
    expect(frame.anchorDetachedMs).toBe(50000); // 仍从 t=0 的 ACTIVE_INPUT 算起
  });

  it('lastAnchorSnapshot 记录最后一次有意义锚点交互', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    expect(frame.lastAnchorSnapshot).toEqual({ title: 'login.tsx', url: 'https://vscode.dev/proj', ts: 0 });
  });
});

describe('computeFeatureFrame: texture（场景21 打字型走神盲区修复）', () => {
  it('未分类的混合域（如微信）保持 UNKNOWN，不会被误判为 RELEVANT/IRRELEVANT', () => {
    const ctx = mkCtx();
    const wechatEvent: SignalEvent = {
      timestamp: 60000,
      domain: 'web.wechat.com',
      url: 'https://web.wechat.com/chat',
      title: '微信群聊',
      contentKind: 'social_feed',
      isAnchor: false,
      interactionType: 'ACTIVE_INPUT',
      entryIntent: 'direct_link',
      systemIdle: false,
    };
    const events: SignalEvent[] = [anchorEvent, wechatEvent, { ...wechatEvent, timestamp: 90000 }];
    const frame = computeFeatureFrame(events, ctx, 90000);
    expect(frame.contextRelevance).toBe('UNKNOWN'); // 真实系统里这会走 LLM 分类为 IRRELEVANT，此处未注入分类结果
  });

  it('IRRELEVANT 上下文时，纯 ACTIVE_INPUT 窗口判 passive（非 purposeful）——核心盲区修复', () => {
    const ctx = mkCtx({ sessionWhitelist: [] });
    const irrelevantActiveEvent: SignalEvent = {
      timestamp: 60000,
      domain: 'weibo.com', // DEMO_PRESET_CACHE 中为 IRRELEVANT
      url: 'https://weibo.com/hot',
      title: '热搜',
      contentKind: 'social_feed',
      isAnchor: false,
      interactionType: 'ACTIVE_INPUT',
      entryIntent: 'direct_link',
      systemIdle: false,
    };
    const events: SignalEvent[] = [anchorEvent, irrelevantActiveEvent, { ...irrelevantActiveEvent, timestamp: 90000 }];
    const frame = computeFeatureFrame(events, ctx, 90000);
    expect(frame.contextRelevance).toBe('IRRELEVANT');
    expect(frame.texture).toBe('passive');
  });

  it('冷启动（窗口内事件 < 2）沿用 previousTexture', () => {
    const ctx = mkCtx();
    const frame = computeFeatureFrame([anchorEvent], ctx, 0, new Map(), 'purposeful');
    expect(frame.texture).toBe('purposeful');
  });
});

describe('computeFeatureFrame: jumpPattern', () => {
  it('少于 3 段切换 → stable', () => {
    const ctx = mkCtx();
    const events: SignalEvent[] = [anchorEvent];
    expect(computeFeatureFrame(events, ctx, 0).jumpPattern).toBe('stable');
  });

  it('IDE↔docs↔AI↔SO 快切、全相关域、最近5段都未落在锚点上 → task_orbit（场景1）', () => {
    const ctx = mkCtx();
    const events: SignalEvent[] = [
      anchorEvent,
      { timestamp: 45000, domain: 'react.dev', url: 'https://react.dev/reference/hooks', title: 'Hooks Reference', contentKind: 'docs', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 90000, domain: 'claude.ai', url: 'https://claude.ai/chat/abc', title: 'debug login flow', contentKind: 'ai_chat', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'direct_link', systemIdle: false },
      { timestamp: 150000, domain: 'stackoverflow.com', url: 'https://stackoverflow.com/q/123', title: 'useEffect infinite loop', contentKind: 'code', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 200000, domain: 'react.dev', url: 'https://react.dev/reference/hooks', title: 'Hooks Reference', contentKind: 'docs', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'search', systemIdle: false },
      { timestamp: 260000, domain: 'claude.ai', url: 'https://claude.ai/chat/abc', title: 'debug login flow', contentKind: 'ai_chat', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'direct_link', systemIdle: false },
    ];
    // 最近5段（react/claude/SO/react/claude）都未落在锚点域上，且全部 RELEVANT（演示预置缓存）
    expect(computeFeatureFrame(events, ctx, 260000).jumpPattern).toBe('task_orbit');
  });

  it('最近5段窗口内命中锚点段 → stable（当前正处在锚点上，不是"在跳"）', () => {
    const ctx = mkCtx();
    const events: SignalEvent[] = [
      anchorEvent,
      { timestamp: 45000, domain: 'react.dev', url: 'https://react.dev/reference/hooks', title: 'Hooks Reference', contentKind: 'docs', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 90000, domain: 'claude.ai', url: 'https://claude.ai/chat/abc', title: 'debug login flow', contentKind: 'ai_chat', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'direct_link', systemIdle: false },
    ];
    expect(computeFeatureFrame(events, ctx, 90000).jumpPattern).toBe('stable');
  });

  it('含 UNKNOWN 域时即使 IRRELEVANT≤1 也不判 task_orbit，保守判 stable（契约§1："其余均RELEVANT"）', () => {
    const ctx = mkCtx();
    // react.dev(RELEVANT) → claude.ai(RELEVANT) → zhihu.com(未分类→UNKNOWN) → react.dev → claude.ai，
    // 全程未落在锚点域，irrelevantCount=0 但含一个 UNKNOWN 段。
    const events: SignalEvent[] = [
      { timestamp: 0, domain: 'react.dev', url: 'https://react.dev/a', title: 'a', contentKind: 'docs', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 10000, domain: 'claude.ai', url: 'https://claude.ai/b', title: 'b', contentKind: 'ai_chat', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'direct_link', systemIdle: false },
      { timestamp: 20000, domain: 'zhihu.com', url: 'https://zhihu.com/q/1', title: 'q', contentKind: 'article', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 30000, domain: 'react.dev', url: 'https://react.dev/a', title: 'a', contentKind: 'docs', isAnchor: false, interactionType: 'PASSIVE_SCROLL', entryIntent: 'search', systemIdle: false },
      { timestamp: 40000, domain: 'claude.ai', url: 'https://claude.ai/b', title: 'b', contentKind: 'ai_chat', isAnchor: false, interactionType: 'ACTIVE_INPUT', entryIntent: 'direct_link', systemIdle: false },
    ];
    expect(computeFeatureFrame(events, ctx, 40000).jumpPattern).toBe('stable');
  });
});

describe('computeFeatureFrame: stillnessMs 只看当前页自己的交互', () => {
  it('别的域上的一次交互不冲掉当前页的静止计时', () => {
    const ctx = mkCtx();
    const wechatBlip: SignalEvent = {
      timestamp: 900_000,
      domain: 'web.wechat.com',
      url: 'https://web.wechat.com/chat',
      title: '微信群聊',
      contentKind: 'social_feed',
      isAnchor: false,
      interactionType: 'ACTIVE_INPUT',
      entryIntent: 'direct_link',
      systemIdle: false,
    };
    const backToAnchor: SignalEvent = { ...anchorEvent, timestamp: 902_000, interactionType: 'IDLE' };
    const events: SignalEvent[] = [anchorEvent, wechatBlip, backToAnchor];
    // 当前页是 vscode.dev（锚点），距 t=0 的 ACTIVE_INPUT 已经过去 902000ms，
    // 中途在微信上的那一下不属于当前页，不该把 stillnessMs 重置成距 t=900000 的 2000ms。
    expect(computeFeatureFrame(events, ctx, 902_000).stillnessMs).toBe(902_000);
  });
});