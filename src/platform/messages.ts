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

// 起步教练（B6）：side panel 挂载时问一次"现在该显示起步输入框还是直接显示桌宠"——
// 不能只信任面板自己缓存的旧值，SW 可能在这次打开之间已经完成过一次 onboarding。
export interface OnboardingStatusRequestMessage {
  type: 'ONBOARDING_STATUS_REQUEST';
  timestamp: number;
}

// 起步教练：用户在输入框里提交了这一轮内容（第一轮是任务声明本身，追问后的后续轮次
// 是对追问的回答）。roundsUsed 由 side panel 原样带回上一次响应里的 roundsUsed。
export interface OnboardingSubmitMessage {
  type: 'ONBOARDING_SUBMIT';
  text: string;
  roundsUsed: number;
  timestamp: number;
}

export type RuntimeMessage = ContentScriptReadyMessage | InteractionMessage | CheckInAnswerMessage | OnboardingStatusRequestMessage | OnboardingSubmitMessage;
