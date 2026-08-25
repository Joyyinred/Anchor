// Anchor · A4 真实信号采集：chrome.tabs/idle/webNavigation → SignalEvent
// 契约v4 §5.1：当前仅支持单一锚点/单一活动 tab 的信号流（多窗口是阶段二已知限制）
import type { SessionContext, SignalEvent } from '../../engine/types';
import { guessContentKind, mapEntryIntent } from './heuristics';
import { getOrInitSessionContext } from './session';

interface LiveTabInfo {
  tabId: number;
  domain: string;
  url: string;
  title: string;
  entryIntent: SignalEvent['entryIntent'];
}

let currentTab: LiveTabInfo | null = null;
let currentInteractionType: SignalEvent['interactionType'] = 'ACTIVE_INPUT';
let systemIdle = false;

const IDLE_DETECTION_INTERVAL_SECONDS = 60;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isAnchorMatch(domain: string, url: string, anchor: SessionContext['anchor']): boolean {
  if (anchor.matchMode === 'exact') return domain === anchor.domain;
  return domain.endsWith(anchor.domain) || url.startsWith(anchor.url);
}

async function emitSignalEvent(reason: string): Promise<void> {
  if (!currentTab) return;
  const ctx = await getOrInitSessionContext();
  const event: SignalEvent = {
    timestamp: Date.now(),
    domain: currentTab.domain,
    url: currentTab.url,
    title: currentTab.title,
    contentKind: guessContentKind(currentTab.url, currentTab.domain),
    isAnchor: isAnchorMatch(currentTab.domain, currentTab.url, ctx.anchor),
    interactionType: currentInteractionType,
    entryIntent: currentTab.entryIntent,
    systemIdle,
  };
  console.log(`[Anchor SW] SignalEvent (${reason})`, event);
}

export function isTrackedTab(tabId: number): boolean {
  return currentTab?.tabId === tabId;
}

// 契约v4 §3.1：SW 被 MV3 回收后 currentTab 这个内存变量会归零；如果用户正安安静静待在同一个
// tab 里工作（没有触发 tabs.onActivated/onUpdated/webNavigation 事件），回收后就再也没有事件能
// 重新填上 currentTab，信号采集会一直哑火。心跳 alarm 和"被消息唤醒"这两个入口都要调用本函数，
// 主动查一次当前激活 tab 来补回状态，而不是干等一个可能永远不会来的 tab 切换事件。
export async function ensureCurrentTab(): Promise<void> {
  if (currentTab) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;
  currentTab = {
    tabId: tab.id,
    domain: domainOf(tab.url),
    url: tab.url,
    title: tab.title ?? '',
    entryIntent: 'unknown',
  };
  currentInteractionType = 'ACTIVE_INPUT';
  void emitSignalEvent('sw-wake-requery');
}

export function handleInteractionMessage(interactionType: SignalEvent['interactionType']): void {
  currentInteractionType = interactionType;
  void emitSignalEvent('content-interaction');
}

export function registerSignalListeners(): void {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    currentTab = {
      tabId,
      domain: domainOf(tab.url),
      url: tab.url,
      title: tab.title ?? '',
      entryIntent: 'unknown',
    };
    currentInteractionType = 'ACTIVE_INPUT';
    void emitSignalEvent('tab-activated');
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!currentTab || currentTab.tabId !== tabId) return;
    if (changeInfo.url) {
      currentTab.url = changeInfo.url;
      currentTab.domain = domainOf(changeInfo.url);
    }
    if (changeInfo.title) currentTab.title = changeInfo.title;
    if (changeInfo.url || changeInfo.title) void emitSignalEvent('tab-updated');
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || !currentTab || currentTab.tabId !== details.tabId) return;
    currentTab.entryIntent = mapEntryIntent(details.transitionType);
    void emitSignalEvent('nav-committed');
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0 || !currentTab || currentTab.tabId !== details.tabId) return;
    currentTab.url = details.url;
    currentTab.domain = domainOf(details.url);
    // 契约v4 §5.1：忽略该事件自带的 transitionType（对 SPA 跳转不可靠），强制走保守分支
    currentTab.entryIntent = mapEntryIntent('pushState');
    void emitSignalEvent('nav-history-state');
  });

  chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);
  chrome.idle.onStateChanged.addListener((state) => {
    systemIdle = state !== 'active';
    if (systemIdle) currentInteractionType = 'IDLE';
    void emitSignalEvent('idle-state-changed');
  });
}
