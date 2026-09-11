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
// 09-05：用户刚在 AI 对话页面里输入的文字（目前仅 claude.ai，见 chat-sites.ts）。
// ★ 存的时候连同它所属的 url 一起记——currentTab 被重新赋值的地方有好几处（onActivated/
// onFocusChanged/onUpdated/onHistoryStateUpdated/ensureCurrentTab），挨个记得清空这个变量
// 太容易漏一处（漏一处就是旧对话的文字污染了下一个完全无关页面的分类）。改成在读取的那一刻
// （emitSignalEvent）比对 url 是否还对得上，对不上就当没有——结构上就不可能读到过期数据，
// 不用依赖"改 currentTab 的每个地方都记得手动清"这种容易遗漏的约定。
let currentContentSnippet: { url: string; snippet: string } | undefined;
// onActivated 的监听器是异步的（await chrome.tabs.get），快速连续切 tab 时后触发的请求可能反而
// 先 resolve——用一个单调递增的序号在 await 前后打卡，await 完了发现自己不是"最新一次"就放弃提交，
// 避免过期请求的结果覆盖掉更新的 currentTab。
let activationSeq = 0;

const IDLE_DETECTION_INTERVAL_SECONDS = 60;

// A12：真实数据噪音处理。两类噪音源，两种不同的处理方式：
// ①「tab 快切」——Alt+Tab 连按/双屏工作时 onActivated/onFocusChanged/onUpdated 会在几十到
//   几百毫秒内连续触发多次，每次都跑一遍完整的 computeFeatureFrame+evaluateFrame+两次
//   chrome.storage.local 写入，纯属浪费。debounce 只延迟"要不要发信号"这个决定本身——
//   currentTab 的赋值仍然是同步的，debounce 期间用户再切一次会看到最新的 currentTab，
//   只有停留超过 TAB_SWITCH_DEBOUNCE_MS 才会真正产出一条 SignalEvent。300ms 选得足够短：
//   人不可能在这么短时间内真正"看"一眼某个标签页再决定继续切，jumpPattern 关心的是秒级的
//   往返跳转模式，不会因为吞掉亚秒级抖动而丢失有意义的证据。
// ②「idle 抖动」——chrome.idle 用固定检测周期，理论上不该重复报同一个状态，但没有文档保证
//   绝不会；防御性地在真正状态变化时才发信号，避免同状态重复触发一遍完整的评估链路。
const TAB_SWITCH_DEBOUNCE_MS = 300;
let tabSwitchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function emitSignalEventDebounced(reason: string): void {
  if (tabSwitchDebounceTimer) clearTimeout(tabSwitchDebounceTimer);
  tabSwitchDebounceTimer = setTimeout(() => {
    tabSwitchDebounceTimer = null;
    void emitSignalEvent(reason);
  }, TAB_SWITCH_DEBOUNCE_MS);
}

// 'prefix' 模式要求"同域或其子域"，不能用裸 endsWith（会把 notexample.com 误判成命中 example.com）——
// 复用引擎里同一条边界判断逻辑（perceiver.ts 的 domainMatches），别再自己写一份不带 `.` 边界的版本。
// 导出给 pull-back.ts 复用（用户点"拉我回去"时要找出哪个 tab 是锚点）——
// 锚点匹配全项目只该有这一份，别再写第四遍（perceiver 的 domainMatches 已经被
// 这里、heuristics.ts 收敛过一次了，见 08-26 code review ④）。
export function isAnchorMatch(domain: string, anchor: SessionContext['anchor']): boolean {
  if (anchor.matchMode === 'exact') return domain === anchor.domain;
  return domainMatches(domain, anchor.domain);
}

// A7：真实事件流不再只打日志——喂进感知半（computeFeatureFrame）产出 FeatureFrame，
// 这条路径替换的是 mock events.json 那条测试专用路径
//
// ★ A17（阶段二·信号优雅降级）：这是全项目唯一一条"感知 → 决策 → 面板"的主干路径，
//   所有信号来源（tab 切换/导航/交互/idle/RECHECK/心跳）最终都会走到这一个函数。
//   之前这里没有任何 try/catch——链路上任何一步意外失败（storage 读写异常、
//   recordEventAndEvaluate 内部的分类/持久化出问题、或者任何没预料到的边界情况）都会
//   变成一次静默的 unhandled rejection：不会让 SW 崩掉（下一次事件来了照样能正常处理），
//   但那一次信号会凭空消失，且没有任何痕迹——比"崩溃"更难排查，因为看起来像什么都没发生。
//   包一层 try/catch，在这一个位置就能兜住所有上游信号源的失败，不用在每个监听器里各自处理。
async function emitSignalEvent(reason: string): Promise<void> {
  if (!currentTab) return;
  try {
    const ctx = await getOrInitSessionContext();
    const event: SignalEvent = {
      timestamp: Date.now(),
      domain: currentTab.domain,
      url: currentTab.url,
      title: currentTab.title,
      tabId: currentTab.tabId,
      contentKind: guessContentKind(currentTab.url, currentTab.domain),
      isAnchor: isAnchorMatch(currentTab.domain, ctx.anchor),
      interactionType: currentInteractionType,
      entryIntent: currentTab.entryIntent,
      systemIdle,
      // 只在这条快照还属于当前这个 url 时才带上——见上面 currentContentSnippet 的注释。
      contentSnippet: currentContentSnippet?.url === currentTab.url ? currentContentSnippet.snippet : undefined,
    };
    const isDemoMode = await getDemoMode();
    const { frame, result, petState } = await recordEventAndEvaluate(event, ctx, isDemoMode);
    await pushPanelState(frame, result, petState, event.timestamp);
    console.log(`[Anchor SW] SignalEvent (${reason})`, event);
    console.log('[Anchor SW] FeatureFrame', frame);
    console.log('[Anchor SW] DetectionResult', result);
    // 08-31 排查补：graceUntil（起步后 2 分钟宽限期，detector.ts isDrifting()/isStuck() 排在
    // 黑名单快速通道之前的公共闸门）之前完全没有日志可查，只能靠时间戳反推，排查效率很低——
    // 直接打出来，下次一眼能看出是不是撞在这道闸上。
    console.log('[Anchor SW] graceUntil', ctx.graceUntil, 'stillInGrace', event.timestamp < ctx.graceUntil);
  } catch (err) {
    console.error(`[Anchor SW] emitSignalEvent(${reason}) failed — this signal is dropped, next one should recover`, err);
  }
}

export function isTrackedTab(tabId: number): boolean {
  return currentTab?.tabId === tabId;
}

// 08-31 排查用：RECHECK 消息被 isTrackedTab 挡掉时，光打"没过校验"看不出是"没有任何 tab
// 被追踪"还是"追踪的是另一个 tab"——暴露这个只读值方便日志里对比两个 tabId。
export function getTrackedTabId(): number | null {
  return currentTab?.tabId ?? null;
}

// 契约v4 §3.1：SW 被 MV3 回收后 currentTab 这个内存变量会归零；如果用户正安安静静待在同一个
// tab 里工作（没有触发 tabs.onActivated/onUpdated/webNavigation 事件），回收后就再也没有事件能
// 重新填上 currentTab，信号采集会一直哑火。心跳 alarm 和"被消息唤醒"这两个入口都要调用本函数，
// 主动查一次当前激活 tab 来补回状态，而不是干等一个可能永远不会来的 tab 切换事件。
export async function ensureCurrentTab(): Promise<void> {
  if (currentTab) return;
  // A17：chrome.tabs.query 理论上很少失败，但心跳/RECHECK/onInstalled 好几条路径都会调这个
  // 函数，SW 生命周期边界（刚被唤醒/即将被回收）上的怪异状态不是完全不可能撞到——查不到就
  // 当这次没查到处理，下一次心跳/事件会再试一次，不需要在这里做任何特殊恢复。
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.error('[Anchor SW] ensureCurrentTab: chrome.tabs.query failed', err);
    return;
  }
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

// 09-05：content script 发来的最新一条用户消息（见 chat-sites.ts）。跟 handleInteractionMessage
// 同一个模式，但不改 currentInteractionType——这不是一次交互类型的变化，是页面内容本身的变化。
export function handleChatSnippetMessage(snippet: string): void {
  if (!currentTab) return;
  currentContentSnippet = { url: currentTab.url, snippet };
  void emitSignalEvent('chat-snippet');
}

export function registerSignalListeners(): void {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const seq = ++activationSeq;
    // A17：真实存在的竞态，不是理论风险——用户手速快的话，这个 tab 可能在 onActivated 触发
    // 之后、这次查询真正 resolve 之前就被关掉了，chrome.tabs.get 会 reject（"No tab with
    // id: N"）。这不是需要恢复的错误——tab 都不在了，本来就没有 currentTab 可切，跟其它
    // "查不到就跳过，等下一次事件"的分支是同一个处理方式。
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      console.warn('[Anchor SW] onActivated: chrome.tabs.get failed (tab likely closed mid-query)', tabId, err);
      return;
    }
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
    emitSignalEventDebounced('tab-activated');
  });

  // tabs.onActivated 只在同一窗口内切标签时触发——跨窗口切换（真实用户双屏工作很常见）完全静默。
  // 焦点换到别的 Chrome 窗口时，查一次那个窗口里当前激活的 tab，按同一套逻辑处理；
  // 复用 activationSeq，跟 onActivated 共享同一个"只认最新一次"的过期保护。
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return; // 焦点离开 Chrome 本身（切到别的应用），不是标签切换
    const seq = ++activationSeq;
    // A17：跟上面 onActivated 同一类竞态——窗口可能在查询期间被关掉。
    let tab: chrome.tabs.Tab | undefined;
    try {
      [tab] = await chrome.tabs.query({ active: true, windowId });
    } catch (err) {
      console.warn('[Anchor SW] onFocusChanged: chrome.tabs.query failed (window likely closed mid-query)', windowId, err);
      return;
    }
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
    emitSignalEventDebounced('window-focus-changed');
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!currentTab || currentTab.tabId !== tabId) return;
    if (changeInfo.url) {
      currentTab.url = changeInfo.url;
      currentTab.domain = domainOf(changeInfo.url);
    }
    if (changeInfo.title) currentTab.title = changeInfo.title;
    // 单次导航期间 Chrome 通常会分好几次触发这个事件（url 先到、title 随后、status 变化再一次）——
    // debounce 掉，只在字段都稳定下来之后发一条信号，而不是每一小步都跑一遍完整评估链路。
    if (changeInfo.url || changeInfo.title) emitSignalEventDebounced('tab-updated');
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
    const nextIdle = state !== 'active';
    if (nextIdle === systemIdle) return; // 真实状态没变，防御性去重，不重复跑一遍评估链路
    systemIdle = nextIdle;
    if (systemIdle) currentInteractionType = 'IDLE';
    void emitSignalEvent('idle-state-changed');
  });
}
