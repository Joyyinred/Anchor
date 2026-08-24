# Anchor — 项目工作流程表单

> 基于《[分工v2.md](docs/分工v2.md)》（定稿 v3·双引擎半分法）+《[Anchor_A_阶段一计划.md](Anchor_A_阶段一计划.md)》/《[Anchor_B_阶段一计划.md](Anchor_B_阶段一计划.md)》整理
> 不绑定 Day1/2/3 具体日期，按**依赖顺序**排列任务；每个任务有编号，完成后把状态改成 ✅，我会据此推进到下一项
> 状态：⬜ 待开始　🔄 进行中　✅ 已完成
> 覆盖范围：阶段一（核心引擎验证）+ 阶段二（深化 + demo/deck），对应 `分工v2.md` §3、§4

---

## 一、联合任务（A + B 共同，跨人的缝都在这里）

| 编号 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|
| J1 | 共定三契约：`SignalEvent` / `FeatureFrame` / `SessionContext` | ⬜ | 深度设计会，四信号精确定义 + 置信度判定式草图，唯一必须现场结对的事 |
| J2 | 准备两套 mock：`events.json`（A 用）+ `frames.json`（B 用） | ⬜ | 依赖 J1 |
| J3 | 两半合流：感知半（A）+ 决策半（B）纯函数拼接，5 场景端到端全绿 | ⬜ | ★关键检查点一；依赖 A5、B1 |
| J4 | 真实信号接入 + 桌宠组件进 MV3 side panel 联调 | ⬜ | 依赖 J3、A7、B4 |
| J5 | 真实浏览器复现两个反差瞬间（疯狂切 tab 不打扰 + 飘走触发 check-in） | ⬜ | ★关键检查点二；依赖 J4 |
| J6 | 确认 `SessionContext` 正确喂给 A 感知半（B→A 反向缝） | ⬜ | 依赖 J5、B6 |
| J7 | 端到端闭环验证：起步 → 陪伴 → 拉回 → 收尾反思 | ⬜ | 依赖 J6；过此项即阶段一验收通过 |
| J8 | 每日/每周对齐小会（持续性任务，不是一次性完成） | 🔄 | 贯穿全程，防止各自封闭到最后接口不匹配 |
| J9 | deck 骨架搭建，滚动填充真实进展截图/数据 | ⬜ | 从 J7 之后可启动，占评审 ~30% 分之一部分 |
| J10 | demo 脚本初稿定稿 + 走查排练 | ⬜ | 依赖 J7，暴露"哪个反差瞬间演不稳"反推工程去补 |
| J11 | 录制备用 demo 视频 | ⬜ | 依赖 J10，现场触发有随机性，务必有兜底 |
| J12 | deck 定稿 + demo 视频定稿 + repo README/文档定稿提交 | ⬜ | 收尾，硬性提交物 |

---

## 二、A（感知侧）工作流程

| 编号 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|
| A1 | MV3 平台预研（权限声明、service worker 生命周期踩坑点） | ⬜ | 可与 J1 并行独立开始 |
| A2 | 域名分类 prompt v0 + 本地黑白名单兜底表 | ⬜ | 覆盖 demo 用到的娱乐域/任务相关域 |
| A3 | MV3 扩展骨架搭建（manifest 权限、service worker 生命周期跑通） | ⬜ | 依赖 A1；平台风险先排，本项只求骨架能跑 |
| A4 | 真实信号采集实现：`chrome.tabs`/`chrome.idle`/Visibility → `SignalEvent` | ⬜ | 依赖 A3、J1（schema 已定） |
| A5 | 感知半四信号计算实现 → `FeatureFrame`（`anchorDetachedMs`/`texture`/`jumpPattern`/`classifyDomainRelevance` mock 版） | ⬜ | 依赖 J1；`classifyDomainRelevance` 先接固定 mock 表 |
| A6 | 单元测试：`events.json` → 断言 `FeatureFrame` 各字段正确 | ⬜ | 依赖 A5、J2 |
| A7 | 真实 `SignalEvent` 流替换 mock，接入感知半 | ⬜ | 依赖 J3（两半合流验证过）、A4 |
| A8 | `classifyDomainRelevance` 真实 LLM 实现（异步 + 惰性 + 缓存） | ⬜ | 依赖 A2、A7；未判出前保持 `UNKNOWN`，绝不阻塞引擎（红线1） |
| A9 | 本地黑白名单兜底接入（断网/API 失败时的降级路径） | ⬜ | 依赖 A2、A8（红线2） |
| A10 | demo 要用到的域名预热进缓存 | ⬜ | 依赖 A8，演示前必做 |
| A11 | 协助桌宠组件接入 side panel（感知半→UI 消息链路：`chrome.runtime`/`chrome.storage`） | ⬜ | 对应 J4，A 侧负责部分 |
| A12 | 真实数据噪音处理：idle 抖动/tab 快切去抖节流 | ⬜ | 依赖 A7、J4 |
| A13 | 消费 `SessionContext`：`anchor` 驱动锚点判定、`sessionWhitelist` 短路分类、跨 profile 验证准确性 | ⬜ | 依赖 J6 |
| A14 | 【阶段二】内容级分类落地（youtube/reddit/slack 按 `domain+path+title` 判并缓存） | ⬜ | 依赖 J7，补最大漏洞 |
| A15 | 【阶段二】交互纹理精细化（keystroke/feed_scroll/media_seek 区分） | ⬜ | 依赖 A14 |
| A16 | 【阶段二】短视频流形态硬判 + 更多 `contentKind` | ⬜ | 依赖 A15 |
| A17 | 【阶段二】信号优雅降级（异常不崩、断网走本地兜底） | ⬜ | 依赖 A9 |
| A18 | 【阶段二】联调修 bug + 备技术 Q&A 数字（误报率、缓存命中率） | ⬜ | 依赖 A14-17、J9 |

---

## 三、B（决策侧）工作流程

| 编号 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|
| B1 | 决策半实现：置信度模型 + `applyProfileMuting` + `isDrifting` 阈值 + 宽限期 → `DetectionResult` | ⬜ | 依赖 J1 |
| B2 | 自适应退让启发式（单会话，据 `CheckInFeedback` 调阈值） | ⬜ | 依赖 B1 |
| B3 | 手写 `frames.json`：5 场景期望 `FeatureFrame` | ⬜ | 依赖 J1，同时替 A 的感知半定验收标准 |
| B4 | 独立 React 桌宠组件（陪伴/观察/check-in 三态），暂不进扩展 | ⬜ | 可与 B1 并行独立开始 |
| B5 | 单元测试：`frames.json` → 断言 `DetectionResult` 动作正确 | ⬜ | 依赖 B1、B3 |
| B6 | 起步教练最小版：单次 LLM 调用出第一步物理动作 + 产出 `SessionContext` | ⬜ | 依赖 J1；对应 J6 的产出方 |
| B7 | check-in / 微重启措辞 v1（像朋友不像监工） | ⬜ | 依赖 B1，J5 前需备好 |
| B8 | 协助桌宠组件接入 MV3 side panel | ⬜ | 对应 J4，B 侧负责部分 |
| B9 | 状态机建模（陪伴/观察/check-in，手写或 XState） | ⬜ | 依赖 B1，MVP 阶段手写足够 |
| B10 | 【阶段二】自适应退让打磨 | ⬜ | 依赖 B2、J7 |
| B11 | 【阶段二】check-in / 微重启措辞反复调 | ⬜ | 依赖 B7，demo 成败点之一 |
| B12 | 【阶段二】起步拆解 prompt 打磨 | ⬜ | 依赖 B6 |
| B13 | 【阶段二】桌宠三态动画 | ⬜ | 依赖 B4 |
| B14 | 【阶段二】check-in 交互 UI | ⬜ | 依赖 B7 |
| B15 | 【阶段二】收尾反思视图 + 角落专注时长显示（配角，别喧宾夺主） | ⬜ | 依赖 J7 |
| B16 | 【阶段二】`documentPictureInPicture` 悬浮桌宠（有余量才做） | ⬜ | 可选项，视进度决定是否启动 |
| B17 | 【阶段二】联调修 bug | ⬜ | 依赖 B10-15 |

---

## 使用方式

- 完成某项任务后告诉我编号（如"A5 完成了"），我会把对应行状态改成 ✅，并检查它解锁了哪些下游任务，提示你/团队下一步该推进什么。
- 如果某项卡住或需要调整顺序，直接说明情况，我会更新表单结构（不必拘泥于现在的编号顺序）。
- 四条不可逾越的稳定性红线（域名分类不阻塞引擎、本地黑白名单兜底、必录备用 demo 视频、`FeatureFrame` 缝改动当天必须同步）仍然适用，未单独编号，执行时对照《分工v2.md》§5。