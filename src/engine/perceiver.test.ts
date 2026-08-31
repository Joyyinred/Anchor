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

  it('built-in entertainment blacklist hard-rules IRRELEVANT (A2 兜底表)', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'douyin.com', url: 'https://www.douyin.com/video/123', contentKind: 'video', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
  });

  it('newly added blacklist domains (netflix/hulu/disneyplus) resolve IRRELEVANT', () => {
    const ctx = mkCtx();
    for (const domain of ['netflix.com', 'hulu.com', 'disneyplus.com']) {
      const event: SignalEvent = { ...anchorEvent, domain, url: `https://${domain}/watch`, contentKind: 'video', isAnchor: false };
      expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
    }
  });

  it('x/facebook/pinterest are mixed sites, not blacklisted — fall through to UNKNOWN like youtube/zhihu', () => {
    const ctx = mkCtx();
    for (const domain of ['x.com', 'facebook.com', 'pinterest.com']) {
      const event: SignalEvent = { ...anchorEvent, domain, url: `https://${domain}/some-post`, contentKind: 'social_feed', isAnchor: false };
      expect(resolveContextRelevance(event, ctx, new Map())).toBe('UNKNOWN');
    }
  });

  it('shopping/ticketing aggregator domains hard-rule IRRELEVANT (head platforms, bounded list)', () => {
    const ctx = mkCtx();
    const domains = [
      'taobao.com', 'tmall.com', 'jd.com', 'amazon.com',
      'ctrip.com', '12306.cn', 'ticketmaster.com', 'booking.com', 'getyourguide.com',
      'zalando.com', 'temu.com',
    ];
    for (const domain of domains) {
      const event: SignalEvent = { ...anchorEvent, domain, url: `https://${domain}/order`, contentKind: 'unknown', isAnchor: false };
      expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
    }
  });

  it('sessionWhitelist can recover a shopping-domain false positive (declared task genuinely involves buying something)', () => {
    const ctx = mkCtx({ sessionWhitelist: ['jd.com'] });
    const event: SignalEvent = { ...anchorEvent, domain: 'jd.com', url: 'https://jd.com/product/monitor', contentKind: 'unknown', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('RELEVANT');
  });

  it('browser mini-game sites hard-rule IRRELEVANT (poki/crazygames/miniclip/y8/addictinggames)', () => {
    const ctx = mkCtx();
    const domains = ['poki.com', 'crazygames.com', 'miniclip.com', 'y8.com', 'addictinggames.com'];
    for (const domain of domains) {
      const event: SignalEvent = { ...anchorEvent, domain, url: `https://${domain}/game/some-game`, contentKind: 'unknown', isAnchor: false };
      expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
    }
  });

  it('brand storefront long-tail (nike/adidas/zara) is NOT blacklisted — unbounded domain space, left to LLM/UNKNOWN', () => {
    const ctx = mkCtx();
    for (const domain of ['nike.com', 'adidas.com', 'zara.com']) {
      const event: SignalEvent = { ...anchorEvent, domain, url: `https://${domain}/product/123`, contentKind: 'unknown', isAnchor: false };
      expect(resolveContextRelevance(event, ctx, new Map())).toBe('UNKNOWN');
    }
  });

  it('sessionWhitelist overrides the blacklist (whitelist takes priority)', () => {
    const ctx = mkCtx({ sessionWhitelist: ['netflix.com'] });
    const event: SignalEvent = { ...anchorEvent, domain: 'netflix.com', url: 'https://netflix.com/watch/documentary', contentKind: 'video', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('RELEVANT');
  });

  it('blacklist matches real-world www./subdomain hostnames, not just the bare registered domain', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'www.taobao.com', url: 'https://www.taobao.com/item', contentKind: 'unknown', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('IRRELEVANT');
  });

  it('demo preset cache matches www./subdomain hostnames', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'www.github.com', url: 'https://www.github.com/anthropics', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('RELEVANT');
  });

  it('sessionWhitelist domain entry matches www./subdomain hostnames', () => {
    const ctx = mkCtx({ sessionWhitelist: ['netflix.com'] });
    const event: SignalEvent = { ...anchorEvent, domain: 'www.netflix.com', url: 'https://www.netflix.com/watch/documentary', contentKind: 'video', isAnchor: false };
    expect(resolveContextRelevance(event, ctx, new Map())).toBe('RELEVANT');
  });

  it('subdomain matching respects the dot boundary — notdouyin.com is NOT douyin.com', () => {
    const ctx = mkCtx();
    const event: SignalEvent = { ...anchorEvent, domain: 'notdouyin.com', url: 'https://notdouyin.com/page', contentKind: 'unknown', isAnchor: false };
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

  // 08-30：锚点不再是"起步教练最初声明的那一个固定页面"——真实专注场景里会从 GitHub 切到
  // Jupyter 再切到 Notion，只要都判 RELEVANT 就该算"还在干正事"。events 的第二条事件在
  // react.dev（DEMO_PRESET_CACHE 里是 RELEVANT），isAnchor:false（不是最初声明的那个 vscode.dev），
  // 但现在判定标准已经不看 isAnchor 了——PASSIVE_SCROLL + RELEVANT 依然归零。
  it('anchorDetachedMs：切到另一个 RELEVANT 页面（不是最初的锚点）依然归零', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    expect(frame.anchorDetachedMs).toBe(0);
  });

  it('anchorDetachedMs：PASSIVE_SCROLL 在 RELEVANT 页面上归零', () => {
    const scrollOnAnchor: SignalEvent = { ...anchorEvent, timestamp: 45000, interactionType: 'PASSIVE_SCROLL' };
    const frame = computeFeatureFrame([anchorEvent, scrollOnAnchor], ctx, 50000);
    expect(frame.anchorDetachedMs).toBe(5000);
  });

  it('anchorDetachedMs：MEDIA_PLAY 在 RELEVANT 页面上不归零（契约明确排除在有意义交互之外）', () => {
    const playOnAnchor: SignalEvent = { ...anchorEvent, timestamp: 45000, interactionType: 'MEDIA_PLAY' };
    const frame = computeFeatureFrame([anchorEvent, playOnAnchor], ctx, 50000);
    expect(frame.anchorDetachedMs).toBe(50000); // 仍从 t=0 的 ACTIVE_INPUT 算起
  });

  // isAnchor 字段本身不再决定这个信号——一个页面哪怕标了 isAnchor:true，只要判定不是
  // RELEVANT（比如分类还没判出来，UNKNOWN），也不该被当成"还在干正事"。用一个不在任何
  // 预置表/白名单/黑名单里的域名（会落到 UNKNOWN）验证这一点。
  it('anchorDetachedMs：isAnchor:true 但页面判定不是 RELEVANT 时不归零', () => {
    const unknownDomainAnchor: SignalEvent = {
      ...anchorEvent,
      domain: 'some-random-unclassified-site.com',
      url: 'https://some-random-unclassified-site.com/page',
      isAnchor: true, // 就算平台层标记了 isAnchor，这个信号现在也不看它
      timestamp: 45000,
    };
    const frame = computeFeatureFrame([unknownDomainAnchor], ctx, 50000);
    // events[0] 就是 unknownDomainAnchor 本身，lastTs 兜底成这条事件的时间戳（45000），
    // 不是因为它被判成"命中"，纯粹是"这份历史最早一条事件"这个兜底逻辑生效。
    expect(frame.anchorDetachedMs).toBe(5000);
    expect(frame.lastAnchorSnapshot).toEqual({ title: '', url: '', ts: 0 }); // 快照没被这条事件更新
  });

  it('lastAnchorSnapshot 记录最后一次"RELEVANT 页面"上的有意义交互（不要求是最初的锚点）', () => {
    const frame = computeFeatureFrame(events, ctx, 45000);
    expect(frame.lastAnchorSnapshot).toEqual({ title: 'Hooks Reference', url: 'https://react.dev/reference/hooks', ts: 45000 });
  });

  // 08-30 真机测试暴露的 bug：历史里从来没有一条"RELEVANT 页面上的有意义交互"时（比如
  // 用户全程没碰过任何相关页面），lastTs 原来是字面量 0（Unix epoch），
  // anchorDetachedMs = now - 0，从会话第一帧起就是个天文数字，anchorAbandoned 恒为 true。
  // 契约§1信号2明确写的是"从 sessionStart 起累计"——应该从一个很小的数开始涨，不是天文数字。
  it('anchorDetachedMs：从未命中过 RELEVANT 页面时，从这段历史最早一条事件算起（不是 Unix epoch）', () => {
    // 域名不在任何预置表/白名单/黑名单里，落到 UNKNOWN——整段历史都判不出 RELEVANT。
    const neverAnchored: SignalEvent = {
      ...anchorEvent,
      domain: 'some-random-unclassified-site.com',
      url: 'https://some-random-unclassified-site.com/page',
      isAnchor: false,
      timestamp: 1_700_000_000_000,
    };
    const later: SignalEvent = { ...neverAnchored, timestamp: 1_700_000_060_000, interactionType: 'PASSIVE_SCROLL' };
    const frame = computeFeatureFrame([neverAnchored, later], ctx, 1_700_000_090_000);
    // 应该是"距这段历史最早一条事件过了多久"（90000ms），不是距 1970 年过了多久。
    expect(frame.anchorDetachedMs).toBe(90_000);
    expect(frame.lastAnchorSnapshot).toEqual({ title: '', url: '', ts: 0 }); // 快照本身仍是空的，这条只锁 anchorDetachedMs
  });

  it('anchorDetachedMs：真正的会话第一帧（events 为空）从 0 起算', () => {
    const frame = computeFeatureFrame([], ctx, 1_700_000_000_000);
    expect(frame.anchorDetachedMs).toBe(0);
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

  // A15：keystroke/feed_scroll/media_seek 三种交互纹理要分开判——不是所有 IDLE_BLOCKING_TYPES
  // 都算"主动投入"，被动划动跟主动拖进度条/暂停找内容的投入程度不一样。
  it('PASSIVE_SCROLL（feed_scroll）单独出现时判 passive，不是 purposeful——被动划动跟主动敲键盘/主动拖进度条要分开', () => {
    const ctx = mkCtx();
    const scrollEvent: SignalEvent = { ...anchorEvent, timestamp: 60000, interactionType: 'PASSIVE_SCROLL' };
    const frame = computeFeatureFrame([scrollEvent], ctx, 90000);
    expect(frame.texture).toBe('passive');
  });

  it('MEDIA_SEEK 单独出现时判 purposeful——主动拖进度条找内容跟被动播放（MEDIA_PLAY）要分开', () => {
    const ctx = mkCtx();
    const seekEvent: SignalEvent = { ...anchorEvent, timestamp: 60000, interactionType: 'MEDIA_SEEK' };
    const frame = computeFeatureFrame([seekEvent], ctx, 90000);
    expect(frame.texture).toBe('purposeful');
  });

  it('MEDIA_PAUSE 单独出现时同样判 purposeful', () => {
    const ctx = mkCtx();
    const pauseEvent: SignalEvent = { ...anchorEvent, timestamp: 60000, interactionType: 'MEDIA_PAUSE' };
    const frame = computeFeatureFrame([pauseEvent], ctx, 90000);
    expect(frame.texture).toBe('purposeful');
  });

  it('冷启动（窗口内事件 < 2）沿用 previousTexture', () => {
    const ctx = mkCtx();
    const frame = computeFeatureFrame([anchorEvent], ctx, 0, new Map(), 'purposeful');
    expect(frame.texture).toBe('purposeful');
  });

  // 08-28 回归测试：真机测试暴露的 bug——安静看视频完全不产生新事件（content script 只在
  // 键盘/滚动/播放暂停时才发），心跳 alarm 仍在推进 now，但 events 数组里最后一条事件已经比
  // 一整个纹理窗口（120s）还旧。修复前 computeTexture 会无限期回显 previousTexture，DRIFT
  // 判定要求的 passive/idle 纹理证据永远等不到；修复后一整个窗口的彻底沉默本身就该被判 idle。
  it('真沉默（最后一条事件已超过一整个窗口）应判 idle，不该无限期回显 previousTexture', () => {
    const ctx = mkCtx();
    // 唯一一条事件发生在 t=0（MEDIA_PLAY，安静看视频），此后再没有任何新事件——
    // now 推进到 200000（超过 120000 的纹理窗口），previousTexture 仍是上一帧算出的 'passive'。
    const quietVideoEvent: SignalEvent = { ...anchorEvent, interactionType: 'MEDIA_PLAY' };
    const frame = computeFeatureFrame([quietVideoEvent], ctx, 200_000, new Map(), 'passive');
    expect(frame.texture).toBe('idle');
  });

  it('真正的会话起点（一条事件都没有）仍然沿用 previousTexture——没有信息，不该编造判定', () => {
    const ctx = mkCtx();
    const frame = computeFeatureFrame([], ctx, 200_000, new Map(), 'purposeful');
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