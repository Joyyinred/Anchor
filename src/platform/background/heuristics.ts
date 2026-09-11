// Anchor · A4 简单启发式：contentKind / entryIntent 映射
// 真实语义分类（contextRelevance）是 A8 的事，这里只产出 SignalEvent 字段本身
import type { SignalEvent } from '../../engine/types';
import { domainMatches } from '../../engine/perceiver';

const CODE_DOMAINS = ['github.com', 'vscode.dev', 'gitlab.com', 'stackoverflow.com'];
const DOCS_DOMAINS = ['react.dev', 'docs.google.com', 'developer.mozilla.org'];
const VIDEO_DOMAINS = ['youtube.com', 'bilibili.com'];
// 09-05：跟 perceiver.ts 的 DEMO_PRESET_CACHE 同步扩了这批主流 AI 对话助手——两处
// 各管各的（这里是 contentKind 元数据，那边是 contextRelevance 判定），但都该反映同一个
// "这些是 AI 对话助手" 的事实，没有谁依赖谁，纯粹是保持信息准确、不掉进 unknown。
const AI_CHAT_DOMAINS = [
  'claude.ai',
  'chat.openai.com',
  'chatgpt.com',
  'gemini.google.com',
  'grok.com',
  'perplexity.ai',
  'copilot.microsoft.com',
  'chat.deepseek.com',
  'poe.com',
];
const MUSIC_DOMAINS = ['open.spotify.com', 'music.163.com'];
// A16：docs/分类prompt-v0.md §3.2 明确 x.com/twitter.com/facebook.com/pinterest.com/reddit.com
// 这类"学习+娱乐混合站"不能域级拉黑（内容形态因页面而异），只能走 LLM 内容级分类兜底——
// 但仍然值得把 contentKind 标成 social_feed（而不是掉进 unknown），信息更准确，
// 且这条 tag 是后续 A17/A18 及 B 侧可能用得上的元数据。
const SOCIAL_DOMAINS = ['reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'pinterest.com', 'threads.net'];
const ARTICLE_DOMAINS = ['wikipedia.org', 'medium.com', 'zhihu.com'];

// 09-11 新增，供 frame-pipeline.ts applyCheckInAnswer() 使用：这三组域名的共同点是"内容形态
// 因页面而异，不能域级一刀切"（本文件 A16 注释、docs/分类prompt-v0.md §3.2 都明确写过这个
// 判断，这里只是把它变成一份可以在别处复用的具体名单，不是新决定）。真机复现过的具体后果：
// 答 DRIFT+FALSE_POSITIVE（"This counts as work"）时如果只把域名写进 sessionWhitelist，
// youtube.com 上纠正了一个视频之后，同一会话内这整个域名下所有视频（包括纯娱乐的）都会被
// 短路判 RELEVANT——跟这批域名"必须按页面判断"的既有设计原则直接冲突。这批域名答
// FALSE_POSITIVE 时改成按具体页面（pageKey）白名单，不再是按域名；其余域名维持契约v4
// 场景4"查资料后白名单"的原有域级行为不变。
export const MIXED_CONTENT_DOMAINS = [...VIDEO_DOMAINS, ...SOCIAL_DOMAINS, ...AI_CHAT_DOMAINS];

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some((d) => domainMatches(domain, d));
}

// 短视频流形态硬判（A16，契约v4 §1 信号1 短路优先级第3档）：不能靠域名一刀切
// （facebook.com 上既有 Reels 也有正经的社群/活动页），只硬判"这条 URL 本身就长成
// 短视频信息流"的那部分形态——命中 contentKind='short_feed' 后 resolveContextRelevance()
// 会直接短路 IRRELEVANT，不用等 LLM 往返。youtube/bilibili 的 /shorts/ 已在 A5 做过；
// 这里补 facebook.com 的 /reel/、/reels/ 路径（Meta 官方 Reels URL 形态）。
function isShortFeedPath(domain: string, url: string): boolean {
  if (matchesDomain(domain, VIDEO_DOMAINS)) return url.includes('/shorts/');
  if (domainMatches(domain, 'facebook.com')) return /\/reels?\//.test(url);
  return false;
}

export function guessContentKind(url: string, domain: string): SignalEvent['contentKind'] {
  if (domain === 'arxiv.org' || url.endsWith('.pdf')) return 'pdf';
  if (matchesDomain(domain, CODE_DOMAINS)) return 'code';
  if (matchesDomain(domain, DOCS_DOMAINS)) return 'docs';
  if (matchesDomain(domain, AI_CHAT_DOMAINS)) return 'ai_chat';
  if (matchesDomain(domain, MUSIC_DOMAINS)) return 'music';
  if (isShortFeedPath(domain, url)) return 'short_feed';
  if (matchesDomain(domain, VIDEO_DOMAINS)) return 'video';
  if (matchesDomain(domain, SOCIAL_DOMAINS)) return 'social_feed';
  if (matchesDomain(domain, ARTICLE_DOMAINS)) return 'article';
  return 'unknown';
}

// 契约v4 §5.1：SPA 内部跳转（onHistoryStateUpdated）没有可靠 transitionType，
// 调用方须传入 'pushState' 走保守分支，不信任该事件自带的 transitionType 字段。
const TRANSITION_TO_ENTRY_INTENT: Record<string, SignalEvent['entryIntent']> = {
  typed: 'direct_link',
  generated: 'search',
  keyword: 'search',
  keyword_generated: 'search',
  link: 'direct_link',
  reload: 'direct_link',
  auto_bookmark: 'direct_link',
};

export function mapEntryIntent(transitionType: string): SignalEvent['entryIntent'] {
  if (transitionType === 'pushState') return 'unknown';
  return TRANSITION_TO_ENTRY_INTENT[transitionType] ?? 'unknown';
}
