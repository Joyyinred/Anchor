// Anchor · B9 状态机：陪伴 / 观察 / check-in 三态（Day 6–8，依赖 B1）
// 分工v2.md §2 B 职责："状态机（陪伴 / 观察 / check-in 三态，手写或 XState）"，MVP 阶段手写足够。
//
// 解决的问题：panel.ts 之前把 DO_NOTHING 一律映射成 'companion'，'observing' 这一态
// 从头到尾没有任何代码会产出——桌宠组件画了三态，实际只演得出两态。
//
// 'observing' 的信号从哪来（panel.ts 顶部注释留的那个问题）：
//   DetectionResult 契约本身确实不带"证据接近阈值"这个信号，但 BState 的两个证据持续器带——
//   driftSustainer.since / stuckSustainer.since 一旦不是 null，就意味着"证据已经开始累积、
//   但还没满持续窗口"，这正好就是"有点飘的迹象，先悄悄多看两眼"那一刻。不需要给
//   DetectionResult 加字段，也不需要动 detector.ts 的判定逻辑。
//
// PetState 从 src/pet/types.ts 直接 import：那个文件是零依赖的纯类型声明（没有 React/chrome/DOM），
// 引擎编译它没有任何负担；比在这里再手写第三份 'companion'|'observing'|'checkin' 字面量、
// 再加一道 contract-check 哨兵要划算（08-26 code review ⑨ 已经为同类问题付过一次代价）。
import type { PetState } from '../pet/types';
import type { DetectionResult } from './types';
import { scaled } from './detector';

// 证据消失之后，'observing' 至少再保持这么久才允许退回 'companion'。
// 没有这道迟滞的话：用户在无关页面上随手动一下（texture 从 passive 变回 purposeful），
// 持续器立刻被清空，桌宠就会在 observing/companion 之间来回闪——真实浏览里 texture
// 每隔几秒就可能翻一次，闪烁会非常明显。这纯粹是视觉防抖，不参与任何判定。
export const MIN_OBSERVING_MS = 15_000;

// 状态机自己的记忆。不进 BStatePersistable——这是纯粹的 UI 表现状态，SW 被回收后
// 从 'companion' 重新开始完全无害（最多少演一次"观察"），不值得为它多一次 storage 往返。
export interface PetStateMachine {
  state: PetState;
  /** 进入 'observing' 的时刻，给上面那道迟滞用；不在 observing 态时是 null。 */
  observingSince: number | null;
}

export function createPetStateMachine(): PetStateMachine {
  return { state: 'companion', observingSince: null };
}

/**
 * 证据快照：从 BState 里摘出状态机关心的那几个字段。
 * 故意不直接吃整个 BState——状态机只读这三个值，窄接口让单测不用编造一个完整 BState，
 * 也让"状态机会不会偷偷改引擎状态"这个问题在类型层面就没得问。
 */
export interface PetEvidenceSnapshot {
  driftSustainerSince: number | null;
  stuckSustainerSince: number | null;
  restUntil: number;
}

/**
 * 推进一步状态机，返回这一刻该演哪一态。就地更新 machine（跟 detector.ts 里
 * sustainedWithWindow/applyCheckInFeedback 就地改 BState 是同一个风格）。
 *
 * 优先级从高到低：
 *   1. check-in 触发了 → 'checkin'（最高优先级，压过一切）
 *   2. 休息期内 → 'companion'（用户主动点了休息，这时候演"我在盯着你"是反效果）
 *   3. 证据正在累积 → 'observing'
 *   4. 其余 → 'companion'（但受 MIN_OBSERVING_MS 迟滞保护，见上）
 */
export function advancePetState(
  machine: PetStateMachine,
  action: DetectionResult['action'],
  evidence: PetEvidenceSnapshot,
  now: number,
  isDemoMode?: boolean
): PetState {
  if (action !== 'DO_NOTHING') {
    machine.state = 'checkin';
    machine.observingSince = null;
    return machine.state;
  }

  // 休息期：isDrifting/isStuck 的公共闸口这时候是直接 return false 的（证据持续器保持
  // 原值不被清空），所以这里必须显式挡一道——否则休息期间会一直演 'observing'，
  // 跟"用户主动要求安静一会儿"完全相反。
  if (evidence.restUntil > now) {
    machine.state = 'companion';
    machine.observingSince = null;
    return machine.state;
  }

  const accumulating = evidence.driftSustainerSince !== null || evidence.stuckSustainerSince !== null;
  if (accumulating) {
    // 从别的态进 observing 才重新计时；已经在 observing 里就保持原来的 observingSince，
    // 不然迟滞窗口会被每一帧不断推后，永远退不回 companion。
    if (machine.state !== 'observing') machine.observingSince = now;
    machine.state = 'observing';
    return machine.state;
  }

  // 证据没了：迟滞窗口内先保持 observing，别立刻缩回去。
  if (
    machine.state === 'observing' &&
    machine.observingSince !== null &&
    now - machine.observingSince < scaled(MIN_OBSERVING_MS, isDemoMode)
  ) {
    return machine.state;
  }

  machine.state = 'companion';
  machine.observingSince = null;
  return machine.state;
}