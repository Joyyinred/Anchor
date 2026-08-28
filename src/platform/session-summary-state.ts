// Anchor · 收尾反思（J7 最后一环 / B15 的最小版）在 background <-> side panel 之间共享的状态。
// 跟 panel-state.ts / rest-state.ts / onboarding-state.ts 同一个模式：传输层，不进引擎契约。
//
// ★ 为什么统计不放进 BStatePersistable：那是契约v4 §3.1 定义的"判定状态"（阈值/冷却/休息），
//   收尾统计是纯 UI 数据，塞进去会污染语义；而且 frame-pipeline 的 toPersistable() 用的是
//   解构剩余（`const { driftSustainer, ... } = state`），往 BState 加字段会被自动当成判定状态
//   一起持久化，不是我们想要的。独立一个 key 更干净，也让这块完全归 B 侧维护。
import type { CheckInAnswer } from '../pet/types';

export const SESSION_STATS_KEY = 'anchor_session_stats';
export const SESSION_SUMMARY_KEY = 'anchor_session_summary';

/** 一次会话进行中累计的统计。用户点"Done for today"时结算成 SessionSummary。 */
export interface SessionStats {
  startedTs: number;
  /** 用户真正回答过的 check-in 次数（没回答就被下一帧顶掉的不算——那不是一次有效对话）。 */
  answeredCheckIns: number;
  /** 三种回答各自的次数。误报率 = FALSE_POSITIVE / answeredCheckIns（契约v4 §5.4 的口径）。 */
  answers: Record<CheckInAnswer, number>;
  /** 主动点"休息"的次数。 */
  rests: number;
}

export function createSessionStats(now: number): SessionStats {
  return {
    startedTs: now,
    answeredCheckIns: 0,
    answers: { FOCUSED: 0, FALSE_POSITIVE: 0, DRIFTED: 0 },
    rests: 0,
  };
}

/**
 * 结算后的收尾反思。存在这个 key 里就意味着"该显示收尾视图"，被清掉就意味着翻篇。
 * taskDeclaration 是结算那一刻拷贝下来的快照——SessionContext 随后就会被清空（好让下一次
 * 打开侧边栏重新走起步教练），不能等要显示的时候再去读。
 */
export interface SessionSummary {
  taskDeclaration: string;
  startedTs: number;
  endedTs: number;
  answeredCheckIns: number;
  answers: Record<CheckInAnswer, number>;
  rests: number;
}
