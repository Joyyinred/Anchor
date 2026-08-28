// Anchor · 休息模式（契约v4 §3.8）的 SW 侧逻辑。
//
// ★ 这个文件是 B 侧为了让休息模式能端到端跑通而写的"参考接线"，属于 Jay 在 0828 note 里
//   说的"A 侧需要配合的部分"。她要按自己的风格重写、或挪进 frame-pipeline.ts 都可以——
//   B 侧真正保证的只有：side panel 会发出 REST_START / REST_END / SESSION_END 三条消息
//   （见 messages.ts），以及会读 REST_STATE_KEY 里的 RestState（见 rest-state.ts）。
//
// 引擎侧 startRest()/restReminderDue() 是 B1 早就写好并测过的（metascenario.test.ts 场景23），
// 这里不重新实现任何判定，只负责"读写 BState + 把结果推给面板"。
import { startRest, restReminderDue } from '../../engine/detector';
import type { BState } from '../../engine/detector';
import { REST_STATE_KEY, type RestState } from '../rest-state';

async function pushRestState(state: RestState): Promise<void> {
  await chrome.storage.local.set({ [REST_STATE_KEY]: state });
}

/**
 * 用户点了"Take a break"。startRest() 就地写 restStartTs/restUntil（restUntil = now + 20min），
 * 之后 isDrifting/isStuck 的公共闸口 `state.restUntil > now` 会让双通道全静默。
 * 调用方负责把改过的 state 持久化（跟 applyCheckInAnswer 一样走 setBState/toPersistable）。
 */
export async function beginRest(state: BState, now: number): Promise<void> {
  startRest(state, now);
  await pushRestState({ isResting: true, restStartTs: now, isReminderDue: false });
}

/**
 * 用户在提醒里点了"Back to it"。
 * ★ 必须同时清 restUntil 和 restStartTs：只清 restUntil 的话，restReminderDue() 还会按
 *   老的休息起点继续判定，提醒停不下来（它只读 restStartTs，不读 restUntil）。
 */
export async function endRest(state: BState): Promise<void> {
  state.restUntil = -Infinity;
  state.restStartTs = -Infinity;
  await pushRestState({ isResting: false });
}

/**
 * 心跳里调一次：休息中且到了提醒节拍（15min 首次，之后每 5min）就把 isReminderDue 打开。
 * 契约v4 §3.8 要求"按心跳节拍调用，节拍间隔 ≤ 60s"——现在心跳正好是 1 分钟，符合。
 *
 * 提醒文案不在这里生成：面板拿着 restStartTs 自己就能算出"已休息 N 分钟"，
 * 让 SW 每分钟为了一个数字重写一次 storage 不划算（见 main.tsx 里同一处的注释）。
 */
export async function refreshRestReminder(state: BState, now: number): Promise<void> {
  if (!(state.restUntil > now)) return; // 没在休息（或休息已自然到期），不碰面板状态
  const due = restReminderDue(state, now);
  await pushRestState({ isResting: true, restStartTs: state.restStartTs, isReminderDue: due });
}