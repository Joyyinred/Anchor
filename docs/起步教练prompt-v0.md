# Anchor · 起步教练 Prompt v5.1（B6 产出 / B12 打磨）

> 对应表单任务：B6（Day 9–10 · v0）+ B12（阶段二 prompt 打磨 · v1 → v2 → v3 → v4 → v5 → v5.1）· 下游使用方：`src/engine/coach.ts` 的 `StarterCoachLLMCall` 注入点
> 上游契约：`docs/契约v4.md` §5.5 taskDeclaration 质量要求
> 本项目是英文项目：本文档里凡是用户会看到的文案（追问话术、LLM 输出、兜底文案、prompt 示例）一律英文，文档本身的说明性文字保持中文（跟团队其它内部文档一致）。

---

## 1. 调用时机

`runStarterCoach()` 只在 `taskDeclaration` 已经够格（≥8 字符，或追问已满 2 轮按契约兜底接受）之后，
调用**一次** LLM——追问本身是纯本地的长度判断，不占用这次调用。

## 2. Prompt v5.1（拆解第一步物理动作）

> ★ 以 `src/platform/background/starter-coach.ts` 的 `buildPrompt()` 为准。
> **08-29 发现本文档 v0 记的 prompt 跟代码里实际那版并不一致**（文档一份、代码一份，各写各的）——
> 以后改 prompt 请两边一起改，不然下次没人知道哪份是真的在跑。（09-01~09-02 v2~v5.1 同步均已照做。）

```text
You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "{taskDeclaration}"

Right now they have this page open: "{tab title}" ({tab url})

Name ONE physical first action: something their hands can do in the next 10 seconds,
on their screen or on their desk. It should be small enough that refusing feels silly.

You know almost nothing about this person. You do not know what files, books, notes, or
apps they have. Every object you name must be one of:
  (a) named in their task above — reuse it exactly, or
  (b) something they create on the spot: a blank doc, a new tab, a blank page, a search.
  (c) the page they already have open, named above — but ONLY if it clearly fits the task.
      If it fits, prefer it over (b): using what is already in front of them always beats
      sending them off to search for something new.
Anything else is a guess about their life, and guessing wrong is worse than being plain.

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

Output JSON only, no extra text:
{"firstAction": string}
```

> ↑ 这是**拿得到当前 tab 时**的形态（v5 新增）。拿不到时（浏览器内部页面被过滤、tab 查询失败），
> `Right now they have this page open:` 那一行和可用对象 `(c)` 两处一起消失，其余一字不差——
> 也就是 v4 那一版。**规则和范例两条分支共用，不存在"两套 prompt"**，`evals/` 里两条分支都有用例覆盖。

### v1 相比 v0 改了什么（B12，08-29）

v0 只有一句指令 + 一组 good/bad 例子，实际会出这四类废话——**v1 的主要改动就是把这些失败
模式当成显式反例写进去，而不是指望模型自己领会**：

| 失败模式 | 例子 | 为什么是废话 |
|---|---|---|
| 复述目标 | "Start writing the essay." | 用户已经说了要写论文，重复一遍等于没说 |
| 计划伪装成开始 | "Plan your approach first." | **最常见的拖延陷阱**——听起来很负责，实际一个字没写 |
| 前置条件当动作 | "Open your laptop." | 不是动作是前提，而且有点侮辱人 |
| 一串步骤 | "Open the doc, then outline, then write." | 看完更不想动了，起步教练的意义正是"只给一步" |

另外三处：

1. **去掉"a task they've been avoiding"这个预设**。v0 开头这么写，等于假定用户在拖延；但很多人
   只是正常开工，这个预设会让语气变成"我知道你在逃避哦"，跟产品「像朋友不像监工」的定位相反。
2. **加了 12 词长度上限**。这句话要塞进 220px 的气泡——真机上标题过长撑坏布局的坑刚踩过一次。
3. **显式要求英文输出**。v0 没写，用户用中文声明任务时模型很可能跟着回中文。

### v2 相比 v1 改了什么（B12，09-01）— 修的是 v1 自己引入的 bug

**真机复现（Jay 08-30）**：输入 `review computer network for the exam`，产出
`"Open the network textbook, flip to chapter 4."`——**哪本书、哪一章全是编的**。

**根因不是模型抽风，是 v1 的 prompt 在教它编**，而且**五处都在教**：

| # | v1 里的原文 | 问题 |
|---|---|---|
| ① | 规则2 "If you cannot name the thing, you are being too vague." | 逼一个不知道用户有哪本书的模型必须说出书名 |
| ② | 规则6 "hedging is worse than guessing." | 字面意思就是"编一个好过承认不知道" |
| ③ | Good 范例 "Pull up **lecture 5** slides…" | 范例自己在示范这个 bug |
| ④ | Good 范例 "…open to **chapter 3**." | 同上，3 个 Good 里占了 2 个 |
| ⑤ | （缺失） | 5 条 Bad 范例没有任何一条针对"编造事实" |

**更深一层**：v1 把"具体"和"真实"混为一谈了——**只要求了具体、没要求真实**。模型要同时
满足"具体" + "12 词内"，除了编没有别的出路。

v2 的三处改动：

1. **规则2 拆成两件事**：「必须物理具体」+「细节只能来自任务里真的给了的信息」，并且**给出
   泛化但真实的替代表述**（`"your notes"` / `"the material you have open"` / `"your textbook"`）。
   只说"不许编"而不给退路的话，模型夹在"不许编"和"必须具体"之间，只会退化成跟兜底文案
   差不多的废话——所以退路本身是必要的。
   **★ 但这个退路的内容选错了，当天就被真机推翻，见下面的 v3。**
2. **规则6 收窄"concrete"的定义**：保留「vague 任务也必须给一个动作，不许反问不许 hedge」
   （这部分设计是对的——单次调用没有第二轮，见 §1），但把 concrete 限定为**动作本身**
   （open / pick up / type / scroll），而不是虚构的事实。
3. **换 few-shot 范例**：2 条带编号的 Good 换成不带编号的表述，新增 1 条 Bad 直接用这次真机
   复现的原句。**★ 这是三处里最重要的一步**——few-shot 范例对模型行为的影响通常大于规则
   文字，只改规则文字、留着那两个"编号范例"大概率压不住。

### v3 相比 v2 改了什么（B12，09-01 同一天）— v2 的"泛化对象"退路本身是错的

**真机复现（Joy 09-01）**：输入 `I wanna prestudy my new course advanced data structure and algorithm`，
产出 `"Pick up your notes and read the first line."`——**预习一门新课，笔记按定义还不存在**。

守卫没拦、也没有编造章节号，v2 的两条防线**都按设计工作了**——问题出在设计本身。

**又是 prompt 教的**：v2 规则2 结尾那句退路写着

> point at something real but generic: **"your notes"**, "the material you have open", **"your textbook"**

产出几乎是**逐字照抄这个建议清单**。这是同一个诊断第三次成立：不是模型抽风，是 prompt 在教它。

**根因：v2 的分类维度选错了。** 当时以为分界线是「具体 vs 泛化」，真正的分界线是：

| 类别 | 例子 | 安全吗 |
|---|---|---|
| 需要用户**已经拥有** | `your notes` / `your textbook` / `your slides` | ❌ 全是对用户生活的猜测 |
| 用户**当场能造出来** | 空白文档 / 新标签页 / 一张白纸 / 一次搜索 | ✅ 100% 存在 |

`"your notes"` 不具体，但它**依然是个假设**——**不具体 ≠ 安全**。这是同一个错误的第二次变形。

v3 的三处改动：

1. **在规则之前先声明认知边界**，并把可用对象范围写死成两类（任务里给过的 / 当场能造的）：
   `"You know nothing about this person except the sentence above."`
   ★ 让模型知道**自己不知道什么**，比逐条禁止它说什么更省事，也更不容易被下一个没想到的
   场景绕过去——前两版都是"发现一类就禁一类"，这一版换成了正面圈定范围。
2. **删掉 v2 那个害人的建议清单**，换成「MAKE something or LOOK something up」。
3. **三条 Good 范例全换**——原来那三条里有两条自己就在假设拥有（`"your slides"`、
   `"your textbook"`）；新增反例用这次真机复现的原句。**又是范例在带头犯规**，跟 v2 那次一样。

### v4 相比 v3 改了什么（B12，09-01 还是同一天）— 前三版都在管"真不真实"，没人管"有没有用"

**真机复现（Joy 09-01）**：输入 `pre study for my new course data structure and algorithm`，
产出 `"Open a new doc, type down data structure and algorithm."`

**这个产出没有任何毛病**——不编造、不假设拥有、物理、一步、12 词内，**v3 的每条规则都过了**。
唯一的问题是它**什么也没推进**：把早就知道的课程名打进空文档，得到的东西跟十秒前一模一样。

**又是范例教的（第四次）**：v3 的 `Good #1` 就是 `"Open a blank doc and type just the title."`，
产出跟它是同一个句式模板；`Good #3` `"Write the topic name at the top of a blank page."` 得的是
同一种病。**当时只检查了范例"真不真实"，没检查它"有没有用"。**

**根因：前三版全在优化"真实性"这一个轴，没有任何一条规则要求"有用性"。**

| 动作 | 十秒后多了什么 |
|---|---|
| 搜大纲 / 打开课程页 / 读一行 | ✅ 真实材料被拉到眼前 |
| 写一句粗糙的开头 / 一行代码 | ✅ 产出了一小块真东西 |
| 把课名打一遍 / 给空文档起标题 | ❌ 信息量为零 |

v4 的两处改动：

1. **新增一条"必须推进任务"的规则**：`Ten seconds later they should HAVE something or KNOW
   something they did not before.`，并点名"打标题/写任务名/开空文件"是零信息量，给出两条
   合格路径（把真实材料拉到眼前 / 产出一小块真东西）。
   ★ **前三版都在收紧"不许说什么"，这条是第一次规定"必须做到什么"**——纯禁令改不出好答案，
   只能改出"安全的废话"。
2. **两条"起标题/写名字"型的 Good 换成会产出或揭示东西的**，新增反例用这次的原句。

**★ 值得记下来的模式**：v1→v4 每一版都修好了上一版的病、又引入一个新的。四次的直接原因
**全部是 few-shot 范例**（编号范例 → 假设拥有的范例 → 零信息量的范例）。结论不是"再改一版
范例就好了"，而是：**改 prompt 时必须把每条范例按当前所有维度重新过一遍，而不只是按这次
要修的那一维**。

### v5 相比 v4 改了什么（B12，09-01）— 不再改措辞，改成给它补信息

**这一版的触发不是手测，是第一次跑评测集的数字**（`evals/`，12 条用例）：

> **通过率 12/12（100%），但 SEARCH 形态占 83%。**

每一条都合规、每一条都过了全部规则，**而且十条里九条是同一个动作**：

| 任务 | 产出 | 问题 |
|---|---|---|
| `finish chapter 3 of the react docs` | "search for React docs chapter 3" | 人就在读那个文档 |
| `watch the recorded lecture from monday` | "search for recorded lecture Monday" | **公网根本搜不到私有课程录播** |
| `debug the login flow in our app` | "search for login flow debugging steps" | 搜"怎么做"不是做 |

**根因不是范例又选歪了，是四版约束叠起来把解空间挤到只剩一个点：**

| 版本 | 加的约束 | 砍掉了什么 |
|---|---|---|
| v2 | 不许编造细节 | 所有具体命名 |
| v3 | 只能用任务里给过的 / 当场能造的 | **所有已有材料** |
| v4 | 必须揭示或产出新东西 | "打开某物看一眼" |

交集里"去搜"几乎是唯一活口。**一个只知道任务字符串的模型，确实只能这么答。**

**决定性的一条证据**：那 12 条里唯一一条不搜索的好答案，是
`fix the failing tests in detector.test.ts` → `"Open detector.test.ts in your editor"`
——**唯一一条任务自己给了真实对象的用例**。给它可信的真实对象，它立刻就不搜了。

v5 的改动：

1. **新增 `anchorContext`（当前 tab 的 title + url）**，从 `handleOnboardingSubmit` →
   `runStarterCoach` → `StarterCoachLLMCall` 一路透传。这是整条链路上**唯一一份"不用猜"的
   真实信息**，它让 `OPEN_EXISTING` / `PLAY` / `READ` 这几种形态重新变成合法选项。
   - 接口是 `coach.ts` 内部的，**不走 FeatureFrame 那条缝**（红线4 不涉及）。
   - `runStarterCoach` **不判断相关性**——"这个页面跟任务有没有关系"是语义判断，交给
     prompt 里的模型（它同时看得到任务和标题，判据比平台层全）。
   - 内部页面（`chrome://extensions/` 之类）被 `isInternalBrowserUrl` 过滤成空 url 时**不传**，
     prompt 自动退回 v4 那条无上下文分支。
2. **★ 必配的防讨好补丁**：模型有强烈的"把给它的东西用上"倾向。只写"相关就用它"的话，
   `study neural networks` + 用户正开着 Gmail，很可能得到 `"Search your inbox for the course
   email."`——**那是编造换了个真实的锚，比凭空编章节号更难识破，因为对象确实存在**。
   所以同时写死了反向指令（`An open page is not automatically relevant… ignore it completely`）
   **和一条对应反例**。前四版的经验很清楚：**光有规则没有反例压不住，两者必须成对出现。**
3. **评测集配套加了 4 条用例**：2 条相关页面（期望不再搜索）、2 条无关页面（期望被完全忽略），
   并新增 `BORROWED_IRRELEVANT_PAGE` 规则自动检测"把无关页面硬凑进来"。
   形态分布现在**按有无当前页面分两组打印**——两组的差值就是 anchorContext 到底值不值。

**★ 原来那 12 条不带 anchor 的用例是对照组，不要给它们补 anchor**：拿不到当前 tab 的情况
一直存在，那条分支必须一直有人测。

### v5.1 相比 v5 改了什么（B12，09-02）— v5 跑分后补的一条窄缺口

**v5 首跑成绩（16 条用例）**：

| 分组 | 结果 | 判定 |
|---|---|---|
| 无当前页面（对照组，n=12） | SEARCH 83% | 跟基线一致——v5 对这组本来就不改，对照组正常 |
| **页面无关 · 期望忽略**（n=2） | Gmail→SEARCH、Nike→WRITE，`BORROWED_IRRELEVANT_PAGE` **零命中** | ✅ **2/2，防讨好补丁完全有效** |
| **页面相关 · 期望用上**（n=2） | 3b1b 视频→**PLAY**、react.dev→SEARCH | ⚠️ **1/2** |

两点值得记：

1. **`PLAY` 这个形态在 v1~v4 从来没出现过**——没有页面信息时它根本说不出口。anchorContext 确实打开了新的解空间。
2. **失败那条是 react.dev**：任务 `finish chapter 3 of the react docs` + 页面正开着 react.dev
   → `"Open a new tab and search for React docs chapter 3"`。**材料就在眼前，却被支去重新找一遍。**

**根因：规则 (a) 只说了半句。** `named in their task above — reuse it exactly` 要求了"复用这个名字"，
**没要求"直接打开它、别去搜它"**——模型老实复用了名字，然后套进它最熟的搜索模板。

对照组里那三条（react docs / transformer paper / Monday 录播）是同一个病，所以这一条补下去**同时打两组**。
其中 Monday 录播那条尤其要紧：**私有课程录播在公网上根本搜不到，那个动作执行下去必然失败**——不只是平淡，是错的。

v5.1 的改动（只动一处，便于下一轮跑分归因）：新增规则「任务已经点名的材料，直接 OPEN 不要 SEARCH」+ 两条对应反例。

**★ 同时修了指标本身**：v5 首跑我把"有当前页面"当成一组看，得出"50% SEARCH"——**这个读法是错的**，
因为无关页面那两条**本来就该退回搜索**。形态分布现在按 `none` / `use` / `ignore` 三组分开打印，
并新增 `IGNORED_OPEN_PAGE` 规则（标了 `anchorShouldBeUsed` 的用例产出仍是 SEARCH 就判失败）。
**指标设计错了比 prompt 写错更隐蔽——它会让你把成功读成失败，或者反过来。**

**为什么不加"追问具体章节"的二次 LLM 交互**（评估后否决，记下来免得下次重新辩论）：
契约 §5.5 对 `taskDeclaration` 只要求长度 ≥8 字符、不够则追问最多 2 轮，**是纯长度闸门，
不涉及语义**；`coach.ts` 的 `StarterCoachLLMCall` 是单次调用设计，`callGroq()` 单轮无历史。
加语义追问会：多一轮延迟 + 复用/污染契约明文只给长度检查用的那 2 轮预算 + 多一个"追问
问题本身也可能问不好"的新故障面——**超出这一个 bug 该有的改动范围**。

## 3. 输出约束

| 规则 | 实现 |
|---|---|
| 单次调用（拆解本身） | 拆解第一步物理动作这一步，每次起步教练流程最多 1 次 LLM 调用 |
| **总调用上限**（09-05 新增质量检查后） | 最多 3 次：任务质量检查最多触发 2 次（≤`MAX_FOLLOWUP_ROUNDS`）+ 拆解 1 次；长度闸门（<8 字符）不触发任何调用，见 §4.1 |
| 输出形状 | `{ firstAction: string }`，`coach.ts` 的 `StarterCoachLLMOutput` |
| 语言 | 英文项目，输出统一用英文 |
| 粒度 | "手能动"的具体动作，不是任务复述、不是多步计划 |
| 长度 | ≤12 词（v1 新增）——气泡宽 220px，超了会撑坏布局 |
| 拒绝计划类回答 | v1 新增——"先规划一下"是拖延伪装成准备，不算第一步 |
| **不得编造事实** | **v2 新增**——章节号/页码/书名/文件名只能来自 `taskDeclaration`，不许自己造 |
| **不得假设已拥有** | **v3 新增**——可用对象只有两类：任务里点名过的，或用户当场能造出来的（空白文档/新标签页/白纸/一次搜索）。`"your notes"` 这类"泛化但假设拥有"的说法一律不行 |
| **必须推进任务** | **v4 新增**——做完之后必须拥有或知道某样十秒前没有的东西；打标题/写任务名/开空文件属于零信息量，一律不行 |
| **可以用当前页面** | **v5 新增**——拿得到当前 tab 时多一类可用对象 `(c)`，相关就优先用它；**不相关必须完全忽略**（防讨好，配套反例 + `BORROWED_IRRELEVANT_PAGE` 规则） |
| **运行时守卫** | **v2 新增**——`hasFabricatedSpecific()` 见 §3.1 |
| 失败兜底 | 调用抛错/超时/**被守卫拦下** → `coach.ts` 捕获后用固定文案 `FIRST_ACTION_FALLBACK`（`"Don't overthink it — just open whatever you need, and that counts as starting."`）兜底，起步流程不因 LLM 故障卡死（分工v2.md §5 红线2同精神） |

### 3.1 运行时守卫 `hasFabricatedSpecific()`（v2 新增，第二道防线）

```ts
const FABRICATION_PATTERN = /\b(chapter|page|lecture|section|unit|module|slide|problem|exercise|week)\s+\d+\b/gi;
```

`groqStarterCoachCall` 在 `extractFirstAction()` 成功之后、`return` 之前查一遍：firstAction 里
出现了 `taskDeclaration` 里根本没给过的编号，就 `console.warn` + `throw`，**直接复用
`coach.ts` 已有的 try/catch → `FIRST_ACTION_FALLBACK`，不需要新架构**（`coach.ts`/`coach.test.ts`
这次一行没动）。

- **为什么值得加**：编造的具体细节恰好是这个产品最伤的一类错误——它出现在整场 demo 的**第一屏**，
  评委第一反应是"它怎么知道我有这本书"，比功能缺失更致命。
- **★ 明确的局限**：只挡得住**数字型编号**。编造书名（`"Open Tanenbaum and read the intro."`）、
  文件名这类非数字胡诌它一概挡不住——**这是第二道防线，不是完整方案，真正的修复靠 prompt**。
  这条局限本身写成了一条单测，免得以后有人误以为"已经修好了"。
- **已知的误杀方向**：任务写 `"ch. 3"` 而动作写 `"chapter 3"` 时会被判成编造，白白退化成兜底
  文案。接受这个代价——**误杀的后果是一句略平淡的兜底话，漏放的后果是当着评委的面撒谎**。

## 4. 追问话术（契约v4 §5.5，固定文案，不经 LLM）

```
Can you be a bit more specific? Something like "review data structures for tomorrow's exam."
```

- `taskDeclaration.length < 8` 且追问轮次 `< 2` → 弹出上面这句，不调用 LLM。
- 追问满 2 轮后，不管用户说得够不够具体，都接受输入往下走（契约原文："追问最多 2 轮，之后接受用户输入，避免僵住"）。

### 4.1 任务质量检查 `groqTaskQualityCheckCall`（09-05 新增，语义级"够不够具体"）

**为什么要加**：长度闸门只挡"太短"，挡不住"够长但空洞"——真机复现：`taskDeclaration`
`"adjust and test my hackathon project"`（够 8 字符）放行了，但完全没说项目叫什么、调哪部分。
后果不止是拆解出来的第一步动作会写得笼统：`classifier.ts` 的 `classifyDomainRelevance()`
全程只拿这一句话去跟每个页面的标题比对，声明本身空洞，会拖累**整场会话**的相关性判定
（真机上一个明明是本项目功能讨论的对话，标题"构建起步教练的心理学方法"，就是判不出关联，
长期卡 `UNKNOWN`）。

★ 这道检查关心"这句话撑不撑得起一整场会话的相关性判断"，**不是**"能不能靠它写出一个像样的
第一步动作"——后者拆解 prompt 能借助 `anchorContext`（当前页面）蒙混过去，但 `anchorContext`
只是起步那一刻的快照，不会被后续每一次分类复用；声明本身站不站得住才是关键，所以这个检查
**故意不传 `anchorContext`**，只看 `taskDeclaration`这句话本身。

**v2（09-05，真机反馈修正）**：v1（上面这版最早的版本，已被取代）上线后几乎每一次填写
起步任务都触发追问，包括"review data structure"、"study neural network"这类明明已经点了
名的主题也被拦下。根因是 v1 的反例"study for the exam"跟这些好例子长得太像（都是"动词 +
一两个词的名词短语"），模型很可能是照着句式在判，不是照着内容——v2 把结构几乎相同但答案
相反的一对例子（"study neural network" vs "study for the exam"）并排放，逼模型看内容不看
句式，并直接把 Jay 举的反例"test and update hackathon project"写进去。跟代码保持一致，
现在生产用的是这一版：

```
You judge whether a task description names a concrete enough SUBJECT to be used for an
entire work session to decide whether ANY webpage the person visits later is related to their
work — not just to write one first step for right now.

Their task: "{taskDeclaration}"

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
{"sufficient": boolean, "followupQuestion": string | null}
```

**接线**（`coach.ts` `runStarterCoach()`）：长度闸门之后、拆解调用之前插一道新闸门，共用
同一份 `roundsUsed` 预算和 `MAX_FOLLOWUP_ROUNDS=2` 封顶——不是给"语义不够具体"单独开一份
新的追问额度，契约"最多追问 2 轮"本来就是一个不可超支的总预算，不分是哪种原因触发的追问。
`sufficient:false` 且带了 `followupQuestion` 才会追问，展示的是模型给的针对性问题（比如
"Which part of the project are you adjusting?"），不是 §4 那句通用固定文案。

**Fail open**：这道检查是锦上添花，不是关键路径——`callGroq` 失败、解析不出来、或者
`sufficient:false` 却没给 `followupQuestion`（半成品结果），一律当成"够格"直接放行到拆解
那一步，绝不能让这道新加的检查本身出问题就把起步教练卡住（分工v2.md §5 红线2同精神）。
`groqTaskQualityCheckCall` 因此从不 `throw`，跟 `groqStarterCoachCall`（失败靠抛错、外层
`try/catch` 兜底）是两种不同的失败处理方式——前者失败了还有后半段拆解流程要走，不能拖累它；
后者本身就是流程的最后一步，抛错交给 `coach.ts` 统一兜底更简单。

`temperature: 0`（`groq.ts` `callGroq()` 09-05 新增的可选参数）：判"够不够具体"是个二选一
判断，一致性比多样性重要——跟 `classifier.ts` 同一个理由（真机复现过同一个标题两次分类
给出不同结果）。这个默认值只在显式传的时候生效，不影响拆解那次调用一直以来的行为。

## 5. 阶段一范围声明

- 这一版 LLM 调用**只**产出 `firstAction`，不兼职判断 `profile.archetype`——阶段一 profile 统一按
  `defaultSessionContext()` 的默认值（CREATOR）近似（`docs/契约v4.md` 三预设参数表下方注："教程跟练阶段一用 CREATOR 近似"）。
  archetype 推断/自定义组合是阶段二 B12（起步拆解 prompt 打磨）的范围，不在 B6 最小版里。
- `anchor`/`sessionWhitelist`/`graceUntil` 均沿用 `defaultSessionContext()` 已经测试过的兜底逻辑
  （`src/engine/metascenario.test.ts` 场景22），B6 只负责把校验通过的 `taskDeclaration` 和 LLM 产出的
  `firstAction` 接进这条已有的路径，不重新发明 `SessionContext` 的构造方式。

## 6. 怎么验证（v2 新增）

**prompt 质量本身没法自动化验证**——好不好只能人读。所以分成两层：

- **能自动化的部分**：
  - `hasFabricatedSpecific()` 是纯字符串函数，`src/platform/background/starter-coach.test.ts`
    测了 12 条（该拦的编号、该放行的用户自给细节、Good 范例、以及那条已知局限）。
  - **评测集（v5 起，`evals/`）**：16 条固定用例 + 11 条机械判据 + 形态分布，
    `npm run eval:coach` 批量打 Groq 出通过率。规则层自己也有 27 条离线单测（进 `npm test`）。
    **改 prompt 前后各跑一次，用数字代替感觉**——四版全靠肉眼、每次修一个坏一个就是这么来的。
  - **不测 `groqStarterCoachCall`/`callGroq`**，不破坏"chrome API 相关代码不做自动化测试"这条现有共识；
    跑分脚本打真实网络、结果非确定性，**永远不进 `npm test`**。
- **只能真机手测的部分**：4 个用例走一遍起步教练，看 SW 控制台的 `[Anchor SW] starter coach` 日志：

  | 用例 | 输入 | 看什么 |
  |---|---|---|
  | 原始复现 | `review computer network for the exam` | 不再出现编造的章节号/书名 |
  | 已带真实细节 | `finish chapter 3 of the react docs` | `chapter 3` 应当被**原样复用**，不该被守卫误杀成兜底文案 |
  | 很模糊但够 8 字符 | `study for the test` | 仍然给出一个动作，不反问、不 hedge、不退化成废话 |
  | 非学术类 | `write a blog post about my trip` | 编号词表在这类任务上不该有任何副作用 |
  | **相关页面**（v5 新增） | `study neural networks` + 开着 3b1b 视频页 | 期望"按下你已经开着的那个视频"，**不该再去搜一个新的** |
  | **无关页面**（v5 新增） | `study neural networks` + 开着 Gmail | ★ 防讨好：必须**完全忽略**那个页面，出现 inbox/mail/email 就是把无关页面硬凑进来 |
  | **零信息量**（v4 新增） | `pre study for my new course data structure and algorithm` | **不许出现"把课名打进空文档"这类做完等于没做的动作**——期望是把真实材料拉到眼前（搜大纲/查第一周内容）或产出一小块真东西 |
  | **全新领域**（v3 新增） | `I wanna prestudy my new course advanced data structure and algorithm` | **不许出现 `your notes` / `your textbook` 这类"假设你已经有"的对象**——一门还没开始的新课，什么都还不存在。期望形如 `"Open a new tab and search for the course syllabus."` |

  每一条同时回看 v1 已经修掉的 5 类失败模式（复述目标 / 伪装成计划 / 前置条件当动作 /
  一串步骤 / 加油打气式空话）**有没有被这次改动带回来**。
