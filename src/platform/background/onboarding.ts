// Anchor · 起步教练 UI 的 SW 侧逻辑（补上 B6 一直缺的那块：runStarterCoach()/
// groqStarterCoachCall 写好了，但从没有任何 UI/消息通道真正调用过它）。
//
// 结果推回 ONBOARDING_STATE_KEY，side panel 用 chrome.storage.onChanged 订阅——
// 跟 panel.ts 推 PanelState 是同一个模式，不用一次性 sendMessage（面板没打开时消息会丢，
// storage 里的值不会，下次打开读一次当前值就有）。
import { runStarterCoach } from '../../engine/coach';
import { DEFAULT_TASK_DECLARATION, type SessionContext } from '../../engine/types';
import { groqStarterCoachCall } from './starter-coach';
import { saveSessionContext } from './session';
import { ONBOARDING_STATE_KEY, type OnboardingState } from '../onboarding-state';

async function pushOnboardingState(state: OnboardingState): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_STATE_KEY]: state });
}

/**
 * side panel 挂载时调用一次：现在到底该显示起步输入框还是直接显示桌宠，由当前持久化的
 * SessionContext.taskDeclaration 是不是还是那句默认占位文案决定——不额外维护一个"onboarding
 * 有没有做过"的独立标记，省得这两处状态哪天不同步。
 */
export async function pushOnboardingStatus(ctx: SessionContext): Promise<void> {
  const status: OnboardingState =
    ctx.taskDeclaration === DEFAULT_TASK_DECLARATION ? { status: 'PENDING' } : { status: 'DONE' };
  await pushOnboardingState(status);
}

/**
 * 用户在起步输入框里提交了这一轮内容（第一轮是任务声明本身，追问后的后续轮次是回答）。
 * roundsUsed 由 side panel 原样带回上一次响应里的值（第一次提交传 0）。
 */
export async function handleOnboardingSubmit(text: string, roundsUsed: number, now: number): Promise<void> {
  const result = await runStarterCoach(text, roundsUsed, groqStarterCoachCall, now);

  if (result.status === 'NEEDS_FOLLOWUP') {
    await pushOnboardingState({ status: 'NEEDS_FOLLOWUP', prompt: result.prompt, roundsUsed: result.roundsUsed });
    return;
  }

  // READY：先把这次真实产出的 SessionContext 存回 getOrInitSessionContext() 读的那个 key，
  // 再推 UI 状态——两步顺序不能反，不然 UI 已经显示"完成"了，但下一次心跳/事件读到的
  // ctx 还是旧的默认占位值。
  await saveSessionContext(result.sessionContext);
  await pushOnboardingState({ status: 'READY', firstAction: result.firstAction });
}