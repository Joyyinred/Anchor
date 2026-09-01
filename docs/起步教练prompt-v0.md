# Anchor · 起步教练 Prompt v3（B6 产出 / B12 打磨）

> 对应表单任务：B6（Day 9–10 · v0）+ B12（阶段二 prompt 打磨 · v1 → v2 → v3）· 下游使用方：`src/engine/coach.ts` 的 `StarterCoachLLMCall` 注入点
> 上游契约：`docs/契约v4.md` §5.5 taskDeclaration 质量要求
> 本项目是英文项目：本文档里凡是用户会看到的文案（追问话术、LLM 输出、兜底文案、prompt 示例）一律英文，文档本身的说明性文字保持中文（跟团队其它内部文档一致）。

---

## 1. 调用时机

`runStarterCoach()` 只在 `taskDeclaration` 已经够格（≥8 字符，或追问已满 2 轮按契约兜底接受）之后，
调用**一次** LLM——追问本身是纯本地的长度判断，不占用这次调用。

## 2. Prompt v3（拆解第一步物理动作）

> ★ 以 `src/platform/background/starter-coach.ts` 的 `buildPrompt()` 为准。
> **08-29 发现本文档 v0 记的 prompt 跟代码里实际那版并不一致**（文档一份、代码一份，各写各的）——
> 以后改 prompt 请两边一起改，不然下次没人知道哪份是真的在跑。（09-01 v2/v3 同步均已照做。）

```text
You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "{taskDeclaration}"

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
{"firstAction": string}
```

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

**为什么不加"追问具体章节"的二次 LLM 交互**（评估后否决，记下来免得下次重新辩论）：
契约 §5.5 对 `taskDeclaration` 只要求长度 ≥8 字符、不够则追问最多 2 轮，**是纯长度闸门，
不涉及语义**；`coach.ts` 的 `StarterCoachLLMCall` 是单次调用设计，`callGroq()` 单轮无历史。
加语义追问会：多一轮延迟 + 复用/污染契约明文只给长度检查用的那 2 轮预算 + 多一个"追问
问题本身也可能问不好"的新故障面——**超出这一个 bug 该有的改动范围**。

## 3. 输出约束

| 规则 | 实现 |
|---|---|
| 单次调用 | 每次起步教练流程最多 1 次 LLM 调用；追问轮次不触发调用 |
| 输出形状 | `{ firstAction: string }`，`coach.ts` 的 `StarterCoachLLMOutput` |
| 语言 | 英文项目，输出统一用英文 |
| 粒度 | "手能动"的具体动作，不是任务复述、不是多步计划 |
| 长度 | ≤12 词（v1 新增）——气泡宽 220px，超了会撑坏布局 |
| 拒绝计划类回答 | v1 新增——"先规划一下"是拖延伪装成准备，不算第一步 |
| **不得编造事实** | **v2 新增**——章节号/页码/书名/文件名只能来自 `taskDeclaration`，不许自己造 |
| **不得假设已拥有** | **v3 新增**——可用对象只有两类：任务里点名过的，或用户当场能造出来的（空白文档/新标签页/白纸/一次搜索）。`"your notes"` 这类"泛化但假设拥有"的说法一律不行 |
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

## 5. 阶段一范围声明

- 这一版 LLM 调用**只**产出 `firstAction`，不兼职判断 `profile.archetype`——阶段一 profile 统一按
  `defaultSessionContext()` 的默认值（CREATOR）近似（`docs/契约v4.md` 三预设参数表下方注："教程跟练阶段一用 CREATOR 近似"）。
  archetype 推断/自定义组合是阶段二 B12（起步拆解 prompt 打磨）的范围，不在 B6 最小版里。
- `anchor`/`sessionWhitelist`/`graceUntil` 均沿用 `defaultSessionContext()` 已经测试过的兜底逻辑
  （`src/engine/metascenario.test.ts` 场景22），B6 只负责把校验通过的 `taskDeclaration` 和 LLM 产出的
  `firstAction` 接进这条已有的路径，不重新发明 `SessionContext` 的构造方式。

## 6. 怎么验证（v2 新增）

**prompt 质量本身没法自动化验证**——好不好只能人读。所以分成两层：

- **能自动化的部分**：`hasFabricatedSpecific()` 是纯字符串函数，`src/platform/background/starter-coach.test.ts`
  测了 12 条（该拦的编号、该放行的用户自给细节、v2 三条 Good 范例、以及那条已知局限）。
  **不测 `groqStarterCoachCall`/`callGroq`**，不破坏"chrome API 相关代码不做自动化测试"这条现有共识。
- **只能真机手测的部分**：4 个用例走一遍起步教练，看 SW 控制台的 `[Anchor SW] starter coach` 日志：

  | 用例 | 输入 | 看什么 |
  |---|---|---|
  | 原始复现 | `review computer network for the exam` | 不再出现编造的章节号/书名 |
  | 已带真实细节 | `finish chapter 3 of the react docs` | `chapter 3` 应当被**原样复用**，不该被守卫误杀成兜底文案 |
  | 很模糊但够 8 字符 | `study for the test` | 仍然给出一个动作，不反问、不 hedge、不退化成废话 |
  | 非学术类 | `write a blog post about my trip` | 编号词表在这类任务上不该有任何副作用 |
  | **全新领域**（v3 新增） | `I wanna prestudy my new course advanced data structure and algorithm` | **不许出现 `your notes` / `your textbook` 这类"假设你已经有"的对象**——一门还没开始的新课，什么都还不存在。期望形如 `"Open a new tab and search for the course syllabus."` |

  每一条同时回看 v1 已经修掉的 5 类失败模式（复述目标 / 伪装成计划 / 前置条件当动作 /
  一串步骤 / 加油打气式空话）**有没有被这次改动带回来**。
