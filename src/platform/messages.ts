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
  // DRIFT 通道触发时的 frame.currentDomain，side panel 从 PanelState.domain 原样带回来——
  // 答 FALSE_POSITIVE 时 SW 用它写回 SessionContext.sessionWhitelist（J6：sessionWhitelist
  // 一直只有读没有写的那个缺口）。STUCK 通道没有意义，可以不传。
  domain?: string;
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

// ── 休息模式（契约v4 §3.8）：B 侧 UI 发出，SW 侧接住后操作 BState ──
// 这三条是 B 定的 UI 契约，A 侧照 CHECK_IN_ANSWER 已有的模式在 background/index.ts 接即可。

// 用户点了桌宠下方的"Take a break"。SW 收到后调 detector.ts 的 startRest(state, now)
// —— restUntil = now + 20min，期间 isDrifting/isStuck 的公共闸口会让双通道全静默。
export interface RestStartMessage {
  type: 'REST_START';
  timestamp: number;
}

// 用户在休息提醒里点了"Back to it"（契约里的"继续专注"）。SW 收到后把 restUntil/restStartTs
// 清回初始值（-Infinity），双通道恢复工作。注意不能只清 restUntil：restStartTs 留着的话
// restReminderDue() 会继续按老的休息起点判定，提醒不会停。
export interface RestEndMessage {
  type: 'REST_END';
  timestamp: number;
}

// 用户在休息提醒里点了"Done for today"（契约里的"结束专注"）——语义是"今天这场专注到此为止"，
// 不是"再休息一会儿"。★ 下游行为还没定：完整的收尾反思是 B15（阶段二，还没开工），
// 阶段一最小可用的做法是清掉 SessionContext，让用户下次打开侧边栏时重新走一遍起步教练。
// 具体怎么接由 A/B 一起定，B 侧只保证这条消息会被正确发出来。
export interface SessionEndMessage {
  type: 'SESSION_END';
  timestamp: number;
}

// 用户在收尾反思视图上点了"Start something new"：清掉 summary，面板随即回到起步教练
// （SessionContext.taskDeclaration 在 SESSION_END 结算时已经打回默认值了）。
export interface SessionRestartMessage {
  type: 'SESSION_RESTART';
  timestamp: number;
}

export type RuntimeMessage =
  | ContentScriptReadyMessage
  | InteractionMessage
  | CheckInAnswerMessage
  | OnboardingStatusRequestMessage
  | OnboardingSubmitMessage
  | RestStartMessage
  | RestEndMessage
  | SessionEndMessage
  | SessionRestartMessage;
