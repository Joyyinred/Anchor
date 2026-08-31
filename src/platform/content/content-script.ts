// Anchor · Content Script：交互纹理采集（A4）
import type { InteractionMessage, RecheckMessage, RuntimeMessage } from '../messages';

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
  chrome.runtime.sendMessage(message).catch(() => {});
}, RECHECK_MS);
