// Anchor · A4 简单启发式：contentKind / entryIntent 映射
// 真实语义分类（contextRelevance）是 A8 的事，这里只产出 SignalEvent 字段本身
import type { SignalEvent } from '../../engine/types';
import { domainMatches } from '../../engine/perceiver';

const CODE_DOMAINS = ['github.com', 'vscode.dev', 'gitlab.com', 'stackoverflow.com'];
const DOCS_DOMAINS = ['react.dev', 'docs.google.com', 'developer.mozilla.org'];
const VIDEO_DOMAINS = ['youtube.com', 'bilibili.com'];
const AI_CHAT_DOMAINS = ['claude.ai', 'chat.openai.com'];
const MUSIC_DOMAINS = ['open.spotify.com', 'music.163.com'];

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some((d) => domainMatches(domain, d));
}

export function guessContentKind(url: string, domain: string): SignalEvent['contentKind'] {
  if (domain === 'arxiv.org' || url.endsWith('.pdf')) return 'pdf';
  if (matchesDomain(domain, CODE_DOMAINS)) return 'code';
  if (matchesDomain(domain, DOCS_DOMAINS)) return 'docs';
  if (matchesDomain(domain, AI_CHAT_DOMAINS)) return 'ai_chat';
  if (matchesDomain(domain, MUSIC_DOMAINS)) return 'music';
  if (matchesDomain(domain, VIDEO_DOMAINS)) {
    return url.includes('/shorts/') ? 'short_feed' : 'video';
  }
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
