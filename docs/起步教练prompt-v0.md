# Anchor · 起步教练 Prompt v1（B6 产出 / B12 打磨）

> 对应表单任务：B6（Day 9–10 · v0）+ B12（阶段二 prompt 打磨 · v1）· 下游使用方：`src/engine/coach.ts` 的 `StarterCoachLLMCall` 注入点
> 上游契约：`docs/契约v4.md` §5.5 taskDeclaration 质量要求
> 本项目是英文项目：本文档里凡是用户会看到的文案（追问话术、LLM 输出、兜底文案、prompt 示例）一律英文，文档本身的说明性文字保持中文（跟团队其它内部文档一致）。

---

## 1. 调用时机

`runStarterCoach()` 只在 `taskDeclaration` 已经够格（≥8 字符，或追问已满 2 轮按契约兜底接受）之后，
调用**一次** LLM——追问本身是纯本地的长度判断，不占用这次调用。

## 2. Prompt v1（拆解第一步物理动作）

> ★ 以 `src/platform/background/starter-coach.ts` 的 `buildPrompt()` 为准。
> **08-28 发现本文档 v0 记的 prompt 跟代码里实际那版并不一致**（文档一份、代码一份，各写各的）——
> 以后改 prompt 请两边一起改，不然下次没人知道哪份是真的在跑。

```text
You are a warm, practical friend helping someone begin a work session.
Not a coach and not a manager — a friend who knows that starting is the hard part.

Their task: "{taskDeclaration}"

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
{"firstAction": string}
```

### v1 相比 v0 改了什么（B12）

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

## 3. 输出约束

| 规则 | 实现 |
|---|---|
| 单次调用 | 每次起步教练流程最多 1 次 LLM 调用；追问轮次不触发调用 |
| 输出形状 | `{ firstAction: string }`，`coach.ts` 的 `StarterCoachLLMOutput` |
| 语言 | 英文项目，输出统一用英文 |
| 粒度 | "手能动"的具体动作，不是任务复述、不是多步计划 |
| **长度** | **≤12 词**（v1 新增）——气泡宽 220px，超了会撑坏布局 |
| **拒绝计划类回答** | **v1 新增**——"先规划一下"是拖延伪装成准备，不算第一步 |
| **失败兜底** | 调用抛错/超时 → `coach.ts` 捕获后用固定文案 `FIRST_ACTION_FALLBACK`（`"Don't overthink it — just open whatever you need, and that counts as starting."`）兜底，起步流程不因 LLM 故障卡死（分工v2.md §5 红线2同精神） |

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