// Anchor · B6 起步教练最小版（Day 9–10）
// 依赖：J1（三契约，types.ts）；对应 J6 的产出方（本模块产出的 SessionContext 就是 J6 要喂给 A 的那份）。
// 契约v4 §5.5 taskDeclaration 质量要求：
//   - taskDeclaration.length >= 8 才够格（"学习"不满足）
//   - 不够格就追问（英文项目，用户可见文案统一用英文，见下方 FOLLOWUP_PROMPT）
//   - 追问最多 2 轮，之后接受用户输入（避免僵住）
//
// 设计取舍：真正的 LLM 调用（网络请求）不写死在这个文件里——跟 perceiver.ts 用
// ClassificationCache 注入分类结果同一个思路，这里用 StarterCoachLLMCall 注入，
// 换成任何供应商的 SDK 都不用改这个文件，单测也不需要真的打网络请求。
// "单次 LLM 调用"这个约束体现在：追问轮次是纯本地的长度判断，完全不触发 llmCall；
// 只有 taskDeclaration 够格（或已经问满 2 轮、按契约兜底接受）之后，才会真正调用一次 LLM。
import {
  SessionContext,
  defaultSessionContext,
  InferredAnchor,
} from './types';

export const MIN_TASK_DECLARATION_LENGTH = 8;
export const MAX_FOLLOWUP_ROUNDS = 2;
// 用户可见文案——本项目是英文项目，凡是展示给用户看的字符串一律用英文（内部注释仍用中文）。
export const FOLLOWUP_PROMPT =
  "Can you be a bit more specific? Something like \"review data structures for tomorrow's exam.\"";

// LLM 这一次调用只做一件事：把已经够格的 taskDeclaration 拆解成第一步物理动作
// （"写论文"→"打开 Word，写下题目"这种"手能动"的粒度，不是"开始写论文"这种正确的废话）。
// 阶段一 profile 用 CREATOR 近似（分工v2.md §3 三预设参数表下方注），不在这一次调用里
// 让 LLM 兼职判断 archetype——那是 B12（阶段二起步拆解 prompt 打磨）的范围，这里保持最小。
export interface StarterCoachLLMOutput {
  firstAction: string;
}

export type StarterCoachLLMCall = (input: {
  taskDeclaration: string;
}) => Promise<StarterCoachLLMOutput>;

// LLM 调用失败/超时时的兜底文案（用户可见，英文）——跟分工v2.md §5 红线2（必有本地兜底，
// 绝不整条链路挂死）同一个精神：起步教练是用户进来第一件事，这里断了比感知半断了观感更差，
// 必须有话可说。
export const FIRST_ACTION_FALLBACK =
  "Don't overthink it — just open whatever you need, and that counts as starting.";

export type StarterCoachResult =
  | {
      status: 'NEEDS_FOLLOWUP';
      /** 展示给用户的追问文案（英文，见 FOLLOWUP_PROMPT）。 */
      prompt: string;
      /** 调用方下一次调用要传回来的轮次计数（本轮追问算一轮）。 */
      roundsUsed: number;
    }
  | {
      status: 'READY';
      sessionContext: SessionContext;
      firstAction: string;
    };

/**
 * 起步教练主入口。调用方（UI 层）典型用法：
 *
 *   let rounds = 0;
 *   let result = await runStarterCoach(userInput, rounds, llmCall, Date.now());
 *   while (result.status === 'NEEDS_FOLLOWUP') {
 *     rounds = result.roundsUsed;
 *     const answer = await askUserAgain(result.prompt);
 *     result = await runStarterCoach(answer, rounds, llmCall, Date.now());
 *   }
 *   // result.status === 'READY'：result.sessionContext 喂给 A（J6），result.firstAction 展示给用户
 *
 * @param rawTaskDeclaration 用户这一轮的输入（第一轮是任务声明本身，后续轮次是对追问的回答）
 * @param roundsUsed         已经追问过多少轮（第一次调用传 0）
 * @param llmCall            单次 LLM 调用的注入点，见上方 StarterCoachLLMCall 的设计取舍说明
 * @param now                Date.now()，用于 defaultSessionContext 的 graceUntil 计算
 * @param sessionId           会话 id，不传则按 now 生成
 * @param inferredAnchor      A 侧推断出的锚点（前两次 tab 切换后活跃最久的 tab），还没推断出时可不传
 */
export async function runStarterCoach(
  rawTaskDeclaration: string,
  roundsUsed: number,
  llmCall: StarterCoachLLMCall,
  now: number,
  sessionId?: string,
  inferredAnchor?: InferredAnchor
): Promise<StarterCoachResult> {
  const taskDeclaration = rawTaskDeclaration.trim();

  // ★ 契约v4 §5.5：不够 8 字符且追问还没问满 2 轮 → 追问，不占用那"单次" LLM 调用。
  if (taskDeclaration.length < MIN_TASK_DECLARATION_LENGTH && roundsUsed < MAX_FOLLOWUP_ROUNDS) {
    return {
      status: 'NEEDS_FOLLOWUP',
      prompt: FOLLOWUP_PROMPT,
      roundsUsed: roundsUsed + 1,
    };
  }

  // 走到这里：要么够格了，要么已经追问满 2 轮——按契约"之后接受用户输入（避免僵住）"，
  // 不管长度多短都往下走，不能因为用户嫌烦不肯细化就把起步卡死。
  let firstAction: string;
  try {
    const output = await llmCall({ taskDeclaration });
    firstAction = output.firstAction;
  } catch {
    firstAction = FIRST_ACTION_FALLBACK;
  }

  const ctx = defaultSessionContext(now, inferredAnchor, sessionId);
  // defaultSessionContext 兜底文案是"未声明任务（默认陪伴模式）"——只有真拿到非空声明时才覆盖，
  // 空声明（用户问满 2 轮还是没说清楚）保留那句默认文案，不要把空字符串硬塞进 taskDeclaration。
  if (taskDeclaration.length > 0) {
    ctx.taskDeclaration = taskDeclaration;
  }

  return { status: 'READY', sessionContext: ctx, firstAction };
}