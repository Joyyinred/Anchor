// Anchor · content script <-> service worker 传输层消息类型
// 这是消息传输层，不是引擎契约——不放进 src/engine/types.ts
import type { SignalEvent } from '../engine/types';

export interface ContentScriptReadyMessage {
  type: 'CONTENT_SCRIPT_READY';
  timestamp: number;
}

export interface InteractionMessage {
  type: 'INTERACTION';
  interactionType: Extract<
    SignalEvent['interactionType'],
    'ACTIVE_INPUT' | 'PASSIVE_SCROLL' | 'HIDDEN' | 'MEDIA_PLAY' | 'MEDIA_PAUSE' | 'MEDIA_SEEK'
  >;
  timestamp: number;
}

export type RuntimeMessage = ContentScriptReadyMessage | InteractionMessage;
