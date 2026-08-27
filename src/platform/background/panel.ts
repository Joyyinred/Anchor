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
