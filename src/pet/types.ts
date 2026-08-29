// Anchor · 桌宠组件（B4）的展示层类型
// 这里不 import 引擎（src/engine），保持组件是纯展示层——state 由调用方（未来 B8/B9 状态机）算好了传进来。
// 字段名故意和引擎的 DetectionResult / CheckInFeedback 对齐，方便以后接线时一眼看出映射关系：
//   DetectionResult.action === 'DO_NOTHING'      → PetState 'companion' 或 'observing'（哪个由状态机决定，组件不关心）
//   DetectionResult.action === 'CHECK_IN_DRIFT'  → PetState 'checkin'，message 来自 B7 措辞层
//   DetectionResult.action === 'CHECK_IN_STUCK'  → PetState 'checkin'，message 来自 B7 措辞层
//   用户在气泡里点按钮                            → CheckInAnswer，就是 CheckInFeedback.answer 那三个值

export type PetState = 'companion' | 'observing' | 'checkin';

export type CheckInAnswer = 'FOCUSED' | 'DRIFTED' | 'FALSE_POSITIVE';

// DRIFT/STUCK 两条通道触发 check-in 时都收敛成同一个 PetState 'checkin'（组件不靠通道区分视觉），
// 但调用方拼 CheckInFeedback = {channel, answer} 喂给 applyCheckInFeedback 时需要知道是哪条通道——
// 跟引擎 CheckInChannel 是同一个概念，这里独立声明一份（组件保持不 import 引擎），
// src/pet/types.contract-check.ts 有一个编译期哨兵防止两边字面量集合悄悄漂移。
export type CheckInChannel = 'DRIFT' | 'STUCK';

export interface CuteAnchorPetProps {
  /** 当前该演哪个状态；三态之外没有第四态。 */
  state: PetState;
  /**
   * check-in 气泡里的文案。state !== 'checkin' 时不生效。
   * 不传时组件会用一句占位文案兜底，方便在真正接上 B7 措辞层之前也能预览。
   */
  message?: string;
  /**
   * 陪伴态右上角的专注时长小标签（分钟数）。是配角数据，不传就不显示——
   * 对应分工v2 §4 B15"角落专注时长（配角，别喧宾夺主）"。
   */
  focusedMinutes?: number;
  /**
   * state === 'checkin' 时，这次 check-in 是哪条通道触发的（DRIFT 走神 / STUCK 卡住）。
   * PetState 本身不区分通道，靠这个字段把信息带进来，再由 onAnswer 原样带出去——
   * 调用方才拼得出完整的 CheckInFeedback。state !== 'checkin' 时不生效。
   */
  channel?: CheckInChannel;
  /**
   * 用户点了气泡里的回答按钮。调用方通常直接把 {channel, answer} 转给 B2 的
   * applyCheckInFeedback——channel 就是原样透传回去的 props.channel。
   */
  onAnswer?: (answer: CheckInAnswer, channel?: CheckInChannel) => void;
  /**
   * 休息模式（契约v4 §3.8）开着。★ 这不是第四个 PetState——休息期间 state 仍然是
   * 'companion'，这只是一个正交的"此刻安静着"标记，只影响锚徽章样式和下方说明文案。
   * 组件本身不判断休息该不该结束，那是引擎（startRest/restReminderDue）和调用方的事。
   */
  isResting?: boolean;
  /**
   * 用户点了"休息"入口。调用方负责发 REST_START 消息给 SW（那边调 startRest()）。
   * 08-29 修过一个 bug：这个按钮和下面 onRestEnd/onSessionEnd 原来分别焊死在
   * !isResting 和"提醒节拍到了"（当时还有个 isRestReminder prop）上——契约v4 §3.8
   * 明确写着"可随时'继续专注'或'结束专注'"，休息中途想提前回来却要等到 15min 首次
   * 提醒才有按钮可点，是真 bug 不是设计。现在 onRestStart/onRestEnd/onSessionEnd
   * 只按 isResting 二选一切换，不再依赖是否到了提醒节拍——提醒文案（"该继续了吗"那句）
   * 仍然只在 restReminderDue() 为 true 时才通过 message 出现，但按钮本身随时都在。
   */
  onRestStart?: () => void;
  /** 用户点了"继续专注"（随时，不限于提醒弹出时）。调用方发 REST_END 消息（那边清空 restUntil）。 */
  onRestEnd?: () => void;
  /**
   * 用户点了"结束专注"——契约v4 §3.8 里跟"继续专注"并列的第二个选项，语义是
   * "今天这场专注到此为止"。随时可点：companion/observing/resting 时在锚点下方常驻，
   * checkin 时挪进气泡内部（弱化视觉，不跟三个判定按钮抢注意力）——任何状态都有出口。
   */
  onSessionEnd?: () => void;
  /** 透传到最外层容器，方便调用方做定位/尺寸调整。 */
  className?: string;
}