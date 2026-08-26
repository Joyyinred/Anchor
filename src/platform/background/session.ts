// Anchor · 今天范围内的默认 SessionContext（A13 才会接真正的起步教练产出）
// 契约v4"无起步教练默认策略"：当前活动 tab 设为锚点、CREATOR 档、graceUntil = now + 2min
import type { SessionContext } from '../../engine/types';
import { PROFILE_PRESETS } from '../../engine/types';
import { domainOf } from './domain';

const SESSION_KEY = 'anchor_default_session';
const DEFAULT_GRACE_MS = 2 * 60_000;

export async function getOrInitSessionContext(): Promise<SessionContext> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const existing = stored[SESSION_KEY] as SessionContext | undefined;
  if (existing) return existing;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url ?? '';
  const preset = PROFILE_PRESETS.CREATOR;

  const ctx: SessionContext = {
    sessionId: 'default',
    taskDeclaration: '',
    profile: { archetype: 'CREATOR', policy: preset },
    anchor: { domain: domainOf(url), url, matchMode: preset.matchMode },
    sessionWhitelist: [],
    graceUntil: Date.now() + DEFAULT_GRACE_MS,
  };
  await chrome.storage.local.set({ [SESSION_KEY]: ctx });
  return ctx;
}
