// Anchor · 感知半（A）四信号计算
// 来源：契约v4.md §1（四信号精确定义）+ §2（Schema）+ §5.2（演示域预置缓存）
// 输入 SignalEvent[]（含历史）+ SessionContext + now，纯函数产出单帧 FeatureFrame
// 真实 LLM 调用（Day6/A8）通过 ClassificationCache 注入，不改动本文件的判定逻辑

import { SignalEvent, FeatureFrame, SessionContext, scaled } from './types';

export type ContextRelevance = FeatureFrame['contextRelevance'];

// 契约v4 §3.2：DEMO_MODE 下所有时间常数压缩 120 倍——不只是 B 侧的判定阈值，
// A 侧用来圈"最近多久"的窗口常量（纹理窗口、短停豁免）同样要压，否则 demo 的压缩时间轴上
// 这些窗口相对变得无限大，等于没有窗口。08-28：scaled() 之前这里自己维护了一份，跟 detector.ts
// 的实现几乎一样却是两份代码——统一改成从 types.ts 导入唯一的规范实现。


// ── §5.2 演示域预置分类缓存表：优先级高于 LLM 和黑名单，低于 sessionWhitelist 和 Shorts 硬判 ──
export const DEMO_PRESET_CACHE: Record<string, ContextRelevance> = {
  'vscode.dev': 'RELEVANT',
  'react.dev': 'RELEVANT',
  'stackoverflow.com': 'RELEVANT',
  'github.com': 'RELEVANT',
  'docs.google.com': 'RELEVANT',
  'claude.ai': 'RELEVANT',
  'chat.openai.com': 'RELEVANT',
  'arxiv.org': 'RELEVANT',
  'scholar.google.com': 'RELEVANT',
  'coursera.org': 'RELEVANT',
  'weibo.com': 'IRRELEVANT',
};

// 内置纯娱乐/购物/票务/网页游戏域黑名单（§1 信号1：不含 youtube/bilibili/reddit/x/facebook/pinterest 等
// 学习+娱乐混合站——那些站点内容形态因页面而异，域级拉黑会误伤真正相关的用法，一律走 LLM 内容级分类）
// 购物/票务站（淘宝/京东/Amazon/携程/12306/Ticketmaster/booking/getyourguide/zalando/temu）+
// 网页小游戏站（poki/crazygames/miniclip/y8/addictinggames）纳入本表：
// 误判概率极小（内容同质、纯被动/摸鱼消费，几乎不会是任务相关场景），即使误判，用户也能通过 sessionWhitelist
// 手动申诉纠正（见本文件底部优先级说明），成本可控。
// 注意：只收纳数量有限、体量巨大的头部聚合平台——不收纳品牌官网长尾（Nike/Adidas/Zara 等数量不可枚举，
// 且相关性依赖具体任务声明，交给 LLM 内容级分类兜底，见 docs/分类prompt-v0.md §3.2）
export const BUILTIN_ENTERTAINMENT_BLACKLIST = new Set<string>([
  'douyin.com',
  'xiaohongshu.com',
  'tiktok.com',
  'instagram.com',
  'kuaishou.com',
  'snapchat.com',
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'taobao.com',
  'tmall.com',
  'jd.com',
  'amazon.com',
  'ctrip.com',
  '12306.cn',
  'ticketmaster.com',
  'booking.com',
  'getyourguide.com',
  'zalando.com',
  'temu.com',
  'poki.com',
  'crazygames.com',
  'miniclip.com',
  'y8.com',
  'addictinggames.com',
]);

// 域名分类缓存：cacheKey(domain+pathPattern) -> 分类结果
// Day6（A8）由真实异步 LLM 写入；未命中前保守 UNKNOWN（红线1）
export type ClassificationCache = Map<string, ContextRelevance>;

function pathPattern(url: string): string {
  // 含 query（如 ?v=videoId）：同域不同内容（不同视频/不同帖子）需要分别缓存，
  // 仅取 pathname 会把 youtube.com/watch?v=A 和 ?v=B 错误地合并成同一条缓存。
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function cacheKey(domain: string, url: string): string {
  return `${domain}${pathPattern(url)}`;
}

// 真实 SignalEvent.domain 来自 URL.hostname（见 src/platform/background/domain.ts 的 domainOf()），
// 绝大多数真实流量带 www./m. 等子域前缀，而下面三张表只登记裸域名——必须按"同域或其子域"匹配，
// 不能用精确相等，否则 www.taobao.com 匹配不到表里的 taobao.com（黑名单/白名单/预置缓存全部失效）。
// 导出给平台层复用（signals.ts 的 isAnchorMatch、heuristics.ts 的 matchesDomain），
// 避免"同域或子域"这条边界判断逻辑在多处各写一份、容易一处改另一处忘（引擎依赖方向不变：
// 这是纯字符串函数，平台层依赖引擎是正常方向，引擎本身依然零 chrome API 依赖）。
export function domainMatches(domain: string, registered: string): boolean {
  return domain === registered || domain.endsWith(`.${registered}`);
}

/**
 * 信号 1：上下文相关性
 * 短路优先级（§1）：演示域预置缓存 > sessionWhitelist > short_feed 硬判 > 内置娱乐黑名单 > LLM 分类缓存 > UNKNOWN
 */
export function resolveContextRelevance(
  event: SignalEvent,
  ctx: SessionContext,
  cache: ClassificationCache
): ContextRelevance {
  const presetMatch = Object.entries(DEMO_PRESET_CACHE).find(([registered]) =>
    domainMatches(event.domain, registered)
  );
  if (presetMatch) return presetMatch[1];

  const key = cacheKey(event.domain, event.url);
  const domainWhitelisted = ctx.sessionWhitelist.some((w) => domainMatches(event.domain, w));
  if (domainWhitelisted || ctx.sessionWhitelist.includes(key)) {
    return 'RELEVANT';
  }

  if (event.contentKind === 'short_feed') return 'IRRELEVANT';

  const blacklisted = [...BUILTIN_ENTERTAINMENT_BLACKLIST].some((d) => domainMatches(event.domain, d));
  if (blacklisted) return 'IRRELEVANT';

  // entryIntent === purposeful 时即使判不出也不升级为 IRRELEVANT——本实现天然满足：
  // 未命中缓存时统一落到 UNKNOWN，从不主动升级为 IRRELEVANT。
  return cache.get(key) ?? 'UNKNOWN';
}

// ── 信号 2：锚点脱离时长 + lastAnchorSnapshot ──
// isAnchor 由上游信号采集（A4）依据 SessionContext.anchor.matchMode 判定后直接标记在 SignalEvent 上；
// 感知半在此只消费该标记，不重复做 URL/前缀匹配。
const MEANINGFUL_ANCHOR_INTERACTIONS = new Set<SignalEvent['interactionType']>([
  'ACTIVE_INPUT',
  'PASSIVE_SCROLL',
  'MEDIA_PAUSE',
  'MEDIA_SEEK',
]);

function computeAnchorSignal(
  events: SignalEvent[],
  now: number
): { anchorDetachedMs: number; lastAnchorSnapshot: FeatureFrame['lastAnchorSnapshot'] } {
  let lastTs = 0; // 会话开始尚无锚点交互时，从 sessionStart(0) 起累计
  let snapshot: FeatureFrame['lastAnchorSnapshot'] = { title: '', url: '', ts: 0 };
  for (const e of events) {
    if (e.isAnchor && MEANINGFUL_ANCHOR_INTERACTIONS.has(e.interactionType)) {
      lastTs = e.timestamp;
      snapshot = { title: e.title, url: e.url, ts: e.timestamp };
    }
  }
  return { anchorDetachedMs: now - lastTs, lastAnchorSnapshot: snapshot };
}

// ── 信号 3：交互纹理（最近 120s 窗口，优先级 idle > purposeful > passive）──
const TEXTURE_WINDOW_MS = 120_000;

const IDLE_BLOCKING_TYPES = new Set<SignalEvent['interactionType']>([
  'ACTIVE_INPUT',
  'PASSIVE_SCROLL',
  'MEDIA_PLAY',
  'MEDIA_PAUSE',
  'MEDIA_SEEK',
]);

export function computeTexture(
  events: SignalEvent[],
  now: number,
  contextRelevance: ContextRelevance,
  previousTexture: FeatureFrame['texture'] = 'idle',
  isDemoMode?: boolean
): FeatureFrame['texture'] {
  const current = events[events.length - 1];
  const windowMs = scaled(TEXTURE_WINDOW_MS, isDemoMode);
  // 契约：「当前活跃页事件」——只看当前这一域（切页前上一页的交互不该混进来算这一页的纹理）。
  // 用 domain 而非精确 url：连续切换到同域下一条内容（如 YouTube 自动连播换下一个视频）
  // 仍应视为同一次"停留"的延续，不应因 url 变了就把纹理证据打断、退回冷启动。
  const windowEvents = current
    ? events.filter((e) => e.timestamp > now - windowMs && e.timestamp <= now && e.domain === current.domain)
    : [];

  // 冷启动 vs 真沉默：current 恒等于全部历史里时间戳最大的那条事件，它必然满足自己的
  // domain 过滤条件，所以 windowEvents 为空当且仅当①压根没有任何事件（真正的会话起点，
  // 沿用 previousTexture——没有信息，不该编造判定）或②最近一条事件已经比一整个窗口还旧
  // （不管是不是同一域名，反正这一整个窗口时间片里什么信号都没发生）。真机测试暴露过：
  // 安静看视频完全不产生事件（content script 只在键盘/滚动/播放暂停时才发），②这个分支会
  // 被心跳持续命中，previousTexture 就此冻结、永不更新——DRIFT 判定要求的 passive/idle 纹理
  // 证据因此永远等不到。一整个窗口的彻底沉默本身就是"idle"最有力的证据，不该无限期回显
  // 上一次判定，两种情况必须分开处理。
  if (windowEvents.length < 1) return current ? 'idle' : previousTexture;

  const hasEngagement = windowEvents.some((e) => IDLE_BLOCKING_TYPES.has(e.interactionType));
  if (!hasEngagement) return 'idle';

  const purposefulEvidence = windowEvents.some((e) => {
    if (e.interactionType === 'MEDIA_PAUSE' || e.interactionType === 'MEDIA_SEEK') return true;
    // v4：IRRELEVANT 页上的 ACTIVE_INPUT 不升级为 purposeful（CREATOR 打字型走神盲区修复）
    if (e.interactionType === 'ACTIVE_INPUT' && contextRelevance !== 'IRRELEVANT') return true;
    return false;
  });
  if (purposefulEvidence) return 'purposeful';

  return 'passive';
}

// ── 信号 4：跳转形态（最近 5 次域名切换，去重连续同域）──
interface DomainSegment {
  domain: string;
  startTs: number;
  endTs: number;
  isAnchorSegment: boolean;
  relevance: ContextRelevance;
}

function buildDomainSegments(
  events: SignalEvent[],
  ctx: SessionContext,
  cache: ClassificationCache,
  now: number
): DomainSegment[] {
  const segments: DomainSegment[] = [];
  for (const e of events) {
    const last = segments[segments.length - 1];
    if (!last || last.domain !== e.domain) {
      if (last) last.endTs = e.timestamp;
      segments.push({
        domain: e.domain,
        startTs: e.timestamp,
        endTs: now,
        isAnchorSegment: e.isAnchor,
        relevance: resolveContextRelevance(e, ctx, cache),
      });
    } else {
      last.isAnchorSegment = last.isAnchorSegment || e.isAnchor;
    }
  }
  return segments;
}

const SHORT_STAY_GRACE_MS = 10_000; // 短停豁免：停留 <=10s 的离群点不计入 rabbit_hole

export function computeJumpPattern(
  events: SignalEvent[],
  ctx: SessionContext,
  cache: ClassificationCache,
  now: number,
  isDemoMode?: boolean
): FeatureFrame['jumpPattern'] {
  const shortStayGraceMs = scaled(SHORT_STAY_GRACE_MS, isDemoMode);
  const segments = buildDomainSegments(events, ctx, cache, now);
  const last5 = segments.slice(-5);

  if (last5.length < 3) return 'stable';
  if (last5.some((s) => s.isAnchorSegment)) return 'stable'; // ≥1 次回到锚点域

  const hasUnknown = last5.some((s) => s.relevance === 'UNKNOWN');
  const irrelevantCount = last5.filter((s) => s.relevance === 'IRRELEVANT').length;

  if (irrelevantCount >= 2) {
    if (!hasUnknown) {
      for (let i = 0; i < last5.length - 1; i++) {
        const a = last5[i];
        const b = last5[i + 1];
        if (
          a.relevance === 'IRRELEVANT' &&
          b.relevance === 'IRRELEVANT' &&
          a.endTs - a.startTs > shortStayGraceMs &&
          b.endTs - b.startTs > shortStayGraceMs
        ) {
          return 'rabbit_hole';
        }
      }
    }
    return 'stable';
  }

  // irrelevantCount <= 1：手滑容忍，但含 UNKNOWN 域时「其余均 RELEVANT」不成立，保守判 stable
  if (hasUnknown) return 'stable';
  return 'task_orbit';
}

// ── 辅助测量：stillnessMs（当前页连续无任何交互，含 HIDDEN；ACTIVE_INPUT/PASSIVE_SCROLL/MEDIA_* 归零）──
// 契约明确是「当前页」静止时长，只统计发生在当前页（同 domain+url）上的交互——
// 在别的页面/tab 上动一下不该把这一页的静止计时冲掉。
function computeStillnessMs(events: SignalEvent[], now: number): number {
  const current = events[events.length - 1];
  if (!current) return now;

  let lastActivityTs = 0;
  for (const e of events) {
    if (e.domain !== current.domain || e.url !== current.url) continue;
    if (
      e.interactionType === 'ACTIVE_INPUT' ||
      e.interactionType === 'PASSIVE_SCROLL' ||
      e.interactionType === 'MEDIA_PLAY' ||
      e.interactionType === 'MEDIA_PAUSE' ||
      e.interactionType === 'MEDIA_SEEK'
    ) {
      lastActivityTs = e.timestamp;
    }
  }
  return now - lastActivityTs;
}

// ── entryIntent：SignalEvent 5 值 → FeatureFrame 3 值归约 ──
function reduceEntryIntent(intent: SignalEvent['entryIntent']): FeatureFrame['entryIntent'] {
  switch (intent) {
    case 'search':
    case 'direct_link':
      return 'purposeful';
    case 'feed':
    case 'autoplay':
      return 'feed_driven';
    default:
      return 'unknown';
  }
}

/**
 * 感知半主入口：给定完整事件历史（≤now）与会话参照系，产出当前时刻的 FeatureFrame。
 * 纯函数、无副作用；previousTexture 仅用于 texture 信号的冷启动延续（§1 信号3）。
 */
export function computeFeatureFrame(
  events: SignalEvent[],
  ctx: SessionContext,
  now: number,
  cache: ClassificationCache = new Map(),
  previousTexture: FeatureFrame['texture'] = 'idle',
  isDemoMode?: boolean
): FeatureFrame {
  const visible = events.filter((e) => e.timestamp <= now);
  const current = visible[visible.length - 1];

  const contextRelevance = current ? resolveContextRelevance(current, ctx, cache) : 'UNKNOWN';
  const { anchorDetachedMs, lastAnchorSnapshot } = computeAnchorSignal(visible, now);
  const texture = computeTexture(visible, now, contextRelevance, previousTexture, isDemoMode);
  const jumpPattern = computeJumpPattern(visible, ctx, cache, now, isDemoMode);
  const stillnessMs = computeStillnessMs(visible, now);

  return {
    timestamp: now,
    sessionId: ctx.sessionId,
    contextRelevance,
    anchorDetachedMs,
    texture,
    jumpPattern,
    stillnessMs,
    entryIntent: current ? reduceEntryIntent(current.entryIntent) : 'unknown',
    contentFormat: current?.contentKind === 'short_feed' ? 'short_feed' : 'standard',
    systemIdle: current?.systemIdle ?? false,
    lastAnchorSnapshot,
    currentDomain: current?.domain ?? '',
    currentTitle: current?.title ?? '',
    currentContentKind: current?.contentKind ?? 'unknown',
  };
}