// Anchor · Content Script：交互纹理采集（A4）
import type { InteractionMessage, RuntimeMessage } from '../messages';

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
