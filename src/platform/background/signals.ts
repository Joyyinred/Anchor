// Anchor · A4 真实信号采集：chrome.tabs/idle/webNavigation → SignalEvent
// 契约v4 §5.1：当前仅支持单一锚点/单一活动 tab 的信号流（多窗口是阶段二已知限制）
import type { SessionContext, SignalEvent } from '../../engine/types';
import { domainMatches } from '../../engine/perceiver';
import { guessContentKind, mapEntryIntent } from './heuristics';
import { getOrInitSessionContext } from './session';
import { getDemoMode } from './state';
import { domainOf } from './domain';
import { recordEventAndEvaluate } from './frame-pipeline';
import { pushPanelState } from './panel';

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
// onActivated 的监听器是异步的（await chrome.tabs.get），快速连续切 tab 时后触发的请求可能反而
// 先 resolve——用一个单调递增的序号在 await 前后打卡，await 完了发现自己不是"最新一次"就放弃提交，
// 避免过期请求的结果覆盖掉更新的 currentTab。
let activationSeq = 0;

const IDLE_DETECTION_INTERVAL_SECONDS = 60;

// 'prefix' 模式要求"同域或其子域"，不能用裸 endsWith（会把 notexample.com 误判成命中 example.com）——
// 复用引擎里同一条边界判断逻辑（perceiver.ts 的 domainMatches），别再自己写一份不带 `.` 边界的版本。
function isAnchorMatch(domain: string, anchor: SessionContext['anchor']): boolean {
  if (anchor.matchMode === 'exact') return domain === anchor.domain;
  return domainMatches(domain, anchor.domain);
}

// A7：真实事件流不再只打日志——喂进感知半（computeFeatureFrame）产出 FeatureFrame，
// 这条路径替换的是 mock events.json 那条测试专用路径
async function emitSignalEvent(reason: string): Promise<void> {
  if (!currentTab) return;
  const ctx = await getOrInitSessionContext();
  const event: SignalEvent = {
    timestamp: Date.now(),
    domain: currentTab.domain,
    url: currentTab.url,
    title: currentTab.title,
    contentKind: guessContentKind(currentTab.url, currentTab.domain),
    isAnchor: isAnchorMatch(currentTab.domain, ctx.anchor),
    interactionType: currentInteractionType,
    entryIntent: currentTab.entryIntent,
    systemIdle,
  };
  const isDemoMode = await getDemoMode();
  const { frame, result, petState } = await recordEventAndEvaluate(event, ctx, isDemoMode);
  await pushPanelState(frame, result, petState, event.timestamp);
  console.log(`[Anchor SW] SignalEvent (${reason})`, event);
  console.log('[Anchor SW] FeatureFrame', frame);
  console.log('[Anchor SW] DetectionResult', result);
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
  // 等待查询期间，一次真正的 tabs.onActivated 可能已经把 currentTab 填上了，所以不要用这次
  // 可能已经过期的查询结果覆盖掉它（同一类 await-期间竞态，和 onActivated 里的问题是一回事）。
  if (currentTab) return;
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
    const seq = ++activationSeq;
    const tab = await chrome.tabs.get(tabId);
    if (seq !== activationSeq) return; // 已经被更新的一次 onActivated 超过，这次的结果作废
    // chrome://newtab/ 等内部页面刚打开时 tab.url 是空字符串（真实 URL 要等 onUpdated 才补上）。
    // 之前这里直接 return，tabId 没跟着切过去——onUpdated/onCommitted/onHistoryStateUpdated
    // 三个监听器全靠 currentTab.tabId 门禁，新标签页之后无论导航到哪都会被判成"不是当前 tab"
    // 丢弃，表现为切到新标签页再打开网站后 SW 完全检测不到，得先切到别的已有 tab 再切回来才恢复。
    // 修法：tabId 无论如何先切过去；url 为空时没有域名/标题可用，先不发信号，等 onUpdated 补上
    // 真实 url 后自然会走 emitSignalEvent。
    currentTab = {
      tabId,
      domain: domainOf(tab.url ?? ''),
      url: tab.url ?? '',
      title: tab.title ?? '',
      entryIntent: 'unknown',
    };
    currentInteractionType = 'ACTIVE_INPUT';
    if (!tab.url) return;
    void emitSignalEvent('tab-activated');
  });

  // tabs.onActivated 只在同一窗口内切标签时触发——跨窗口切换（真实用户双屏工作很常见）完全静默。
  // 焦点换到别的 Chrome 窗口时，查一次那个窗口里当前激活的 tab，按同一套逻辑处理；
  // 复用 activationSeq，跟 onActivated 共享同一个"只认最新一次"的过期保护。
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return; // 焦点离开 Chrome 本身（切到别的应用），不是标签切换
    const seq = ++activationSeq;
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (seq !== activationSeq) return;
    if (!tab?.id) return;
    if (currentTab?.tabId === tab.id) return; // 同一个 tab 只是窗口重新拿到焦点，不是真的切换
    currentTab = {
      tabId: tab.id,
      domain: domainOf(tab.url ?? ''),
      url: tab.url ?? '',
      title: tab.title ?? '',
      entryIntent: 'unknown',
    };
    currentInteractionType = 'ACTIVE_INPUT';
    if (!tab.url) return;
    void emitSignalEvent('window-focus-changed');
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
