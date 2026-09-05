// Anchor · Content Script：交互纹理采集（A4）
import type { ChatSnippetMessage, InteractionMessage, RecheckMessage, RuntimeMessage } from '../messages';
import { findChatSiteExtractor } from './chat-sites';

console.log('[Anchor content script] injected on', location.href);

const readyMessage: RuntimeMessage = { type: 'CONTENT_SCRIPT_READY', timestamp: Date.now() };
chrome.runtime.sendMessage(readyMessage).catch(() => {});

function send(interactionType: InteractionMessage['interactionType']): void {
  const message: InteractionMessage = { type: 'INTERACTION', interactionType, timestamp: Date.now() };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// keydown/scroll 是高频噪音信号，节流；HIDDEN/MEDIA_* 是离散事件，不节流
const NOISY_THROTTLE_MS = 2000;
let lastNoisySent = 0;
function sendThrottled(interactionType: InteractionMessage['interactionType']): void {
  const now = Date.now();
  if (now - lastNoisySent < NOISY_THROTTLE_MS) return;
  lastNoisySent = now;
  send(interactionType);
}

document.addEventListener('keydown', () => sendThrottled('ACTIVE_INPUT'), { passive: true });
document.addEventListener('scroll', () => sendThrottled('PASSIVE_SCROLL'), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) send('HIDDEN');
});

// §3 MV3平台预研：SPA 路由切换会替换 <video> 元素，MutationObserver 重新绑定新元素
const boundVideos = new WeakSet<HTMLVideoElement>();

function bindVideo(video: HTMLVideoElement): void {
  if (boundVideos.has(video)) return;
  boundVideos.add(video);
  video.addEventListener('play', () => send('MEDIA_PLAY'));
  video.addEventListener('pause', () => send('MEDIA_PAUSE'));
  video.addEventListener('seeked', () => send('MEDIA_SEEK'));
}

function bindAllVideos(): void {
  document.querySelectorAll('video').forEach((v) => bindVideo(v as HTMLVideoElement));
}

bindAllVideos();
const videoObserver = new MutationObserver(bindAllVideos);
videoObserver.observe(document.documentElement, { childList: true, subtree: true });

// 08-31：见上面 RecheckMessage 的注释——安静阅读/安静看视频都不产生新 SignalEvent，SW 侧
// DRIFT 判定只能干等下一次事件/心跳才有机会重新检查"持续证据是否已经攒够"，空档最长能撞到
// chrome.alarms 的 ≥1min 平台下限。这里按固定节奏发一个不落库、不改变判定输入的轻量 tick，
// 把"下一次评估机会"的等待上限从"心跳周期"压到 RECHECK_MS。只在页面可见时发——后台标签页
// 本来就不该占用评估资源（SW 侧 isTrackedTab 校验也只认当前活动 tab，多发也会被直接丢弃，
// 这里提前不发是省一次跨进程消息，不是靠它保证正确性）。
const RECHECK_MS = 8000;
setInterval(() => {
  if (document.hidden) return;
  const message: RecheckMessage = { type: 'RECHECK', timestamp: Date.now() };
  // 08-31 排查补：真机反馈 SW 侧完全看不到 RECHECK——最常见的原因是扩展重新加载后，已经
  // 打开的标签页还在跑旧版 content script，它的扩展上下文（extension context）已经失效，
  // chrome.runtime.sendMessage 会同步抛错（不是走 promise reject），try/catch 兜住并打到
  // *这个标签页自己的* devtools 控制台（不是 SW 的 inspect 窗口）——两边控制台是分开的，
  // 排查时要分别看。
  try {
    chrome.runtime.sendMessage(message).catch((err) => {
      console.warn('[Anchor content script] RECHECK send rejected', err);
    });
  } catch (err) {
    console.warn('[Anchor content script] RECHECK send threw (extension context likely invalidated — reload this page)', err);
  }
}, RECHECK_MS);

// 09-05：AI 对话类网站（起步只做 claude.ai，见 chat-sites.ts 顶部注释）标题不一定随每轮
// 对话更新，MutationObserver 盯着页面变化，抓最新一条用户消息、变了才发——不是每次 DOM
// 抖动都发，流式渲染 AI 回复时会连续触发大量 mutation，防抖 + 去重两道过滤缺一不可。
const chatExtractor = findChatSiteExtractor(location.hostname);
if (chatExtractor) {
  console.log('[Anchor content script] chat snippet extractor active for', location.hostname);
  let lastSentSnippet: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 排查补：选择器（chat-sites.ts）没经过真机验证，第一轮大概率抓不对——这条日志在*这个
  // 标签页自己的*控制台里（不是 SW 的 inspect 窗口），专门回答"选择器到底有没有抓到东西"
  // 这一个问题，不然选择器错了的话，从头到尾不会有任何一条日志、没法排查是选择器问题
  // 还是别的地方断了。
  function checkForNewSnippet(): void {
    const snippet = chatExtractor!.extractLatestUserMessage();
    if (!snippet) {
      console.log('[Anchor content script] chat snippet extractor found nothing this tick (selector may be wrong)');
      return;
    }
    if (snippet === lastSentSnippet) return;
    lastSentSnippet = snippet;
    console.log('[Anchor content script] extracted chat snippet:', snippet);
    const message: ChatSnippetMessage = { type: 'CHAT_SNIPPET', snippet, timestamp: Date.now() };
    try {
      chrome.runtime.sendMessage(message).catch((err) => {
        console.warn('[Anchor content script] CHAT_SNIPPET send rejected', err);
      });
    } catch (err) {
      console.warn('[Anchor content script] CHAT_SNIPPET send threw (extension context likely invalidated — reload this page)', err);
    }
  }

  const chatObserver = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForNewSnippet, 1500);
  });
  chatObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}
