# Anchor — 项目工作流程表单

> 基于《[分工v2.md](docs/分工v2.md)》（定稿 v4·双引擎半分法 · 契约对齐）+《[契约v4.md](docs/契约v4.md)》整理
> 不绑定 Day1/2/3 具体日期，按**依赖顺序**排列任务；每个任务有编号，完成后把状态改成 ✅，我会据此推进到下一项
> 状态：⬜ 待开始　🔄 进行中　✅ 已完成
> 覆盖范围：阶段一（核心引擎验证）+ 阶段二（深化 + demo/deck），对应 `分工v2.md` §3、§4
> ★ v4 对齐：契约 v4 已定稿（含 22 条审计修订），25 场景 mock 已就绪（`src/mock/events.json`）

## 日常更新日志
✅（08-24/Jay）测试工具链已搭好：`package.json` + TypeScript 5.9 + Vitest 3.2（`npm test` / `npm run test:watch`），`npm audit` 0 漏洞。

✅（08-24/Jay）感知半（`src/engine/perceiver.ts`）落地，25 场景 mock 全量端到端跑通（`src/engine/integration.test.ts`，23 条可测场景全绿，场景22/23 是独立函数验收暂跳过）——**J3 关键检查点一达成**。过程中顺带发现并修了 B 侧 `detector.ts` 的一个真 bug：`anchorDetachedThresholdMs`/`stuckThresholdMs` 在 DEMO_MODE 下没有走 `scaled()`，导致演示模式的阈值压缩没生效（已修复，契约v4 §3.2 要求的行为现在是对的）。

✅（08-24/Jay）代码审查（code-review）跑了一轮 `perceiver.ts`/`detector.ts`/`integration.test.ts` 的 diff，4 条发现全部确认为真并修复：①`computeJumpPattern` 含 UNKNOWN 域时误判 task_orbit，未按契约保守判 stable；②`computeStillnessMs` 没按当前页过滤，别的域上的一次交互会误把当前页的静止计时冲掉；③`TEXTURE_WINDOW_MS`/`SHORT_STAY_GRACE_MS` 在 DEMO_MODE 下没有走时间压缩（契约§3.2 要求"所有时间常数"都压）；④场景25 的测试只断言了最终动作，没有真正校验它声称要验证的 `lastAnchorSnapshot`。四条都已修复+补回归测试，46/46 测试绿、类型检查干净。

✅（08-25/Jay）A1234 全部完成。A1：`docs/MV3平台预研.md` 复核对齐契约§3.1/§5.1，无遗漏。A2：黑白名单兜底表转录进 `docs/分类prompt-v0.md`，`BUILTIN_ENTERTAINMENT_BLACKLIST` 扩充到10域（新增kuaishou/facebook/twitter/x/snapchat/pinterest）+ 补测试，48/48 测试绿。A3：MV3 扩展骨架落地——`manifest.json`+`vite.config.ts`（CRXJS）+ `tsconfig.engine.json`/`tsconfig.platform.json` 拆分（编译期强制引擎零 chrome 依赖），`npm run build` 产出结构正确，CDP 自动化验证确认 Chrome 加载后 service worker 成功注册。A4：`src/platform/background/{signals,heuristics,session}.ts` + `content-script.ts` 把 tabs/idle/webNavigation/交互事件组装成真实 `SignalEvent`（结构化 console.log 验证，未做持久化）。全程 `npm test` 保持 46→48/48 绿，两份 tsconfig typecheck 均干净。

✅（08-25/Jay）A2 黑名单复盘调整： 
- x.com/facebook.com/pinterest.com 存在真实任务相关用法（技术推文/专业社群/设计参考），不该域级一刀切拉黑——和 youtube/bilibili 一样属于"内容形态因页面而异"的混合站，应改走 LLM 内容级分类。已从 `BUILTIN_ENTERTAINMENT_BLACKLIST` 移除这三个域名（twitter.com 一并移除），新增纯被动娱乐的 netflix.com/hulu.com/disneyplus.com。黑名单：douyin/xiaohongshu/tiktok/instagram/kuaishou/snapchat/netflix/hulu/disneyplus。

- 购物/票务类站点也纳入黑名单：理由是边工作边网购/订票的场景本就极少，误判概率极小，即使误判也能靠 `sessionWhitelist` 低成本纠正回 `RELEVANT`。新增 taobao.com/tmall.com/jd.com/amazon.com/ctrip.com/12306.cn/ticketmaster.com 共7域，最终黑名单扩大到16域。补了黑名单硬判 + 白名单纠正两条测试。品牌官网"全部放进黑名单不现实"。只把**数量有限、体量巨大的头部聚合平台**纳入静态黑名单（新增 booking.com/getyourguide.com/zalando.com/temu.com ），品牌官网这类**数量不可枚举的长尾**明确不拉黑，交给已有的 LLM 内容级分类兜底（A8 接入前默认保守判 `UNKNOWN`）——这也更准确，因为品牌官网并非总是纯消费页面（如"调研运动品牌可持续策略"任务下 nike.com 就是相关的）。补了聚合平台黑名单测试 + 品牌长尾不拉黑（UNKNOWN）的对照测试，`docs/分类prompt-v0.md` §3.2 补充设计边界说明。52/52 测试绿。

- 网页小游戏站（poki/crazygames/miniclip/y8/addictinggames）符合黑名单标准——内容同质（即点即玩）、纯被动摸鱼消费、头部数量有限、误伤面接近零，且是浏览器内货真价实的游戏摸鱼场景。已纳入黑名单，最终扩大到25域。补了对应硬判测试，`docs/分类prompt-v0.md` §3.2 补充说明这批和 Steam/Epic/Twitch（因开发/QA/直播等专业用途不拉黑）的区别。53/53 测试绿。

✅（08-25/Jay）`/code-review [medium]` 跑了一轮今天的 diff，发现6条问题，先修了2条真实 bug：
①`src/engine/perceiver.ts` 的 `resolveContextRelevance` 对 `DEMO_PRESET_CACHE`/`sessionWhitelist`/`BUILTIN_ENTERTAINMENT_BLACKLIST` 都是精确字符串匹配 `event.domain`，但 `signals.ts` 的 `domainOf()` 取的是 `new URL(url).hostname`，真实流量基本都带 www. 前缀（`www.taobao.com`），导致今天扩的 25 域黑名单对真实访问基本是失效的。改成 `domainMatches()`（同域或其子域，按 `.` 边界匹配，仿照 `heuristics.ts` 的 `matchesDomain` 模式），三张表统一改用这个匹配方式。补了4条测试（黑名单/预置缓存/白名单命中 www. 子域 + notdouyin.com 这种伪装域名不会被误判）。
②`src/platform/background/signals.ts` 的 `currentTab` 只存在内存里，SW 被 MV3 回收后如果用户一直待在同一个 tab 不切换/不导航，永远没有事件能把它填回来，信号采集会悄悄哑掉——这正好是心跳机制本该兜底的场景。新增 `ensureCurrentTab()`：SW 每次（重新）启动时、心跳 alarm 触发时、收到 content script 消息时都会先查一次当前激活 tab 补全状态，不再干等一个可能不会来的 tab 切换事件。
57/57 测试绿，`typecheck:engine`/`typecheck:platform` 均干净，`npm run build` 正常出包。其余4条已记录但暂未修：

- **③`onActivated` 异步竞态**（`src/platform/background/signals.ts`）：`chrome.tabs.onActivated` 的监听器是异步的，`await chrome.tabs.get(tabId)` 拿到结果后无条件覆盖 `currentTab`，没检查这个 tab 是不是还是当前激活的那个。快速连续切 tab（比如 Alt+Tab 连按）时，先触发的 A tab 请求如果比后触发的 B tab 请求更晚 resolve，`currentTab` 就会被 A 的过期数据覆盖掉，尽管此刻真正在前台的是 B——domain/锚点判定会跟着错，直到下一次真正的 tab 切换才纠正回来。
- **④`isAnchorMatch` 的 `prefix` 模式没做 `.` 边界检查**（`src/platform/background/signals.ts`）：`prefix` 匹配模式用的是 `domain.endsWith(anchor.domain)`，和 `heuristics.ts` 里正确写法（`domain.endsWith('.' + d)`）不一样，缺了点号边界。举例：锚点是 `example.com`（VIEWER 档用 `prefix` 模式），用户其实在 `notexample.com` 或 `evil-example.com`，`domain.endsWith('example.com')` 依然是 true，会被误判成"在锚点上"。目前这条路径还没人真正触发（默认 SessionContext 写死是 `exact` 模式），是活着但还没暴露的 bug，等 VIEWER/`prefix` 场景真正接上就会出问题。
- **⑤两份 tsconfig 拆开后没有合并的 typecheck 命令**（`tsconfig.json`）：根 `tsconfig.json` 现在只 `extends` `tsconfig.engine.json`（只覆盖 `src/engine`/`src/mock`），`src/platform`/`src/sidepanel` 只有 `tsconfig.platform.json` 覆盖，但编辑器/裸 `tsc` 按目录就近查找 tsconfig 时找不到它。后果两头堵：编辑器打开 `src/platform` 下的文件会因为找不到 DOM/chrome 类型报一堆假错误；反过来，如果开发者习惯性只跑 `npm run typecheck:engine`，`src/platform` 里真实的类型错误也不会被拦下来，因为没有一个命令强制两边都测。
- **⑥`domainOf()` 在两个文件里各写了一份**（`src/platform/background/session.ts` 和 `signals.ts`）：完全一样的函数体重复了两次。目前的风险是维护成本，不是当下就会炸——但两份逻辑分开写，以后任何一次域名处理逻辑的调整（比如进一步规范化域名格式）都得记得两边一起改，漏改一边就会重新引入这类"数据格式不一致"的 bug。

✅（08-26/Jay）把 08-25 code review 剩下的③④⑤⑥四条也修了：
- **③`onActivated` 异步竞态** → `src/platform/background/signals.ts` 新增单调递增的 `activationSeq` 序号，`await chrome.tabs.get(tabId)` 前打卡、resolve 后核对还是不是最新一次，不是就放弃提交，不再让过期请求覆盖新数据。顺手发现 `ensureCurrentTab()` 也是同一类"await 前后没重新检查"的竞态（等查询期间可能已经有一次真正的 `onActivated` 把 `currentTab` 填上了），一并补了 await 后的二次判空。
- **④`isAnchorMatch` 的 `prefix` 模式无 `.` 边界检查** → 把 `perceiver.ts` 里 fix #1 用的 `domainMatches()` 导出，`signals.ts` 直接复用它做 `prefix` 匹配（不再自己写一份不带边界判断的版本），顺带把 `heuristics.ts` 的 `matchesDomain()` 也改成基于同一个 `domainMatches()`，三处判断逻辑收敛成一处。
- **⑤缺合并 typecheck 命令** → `package.json` 新增 `"typecheck": "npm run typecheck:engine && npm run typecheck:platform"` 一条命令测两边；另外在 `src/platform/tsconfig.json`、`src/sidepanel/tsconfig.json` 各放一个 `extends: "../../tsconfig.platform.json"` 的小文件，编辑器按目录就近查找 tsconfig 时能直接找到对的那份，不会再对着没有 DOM/chrome 类型的根配置报假错误。
- **⑥`domainOf()` 重复定义** → 新建 `src/platform/background/domain.ts` 统一导出 `domainOf()`，`session.ts`/`signals.ts` 都改成从这里 import，删掉各自的本地副本。

`npm run typecheck`（新命令，两边一起测）、`npm test`（57/57）、`npm run build` 全部过。今天没有为③④额外补自动化测试——`domainMatches` 本身的边界行为已经在 `perceiver.test.ts` 里覆盖（含 `notdouyin.com` 这种伪装域名的对照测试），`signals.ts` 这层是真实 chrome API 代码，仓库目前没有 chrome API mock 的测试基建，属于遗留缺口，不是今天这次改动引入的。

✅（08-26/Jay）A7：真实 `SignalEvent` 流接入感知半，替换 mock `events.json` 那条测试专用路径（`docs/分工v2.md` Day6-8 既定安排，`FeatureFrame` 缝早已约定，B 的决策半 `detector.ts` 一行没改）。
- 新增 `src/platform/background/frame-pipeline.ts`：维护一份事件历史（内存 + `chrome.storage.local` 持久化，按会话 id 分 key），每次 `signals.ts` 产出新 `SignalEvent` 就把它计入历史，再用完整历史跑一次 `computeFeatureFrame`，产出真实 `FeatureFrame`。历史持久化是 A4 当时特意留到今天补的（SW 被回收后内存数组会归零，跟 `currentTab` 用 `ensureCurrentTab()` 补状态是同一套"重新水合"思路），加载用同一个"第一次用到前查一次 storage"模式。事件历史裁剪到最近 4 小时/500 条以内，避免真实长会话下无限增长。
- `signals.ts` 的 `emitSignalEvent()` 现在会调用 `recordEventAndComputeFrame()`，控制台同时打印 `SignalEvent` 和算出来的 `FeatureFrame`，用于手动验证感知半在真实信号下算出的四信号（`contextRelevance`/`anchorDetachedMs`/`texture`/`jumpPattern`）是否合理。
- 域名分类沿用 A2/A9 已有的黑白名单兜底（`DEMO_PRESET_CACHE`/`BUILTIN_ENTERTAINMENT_BLACKLIST`），LLM 分类缓存暂时是个空 `Map`——A8（真实 LLM 分类）还没接，未命中一律保守 `UNKNOWN`，符合红线1。
- 时间戳直接复用 `Date.now()`（真实 epoch 毫秒），不做相对时间转换：`computeFeatureFrame` 内部所有判断都是"两个时间戳的差值"，只要事件时间戳和传入的 `now` 用的是同一个时钟就自洽，不依赖 mock 测试里"会话起点=0"这个约定本身。
- 验证：`npm run typecheck`（两边干净）、`npm test`（57/57，本次改动没碰 `src/engine`，数量不变）、`npm run build`（16 模块，新增的 `frame-pipeline.ts` 被正常打包）。没有为 `frame-pipeline.ts` 补自动化测试——它和 `signals.ts` 一样依赖真实 `chrome.storage.local`，仓库目前没有 chrome API mock 的测试基建（同 08-26 早些时候记录的遗留缺口）。

✅（08-26/Jay）合并 `B4` → `J4`：Joy 的 B1（`defaultSessionContext`/`restReminderDue`）、B2（`applyCheckInFeedback`）、B4（`src/pet/` 桌宠组件 + Lottie）三块工作并入当前分支，`ort` 策略自动合并、无冲突。合并后验证：`npm run typecheck` 两边干净，`npm test` **78/78 全绿**（新增 Joy 的 `b2.test.ts` 6 条 + `metascenario.test.ts` 15 条）

✅（08-26/Jay）`/code-review` 跑了一轮合并后的 diff，发现10条问题：
- **①`createRestState()` 没有任何调用方把返回值写回 `BState.restUntil`**（`src/engine/detector.ts`）：函数文档说"写了 restUntil 就能让 isDrifting/isStuck 静默"，但仓库里只有测试手写死值，真实链路没接上——"休息"功能目前点了也不生效，DRIFT/STUCK 该提醒照样提醒。
- **②`state.lastCheckInTs` 从未被写入过**（`detector.ts`）：同样只有测试手写。5 分钟冷却闸门 `now - state.lastCheckInTs < CHECKIN_COOLDOWN_MS` 因为 `lastCheckInTs` 永远是初始值 `-Infinity` 而恒为 false，冷却机制形同虚设，`applyCheckInFeedback` 真正接上 UI 后同一帧可能连续触发多次 check-in。
- **③`restReminderDue()` 用精确取模判断提醒时机**（`detector.ts`）：`(elapsed - 首次提醒延迟) % 重复间隔 === 0`，只有心跳节拍和用户点"休息"的时刻严格对齐才会命中；真实心跳是固定节拍闹钟，跟随机时刻点击基本对不上，实际大概率永远不触发（单测能过是因为传的都是整数倍时间点）。
- **④`src/pet/cat.tsx` check-in 按钮隐藏态仍可被键盘 tab 到并触发**：可点性只判断 `onAnswer` 是否传值，不判断 `state === 'checkin'`；隐藏用的是 CSS `opacity`/`pointer-events` 而非 `display:none`，键盘用户能在气泡不可见时把 `onAnswer` 触发出去。
- **⑤`applyCheckInFeedback` 阶梯为空数组（VIEWER 档）时静默跳过重置**（`detector.ts`）：STUCK 通道答"飘了"本该无条件重置回第0格，代码里包了 `ladderLen > 0` 才重置，运行时切到 VIEWER 档会导致这条重置悄悄不生效。
- **⑥`defaultSessionContext()` 浅拷贝导致 `stuckLadderMs` 数组和全局预设共享引用**（`src/engine/types.ts`）：`validatePolicy({ ...PROFILE_PRESETS.CREATOR })` 只展开一层，数组本身仍是同一个引用，注释声称的"防御性拷贝"没做到，未来原地修改某会话的阶梯会连带污染全局预设。
- **⑦`src/devpreview/` 本地预览工具路径写错，根本跑不起来**：`main.tsx` 的 `'../src/pet/cat'` 多写了一层 `src/`（应为 `'../pet/cat'`），`Devpreview.vite.config.ts` 的 `root` 也应为 `'src/devpreview'` 而非 `'devpreview'`——这才是"连不上本地预览"的真实原因，不是防火墙/安全软件问题。
- **⑧`defaultSessionContext()` 和 `session.ts` 现有默认会话逻辑重复维护**：`session.ts` 的 `getOrInitSessionContext()` 没有改成调用新写好的 `defaultSessionContext()`，两处独立维护同一份"无起步教练默认策略"，容易改一处忘另一处。
- **⑨`CheckInAnswer` 类型在 `src/pet/types.ts`/`src/engine/types.ts` 各写一份，且 `CuteAnchorPet.onAnswer` 不回传 `channel`**：两个字面量类型没有共享引用会静默漂移；桌宠组件要接到 `applyCheckInFeedback`（需要完整 `CheckInFeedback = {channel, answer}`）时，`channel` 从哪来还没设计。
- **⑩（小问题）`ladderLen > 0` 判断在 `applyCheckInFeedback` 两个分支里各写一遍**，可以提到外层包一次，避免以后加第三种回答类型时漏包。
- 这轮只做记录，未改代码。

✅（08-26/Jay）修了①②③——这三条的共同点是"纯函数本身写对了，但没有一个自然会被记住去接线的地方"，所以这次的修法都是**改 API 形状，让接线这一步不再需要人记住**：
- **①** `createRestState()` 改名 `startRest(state, now)`，从"返回一个调用方要自己记得回填两处的 `RestState` 对象"改成直接**就地写 `state.restUntil`/新增的 `state.restStartTs`**（跟 `applyCheckInFeedback` 已经在用的"就地改 state 并返回"是同一个模式）。`BStatePersistable`/`BState`（`types.ts`/`detector.ts`）都加了 `restStartTs` 字段——这是顺带补的一个真缺口：原来的 `RestState.restStartTs` 根本没地方持久化，`restReminderDue` 需要的这个值原来注定活不过一次 SW 回收。
- **②** `evaluateFrame()` 在判定要返回 `CHECK_IN_DRIFT`/`CHECK_IN_STUCK` 的那一刻，直接 `state.lastCheckInTs = now`——这就是"UI 真正弹出一次 check-in"的那个时刻，不用等平台层以后接线时再想起来还有这一步。冷却闸门现在真的会拦下来了。
  - 副作用（预期内，不是新 bug）：`integration.test.ts` 原来断言"整条时间轴走到底时最后采样到的动作"，这个断言方式其实是在无意中依赖冷却闸门是坏的（闸门死的时候，一旦证据满足就会一直重复报同一个动作，"最后一帧"和"报没报过"是一回事）。闸门修好后，check-in 触发一次就会正确进入冷却、之后的帧合理地变回 `DO_NOTHING`——所以把断言方式改成："期望 `DO_NOTHING` 的场景整条时间轴都不该报一次 check-in；期望 `CHECK_IN_*` 的场景只要报过一次就算过"，这个断言方式本身也比原来更贴合"expectedAction 到底有没有发生过"这个意图。
- **③** `restReminderDue()` 从"经过时长精确整除"改成"落在提醒节拍附近一个心跳节拍宽度（`REST_REMINDER_TOLERANCE_MS = 60_000`）内"，`frames.json` metaScenario 23 给的 15/17/20/25 分钟四个断言点原样验证通过（17min 明确要求 false，1 分钟容差不会让它变成 true）。加了一条新单测直接断言"`startRest` 是就地写 state，不是返回游离对象"。
- 验证：`npm run typecheck` 两边干净，`npm test` **79/79 全绿**（`integration.test.ts` 断言方式调整后仍是 23 条场景全过，`metascenario.test.ts` 因新增一条断言变成 16 条），`npm run build` 正常出包。

修了④⑤⑥：
- **④`src/pet/cat.tsx` check-in 按钮键盘可达性** → 按钮渲染条件从 `{onAnswer && (...)}` 改成 `{state === 'checkin' && onAnswer && (...)}`，不在 checkin 态时按钮压根不进 DOM，不再依赖 CSS `opacity`/`pointer-events` 单挡鼠标却挡不住键盘 tab。桌宠组件目前没有测试基建（没接 jsdom/@testing-library/react），这条没能补自动化测试，纯代码改动 + 人工核对 JSX 逻辑。
- **⑤`applyCheckInFeedback` 阶梯为空数组时静默跳过重置** → STUCK+DRIFTED 分支去掉 `ladderLen > 0` 守卫，`stuckLadderIndex` 无条件归零；`stuckThresholdMs` 优先取 `policy.stuckLadderMs[0]`，取不到（空数组，如 VIEWER 档）时退回 `DEFAULT_STUCK_LADDER[0]`，和 `validatePolicy()` 对空阶梯的兜底策略保持一致，不再留下"跟已微重启的事实不符"的旧索引/旧阈值。补了一条 VIEWER 档回归测试。
- **⑥`defaultSessionContext()`/`validatePolicy()` 浅拷贝导致数组共享** → 两处都改成显式展开 `stuckLadderMs` 数组（`[...PROFILE_PRESETS.CREATOR.stuckLadderMs]`、`[...DEFAULT_STUCK_LADDER]`），不再是浅拷贝对象却共享数组引用。补了两条回归测试：改动 `defaultSessionContext()` 返回的 policy 不会污染 `PROFILE_PRESETS.CREATOR`；`validatePolicy()` 兜底空阶梯时也不会把 `DEFAULT_STUCK_LADDER` 这个模块常量本身暴露给调用方修改。
- 验证：`npm run typecheck` 两边干净，`npm test` **82/82 全绿**（新增 3 条回归测试），`npm run build` 正常出包。

修了⑦⑧⑨，⑩确认已经在修⑤时顺带解决：
- **⑦`src/devpreview/` 路径写错** → `main.tsx` 的 `'../src/pet/cat'` 改成 `'../pet/cat'`；`Devpreview.vite.config.ts` 的 `root` 从 `'devpreview'` 改成 `'src/devpreview'`。改完实际起了一次预览服务器验证：`curl http://localhost:PORT/main.tsx` 返回 200，内容里 `CuteAnchorPet` 正确解析到 `/@fs/.../src/pet/cat.tsx`（不再是不存在的 `src/src/pet/cat`）。
  - 顺带查到 Joy 8.26 记的"服务器显示 ready 但浏览器/curl 连不上"的**真实原因**：这台机器上 Vite 默认只绑定 IPv6 回环（`::1`），敲 `http://127.0.0.1:PORT` 会连接被拒、敲 `http://localhost:PORT` 却能通（取决于 `localhost`解析成 IPv4 还是 IPv6）——不是防火墙/安全软件。实测复现：同一个服务器，`curl 127.0.0.1` 是 `Connection refused`，`curl localhost` 是 `200 OK`。给 `Devpreview.vite.config.ts` 加了 `server: { host: true }`，让它同时监听 IPv4/IPv6 回环，两种写法都能连上，验证过了。
- **⑧`defaultSessionContext()` 和 `session.ts` 重复维护** → `session.ts` 的 `getOrInitSessionContext()` 改成直接调用 `defaultSessionContext()`，只保留平台层特有的部分（查当前活动 tab、读写 `chrome.storage.local`），删掉了本地重复的 `DEFAULT_GRACE_MS` 常量和手写的默认值组装逻辑。这个改动顺带修正了一个真实的行为不一致：`session.ts` 原来 `taskDeclaration` 写死是空字符串 `''`，而引擎侧 `defaultSessionContext()` 早就按 metaScenario 22 的要求给了非空默认文案（`DEFAULT_TASK_DECLARATION`）——两处独立维护导致平台层其实一直没吃到这条改进，现在统一了。
- **⑨`CheckInAnswer`/`CheckInChannel` 类型在 `src/pet/types.ts` 和 `src/engine/types.ts` 各写一份，`onAnswer` 不带 channel** → 桌宠组件的类型文件顶部本来就明确写着"不 import 引擎、保持纯展示层"，这是有意的架构边界，所以没有直接改成共享 import。改法是：①给 `CuteAnchorPetProps` 加一个 `channel` prop + `onAnswer(answer, channel)` 第二参数，`state==='checkin'` 时调用方传的 `channel` 会原样透传回 `onAnswer`，不用再另外想办法拼出完整的 `CheckInFeedback`；②新增 `src/pet/types.contract-check.ts`，用 TypeScript 类型相等断言（`AssertEqual`，纯 type-only import，零运行时代码，不会被打进构建产物）在编译期锁死两份字面量必须完全一致——手动改坏其中一份验证过，`tsc` 会准确报错在这个哨兵文件上。
- **⑩`ladderLen > 0` 判断在两个分支各写一遍** → 检查后发现这条已经在修⑤的时候顺带解决了：DRIFTED 分支现在是无条件重置，不再需要这个守卫，只有 FOCUSED 分支还留着（这里的守卫是必要的——阶梯为空时"前进一格"本来就无处可进，不是重复代码）。没有额外改动。
- 验证：`npm run typecheck` 两边干净，`npm test` **82/82 全绿**（数量没变，⑦⑧⑨都是平台层/展示层改动，没有 vitest 覆盖场景），`npm run build` 正常出包（16 模块，`types.contract-check.ts` 没被打进产物，符合预期）。

下一步：10 条 code-review 发现全部处理完。A8（真实 LLM 分类）、A9（黑白名单降级路径）仍待开工；B 侧 B5/B6/B8/B9（真正把桌宠接到 side panel 和状态机）是下一个大头。

✅（08-27/Jay）J4 联调启动，A11 前两步：
- 把 `J4` 合并回 `A7`（`A7` 分支之前落后，缺 B6/B7/桌宠组件/React 依赖等一整批 `J4` 已有的东西），验证 `npm run typecheck`/`npm test`（128/128）/`npm run build` 全绿后推到远端，`A7`/`J4` 重新对齐。
- **任务1**：`vite.config.ts` 接入 `@vitejs/plugin-react`（devDependency 已经在 `package.json` 里，之前没注册插件）——`src/pet/cat.tsx`（JSX）现在能被 vite 构建进 side panel 产物，`npm run build` 验证过（16→17 模块）。
- **任务2**：`src/platform/background/frame-pipeline.ts` 接上决策半——之前只算到 `FeatureFrame` 就停了，`evaluateFrame()`（B1）从没被平台层调用过。新增 `BState` 的按会话持久化（`chrome.storage.local`，跟 `eventHistory`/`currentTab` 同一套"SW 回收后重新水合"模式），`recordEventAndComputeFrame` 改名 `recordEventAndEvaluate`，现在返回 `{ frame, result: DetectionResult }`；`signals.ts` 同步更新调用处，日志里现在能看到真实算出来的 `DetectionResult.action`。
- 验证：`npm run typecheck` 两边干净，`npm test` 128/128（本次改动没碰 `src/engine`），`npm run build` 正常出包。还没做浏览器手动验证（留给 side panel 真正渲染出来、能收到消息之后一起测，即 A11 剩下的部分）。

下一步（A11 剩余）：给 side panel 一个真正的 React 入口渲染 `CuteAnchorPet`；`frame-pipeline.ts` 算出的 `DetectionResult` 通过 `chrome.storage.local` + `onChanged` 推给 side panel；side panel 的 `onAnswer` 回调要能把 `CheckInFeedback` 送回 SW 调 `applyCheckInFeedback`（B2）。B 侧 B9（状态机，`DetectionResult.action` → `PetState`）和 B8（协助接线）还没开工，这块需要跟 Joy 对一下由谁来写那层最小映射。

---

## 一、联合任务（A + B 共同，跨人的缝都在这里）

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| J1 | Day 1–2 | 共定三契约：`SignalEvent` / `FeatureFrame` / `SessionContext` | ✅ | 契约 v4 已定稿（`docs/契约v4.md`），含 22 条审计修订 |
| J2 | Day 1–2 | 准备两套 mock：`events.json`（A 用）+ `frames.json`（B 用） | ✅ | 代码核查：`events.json` 25 场景齐全；`frames.json` 覆盖场景 1-21/24 + metaScenarios 22/23，均已就绪 |
| J3 | Day 5 | 两半合流：感知半（A）+ 决策半（B）纯函数拼接，25 场景端到端全绿 | ✅ | `src/engine/integration.test.ts`：23/23 可测场景全绿（22/23 是独立函数验收，不适用），★关键检查点一达成 |
| J4 | Day 6–8 | 真实信号接入 + 桌宠组件进 MV3 side panel 联调 | 🔄 | 已开工：`vite.config.ts` 接上 React 插件、`frame-pipeline.ts` 接上决策半算出真实 `DetectionResult`；剩 side panel 真正渲染桌宠 + 消息链路 + 回传 check-in 答案，需要 B8/B9（桌宠接线、状态机）配合 |
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
| A7 | Day 6 | 真实 `SignalEvent` 流替换 mock，接入感知半 | ✅ | `src/platform/background/frame-pipeline.ts`：事件历史持久化（`chrome.storage.local`，应对 SW 回收）+ 调用 `computeFeatureFrame` 产出真实 `FeatureFrame`，`signals.ts` 每次事件都会算并打日志；B 侧 `detector.ts` 未改动，LLM 分类缓存暂空（留给 A8）。57/57 测试绿，两份 typecheck 干净，`npm run build` 16 模块正常出包 |
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
| B1 | Day 3–5 | 决策半实现：置信度模型 + `applyProfileMuting` + `isDrifting` / `isStuck` 阈值 + 宽限期 → `DetectionResult` | ✅ | `isDrifting`/`isStuck`/`evaluateFrame` 齐全；`defaultSessionContext`/`restReminderDue`（Joy 08-26 产出）补上了 metaScenario 22/23，`src/engine/metascenario.test.ts` 18 条全绿；08-26 code review 顺带修了 `startRest`/`lastCheckInTs`/共享数组等几个真 bug，见上方日志 |
| B2 | Day 3–5 | 自适应退让启发式（单会话，据 `CheckInFeedback` 调阈值） | ✅ | `applyCheckInFeedback()`（Joy 08-26 产出，`detector.ts`）：STUCK 通道按回答推进/重置阶梯，DRIFT 通道清空持续计时器，`src/engine/b2.test.ts` 7 条全绿；08-26 code review 修了空阶梯（VIEWER 档）静默跳过重置的 bug |
| B3 | Day 3–5 | 手写 `frames.json`：25 场景期望 `FeatureFrame` | ✅ | 代码核查：`src/mock/frames.json` 已就绪，含 `lastAnchorSnapshot`/`systemIdle` 相关场景 |
| B4 | Day 3–5 | 独立 React 桌宠组件（陪伴/观察/check-in 三态），暂不进扩展 | ✅ | `src/pet/cat.tsx`+`.css`+`assets/cat.json`（Joy 08-26 产出）：Lottie 矢量猫，三态靠锚徽章+气泡颜色区分，不靠猫变色；`src/devpreview/` 本地预览工具（路径 bug 已修，实测能正常打开三态预览）；08-26 code review 修了 check-in 按钮隐藏态仍可被键盘触发的问题 |
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

