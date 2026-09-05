// Anchor · B6 起步教练的真实 LLM 调用实现（Groq gpt-oss-120b，08-27 跟 Jay 确认：
// 低频、需要措辞质量，免费层够用且快）。
//
// 只实现 coach.ts 需要的 StarterCoachLLMCall 这一个窄接口——只产出"第一步物理动作"，
// 不重新推导 taskDeclaration/archetype（coach.ts 自己已经决定阶段一不让 LLM 兼职判断
// 这些，见 coach.ts 顶部注释）。
//
// 08-27 起 B6 UI（background/onboarding.ts）已经在真正调用这个函数了。
// 08-29 B12：prompt 打磨到 v1。
// 09-01 B12：prompt 一天内改到 v5。v2/v3/v4 每一版都在修前一版自己引入的新毛病
//   （编造 → 假设拥有 → 没用 → 只会搜索），v5 换了个思路：不再收紧措辞，而是**给模型
//   补上它一直缺的那份信息**（当前页面）。根因逐版记在下方 buildPrompt 上的注释里。
//   prompt 全文同步在 docs/起步教练prompt-v0.md（那份文档写着"以代码为准，两边一起改"）。
import { callGroq, extractJsonObject } from './groq';
import type { AnchorContext, StarterCoachLLMCall, TaskQualityCheckCall, TaskQualityCheckOutput } from '../../engine/coach';

const GROQ_COACH_MODEL = 'openai/gpt-oss-120b';

// B12 prompt v5.1（09-02）。下面按 v1 → v2 → v3 → v4 → v5 → v5.1 的顺序记，因为后一版每次都是在修前一版
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
//
// ── v4（09-01，还是同一天）：前三版全在管"真不真实"，没有一条在管"有没有用" ──
// 真机复现：输入 "pre study for my new course data structure and algorithm"，产出
// "Open a new doc, type down data structure and algorithm."
// 这个产出**没有任何毛病**——不编造、不假设拥有、物理、一步、12 词内，v3 的每条规则都过了。
// 唯一的问题是它**什么也没推进**：把早就知道的课程名打进空文档，得到的东西跟十秒前一样。
//
// 又是范例教的（第四次）：v3 的 Good #1 就是 "Open a blank doc and type just the title."，
// 产出跟它是同一个句式模板。Good #3 "Write the topic name at the top of a blank page."
// 得的是同一种病——**我当时只检查了范例"真不真实"，没检查它"有没有用"**。
//
// 缺的维度：**做完之后必须拥有或知道某样十秒前没有的东西**。
//   · 搜大纲 / 打开课程页 / 读一行 → 有（把真实材料拉到眼前）
//   · 写一句粗糙的开头 / 一行代码       → 有（产出了一小块真东西）
//   · 把课名打一遍 / 给空文档起标题     → 没有（信息量为零）
// v4 加的就是这一条规则，并且把两条"起标题/写名字"型的 Good 换成会产出或揭示东西的，
// 新增反例直接用这次的原句。前三版都在收紧"不许说什么"，这条是第一次规定"必须做到什么"。
//
// ── v5（09-01）：不再改措辞，改成给它补信息 ──
// 评测集第一次跑分（12 条用例，见 evals/）给出的数字：**通过率 12/12 (100%)，但 SEARCH 占 83%**。
// 每一条都合规、每一条都过了全部规则，**而且十条里九条是同一个动作**：
//   `finish chapter 3 of the react docs`  → "search for React docs chapter 3"（人就在读那文档）
//   `watch the recorded lecture from monday` → "search for recorded lecture Monday"（公网根本搜不到）
//
// 根因不是范例又选歪了，是**四版约束叠起来把解空间挤到只剩一个点**：
//   v2「不许编造细节」→ 砍掉所有具体命名
//   v3「只能用任务里给过的 / 当场能造的」→ 砍掉所有已有材料
//   v4「必须揭示或产出新东西」→ 砍掉"打开某物看一眼"
// 交集里"去搜"几乎是唯一活口。**一个只知道任务字符串的模型，确实只能这么答。**
//
// 决定性的一条证据：那 12 条里唯一一条不搜索的好答案，是
//   `fix the failing tests in detector.test.ts` → "Open detector.test.ts in your editor"
// ——**唯一一条任务自己给了真实对象的用例**。给它可信的真实对象，它立刻就不搜了。
//
// 所以 v5 加的是 anchorContext（当前 tab 的标题+url）：整条链路上唯一一份"不用猜"的真实
// 信息，它让 OPEN_EXISTING / PLAY / READ 这几种形态重新变成合法选项。
//
// ★ 必配的防讨好补丁：模型有强烈的"把给它的东西用上"倾向。只写"相关就用它"的话，
//   "study neural network" + 用户正开着 Gmail，很可能得到 "Search your inbox for the course
//   email."——**那是编造换了个真实的锚，比原来的编造更难识破**。所以同时写死了反向指令
//   （"An open page is not automatically relevant… ignore it completely"）和一条对应反例。
//   前四版的经验：光有规则没有反例压不住，两者必须成对出现。
//
// ── v5.1（09-02）：v5 跑分后补的一条窄缺口 ──
// v5 首跑成绩（16 条，见 evals/）：**防讨好 2/2 全过**（Gmail / Nike 都被彻底忽略，
// BORROWED_IRRELEVANT_PAGE 零命中），**相关页面 1/2**——3b1b 视频那条第一次给出了 PLAY
// （这个形态 v1~v4 从来没出现过），但 react.dev 那条仍然是
//   任务 `finish chapter 3 of the react docs` + 页面开着 react.dev
//   → "Open a new tab and search for React docs chapter 3"
// **材料就在眼前，却被支去重新找一遍。**
//
// 根因是规则 (a) 只说了半句：`named in their task above — reuse it exactly` 要求了"复用这个
// 名字"，**没要求"直接打开它、别去搜它"**。模型老老实实复用了名字，然后套进它最熟的搜索模板。
// 对照组里那三条（react docs / transformer paper / Monday 录播）是同一个病，所以这一条补下去
// 同时打两组。其中 Monday 录播那条尤其要紧：**私有课程录播在公网上根本搜不到，那个动作
// 执行下去必然失败**——不只是平淡，是错的。
//
// ★ export 出来只有一个原因：`evals/run-starter-coach.ts` 要用**跑在生产里的这一份**去打分。
//   复制一份到 evals 下的话，就是 08-29 那个"文档一份代码一份、各写各的"的坑再踩一次——
//   而且这次更糟：评测跑的是 A 版，用户看到的是 B 版，分数完全没有意义。
/** 标题可能很长（有些站点把整段描述塞进 title），截一下免得挤占 prompt。 */
const MAX_ANCHOR_TITLE_LENGTH = 90;

export function buildPrompt(taskDeclaration: string, anchorContext?: AnchorContext): string {
  // 有没有当前页面，prompt 的形状不一样：没有时保持 v4 原样（两类可用对象），
  // 有时多一类 (c)，并且明确"相关就优先用它"。两条分支共用同一套规则和范例。
  const title = anchorContext?.title.trim().slice(0, MAX_ANCHOR_TITLE_LENGTH) ?? '';
  const openPageLine = anchorContext
    ? `\nRight now they have this page open: "${title}" (${anchorContext.url})\n`
    : '';
  const optionC = anchorContext
    ? `  (c) the page they already have open, named above — but ONLY if it clearly fits the task.
      If it fits, prefer it over (b): using what is already in front of them always beats
      sending them off to search for something new.\n`
    : '';

  return `You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "${taskDeclaration}"
${openPageLine}
Name ONE physical first action: something their hands can do in the next 10 seconds,
on their screen or on their desk. It should be small enough that refusing feels silly.

You know almost nothing about this person. You do not know what files, books, notes, or
apps they have. Every object you name must be one of:
  (a) named in their task above — reuse it exactly, or
  (b) something they create on the spot: a blank doc, a new tab, a blank page, a search.
${optionC}Anything else is a guess about their life, and guessing wrong is worse than being plain.

Rules:
- One action only. Never a sequence, never "first... then...".
- Never invent a detail. A chapter number, page number, book title, or file name you made
  up is a lie, not a detail. Name one ONLY if their task named it.
- If they already named the material — a file, a doc, a paper, a lecture, a video — assume
  they can already reach it. OPEN it, do not send them searching for it. Searching for
  something they just told you they have is a wasted step, and some of it (a private
  course recording, their own file) cannot be found by searching at all.
- Never assume they already own or prepared something. "Your notes", "your textbook",
  "your slides", "your outline" may not exist — for a new course or a fresh project they
  usually don't. Have them MAKE something or LOOK something up instead.
- An open page is not automatically relevant. If the page above has nothing to do with the
  task, ignore it completely and never mention it. Forcing an unrelated page into the action
  is the same lie as inventing a chapter number — you just borrowed a real name for it.
- It must move the task forward. Ten seconds later they should HAVE something or KNOW
  something they did not before. Typing a title, writing down the name of the task, or
  opening an empty file gives them nothing — they already knew the name. Either pull real
  material in front of them (search it, open it, read one line of it) or make them produce
  one real piece of the work (one sentence, one line of code, one solved step).
- Using an already-open relevant page must mean actually engaging with its content — reading
  a specific real part of it, continuing the conversation with a concrete next question,
  scrolling to the relevant section. Selecting or copying an arbitrary sentence just because
  it happens to be the first one on the page is the same zero-progress trap as typing a title:
  they end up holding a random sentence, not one step closer to the task.
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

Good: "Press play on the video you already have open."      (their open page fits the task)
Good: "Open a blank doc and write one rough sentence of the intro."
Good: "Open a new tab and search for the course syllabus."  (nothing relevant is open)
Bad:  "Search for the React docs chapter 3."         (they named it — open it, don't hunt)
Bad:  "Search for the Monday recorded lecture."      (a private recording is not searchable)
Bad:  "Search your inbox for the course email."      (forced an unrelated open page in)
Bad:  "Open a new doc and type the course name."     (gives them nothing they lacked)
Bad:  "Start writing the essay."                     (restates the goal)
Bad:  "Plan your essay structure."                   (planning, not starting)
Bad:  "Open your laptop."                            (a precondition, not an action)
Bad:  "Open the doc, then outline, then write."      (a sequence)
Bad:  "You can do this! Just begin."                 (cheerleading, says nothing)
Bad:  "Open the network textbook, flip to chapter 4." (invents a chapter nobody gave you)
Bad:  "Pick up your notes and read the first line."  (assumes notes they may not have)
Bad:  "Select the first sentence on the page and copy it." (arbitrary, gives them nothing — same trap as typing a title)

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

export const groqStarterCoachCall: StarterCoachLLMCall = async ({ taskDeclaration, anchorContext }) => {
  const text = await callGroq(GROQ_COACH_MODEL, buildPrompt(taskDeclaration, anchorContext), {
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

// ── 任务声明质量检查（09-05，coach.ts TaskQualityCheckCall 的真实实现）──
// 真机复现：taskDeclaration "调整并测试hackathon项目作品"（十几个字符，长度闸门直接放行），
// 但完全没说项目叫什么、调哪部分——contextRelevance 的分类器全程只拿这句话去跟每个页面
// 标题比对，声明本身空洞，claude.ai 上一个明明是本项目功能讨论的对话（标题"构建起步教练的
// 心理学方法"）愣是判不出关联，长期卡 UNKNOWN。
//
// ★ 这个检查关心"这句话撑不撑得起一整场会话的相关性判断"，不是"能不能靠它写出一个像样的
//   第一步动作"——后者 buildPrompt() 能借助 anchorContext 蒙混过去（当前页面给了线索），
//   但 anchorContext 只是起步那一刻的快照，不会被后续每一次分类复用，声明本身站不站得住
//   才是关键，所以这里故意不传 anchorContext（跟 coach.ts 里 TaskQualityCheckCall 的类型
//   定义一致，不是漏传）。
// 09-05 真机反馈修正 v2：v1 这版还是太严——真机复现自从上一次放宽后，几乎**每一次**填写
// 起步任务都触发追问，包括"review data structure"、"study neural network"这类明明已经
// 点了名的主题。根因是 v1 的反例"study for the exam"跟这些好例子长得太像了（都是
// "动词 + 一两个词的名词短语"），模型很可能是照着句式模式而不是内容在判——学会了"study X"
// 这个形状本身看着就"短，可能不够格"，而不是真的在区分"X 有没有指向一个可判断的主题"。
//
// v2 的修法：不再只靠一条规则文字，直接把这次的真实反例（"study for the exam"）跟
// 结构几乎相同、但应该判够格的例子（"study neural network"）并排放，逼模型看内容不看
// 句式——差别只在于 "neural network" 是一个能拿去跟任意网页标题比对的主题词，"the exam"
// 不是（"exam"是一个事件，不是一个主题，任何页面都判断不出跟"the exam"是不是同一场考试）。
// 同理把 Jay 自己举的反例"test and update hackathon project"也直接写进反例——"hackathon
// project"这个短语本身只说明了"这是一个项目"这个事实，没有说这个项目是做什么的，看到一个
// 关于"React"或者"数据库"的网页，没人能判断它属不属于"这个 hackathon 项目"。
//
// 这道检查现在（见 coach.ts）改成最多只问一次，"问不出完美答案就再问一轮"这个退路已经
// 没有了，判定标准必须相应放宽——第一次问完就要用，宁可对模糊的边界情况偏宽松地放行，
// 也不要因为标准太严导致仅有的这一次追问问得不够到位。
function buildTaskQualityPrompt(taskDeclaration: string): string {
  return `You judge whether a task description names a concrete enough SUBJECT to be used for an
entire work session to decide whether ANY webpage the person visits later is related to their
work — not just to write one first step for right now.

Their task: "${taskDeclaration}"

The test: could you look at a random webpage's title and guess yes/no whether it belongs to this
task? You can if the task names a topic, project, feature, component, file, or section — even
just one word of it, even if it is broad. You cannot if the task only names a bare category of
work or a generic container word (project / presentation / assignment / exam / hackathon) with
nothing that says what it is actually about or called.

Sufficient (each names something you could match a webpage against):
- "review data structure"        (a real subject — data-structure pages would match)
- "study neural network"         (a real subject — neural-network pages would match)
- "adjust the starter coach"     (names the feature)
- "fix auth.ts"                  (names the file)
- "review chapter 4"             (names the section)

Insufficient (nothing here tells you what the work is actually about):
- "study for the exam"           (names an EVENT, not a subject — could be about anything)
- "test and update hackathon project"  (names that it's a project, not what the project does)
- "adjust and test my hackathon project"
- "work on my presentation"

Notice the first pair: "study neural network" and "study for the exam" have the same shape
(verb + short phrase) but different answers — judge the CONTENT of the phrase, not its length or
grammatical shape. A short, broad topic word ("neural network", "data structure") is enough; a
generic container word with no topic attached ("the exam", "my project", "hackathon project") is
not, no matter how it's phrased.

Do not ask for further subdivision once one concrete subject is named — "which part of the
starter coach" is exactly the kind of follow-up you must NOT ask if "starter coach" was already
given. When genuinely unsure whether it counts, prefer sufficient:true — you only get to ask
once, so a slightly loose "yes" costs far less than a follow-up that annoys someone who already
gave a reasonable answer.

If it is insufficient, ask ONE natural, warm follow-up question that would surface a first
concrete subject (usually: which project/feature/file/topic). Under 15 words, do not repeat
their sentence back, do not sound like a form field.

Output JSON only, no extra text:
{"sufficient": boolean, "followupQuestion": string | null}`;
}

function extractTaskQuality(text: string): TaskQualityCheckOutput | null {
  const parsed = extractJsonObject(text) as { sufficient?: unknown; followupQuestion?: unknown } | null;
  if (!parsed || typeof parsed.sufficient !== 'boolean') return null;
  if (parsed.sufficient) return { sufficient: true };
  // sufficient===false 时才需要一句能展示给用户的追问——解析不出可用文案就当整次判定不可用
  // （fail open，见下面调用处），不能把 sufficient:false 但没有问题文案的半成品结果放出去。
  if (typeof parsed.followupQuestion === 'string' && parsed.followupQuestion.trim()) {
    return { sufficient: false, followupQuestion: parsed.followupQuestion.trim() };
  }
  return null;
}

// 跟 groqStarterCoachCall 用同一个模型——这是给用户看的追问文案，要措辞质量，不是纯分类，
// 犯不着为了省钱换成 classifier.ts 那个更小的模型（Jay 的原始设想也是同一个模型，最多
// 3 次调用：2 轮追问 + 1 次拆解，见 updateNote 08-31 记录）。
// max_tokens 参考 COACH_MAX_TOKENS 的教训（gpt-oss 的 reasoning 计入预算，200 会截断）——
// 这个 prompt 比完整拆解 prompt 短，但同一个模型的 reasoning 开销量级一样，不能想当然缩小。
const TASK_QUALITY_MAX_TOKENS = 600;

/**
 * ★ 红线2同精神：这个检查是"锦上添花"，不是关键路径——失败/解析不出来时一律 fail open
 *   （当成"够格"，直接放行到拆解那一步），绝不能因为这道新加的质量检查本身出问题就让
 *   起步教练卡住或崩掉。也因此这个函数本身不抛错，coach.ts 那边不需要再包一层 try/catch。
 */
export const groqTaskQualityCheckCall: TaskQualityCheckCall = async ({ taskDeclaration }) => {
  const text = await callGroq(GROQ_COACH_MODEL, buildTaskQualityPrompt(taskDeclaration), {
    maxTokens: TASK_QUALITY_MAX_TOKENS,
    temperature: 0, // 判"够不够具体"是个二选一的判断，一致性比多样性重要——跟 classifier.ts 同一个理由。
  });
  if (text === null) {
    console.warn('[Anchor SW] task quality check: Groq call failed, treating as sufficient (fail open)');
    return { sufficient: true };
  }
  const parsed = extractTaskQuality(text);
  if (!parsed) {
    console.warn('[Anchor SW] task quality check: unusable response, treating as sufficient (fail open). Raw:', text);
    return { sufficient: true };
  }
  return parsed;
};
