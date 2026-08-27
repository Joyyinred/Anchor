// Anchor · content script/side panel <-> service worker 传输层消息类型
// 这是消息传输层，不是引擎契约——不放进 src/engine/types.ts
import type { SignalEvent } from '../engine/types';
import type { CheckInAnswer, CheckInChannel } from '../pet/types';

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

// side panel 里点了 check-in 气泡按钮之后发给 SW 的回答——channel/answer 复用
// src/pet/types.ts 已经声明的那份字面量（CuteAnchorPet.onAnswer 本来就是这个类型）。
export interface CheckInAnswerMessage {
  type: 'CHECK_IN_ANSWER';
  answer: CheckInAnswer;
  channel: CheckInChannel;
  timestamp: number;
}

export type RuntimeMessage = ContentScriptReadyMessage | InteractionMessage | CheckInAnswerMessage;
