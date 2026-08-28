// Anchor · A11：把决策半算出的 DetectionResult 转成 side panel 能直接渲染的最小状态，
// 写进 chrome.storage.local，side panel 用 chrome.storage.onChanged 订阅更新
// （而不是一次性 chrome.runtime.sendMessage——side panel 没打开时消息会丢，
// storage 里的值不会，下次打开读一次当前值就有）。
//
// DO_NOTHING 时到底该显示 'companion' 还是 'observing' 是 B9（状态机）的职责范围
// （分工v2 §3："状态机——陪伴/观察/check-in 三态"），B9 还没开工，这里先给一个最小占位：
// DO_NOTHING 一律映射成 'companion'。DetectionResult 契约本身不带"证据接近阈值"这个信号，
// 真要区分"平静陪伴"和"有点飘的迹象在多看两眼"，需要 B9 建好状态机之后另外决定信号来源——
// 到时候只用换这个函数，side panel/cat.tsx 不用改一行。
import type { FeatureFrame, DetectionResult, CheckInFeedback } from '../../engine/types';
import { buildCheckInMessage, buildMicroRestartMessage } from '../../engine/wording';
import { PANEL_STATE_KEY, type PanelState } from '../panel-state';
import type { PetState } from '../../pet/types';

function toPanelState(
  frame: Pick<FeatureFrame, 'lastAnchorSnapshot' | 'currentTitle'>,
  result: DetectionResult,
  petState: PetState,
  now: number
): PanelState {
  if (result.action === 'CHECK_IN_DRIFT') {
    return { state: 'checkin', channel: 'DRIFT', message: buildCheckInMessage('DRIFT', frame, now) };
  }
  if (result.action === 'CHECK_IN_STUCK') {
    return { state: 'checkin', channel: 'STUCK', message: buildCheckInMessage('STUCK', frame, now) };
  }
  // DO_NOTHING：companion 还是 observing 交给状态机的结论，不在这里二次判断。
  return { state: petState };
}

export async function pushPanelState(
  frame: FeatureFrame,
  result: DetectionResult,
  petState: PetState,
  now: number
): Promise<void> {
  const panelState = toPanelState(frame, result, petState, now);
  await chrome.storage.local.set({ [PANEL_STATE_KEY]: panelState });
}

// 用户点了 check-in 气泡里的按钮之后立刻调用——check-in 已经处理完了，不能让 side panel
// 继续停在 state='checkin' 干等下一次心跳/事件才刷新（那样按钮在 UI 上还留着能点，
// 用户手快的话会把 applyCheckInFeedback 再触发一次）。真正的 companion/observing 区分
// 交给下一次 evaluate 循环去算，这里只需要立刻把 check-in 态摘掉。
export async function pushCompanionState(): Promise<void> {
  const panelState: PanelState = { state: 'companion' };
  await chrome.storage.local.set({ [PANEL_STATE_KEY]: panelState });
}

// B7 的 buildMicroRestartMessage() 写好之后一直没人调用——check-in 答完直接摘成空白
// companion 态（见上面 pushCompanionState），用户答"飘了"/"在专注"没有任何反馈。这里
// 先说一句话，过 MICRO_RESTART_TOAST_MS 再摘回真正的空白 companion，两步都还是
// PetState==='companion'，没有引入第四态（cat.tsx 的"三态之外没有第四态"约束没破）。
const MICRO_RESTART_TOAST_MS = 2500;

export async function pushMicroRestartToast(feedback: CheckInFeedback): Promise<void> {
  const toast: PanelState = { state: 'companion', message: buildMicroRestartMessage(feedback.answer) };
  await chrome.storage.local.set({ [PANEL_STATE_KEY]: toast });
  // SW 可能在这 2.5s 内被回收——不是致命的（用户最多少看到这句反馈，不影响任何判定逻辑），
  // 比额外接一个 chrome.alarms 只为了这一句话的收尾要划算得多。
  setTimeout(() => {
    void pushCompanionState();
  }, MICRO_RESTART_TOAST_MS);
}
