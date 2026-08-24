# Anchor — 项目工作流程表单

> 基于《[分工v2.md](docs/分工v2.md)》（定稿 v4·双引擎半分法 · 契约对齐）+《[契约v4.md](docs/契约v4.md)》整理
> 不绑定 Day1/2/3 具体日期，按**依赖顺序**排列任务；每个任务有编号，完成后把状态改成 ✅，我会据此推进到下一项
> 状态：⬜ 待开始　🔄 进行中　✅ 已完成
> 覆盖范围：阶段一（核心引擎验证）+ 阶段二（深化 + demo/deck），对应 `分工v2.md` §3、§4
> ★ v4 对齐：契约 v4 已定稿（含 22 条审计修订），25 场景 mock 已就绪（`src/mock/events.json`）

## 日常更新日志
✅（08-24）测试工具链已搭好：`package.json` + TypeScript 5.9 + Vitest 3.2（`npm test` / `npm run test:watch`），`npm audit` 0 漏洞。

✅（08-24）感知半（`src/engine/perceiver.ts`）落地，25 场景 mock 全量端到端跑通（`src/engine/integration.test.ts`，23 条可测场景全绿，场景22/23 是独立函数验收暂跳过）——**J3 关键检查点一达成**。过程中顺带发现并修了 B 侧 `detector.ts` 的一个真 bug：`anchorDetachedThresholdMs`/`stuckThresholdMs` 在 DEMO_MODE 下没有走 `scaled()`，导致演示模式的阈值压缩没生效（已修复，契约v4 §3.2 要求的行为现在是对的）。

✅（08-24）代码审查（code-review）跑了一轮 `perceiver.ts`/`detector.ts`/`integration.test.ts` 的 diff，4 条发现全部确认为真并修复：①`computeJumpPattern` 含 UNKNOWN 域时误判 task_orbit，未按契约保守判 stable；②`computeStillnessMs` 没按当前页过滤，别的域上的一次交互会误把当前页的静止计时冲掉；③`TEXTURE_WINDOW_MS`/`SHORT_STAY_GRACE_MS` 在 DEMO_MODE 下没有走时间压缩（契约§3.2 要求"所有时间常数"都压）；④场景25 的测试只断言了最终动作，没有真正校验它声称要验证的 `lastAnchorSnapshot`。四条都已修复+补回归测试，46/46 测试绿、类型检查干净。

下一步：A7/A8（把 mock 事件源换成真实浏览器信号 + 真实 LLM 分类）与 B4/B6（桌宠组件、起步教练）

---

## 一、联合任务（A + B 共同，跨人的缝都在这里）

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| J1 | Day 1–2 | 共定三契约：`SignalEvent` / `FeatureFrame` / `SessionContext` | ✅ | 契约 v4 已定稿（`docs/契约v4.md`），含 22 条审计修订 |
| J2 | Day 1–2 | 准备两套 mock：`events.json`（A 用）+ `frames.json`（B 用） | ✅ | 代码核查：`events.json` 25 场景齐全；`frames.json` 覆盖场景 1-21/24 + metaScenarios 22/23，均已就绪 |
| J3 | Day 5 | 两半合流：感知半（A）+ 决策半（B）纯函数拼接，25 场景端到端全绿 | ✅ | `src/engine/integration.test.ts`：23/23 可测场景全绿（22/23 是独立函数验收，不适用），★关键检查点一达成 |
| J4 | Day 6–8 | 真实信号接入 + 桌宠组件进 MV3 side panel 联调 | ⬜ | 依赖 J3、A7、B4 |
| J5 | Day 8 | 真实浏览器复现两个反差瞬间（疯狂切 tab 不打扰 + 飘走触发 check-in） | ⬜ | ★关键检查点二；依赖 J4 |
| J6 | Day 9–10 | 确认 `SessionContext` 正确喂给 A 感知半（B→A 反向缝） | ⬜ | 依赖 J5、B6 |
| J7 | Day 10 | 端到端闭环验证：起步 → 陪伴 → 拉回 → 收尾反思 | ⬜ | 依赖 J6；过此项即阶段一验收通过 |
| J8 | 全程 | 每日/每周对齐小会（持续性任务，不是一次性完成） | 🔄 | 贯穿全程，防止各自封闭到最后接口不匹配 |
| J9 | Day 11+ | deck 骨架搭建，滚动填充真实进展截图/数据 | ⬜ | 从 J7 之后可启动，占评审 ~30% 分之一部分 |
| J10 | Day 15+ | demo 脚本初稿定稿 + 走查排练 | ⬜ | 依赖 J7，暴露"哪个反差瞬间演不稳"反推工程去补 |
| J11 | Day 20–23 | 录制备用 demo 视频 | ⬜ | 依赖 J10，现场触发有随机性，务必有兜底 |
| J12 | Day 24–25 | deck 定稿 + demo 视频定稿 + repo README/文档定稿提交 | ⬜ | 收尾，硬性提交物 |

---

## 二、A（感知侧）工作流程

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| A1 | Day 1–2 | MV3 平台预研（权限声明、service worker 生命周期踩坑点） | ⬜ | 可与 J1 并行独立开始 |
| A2 | Day 1–2 | 域名分类 prompt v0 + 本地黑白名单兜底表 | ⬜ | 覆盖 demo 用到的娱乐域/任务相关域；★ v4：演示域预置缓存表（`DEMO_PRESET_CACHE`） |
| A3 | Day 3 | MV3 扩展骨架搭建（manifest 权限、service worker 生命周期跑通） | ⬜ | 依赖 A1；平台风险先排，本项只求骨架能跑 |
| A4 | Day 4 | 真实信号采集实现：`chrome.tabs`/`chrome.idle`/Visibility → `SignalEvent` | ⬜ | 依赖 A3、J1（schema 已定）；★ v4：含 `systemIdle` 透传、`entryIntent` 采集 |
| A5 | Day 5 | 感知半四信号计算实现 → `FeatureFrame` | ✅ | `src/engine/perceiver.ts`：四信号 + entryIntent/contentFormat/lastAnchorSnapshot 齐全，可插拔分类缓存留 A8 接真 LLM |
| A6 | Day 5 | 单元测试：`events.json` → 断言 `FeatureFrame` 各字段正确 | ✅ | `src/engine/perceiver.test.ts`（20 项字段级单测）+ `integration.test.ts`（23 场景端到端）全绿；场景21 盲区修复已验证 |
| A7 | Day 6 | 真实 `SignalEvent` 流替换 mock，接入感知半 | ⬜ | 依赖 J3（两半合流验证过）、A4 |
| A8 | Day 6 | `classifyDomainRelevance` 真实 LLM 实现（异步 + 惰性 + 缓存） | ⬜ | 依赖 A2、A7；未判出前保持 `UNKNOWN`，绝不阻塞引擎（红线1） |
| A9 | Day 6 | 本地黑白名单兜底接入（断网/API 失败时的降级路径） | ⬜ | 依赖 A2、A8（红线2）；★ v4：演示域预置缓存表优先级高于 LLM |
| A10 | Day 7 | demo 要用到的域名预热进缓存 | ⬜ | 依赖 A8，演示前必做 |
| A11 | Day 7 | 协助桌宠组件接入 side panel（感知半→UI 消息链路：`chrome.runtime`/`chrome.storage`） | ⬜ | 对应 J4，A 侧负责部分 |
| A12 | Day 7 | 真实数据噪音处理：idle 抖动/tab 快切去抖节流 | ⬜ | 依赖 A7、J4 |
| A13 | Day 9–10 | 消费 `SessionContext`：`anchor` 驱动锚点判定（matchMode）、`sessionWhitelist` 短路分类、跨 profile 验证准确性 | ⬜ | 依赖 J6 |
| A14 | Day 11–14 | 【阶段二】内容级分类落地（youtube/reddit/slack 按 `domain+path+title` 判并缓存） | ⬜ | 依赖 J7，补最大漏洞 |
| A15 | Day 15–18 | 【阶段二】交互纹理精细化（keystroke/feed_scroll/media_seek 区分） | ⬜ | 依赖 A14 |
| A16 | Day 15–18 | 【阶段二】短视频流形态硬判 + 更多 `contentKind` | ⬜ | 依赖 A15 |
| A17 | Day 19–22 | 【阶段二】信号优雅降级（异常不崩、断网走本地兜底） | ⬜ | 依赖 A9 |
| A18 | Day 23–25 | 【阶段二】联调修 bug + 备技术 Q&A 数字（误报率、缓存命中率） | ⬜ | 依赖 A14-17、J9；★ v4：指标定义见 `docs/契约v4.md` §5.4 |

---

## 三、B（决策侧）工作流程

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| B1 | Day 3–5 | 决策半实现：置信度模型 + `applyProfileMuting` + `isDrifting` / `isStuck` 阈值 + 宽限期 → `DetectionResult` | 🔄 | `isDrifting`/`isStuck`/`evaluateFrame` 齐全，25 场景集成测试验证通过；08-24 修了一个真 bug——DEMO_MODE 下 `anchorDetachedThresholdMs`/`stuckThresholdMs` 未过 `scaled()`，已修复；仍缺 `defaultSessionContext`/`restReminderDue`（metaScenario 22/23 需要） |
| B2 | Day 3–5 | 自适应退让启发式（单会话，据 `CheckInFeedback` 调阈值） | 🔄 | 代码核查：`types.ts` 已有阶梯状态结构（`stuckLadderIndex`/`stuckThresholdMs`/`PROFILE_PRESETS`），但未见根据用户回答推进阶梯/更新 `restUntil`/`lastAnswerTs` 的处理函数 |
| B3 | Day 3–5 | 手写 `frames.json`：25 场景期望 `FeatureFrame` | ✅ | 代码核查：`src/mock/frames.json` 已就绪，含 `lastAnchorSnapshot`/`systemIdle` 相关场景 |
| B4 | Day 3–5 | 独立 React 桌宠组件（陪伴/观察/check-in 三态），暂不进扩展 | ⬜ | 可与 B1 并行独立开始 |
| B5 | Day 5 | 单元测试：`frames.json` → 断言 `DetectionResult` 动作正确 | ⬜ | 依赖 B1、B3 |
| B6 | Day 9–10 | 起步教练最小版：单次 LLM 调用出第一步物理动作 + 产出 `SessionContext` | ⬜ | 依赖 J1；对应 J6 的产出方；★ v4：`taskDeclaration` ≥8 字符追问义务 |
| B7 | Day 6–8 | check-in / 微重启措辞 v1（像朋友不像监工） | ⬜ | 依赖 B1，J5 前需备好；★ v4：措辞数据源 `lastAnchorSnapshot` |
| B8 | Day 6–8 | 协助桌宠组件接入 MV3 side panel | ⬜ | 对应 J4，B 侧负责部分 |
| B9 | Day 6–8 | 状态机建模（陪伴/观察/check-in，手写或 XState） | ⬜ | 依赖 B1，MVP 阶段手写足够 |
| B10 | Day 11–14 | 【阶段二】自适应退让打磨 | ⬜ | 依赖 B2、J7 |
| B11 | Day 15–18 | 【阶段二】check-in / 微重启措辞反复调 | ⬜ | 依赖 B7，demo 成败点之一 |
| B12 | Day 15–18 | 【阶段二】起步拆解 prompt 打磨 | ⬜ | 依赖 B6 |
| B13 | Day 15–18 | 【阶段二】桌宠三态动画 | ⬜ | 依赖 B4 |
| B14 | Day 15–18 | 【阶段二】check-in 交互 UI | ⬜ | 依赖 B7 |
| B15 | Day 19–22 | 【阶段二】收尾反思视图 + 角落专注时长显示（配角，别喧宾夺主） | ⬜ | 依赖 J7 |
| B16 | Day 19–22 | 【阶段二】`documentPictureInPicture` 悬浮桌宠（有余量才做） | ⬜ | 可选项，视进度决定是否启动 |
| B17 | Day 23–25 | 【阶段二】联调修 bug | ⬜ | 依赖 B10-15 |

---

## 使用方式

- 完成某项任务后告诉我编号（如"A5 完成了"），我会把对应行状态改成 ✅，并检查它解锁了哪些下游任务，提示你/团队下一步该推进什么。
- 如果某项卡住或需要调整顺序，直接说明情况，我会更新表单结构（不必拘泥于现在的编号顺序）。
- 五条不可逾越的稳定性红线（域名分类不阻塞引擎、本地黑白名单兜底、必录备用 demo 视频、`FeatureFrame` 缝改动当天必须同步、DEMO_MODE 时间压缩常量只在一个地方改）仍然适用，未单独编号，执行时对照《分工v2.md》§5。

