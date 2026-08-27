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
import type { FeatureFrame, DetectionResult } from '../../engine/types';
import { buildCheckInMessage } from '../../engine/wording';
import { PANEL_STATE_KEY, type PanelState } from '../panel-state';

function toPanelState(
  frame: Pick<FeatureFrame, 'lastAnchorSnapshot' | 'currentTitle'>,
  result: DetectionResult,
  now: number
): PanelState {
  if (result.action === 'CHECK_IN_DRIFT') {
    return { state: 'checkin', channel: 'DRIFT', message: buildCheckInMessage('DRIFT', frame, now) };
  }
  if (result.action === 'CHECK_IN_STUCK') {
    return { state: 'checkin', channel: 'STUCK', message: buildCheckInMessage('STUCK', frame, now) };
  }
  return { state: 'companion' };
}

export async function pushPanelState(frame: FeatureFrame, result: DetectionResult, now: number): Promise<void> {
  const panelState = toPanelState(frame, result, now);
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
