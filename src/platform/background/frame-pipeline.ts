// Anchor · A7：把 signals.ts 产出的真实 SignalEvent 接进感知半（computeFeatureFrame），
// 替换 mock events.json 那条测试专用路径
import type { SignalEvent, SessionContext, FeatureFrame } from '../../engine/types';
import { computeFeatureFrame, type ClassificationCache } from '../../engine/perceiver';

const HISTORY_KEY_PREFIX = 'anchor_event_history_';
// computeFeatureFrame 的 anchorDetachedMs/jumpPattern 理论上要看完整历史，但实际不需要无限回看：
// 一旦「距上次锚点交互」超过阈值就已经判定为脱离，再往前找没有额外信息量。留 4 小时窗口/500 条
// 上限只是防止真实长会话下这个数组和它的持久化副本无限增长，不是契约要求的精确数字。
const MAX_HISTORY_EVENTS = 500;
const MAX_HISTORY_AGE_MS = 4 * 60 * 60 * 1000;

let eventHistory: SignalEvent[] = [];
let historyLoadedForSession: string | null = null;
// texture 信号冷启动时沿用上一帧的判定（见 perceiver.ts computeTexture）；这个变量只活在内存里，
// SW 被回收重启后会掉回默认值 'idle'——可接受的降级：事件历史本身是持久化的，
// 重启后第一帧只要窗口内有真实证据就会算出正确值，不依赖这个内存变量。
let previousTexture: FeatureFrame['texture'] = 'idle';
// A8（真实 LLM 分类）还没接入，这里先给 computeFeatureFrame 一个空缓存，未命中一律保守 UNKNOWN（红线1）。
const classificationCache: ClassificationCache = new Map();

function historyKey(sessionId: string): string {
  return `${HISTORY_KEY_PREFIX}${sessionId}`;
}

function trim(events: SignalEvent[], now: number): SignalEvent[] {
  const cutoff = now - MAX_HISTORY_AGE_MS;
  const withinAge = events.filter((e) => e.timestamp >= cutoff);
  return withinAge.length > MAX_HISTORY_EVENTS ? withinAge.slice(-MAX_HISTORY_EVENTS) : withinAge;
}

// SW 每次（重新）启动后 eventHistory 这个内存数组会归零；第一次用到它之前从 chrome.storage.local
// 补一次——跟 signals.ts 里 currentTab 用 ensureCurrentTab() 补状态是同一套"SW 回收后重新水合"思路。
async function ensureHistoryLoaded(sessionId: string): Promise<void> {
  if (historyLoadedForSession === sessionId) return;
  const key = historyKey(sessionId);
  const stored = await chrome.storage.local.get(key);
  eventHistory = (stored[key] as SignalEvent[] | undefined) ?? [];
  historyLoadedForSession = sessionId;
}

/**
 * 把一条真实信号事件计入历史（内存 + chrome.storage.local 持久化，应对 SW 回收），
 * 再用完整历史跑一次感知半，产出当前时刻的 FeatureFrame。
 */
export async function recordEventAndComputeFrame(
  event: SignalEvent,
  ctx: SessionContext,
  isDemoMode: boolean
): Promise<FeatureFrame> {
  await ensureHistoryLoaded(ctx.sessionId);
  eventHistory = trim([...eventHistory, event], event.timestamp);
  void chrome.storage.local.set({ [historyKey(ctx.sessionId)]: eventHistory });

  const frame = computeFeatureFrame(
    eventHistory,
    ctx,
    event.timestamp,
    classificationCache,
    previousTexture,
    isDemoMode
  );
  previousTexture = frame.texture;
  return frame;
}
