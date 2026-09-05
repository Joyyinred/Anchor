// Anchor · 起步教练 UI 状态（background <-> side panel 之间共享，chrome.storage.local）。
// 跟 panel-state.ts 同一个模式：这是传输层形状，不是引擎契约，不放进 src/engine/types.ts。
export const ONBOARDING_STATE_KEY = 'anchor_onboarding_state';

export type OnboardingState =
  // 还没声明过任务（SessionContext.taskDeclaration 还是 DEFAULT_TASK_DECLARATION 那句占位文案）
  // ——该显示起步输入框。
  | { status: 'PENDING' }
  // 契约v4 §5.5：taskDeclaration 不够 8 字符，追问，最多 2 轮。
  // priorDeclaration：09-05 真机反馈修复——追问的回答只是"补充"，不是"替换"。用户答完
  // 追问后原样带回来（跟 roundsUsed 同一个模式），下一次提交时 SW 侧把这轮回答拼接在
  // 它后面，而不是让回答单独顶替掉最初那句声明（真机复现：声明"study neural network"，
  // 追问后答"beginner guide"，如果不拼接，最终 taskDeclaration 会变成单独一句
  // "beginner guide"，"neural network"这个关键词就丢了——后续整场分类都拿不到它）。
  | { status: 'NEEDS_FOLLOWUP'; prompt: string; roundsUsed: number; priorDeclaration: string }
  // 刚完成这一次 runStarterCoach()，短暂展示第一步物理动作。
  | { status: 'READY'; firstAction: string }
  // 早就完成过（SessionContext.taskDeclaration 已经是真实声明），直接显示桌宠。
  | { status: 'DONE' };