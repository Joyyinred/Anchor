// Anchor · 收尾反思的 SW 侧逻辑（J7「起步 → 陪伴 → 拉回 → 收尾反思」的最后一环）。
//
// 补的是两个洞：
//   ① 休息模式交付时 SESSION_END 消息明确标了"下游行为还没定"——这里给它一个归宿。
//   ② 表单上 J7 要求有收尾反思、B15（收尾反思视图）却写着"依赖 J7"，两条互相依赖转不动。
//      这份是最小版：J7 能走完整闭环即可，精修视图留给 B15。
//
// ★ 跟 rest.ts 一样，这是 B 侧写的"参考接线"，Jay 要按自己的风格重写或挪位置都行。
//   index.ts 需要加的只有：CHECK_IN_ANSWER 分支里调一次 recordCheckInAnswer()、
//   REST_START 分支里调一次 recordRestStart()、以及 SESSION_END / SESSION_RESTART 两个新分支。
import type { CheckInFeedback, SessionContext } from '../../engine/types';
import { DEFAULT_TASK_DECLARATION } from '../../engine/types';
import { saveSessionContext } from './session';
import {
  SESSION_STATS_KEY,
  SESSION_SUMMARY_KEY,
  createSessionStats,
  type SessionStats,
  type SessionSummary,
} from '../session-summary-state';

async function loadStats(now: number): Promise<SessionStats> {
  const stored = await chrome.storage.local.get(SESSION_STATS_KEY);
  // 没有就现造一份，把"这一刻"当会话起点。会话真正的起点其实是起步教练完成那一刻，
  // 但那需要 onboarding 侧也写一次统计；差几秒对收尾展示没有意义，不值得多一处接线。
  return (stored[SESSION_STATS_KEY] as SessionStats | undefined) ?? createSessionStats(now);
}

async function saveStats(stats: SessionStats): Promise<void> {
  await chrome.storage.local.set({ [SESSION_STATS_KEY]: stats });
}

/** 用户回答了一次 check-in。在 index.ts 的 CHECK_IN_ANSWER 分支里调一次。 */
export async function recordCheckInAnswer(feedback: CheckInFeedback, now: number): Promise<void> {
  const stats = await loadStats(now);
  stats.answeredCheckIns += 1;
  stats.answers[feedback.answer] += 1;
  await saveStats(stats);
}

/** 用户主动点了休息。在 index.ts 的 REST_START 分支里调一次。 */
export async function recordRestStart(now: number): Promise<void> {
  const stats = await loadStats(now);
  stats.rests += 1;
  await saveStats(stats);
}

/**
 * 用户点了"Done for today"：结算统计 → 写 SessionSummary（side panel 据此显示收尾视图）
 * → 清空 SessionContext 的任务声明。
 *
 * ★ 顺序不能反：先存 summary 再清 context。summary 里的 taskDeclaration 是结算那一刻的
 *   快照——清完 context 之后就读不到了，不能等到要显示时再去查。
 * ★ 清空用的是"把 taskDeclaration 打回 DEFAULT_TASK_DECLARATION"而不是删掉整个 key：
 *   onboarding.ts 的 pushOnboardingStatus() 正是拿这个值判断该不该显示起步输入框
 *   （不额外维护"onboarding 做过没"的独立标记），保持同一个判据，两处不会不同步。
 */
export async function endSession(ctx: SessionContext, now: number): Promise<void> {
  const stats = await loadStats(now);
  const summary: SessionSummary = {
    taskDeclaration: ctx.taskDeclaration,
    startedTs: stats.startedTs,
    endedTs: now,
    answeredCheckIns: stats.answeredCheckIns,
    answers: stats.answers,
    rests: stats.rests,
  };
  await chrome.storage.local.set({ [SESSION_SUMMARY_KEY]: summary });

  await saveSessionContext({ ...ctx, taskDeclaration: DEFAULT_TASK_DECLARATION });
  await chrome.storage.local.remove(SESSION_STATS_KEY);
}

/**
 * 用户在收尾视图上点了"Start something new"：清掉 summary，面板随即回到起步教练
 * （SessionContext.taskDeclaration 在 endSession 时已经打回默认值了）。
 */
export async function restartSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_SUMMARY_KEY);
}
