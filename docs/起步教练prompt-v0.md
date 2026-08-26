# Anchor · 起步教练 Prompt v0（B6 产出）

> 对应表单任务：B6（Day 9–10）· 下游使用方：`src/engine/coach.ts` 的 `StarterCoachLLMCall` 注入点
> 上游契约：`docs/契约v4.md` §5.5 taskDeclaration 质量要求
> 本项目是英文项目：本文档里凡是用户会看到的文案（追问话术、LLM 输出、兜底文案、prompt 示例）一律英文，文档本身的说明性文字保持中文（跟团队其它内部文档一致）。

---

## 1. 调用时机

`runStarterCoach()` 只在 `taskDeclaration` 已经够格（≥8 字符，或追问已满 2 轮按契约兜底接受）之后，
调用**一次** LLM——追问本身是纯本地的长度判断，不占用这次调用。

## 2. Prompt（拆解第一步物理动作）

```text
You are a friendly focus coach for a browser extension. The user just declared what they want to work on:

"{taskDeclaration}"

Break this down into ONE concrete, physical first action they can take in the next 30 seconds —
something their hand can literally do right now (open a specific app/file, write a specific first line,
pull up a specific document) — not a restatement of the goal, not "get started", not a multi-step plan.

Tone: like a friend nudging you to begin, not a supervisor issuing an instruction.

Bad example: "Start writing the essay" (just restates the task)
Good example: "Open Word and type the title"

Output format (JSON only, no extra text):
{"firstAction": "<one short sentence>"}
```

## 3. 输出约束

| 规则 | 实现 |
|---|---|
| 单次调用 | 每次起步教练流程最多 1 次 LLM 调用；追问轮次不触发调用 |
| 输出形状 | `{ firstAction: string }`，`coach.ts` 的 `StarterCoachLLMOutput` |
| 语言 | 英文项目，输出统一用英文 |
| 粒度 | "手能动"的具体动作，不是任务复述、不是多步计划 |
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

## 6. 已知不一致（未在本次改动范围内，供你判断要不要一并处理）

`src/engine/types.ts` 里 `DEFAULT_TASK_DECLARATION`（"无起步教练默认策略"兜底文案，契约v4 §2）目前仍是中文
`'未声明任务（默认陪伴模式）'`。它是用户跳过起步教练时会看到的文案，跟本次"英文项目统一用英文"的要求
是同一类字符串，但它属于既有文件、不在 B6 这次交付范围内，这里只标注，不直接改。