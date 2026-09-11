// Anchor · 感知半（A）四信号计算
// 来源：契约v4.md §1（四信号精确定义）+ §2（Schema）+ §5.2（演示域预置缓存）
// 输入 SignalEvent[]（含历史）+ SessionContext + now，纯函数产出单帧 FeatureFrame
// 真实 LLM 调用（Day6/A8）通过 ClassificationCache 注入，不改动本文件的判定逻辑

import { SignalEvent, FeatureFrame, SessionContext, scaled } from './types';

export type ContextRelevance = FeatureFrame['contextRelevance'];

// 契约v4 §3.2：DEMO_MODE 下所有时间常数按 DEMO_TIME_SCALE 压缩（09-11 从 120x 调到 30x，
// 见 types.ts 顶部注释）——不只是 B 侧的判定阈值，
// A 侧用来圈"最近多久"的窗口常量（纹理窗口、短停豁免）同样要压，否则 demo 的压缩时间轴上
// 这些窗口相对变得无限大，等于没有窗口。08-28：scaled() 之前这里自己维护了一份，跟 detector.ts
// 的实现几乎一样却是两份代码——统一改成从 types.ts 导入唯一的规范实现。


// ── §5.2 演示域预置分类缓存表：优先级高于 LLM 和黑名单，低于 sessionWhitelist 和 Shorts 硬判 ──
// 09-05 撤销：AI 对话助手（claude.ai/chat.openai.com 等）曾经收在这张表里，真机反馈发现是
// 错误的收纳——这张表是域级硬判，一旦命中根本不会走到 LLM，看不到页面标题。AI 对话工具的
// 内容形态完全因对话而异（同一个 claude.ai 网址可能在聊任务，也可能中途飘去问"中午吃什么"），
// 这跟 youtube/reddit/x.com 这类"域名下什么内容都可能出现"的混合站是同一类站点——那些站点
// 故意不进这张表、必须走 LLM 按标题内容级判断，AI 对话助手理应同一个待遇，之前收进来是判断
// 失误，不是这张表的设计原则本身有问题。改用下面的 cacheKey() 带标题重新分类，AI 对话助手
// 现在完全交给 LLM，一个域名不留。
export const DEMO_PRESET_CACHE: Record<string, ContextRelevance> = {
  'vscode.dev': 'RELEVANT',
  'react.dev': 'RELEVANT',
  'stackoverflow.com': 'RELEVANT',
  'github.com': 'RELEVANT',
  'docs.google.com': 'RELEVANT',
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

// 域名分类缓存：cacheKey(domain+pathPattern+title) -> 分类结果
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

/** domain+path，不含标题——给"同一个页面"这个更粗的粒度用（目前只有分类节流要这个粒度）。 */
export function pageKey(domain: string, url: string): string {
  return `${domain}${pathPattern(url)}`;
}

// 09-05：分类要跟着标题变，不能只跟着 URL 变。AI 对话类页面（claude.ai/chat/xxx 这种）
// 整场对话 URL 从不变化，但话题可以从"神经网络入门"飘到"中午吃什么"——只用 domain+path
// 当 key 会把第一次（可能是标题还是"New chat"、信息量为零时）算出的判定冻结一辈子，
// 后面话题怎么飘都读不到。加标题进 key 后，标题一变就是全新的 key，resolveContextRelevance()
// 命中不到旧缓存会自然退回 UNKNOWN，triggerLazyClassification()（frame-pipeline.ts）
// 就会对着新标题重新分类一次——不用额外写"标题变了要不要重新分类"的判断逻辑，直接白拿。
// 标题做归一化（大小写/多余空白）：同一句标题因为多个空格被判成"变了"会白白重新分类一次，
// 只会误伤性能、不会影响正确性，但没必要。
//
// 09-05：contentSnippet（用户刚在页面里输入的文字，目前仅 claude.ai）同样拼进 key，
// 理由跟标题完全一样——真机复现：标题也不是每轮对话都更新（连续问 3 个无关问题，标题
// 从头到尾没变），单靠标题这次也失效了。有新消息就是全新的 key，跟标题变化走的是
// 同一套"缓存命不中 → 自动退回 UNKNOWN → 触发重新分类"机制，不是另开一条判断逻辑。
export function cacheKey(domain: string, url: string, title: string, contentSnippet?: string): string {
  const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const snippetPart = contentSnippet ? `::${normalize(contentSnippet)}` : '';
  return `${pageKey(domain, url)}::${normalize(title)}${snippetPart}`;
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

  const key = cacheKey(event.domain, event.url, event.title, event.contentSnippet);
  const domainWhitelisted = ctx.sessionWhitelist.some((w) => domainMatches(event.domain, w));
  // 09-11：sessionWhitelist 现在可能存的是一整个域名（老行为，"查资料"场景4），也可能是
  // 某个具体页面的 pageKey（domain+path，混合内容站点专用，见 frame-pipeline.ts
  // applyCheckInAnswer() 的注释）——两种粒度共存在同一个数组里，字符串形状天然不会撞
  // （域名不含 "/"，pageKey 一定含 "/"），这里都认。
  const pageWhitelisted = ctx.sessionWhitelist.includes(pageKey(event.domain, event.url));
  if (domainWhitelisted || pageWhitelisted || ctx.sessionWhitelist.includes(key)) {
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
// 08-30 真机测试后改的语义：不再要求"必须是起步教练最初声明的那一个固定锚点"（`isAnchor`
// 字段，按 `SessionContext.anchor.matchMode` 精确/前缀匹配）。真实专注场景里锚点是会变的——
// 从 GitHub 仓库切到 Jupyter Notebook 再切到 Notion 笔记，只要都是任务相关资源，都该算"还在
// 干正事"，不该因为不是最初那一个 URL 就被记成"脱离"。现在的标准改成"这一刻的页面判定是
// 不是 RELEVANT"（信号1已经算好的 `resolveContextRelevance`），不再看 `isAnchor`。
// `isAnchor` 字段本身没有从 schema 里删——jumpPattern 的 segment 判断（§1信号4）、
// 平台层 signals.ts 的 `isAnchorMatch` 还在用它，这里只是信号2改了口径（pull-back.ts
// 08-30 也跟着改成按 lastAnchorSnapshot 找目标 tab，不再依赖 isAnchorMatch）。
const MEANINGFUL_ANCHOR_INTERACTIONS = new Set<SignalEvent['interactionType']>([
  'ACTIVE_INPUT',
  'PASSIVE_SCROLL',
  'MEDIA_PAUSE',
  'MEDIA_SEEK',
]);

function computeAnchorSignal(
  events: SignalEvent[],
  ctx: SessionContext,
  cache: ClassificationCache,
  now: number
): { anchorDetachedMs: number; lastAnchorSnapshot: FeatureFrame['lastAnchorSnapshot'] } {
  // 08-30：会话开始尚无"相关页面上的有意义交互"时，从这份历史里最早一条事件的时间戳算起
  // （不是字面量 0/Unix epoch——那样 anchorDetachedMs 会从第一帧起就是个天文数字，是之前
  // 修过的一个真 bug）。events 为空（真正的会话第一帧）时退回 now，正确从 0 起算。
  let lastTs = events[0]?.timestamp ?? now;
  let snapshot: FeatureFrame['lastAnchorSnapshot'] = { title: '', url: '', ts: 0 };
  for (const e of events) {
    if (
      MEANINGFUL_ANCHOR_INTERACTIONS.has(e.interactionType) &&
      resolveContextRelevance(e, ctx, cache) === 'RELEVANT'
    ) {
      lastTs = e.timestamp;
      snapshot = { title: e.title, url: e.url, ts: e.timestamp, tabId: e.tabId };
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

// ── 辅助测量：当前页最近一条 MEDIA_PLAY/MEDIA_PAUSE 是不是 PLAY（09-11）──
// `video.play` 事件只在开始播放那一刻发一次，持续播放中途不会再发；不看这个字段的话，
// stillnessMs/texture 会把"安静看着一个仍在播放的视频"和"人已经走开、视频早停了/根本没播"
// 算成同一回事（见 isStuck() 里的用法）。MEDIA_SEEK 不改变播放状态（暂停时也能拖进度条），
// 不参与这个判断，只看 PLAY/PAUSE 谁最后发生。
function computeMediaPlaying(events: SignalEvent[]): boolean {
  const current = events[events.length - 1];
  if (!current) return false;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.domain !== current.domain || e.url !== current.url) continue;
    if (e.interactionType === 'MEDIA_PLAY') return true;
    if (e.interactionType === 'MEDIA_PAUSE') return false;
  }
  return false;
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
  const { anchorDetachedMs, lastAnchorSnapshot } = computeAnchorSignal(visible, ctx, cache, now);
  const texture = computeTexture(visible, now, contextRelevance, previousTexture, isDemoMode);
  const jumpPattern = computeJumpPattern(visible, ctx, cache, now, isDemoMode);
  const stillnessMs = computeStillnessMs(visible, now);
  const mediaPlaying = computeMediaPlaying(visible);

  return {
    timestamp: now,
    sessionId: ctx.sessionId,
    contextRelevance,
    anchorDetachedMs,
    texture,
    jumpPattern,
    stillnessMs,
    mediaPlaying,
    entryIntent: current ? reduceEntryIntent(current.entryIntent) : 'unknown',
    contentFormat: current?.contentKind === 'short_feed' ? 'short_feed' : 'standard',
    systemIdle: current?.systemIdle ?? false,
    lastAnchorSnapshot,
    currentDomain: current?.domain ?? '',
    currentTitle: current?.title ?? '',
    currentContentKind: current?.contentKind ?? 'unknown',
    currentUrl: current?.url ?? '',
  };
}