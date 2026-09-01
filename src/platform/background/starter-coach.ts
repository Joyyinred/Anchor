// Anchor · B6 起步教练的真实 LLM 调用实现（Groq gpt-oss-120b，08-27 跟 Jay 确认：
// 低频、需要措辞质量，免费层够用且快）。
//
// 只实现 coach.ts 需要的 StarterCoachLLMCall 这一个窄接口——只产出"第一步物理动作"，
// 不重新推导 taskDeclaration/archetype（coach.ts 自己已经决定阶段一不让 LLM 兼职判断
// 这些，见 coach.ts 顶部注释）。
//
// 08-27 起 B6 UI（background/onboarding.ts）已经在真正调用这个函数了。
// 08-29 B12：prompt 打磨到 v1。
// 09-01 B12：prompt 修到 v2（v1 在教模型编造具体细节）、又修到 v3（v2 的"泛化对象"退路
//   本身在教模型假设用户已经拥有某样东西）——两次的根因都在下方 buildPrompt 上的注释里。
//   prompt 全文同步在 docs/起步教练prompt-v0.md（那份文档写着"以代码为准，两边一起改"）。
import { callGroq, extractJsonObject } from './groq';
import type { StarterCoachLLMCall } from '../../engine/coach';

const GROQ_COACH_MODEL = 'openai/gpt-oss-120b';

// B12 prompt v3（09-01）。下面按 v1 → v2 → v3 的顺序记，因为后一版每次都是在修前一版
// 自己引入的问题——只看最终结果的话，很容易把某条规则当成"多余的啰嗦"再删回去。
//
// ── v1 的历史（保留，因为 v2 没有推翻它，只是修掉了它引入的新问题）──
// v0 那版只有一句指令 + 一组 good/bad 例子，真机上会出这几类废话：
//   · "Start writing the essay."      —— 复述目标，等于没说
//   · "Plan your approach first."     —— 计划伪装成开始，是最常见的拖延陷阱
//   · "Open your laptop."             —— 前置条件不是动作，而且有点侮辱人
//   · "Open the doc, then outline…"   —— 一串步骤，用户看完更不想动了
// v1 的主要改动是把这些失败模式**当成显式反例写进去**，而不是指望模型自己领会；
// 另外去掉了 v0 "a task they've been avoiding" 那个"预设用户在拖延"的开场（跟"像朋友
// 不像监工"的定位相反）、加了 12 词上限（气泡只有 220px 宽）、显式要求英文输出。
//
// ── v2 修的是 v1 自己引入的 bug：prompt 在教模型撒谎 ──
// 08-30 真机复现：输入 "review computer network for the exam"，它给的是
// "Open the network textbook, flip to chapter 4."——哪本书、哪一章全是编的。
// 这不是模型抽风，是 v1 **五处都在要求它编**：
//   ① 规则2 "If you cannot name the thing, you are being too vague."
//      —— 逼一个不知道用户有哪本书的模型必须说出书名。
//   ② 规则6 "hedging is worse than guessing."
//      —— 字面意思就是"编一个好过承认不知道"。
//   ③④ 3 个 Good 范例里有 2 个自己在示范这个 bug："lecture 5"、"chapter 3" 都是凭空的。
//   ⑤ 反例集合里没有任何一条针对"编造事实"。
// 根因是 v1 把"具体"和"真实"混为一谈了：只要求了具体、没要求真实，模型要同时满足
// "具体" + "12 词内"，只能靠编。
//
// v2 的修法（Jay 08-30 的方案）：
//   · 规则2 拆成"必须物理具体" + "细节只能来自任务里真的给了的信息"，并给出"泛化但真实"
//     的替代表述（"your notes" / "your textbook"）——不给替代表述的话，模型夹在"不许编"
//     和"必须具体"之间，只会退化成跟兜底文案差不多的废话。
//     ★ 但**这个替代表述本身选错了**，当天就被真机推翻，见下面的 v3。
//   · 规则6 保留"vague 任务也必须给一个动作、不许反问不许 hedge"（这部分设计是对的，
//     单次调用没有第二轮），但把"concrete"的定义收窄到**动作**本身，而不是虚构的事实。
//   · 2 个 Good 范例换成不带编号的表述，新增 1 条 Bad 范例直接用这次真机复现的原句。
//     ★ 换范例是这次改动里最重要的一步：few-shot 范例对模型行为的影响通常大于规则文字，
//     只改规则、留着那两个"编号范例"大概率压不住。
//
// ── v3（09-01，同一天）：v2 的"泛化对象"退路本身也是错的 ──
// 真机复现：输入 "I wanna prestudy my new course advanced data structure and algorithm"，
// 产出 "Pick up your notes and read the first line."——**预习一门新课，笔记按定义还不存在**。
// 又是 prompt 教的：v2 规则2 结尾那句退路写着「point at something real but generic:
// "your notes", "the material you have open", "your textbook"」，产出几乎是逐字照抄它。
//
// 根因是 v2 的分类维度选错了。当时以为分界线是「具体 vs 泛化」，真正的分界线是：
//   · 需要用户**已经拥有**的东西（your notes / your textbook / your slides）→ 全是猜测
//   · 用户**当场能造出来**的东西（空白文档 / 新标签页 / 白纸 / 一次搜索）→ 100% 存在
// "your notes" 不具体，但它依然是个假设——不具体不等于安全。同一个错误的第二次变形。
//
// v3 的修法：不再靠"少说一点"来躲，而是**把可用对象的范围写死成两类**（任务里给过的，
// 或当场能造的），并且放在规则之前先声明认知边界（"You know nothing about this person
// except the sentence above"）——让模型知道自己不知道什么，比逐条禁止它说什么更省事。
// 配套删掉 v2 那个害人的建议清单，三条 Good 范例全换（原来有两条自己就在假设拥有：
// "your slides"、"your textbook"），新增反例用这次真机复现的原句。
function buildPrompt(taskDeclaration: string): string {
  return `You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "${taskDeclaration}"

Name ONE physical first action: something their hands can do in the next 10 seconds,
on their screen or on their desk. It should be small enough that refusing feels silly.

You know nothing about this person except the sentence above. You do not know what files,
books, notes, or apps they have. Every object you name must be one of:
  (a) named in their task above — reuse it exactly, or
  (b) something they create on the spot: a blank doc, a new tab, a blank page, a search.
Anything else is a guess about their life, and guessing wrong is worse than being plain.

Rules:
- One action only. Never a sequence, never "first... then...".
- Never invent a detail. A chapter number, page number, book title, or file name you made
  up is a lie, not a detail. Name one ONLY if their task named it.
- Never assume they already own or prepared something. "Your notes", "your textbook",
  "your slides", "your outline" may not exist — for a new course or a fresh project they
  usually don't. Have them MAKE something or LOOK something up instead.
- Planning is not starting. Reject "outline your approach", "think about the structure",
  "make a list of what to do" — that is procrastination wearing a productive costume.
- Do not restate the goal. "Start writing the essay" is the goal, not an action.
- Do not name a prerequisite. "Open your laptop" is not an action, it is a precondition,
  and saying it sounds condescending.
- If the task is vague, still commit to ONE concrete action — never ask a question, never
  hedge, you get one shot. "Concrete" describes the ACTION (open, type, search, write),
  not invented facts about material you were never shown.
- At most 12 words. It is displayed in a small speech bubble.
- Write in English regardless of the language of the task. Plain and warm; no exclamation
  marks, no cheerleading, no praise.

Good: "Open a blank doc and type just the title."
Good: "Open a new tab and search for the course syllabus."
Good: "Write the topic name at the top of a blank page."
Bad:  "Start writing the essay."                     (restates the goal)
Bad:  "Plan your essay structure."                   (planning, not starting)
Bad:  "Open your laptop."                            (a precondition, not an action)
Bad:  "Open the doc, then outline, then write."      (a sequence)
Bad:  "You can do this! Just begin."                 (cheerleading, says nothing)
Bad:  "Open the network textbook, flip to chapter 4." (invents a chapter nobody gave you)
Bad:  "Pick up your notes and read the first line."  (assumes notes they may not have)

Output JSON only, no extra text:
{"firstAction": string}`;
}

function extractFirstAction(text: string | null): string | null {
  if (!text) return null;
  const parsed = extractJsonObject(text) as { firstAction?: unknown } | null;
  return parsed && typeof parsed.firstAction === 'string' && parsed.firstAction.trim() ? parsed.firstAction : null;
}

// ── 第二道防线：运行时正则守卫（B12 v2，09-01）──
// prompt 才是真正的修复，这个只是兜底：模型偶尔仍会漏掉规则，而"编造的具体细节"恰好是
// 这个产品最伤的一类错误——它出现在整场 demo 的第一屏，用户第一反应是"它怎么知道我有
// 这本书"，比功能缺失更致命。
//
// ★ 明确的局限：只挡得住"数字型编号"（chapter 4 / page 12 / lecture 5 …）。编造书名、
//   文件名这类非数字的胡诌它一概挡不住——**这是第二道防线，不是完整方案**，别指望它。
const FABRICATION_PATTERN = /\b(chapter|page|lecture|section|unit|module|slide|problem|exercise|week)\s+\d+\b/gi;

/**
 * firstAction 里出现了任务声明里根本没给过的"编号型具体细节"吗？
 *
 * 纯字符串判断，不碰 chrome API，所以可以完整单测（见 starter-coach.test.ts）——
 * 跟这个文件里其余部分（真实 Groq 调用）不一样，不受"chrome API 相关代码不做自动化
 * 测试"这条现有共识的限制。
 *
 * @param firstAction LLM 产出的第一步动作
 * @param taskDeclaration 用户自己写的任务声明——判断的唯一依据就是"这个细节是不是他自己说的"
 * @returns true = 编的，调用方应该丢弃这次产出走兜底文案
 */
export function hasFabricatedSpecific(firstAction: string, taskDeclaration: string): boolean {
  // 空白归一化：任务里写 "chapter  3"（多打了一个空格）而动作里写 "chapter 3" 时，
  // 不做这一步就会把一个**用户自己给过的**细节误判成编的，白白退化成兜底文案。
  // 只会减少误杀、不会放过真的编造，是纯赚的一步。
  const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');
  const task = normalize(taskDeclaration);
  const matches = firstAction.match(FABRICATION_PATTERN) ?? [];
  return matches.some((m) => !task.includes(normalize(m)));
}

/**
 * runStarterCoach() 的 llmCall 参数就传这个函数。调用失败/解析不出来时抛错——
 * runStarterCoach() 已经用 try/catch 兜底成 FIRST_ACTION_FALLBACK（分工v2.md §5 红线2
 * 同一个精神），这里不用重复兜底一次。
 *
 * ★ 但抛错前一定要打日志：coach.ts 那边是空 catch（连错误对象都不接），
 *   所以这里不说，整条链路就是完全静默的——用户只看到一句正常的兜底文案，
 *   分不清是"LLM 这么说的"还是"LLM 挂了"。08-29 那次 max_tokens 截断就是这么难查的。
 */
// ★ 08-29：起步教练必须给足 token 预算。gpt-oss 的 reasoning 计入 max_tokens，
// 而这个 prompt（规则 + 例子都不短）会让模型想得比分类那条长得多——
// 真机实测 reasoning 就占了 182/200，content 被截断成半截 JSON。1000 是实测够用的值。
const COACH_MAX_TOKENS = 1000;

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
  if (hasFabricatedSpecific(firstAction, taskDeclaration)) {
    // 走到这里说明 prompt v2 没压住——两句都打出来，下次调 prompt 时有第一手素材。
    // 抛错后 coach.ts 的 try/catch 会兜成 FIRST_ACTION_FALLBACK，不需要新架构。
    console.warn(
      '[Anchor SW] starter coach: fabricated specific detected, falling back.',
      'firstAction:', firstAction, '| task:', taskDeclaration
    );
    throw new Error('groqStarterCoachCall: fabricated specific');
  }
  return { firstAction };
};
