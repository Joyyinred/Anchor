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

✅（08-25）A1234 全部完成。A1：`docs/MV3平台预研.md` 复核对齐契约§3.1/§5.1，无遗漏。A2：黑白名单兜底表转录进 `docs/分类prompt-v0.md`，`BUILTIN_ENTERTAINMENT_BLACKLIST` 扩充到10域（新增kuaishou/facebook/twitter/x/snapchat/pinterest）+ 补测试，48/48 测试绿。A3：MV3 扩展骨架落地——`manifest.json`+`vite.config.ts`（CRXJS）+ `tsconfig.engine.json`/`tsconfig.platform.json` 拆分（编译期强制引擎零 chrome 依赖），`npm run build` 产出结构正确，CDP 自动化验证确认 Chrome 加载后 service worker 成功注册。A4：`src/platform/background/{signals,heuristics,session}.ts` + `content-script.ts` 把 tabs/idle/webNavigation/交互事件组装成真实 `SignalEvent`（结构化 console.log 验证，未做持久化）。全程 `npm test` 保持 46→48/48 绿，两份 tsconfig typecheck 均干净。

✅（08-25）A2 黑名单复盘调整： 
- x.com/facebook.com/pinterest.com 存在真实任务相关用法（技术推文/专业社群/设计参考），不该域级一刀切拉黑——和 youtube/bilibili 一样属于"内容形态因页面而异"的混合站，应改走 LLM 内容级分类。已从 `BUILTIN_ENTERTAINMENT_BLACKLIST` 移除这三个域名（twitter.com 一并移除），新增纯被动娱乐的 netflix.com/hulu.com/disneyplus.com。黑名单：douyin/xiaohongshu/tiktok/instagram/kuaishou/snapchat/netflix/hulu/disneyplus。

- 购物/票务类站点也纳入黑名单：理由是边工作边网购/订票的场景本就极少，误判概率极小，即使误判也能靠 `sessionWhitelist` 低成本纠正回 `RELEVANT`。新增 taobao.com/tmall.com/jd.com/amazon.com/ctrip.com/12306.cn/ticketmaster.com 共7域，最终黑名单扩大到16域。补了黑名单硬判 + 白名单纠正两条测试。品牌官网"全部放进黑名单不现实"。只把**数量有限、体量巨大的头部聚合平台**纳入静态黑名单（新增 booking.com/getyourguide.com/zalando.com/temu.com ），品牌官网这类**数量不可枚举的长尾**明确不拉黑，交给已有的 LLM 内容级分类兜底（A8 接入前默认保守判 `UNKNOWN`）——这也更准确，因为品牌官网并非总是纯消费页面（如"调研运动品牌可持续策略"任务下 nike.com 就是相关的）。补了聚合平台黑名单测试 + 品牌长尾不拉黑（UNKNOWN）的对照测试，`docs/分类prompt-v0.md` §3.2 补充设计边界说明。52/52 测试绿。

- 网页小游戏站（poki/crazygames/miniclip/y8/addictinggames）符合黑名单标准——内容同质（即点即玩）、纯被动摸鱼消费、头部数量有限、误伤面接近零，且是浏览器内货真价实的游戏摸鱼场景。已纳入黑名单，最终扩大到25域。补了对应硬判测试，`docs/分类prompt-v0.md` §3.2 补充说明这批和 Steam/Epic/Twitch（因开发/QA/直播等专业用途不拉黑）的区别。53/53 测试绿。

✅（08-25）`/code-review [medium]` 跑了一轮今天的 diff，发现6条问题，先修了2条真实 bug：
①`src/engine/perceiver.ts` 的 `resolveContextRelevance` 对 `DEMO_PRESET_CACHE`/`sessionWhitelist`/`BUILTIN_ENTERTAINMENT_BLACKLIST` 都是精确字符串匹配 `event.domain`，但 `signals.ts` 的 `domainOf()` 取的是 `new URL(url).hostname`，真实流量基本都带 www. 前缀（`www.taobao.com`），导致今天扩的 25 域黑名单对真实访问基本是失效的。改成 `domainMatches()`（同域或其子域，按 `.` 边界匹配，仿照 `heuristics.ts` 的 `matchesDomain` 模式），三张表统一改用这个匹配方式。补了4条测试（黑名单/预置缓存/白名单命中 www. 子域 + notdouyin.com 这种伪装域名不会被误判）。
②`src/platform/background/signals.ts` 的 `currentTab` 只存在内存里，SW 被 MV3 回收后如果用户一直待在同一个 tab 不切换/不导航，永远没有事件能把它填回来，信号采集会悄悄哑掉——这正好是心跳机制本该兜底的场景。新增 `ensureCurrentTab()`：SW 每次（重新）启动时、心跳 alarm 触发时、收到 content script 消息时都会先查一次当前激活 tab 补全状态，不再干等一个可能不会来的 tab 切换事件。
57/57 测试绿，`typecheck:engine`/`typecheck:platform` 均干净，`npm run build` 正常出包。其余4条已记录但暂未修：

- **③`onActivated` 异步竞态**（`src/platform/background/signals.ts`）：`chrome.tabs.onActivated` 的监听器是异步的，`await chrome.tabs.get(tabId)` 拿到结果后无条件覆盖 `currentTab`，没检查这个 tab 是不是还是当前激活的那个。快速连续切 tab（比如 Alt+Tab 连按）时，先触发的 A tab 请求如果比后触发的 B tab 请求更晚 resolve，`currentTab` 就会被 A 的过期数据覆盖掉，尽管此刻真正在前台的是 B——domain/锚点判定会跟着错，直到下一次真正的 tab 切换才纠正回来。
- **④`isAnchorMatch` 的 `prefix` 模式没做 `.` 边界检查**（`src/platform/background/signals.ts`）：`prefix` 匹配模式用的是 `domain.endsWith(anchor.domain)`，和 `heuristics.ts` 里正确写法（`domain.endsWith('.' + d)`）不一样，缺了点号边界。举例：锚点是 `example.com`（VIEWER 档用 `prefix` 模式），用户其实在 `notexample.com` 或 `evil-example.com`，`domain.endsWith('example.com')` 依然是 true，会被误判成"在锚点上"。目前这条路径还没人真正触发（默认 SessionContext 写死是 `exact` 模式），是活着但还没暴露的 bug，等 VIEWER/`prefix` 场景真正接上就会出问题。
- **⑤两份 tsconfig 拆开后没有合并的 typecheck 命令**（`tsconfig.json`）：根 `tsconfig.json` 现在只 `extends` `tsconfig.engine.json`（只覆盖 `src/engine`/`src/mock`），`src/platform`/`src/sidepanel` 只有 `tsconfig.platform.json` 覆盖，但编辑器/裸 `tsc` 按目录就近查找 tsconfig 时找不到它。后果两头堵：编辑器打开 `src/platform` 下的文件会因为找不到 DOM/chrome 类型报一堆假错误；反过来，如果开发者习惯性只跑 `npm run typecheck:engine`，`src/platform` 里真实的类型错误也不会被拦下来，因为没有一个命令强制两边都测。
- **⑥`domainOf()` 在两个文件里各写了一份**（`src/platform/background/session.ts` 和 `signals.ts`）：完全一样的函数体重复了两次。目前的风险是维护成本，不是当下就会炸——但两份逻辑分开写，以后任何一次域名处理逻辑的调整（比如进一步规范化域名格式）都得记得两边一起改，漏改一边就会重新引入这类"数据格式不一致"的 bug。

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
| A1 | Day 1–2 | MV3 平台预研（权限声明、service worker 生命周期踩坑点） | ✅ | `docs/MV3平台预研.md`：manifest 权限表、SW 生命周期与状态恢复（对齐契约§3.1）、content script 注入策略、消息链路、entryIntent 可行性（对齐契约§5.1）、构建工具选型（CRXJS+Vite+TS） |
| A2 | Day 1–2 | 域名分类 prompt v0 + 本地黑白名单兜底表 | ✅ | `docs/分类prompt-v0.md`：分类 prompt + 输出约束 + 本地黑白名单兜底表；`src/engine/perceiver.ts` 的 `BUILTIN_ENTERTAINMENT_BLACKLIST` 最终定为25域（娱乐9域 + 购物票务11域 + 网页小游戏5域：poki/crazygames/miniclip/y8/addictinggames）——头部聚合/游戏平台拉黑，品牌官网长尾（Nike/Adidas等）和 x.com/facebook.com/pinterest.com/Steam/Twitch 这类混合站或有专业用途的站点均不拉黑，走 LLM 分类；补测试覆盖，53/53 测试绿；★ v4：演示域预置缓存表（`DEMO_PRESET_CACHE`） |
| A3 | Day 3 | MV3 扩展骨架搭建（manifest 权限、service worker 生命周期跑通） | ✅ | `manifest.json`+`vite.config.ts`（CRXJS）+ `tsconfig.engine.json`/`tsconfig.platform.json` 拆分 + `src/platform/background`（SW 生命周期/心跳/存储）+ `src/platform/content`（content script 占位）+ `src/sidepanel`（占位）。`npm run build` 产出 dist/ 结构正确；CDP 自动化验证确认 Chrome 加载后 service worker 成功注册（manifest 无报错）；交互式验证（content script 控制台日志、side panel 渲染）留给用户手动确认一遍。`npm test` 48/48 绿，两份 tsconfig 均 typecheck 干净 |
| A4 | Day 4 | 真实信号采集实现：`chrome.tabs`/`chrome.idle`/Visibility → `SignalEvent` | ✅ | `src/platform/background/{signals,heuristics,session}.ts` + `content-script.ts`：tabs.onActivated/onUpdated、idle.onStateChanged、webNavigation.onCommitted/onHistoryStateUpdated（SPA 跳转对齐契约§5.1 保守判 unknown）、keydown/scroll/visibility/video 交互采集，组装成 `SignalEvent` 结构化 console.log 输出（未做持久化，留给 A7）；默认 SessionContext（CREATOR 档、当前活动 tab 为锚点）支撑 isAnchor 计算；★ v4：`systemIdle`/`entryIntent` 均已采集 |
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

