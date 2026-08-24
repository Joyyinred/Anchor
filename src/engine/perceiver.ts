// Anchor · 感知半（A）四信号计算
// 来源：契约v4.md §1（四信号精确定义）+ §2（Schema）+ §5.2（演示域预置缓存）
// 输入 SignalEvent[]（含历史）+ SessionContext + now，纯函数产出单帧 FeatureFrame
// 真实 LLM 调用（Day6/A8）通过 ClassificationCache 注入，不改动本文件的判定逻辑

import { SignalEvent, FeatureFrame, SessionContext } from './types';

export type ContextRelevance = FeatureFrame['contextRelevance'];

// 契约v4 §3.2：DEMO_MODE 下所有时间常数压缩 120 倍——不只是 B 侧的判定阈值，
// A 侧用来圈"最近多久"的窗口常量（纹理窗口、短停豁免）同样要压，否则 demo 的压缩时间轴上
// 这些窗口相对变得无限大，等于没有窗口。
const DEMO_TIME_SCALE = 1 / 120;
function scaled(ms: number, isDemoMode?: boolean): number {
  return isDemoMode ? ms * DEMO_TIME_SCALE : ms;
}

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

// 内置纯娱乐域黑名单（§1 信号1：不含 youtube/bilibili 等学习+娱乐混合站，那些走 LLM 内容级分类）
export const BUILTIN_ENTERTAINMENT_BLACKLIST = new Set<string>([
  'douyin.com',
  'xiaohongshu.com',
  'tiktok.com',
  'instagram.com',
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

/**
 * 信号 1：上下文相关性
 * 短路优先级（§1）：演示域预置缓存 > sessionWhitelist > short_feed 硬判 > 内置娱乐黑名单 > LLM 分类缓存 > UNKNOWN
 */
export function resolveContextRelevance(
  event: SignalEvent,
  ctx: SessionContext,
  cache: ClassificationCache
): ContextRelevance {
  if (event.domain in DEMO_PRESET_CACHE) return DEMO_PRESET_CACHE[event.domain];

  const key = cacheKey(event.domain, event.url);
  if (ctx.sessionWhitelist.includes(event.domain) || ctx.sessionWhitelist.includes(key)) {
    return 'RELEVANT';
  }

  if (event.contentKind === 'short_feed') return 'IRRELEVANT';

  if (BUILTIN_ENTERTAINMENT_BLACKLIST.has(event.domain)) return 'IRRELEVANT';

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

  // 冷启动：窗口内完全没有当前页事件，沿用最近一次判定。
  // 契约原文本要求 "<2 条"，但那是针对真实浏览器里事件密集产生的场景；本仓库的 mock 事件流
  // 是稀疏的关键时刻快照（如一次 MEDIA_PLAY 代表持续观看），单条事件本身已经是有效证据，
  // 不应被当成"数据不足"而退回冷启动，故此处放宽为 0 条才算冷启动。
  if (windowEvents.length < 1) return previousTexture;

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