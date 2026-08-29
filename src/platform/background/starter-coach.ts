// Anchor · B6 起步教练的真实 LLM 调用实现（Groq gpt-oss-120b，08-27 跟 Jay 确认：
// 低频、需要措辞质量，免费层够用且快）。
//
// 只实现 coach.ts 需要的 StarterCoachLLMCall 这一个窄接口——只产出"第一步物理动作"，
// 不重新推导 taskDeclaration/archetype（coach.ts 自己已经决定阶段一不让 LLM 兼职判断
// 这些，见 coach.ts 顶部注释）。
//
// 08-27 起 B6 UI（background/onboarding.ts）已经在真正调用这个函数了。
// 08-29 B12：prompt 打磨到 v1，见下方 buildPrompt 里逐条规则的注释和 docs/起步教练prompt-v0.md。
import { callGroq, extractJsonObject } from './groq';
import type { StarterCoachLLMCall } from '../../engine/coach';

const GROQ_COACH_MODEL = 'openai/gpt-oss-120b';

// B12 prompt v1。v0 那版只有一句指令 + 一组 good/bad 例子，真机上会出这几类废话：
//   · "Start writing the essay."      —— 复述目标，等于没说
//   · "Plan your approach first."     —— 计划伪装成开始，是最常见的拖延陷阱
//   · "Open your laptop."             —— 前置条件不是动作，而且有点侮辱人
//   · "Open the doc, then outline…"   —— 一串步骤，用户看完更不想动了
// 所以 v1 的主要改动是：把这些失败模式**当成显式反例写进去**，而不是指望模型自己领会。
//
// 另外三处：
//   ① v0 开头写 "a task they've been avoiding"——预设用户在拖延。但很多人只是正常开工，
//      这个预设会让语气变成"我知道你在逃避哦"，跟产品"像朋友不像监工"的定位相反。
//   ② v0 没有长度约束。这句话要塞进 220px 的气泡，长了会把布局撑坏（真机上标题就踩过这个坑）。
//   ③ v0 没写语言。项目是英文的，但用户如果用中文声明任务，模型很可能跟着回中文。
function buildPrompt(taskDeclaration: string): string {
  return `You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "${taskDeclaration}"

Name ONE physical first action: something their hands can do in the next 10 seconds,
on their screen or on their desk. It should be small enough that refusing feels silly.

Rules:
- One action only. Never a sequence, never "first... then...".
- Be physical and specific: open a named file, type a specific first line, put a specific
  book on the desk. If you cannot name the thing, you are being too vague.
- Planning is not starting. Reject "outline your approach", "think about the structure",
  "make a list of what to do" — that is procrastination wearing a productive costume.
- Do not restate the goal. "Start writing the essay" is the goal, not an action.
- Do not name a prerequisite. "Open your laptop" is not an action, it is a precondition,
  and saying it sounds condescending.
- If the task is vague, pick the most likely concrete reading and commit to it. You get
  one shot — there is no follow-up question, and hedging is worse than guessing.
- At most 12 words. It is displayed in a small speech bubble.
- Write in English regardless of the language of the task. Plain and warm; no exclamation
  marks, no cheerleading, no praise.

Good: "Open the essay doc and type just the title."
Good: "Pull up lecture 5 slides and read the first one."
Good: "Put the textbook on your desk, open to chapter 3."
Bad:  "Start writing the essay."                    (restates the goal)
Bad:  "Plan your essay structure."                  (planning, not starting)
Bad:  "Open your laptop."                           (a precondition, not an action)
Bad:  "Open the doc, then outline, then write."     (a sequence)
Bad:  "You can do this! Just begin."                (cheerleading, says nothing)

Output JSON only, no extra text:
{"firstAction": string}`;
}

function extractFirstAction(text: string | null): string | null {
  if (!text) return null;
  const parsed = extractJsonObject(text) as { firstAction?: unknown } | null;
  return parsed && typeof parsed.firstAction === 'string' && parsed.firstAction.trim() ? parsed.firstAction : null;
}

/**
 * runStarterCoach() 的 llmCall 参数就传这个函数。调用失败/解析不出来时抛错——
 * runStarterCoach() 已经用 try/catch 把 llmCall 的失败兜底成 FIRST_ACTION_FALLBACK
 * （coach.ts 已实现，分工v2.md §5 红线2 同一个精神），这里不用重复兜底一次。
 */
// ★ 08-29：起步教练必须给足 token 预算。gpt-oss 的 reasoning 计入 max_tokens，
// 而这个 prompt（v1，8 条规则 + 例子）会让模型想得比分类那条长得多——
// 真机实测 reasoning 就占了 182/200，content 被截断成半截 JSON。1000 是实测够用的值。
const COACH_MAX_TOKENS = 1000;

/**
 * runStarterCoach() 的 llmCall 参数就传这个函数。调用失败/解析不出来时抛错——
 * runStarterCoach() 已经用 try/catch 兜底成 FIRST_ACTION_FALLBACK（红线2 同一个精神）。
 *
 * ★ 但抛错前一定要打日志：coach.ts 那边是空 catch（连错误对象都不接），
 *   所以这里不说，整条链路就是完全静默的——用户只看到一句正常的兜底文案，
 *   分不清是"LLM 这么说的"还是"LLM 挂了"。08-29 那次 max_tokens 截断就是这么难查的。
 */
export const groqStarterCoachCall: StarterCoachLLMCall = async ({ taskDeclaration }) => {
  const text = await callGroq(GROQ_COACH_MODEL, buildPrompt(taskDeclaration), {
    maxTokens: COACH_MAX_TOKENS,
  });
  if (text === null) {
    // callGroq 已经打过具体原因（没配 key / 非 2xx / 超时），这里补一句把两段日志串起来。
    console.warn('[Anchor SW] starter coach: Groq call failed, falling back to canned first action');
    throw new Error('groqStarterCoachCall: no response');
  }
  const firstAction = extractFirstAction(text);
  if (!firstAction) {
    // 拿到回复但抠不出 firstAction——最常见的原因就是 max_tokens 不够、JSON 被截断。
    // 把原始回复打出来，下次一眼能看出是截断还是模型没按格式输出。
    console.warn('[Anchor SW] starter coach: unusable response, falling back. Raw:', text);
    throw new Error('groqStarterCoachCall: no usable response');
  }
  return { firstAction };
};