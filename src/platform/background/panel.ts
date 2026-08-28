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
  frame: Pick<FeatureFrame, 'lastAnchorSnapshot' | 'currentTitle' | 'currentDomain'>,
  result: DetectionResult,
  petState: PetState,
  now: number
): PanelState {
  if (result.action === 'CHECK_IN_DRIFT') {
    // domain 记的是"就是这个域名把我判成走神了"（触发那一刻的 frame.currentDomain）——
    // 答 FALSE_POSITIVE 时要用它写回 sessionWhitelist，不是用户点按钮那一刻恰好在哪个域名
    // （sticky 面板允许气泡还没消失时用户已经切走，见 pushPanelState 上面的注释）。
    return {
      state: 'checkin',
      channel: 'DRIFT',
      message: buildCheckInMessage('DRIFT', frame, now),
      domain: frame.currentDomain,
    };
  }
  if (result.action === 'CHECK_IN_STUCK') {
    return { state: 'checkin', channel: 'STUCK', message: buildCheckInMessage('STUCK', frame, now) };
  }
  // DO_NOTHING：companion 还是 observing 交给状态机的结论，不在这里二次判断。
  return { state: petState };
}

// 08-28 真机测试暴露的 bug：check-in 触发的那一刻 evaluateFrame() 会把 state.lastCheckInTs
// 设成 now（这是它自己的冷却闸门需要的），于是紧接着的下一次 evaluate（任何后续事件都会
// 触发一次——键盘/滚动/切 tab，不需要是用户在回答）里，冷却闸门让 action 变回 DO_NOTHING，
// 而这里原来是每一帧都无条件用最新算出的 PanelState 覆盖 storage——check-in 气泡因此会在
// 用户还没来得及读完/回答之前就被下一个事件顶掉，表现为"气泡一闪而过"。
// 修法：已经在显示未回答的 check-in 时，只有下一帧仍然是 check-in（同一次判定的延续）才刷新；
// 真正让它消失的只能是用户点按钮触发的 pushCompanionState()/pushMicroRestartToast()。
export async function pushPanelState(
  frame: FeatureFrame,
  result: DetectionResult,
  petState: PetState,
  now: number
): Promise<void> {
  const panelState = toPanelState(frame, result, petState, now);
  if (panelState.state !== 'checkin') {
    const stored = await chrome.storage.local.get(PANEL_STATE_KEY);
    const current = stored[PANEL_STATE_KEY] as PanelState | undefined;
    if (current?.state === 'checkin') return;
  }
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
  // B11：把 now 传进去，微重启那句才会在多个变体之间轮换；不传的话永远只出每个池的第一句，
  // 一次会话里答两次 check-in 就会看到一模一样的回复。
  const toast: PanelState = {
    state: 'companion',
    message: buildMicroRestartMessage(feedback.answer, Date.now()),
  };
  await chrome.storage.local.set({ [PANEL_STATE_KEY]: toast });
  // SW 可能在这 2.5s 内被回收——不是致命的（用户最多少看到这句反馈，不影响任何判定逻辑），
  // 比额外接一个 chrome.alarms 只为了这一句话的收尾要划算得多。
  setTimeout(() => {
    void pushCompanionState();
  }, MICRO_RESTART_TOAST_MS);
}
