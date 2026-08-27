// Anchor · B6 起步教练的真实 LLM 调用实现（Groq gpt-oss-120b，08-27 跟 Jay 确认：
// 低频、需要措辞质量，免费层够用且快）。
//
// 只实现 coach.ts 需要的 StarterCoachLLMCall 这一个窄接口——只产出"第一步物理动作"，
// 不重新推导 taskDeclaration/archetype（coach.ts 自己已经决定阶段一不让 LLM 兼职判断
// 这些，见 coach.ts 顶部注释）。
//
// 目前还没有任何调用方接这个函数——起步教练的 UI（B6 交互 + A13 消费 SessionContext）
// 都还没建，这里先把"接上真实 LLM"这一步准备好：UI 接线时把 groqStarterCoachCall
// 直接传给 runStarterCoach() 当 llmCall 参数用即可。
import { callGroq, extractJsonObject } from './groq';
import type { StarterCoachLLMCall } from '../../engine/coach';

const GROQ_COACH_MODEL = 'openai/gpt-oss-120b';

function buildPrompt(taskDeclaration: string): string {
  return `You are a focus coach helping someone start a task they've been avoiding.

Task: "${taskDeclaration}"

Output ONLY the first physical action to take — absurdly small, something the hands can
literally do in the next 10 seconds (e.g. "open the doc and type the title", not "start writing").

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
export const groqStarterCoachCall: StarterCoachLLMCall = async ({ taskDeclaration }) => {
  const text = await callGroq(GROQ_COACH_MODEL, buildPrompt(taskDeclaration));
  const firstAction = extractFirstAction(text);
  if (!firstAction) throw new Error('groqStarterCoachCall: no usable response');
  return { firstAction };
};
