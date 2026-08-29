// Anchor · 休息模式（契约v4 §3.8）在 background <-> side panel 之间共享的状态形状。
// 跟 panel-state.ts / onboarding-state.ts 同一个模式：传输层，不是引擎契约，不进 src/engine/types.ts。
//
// 为什么不塞进 PanelState：休息是跟三态正交的一件事——休息期间 PetState 仍然是 'companion'
// （契约里桌宠只有三态，cat.tsx 顶部注释明确禁止第四态），只是"此刻安静着、并且可能在提醒"。
// 分开一个 key 还有个好处：SW 侧 rest 的读写跟 evaluate 循环推 PanelState 是两条独立路径，
// 不会互相覆盖（用户点"休息"那一刻，下一次心跳的 pushPanelState 不该把它冲掉）。
export const REST_STATE_KEY = 'anchor_rest_state';

export interface RestState {
  /** 休息模式是否开着。false 时下面两个字段都没有意义。 */
  isResting: boolean;
  /** 这次休息开始的时刻（BState.restStartTs 的镜像），用于算"已经休息了多久"。 */
  restStartTs?: number;
  /**
   * 此刻是否该弹一次"休息够了吗"的轻声提醒（detector.ts 的 restReminderDue() 判定为 true）。
   * 契约v4 §3.8：休息满 15 分钟首次提醒，之后每 5 分钟重复，直到用户回来。
   */
  isReminderDue?: boolean;
}

export const DEFAULT_REST_STATE: RestState = { isResting: false };