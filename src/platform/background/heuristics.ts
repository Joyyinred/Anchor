// Anchor · A4 简单启发式：contentKind / entryIntent 映射
// 真实语义分类（contextRelevance）是 A8 的事，这里只产出 SignalEvent 字段本身
import type { SignalEvent } from '../../engine/types';
import { domainMatches } from '../../engine/perceiver';

const CODE_DOMAINS = ['github.com', 'vscode.dev', 'gitlab.com', 'stackoverflow.com'];
const DOCS_DOMAINS = ['react.dev', 'docs.google.com', 'developer.mozilla.org'];
const VIDEO_DOMAINS = ['youtube.com', 'bilibili.com'];
const AI_CHAT_DOMAINS = ['claude.ai', 'chat.openai.com'];
const MUSIC_DOMAINS = ['open.spotify.com', 'music.163.com'];
// A16：docs/分类prompt-v0.md §3.2 明确 x.com/twitter.com/facebook.com/pinterest.com/reddit.com
// 这类"学习+娱乐混合站"不能域级拉黑（内容形态因页面而异），只能走 LLM 内容级分类兜底——
// 但仍然值得把 contentKind 标成 social_feed（而不是掉进 unknown），信息更准确，
// 且这条 tag 是后续 A17/A18 及 B 侧可能用得上的元数据。
const SOCIAL_DOMAINS = ['reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'pinterest.com', 'threads.net'];
const ARTICLE_DOMAINS = ['wikipedia.org', 'medium.com', 'zhihu.com'];

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
