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

✅（08-27/Jay）A11 剩余部分做完，J4 端到端链路打通（B9/B8 那层最小映射先由 A 侧占位实现，不等 Joy）：
- 新增 `src/platform/panel-state.ts`：background↔side panel 共享的 `PanelState` 形状（`state`/`message`/`channel`），`PetState`/`CheckInChannel` 直接复用 `src/pet/types.ts` 已经声明的那份，不再写第三份字面量。
- 新增 `src/platform/background/panel.ts`：把 `DetectionResult` 翻成 `PanelState`——`CHECK_IN_DRIFT`/`CHECK_IN_STUCK` 调 B7 的 `buildCheckInMessage()` 生成真实文案，`DO_NOTHING` 映射成 `'companion'`。**这里是个占位**：`companion`/`observing` 的区分是 B9 状态机的职责范围，`DetectionResult` 契约本身不带"证据接近阈值"这个信号，B9 真正建好之前先都算 `companion`，以后只换这一个函数，不用碰 side panel/`cat.tsx`。
- `signals.ts` 每次算完 `DetectionResult` 就调 `pushPanelState()` 写进 `chrome.storage.local`。
- `src/sidepanel/main.tsx`（新，替换占位 `main.ts`）：真正的 React 入口，渲染 `CuteAnchorPet`，用 `chrome.storage.onChanged` 订阅 `PanelState`（不用一次性 `sendMessage`——panel 没打开时消息会丢，storage 里的值不会）。`onAnswer` 回调把 `{answer, channel}` 通过 `chrome.runtime.sendMessage` 发回 SW。
- `src/platform/messages.ts` 新增 `CheckInAnswerMessage`（`CHECK_IN_ANSWER` 类型，answer/channel 复用 pet 的类型）；`background/index.ts` 收到后调 `frame-pipeline.ts` 新增的 `applyCheckInAnswer()`（内部调 B2 的 `applyCheckInFeedback()`，存回同一份持久化 `BState`）。
- 已知缺口（记录，不在这次范围内）：DRIFT 通道答 FALSE_POSITIVE 时，按 `detector.ts` 注释本该把当前域名写进 `SessionContext.sessionWhitelist`，这一步还没接，目前只会清空 `driftSustainer`。
- 验证：`npm run typecheck` 两边干净，`npm test` 128/128，`npm run build` 正常出包（33 模块，含 React/lottie/panel-state）。尝试用 CDP 自动化打开 side panel 页面做浏览器级验证，卡在这台机器 Chrome Stable 的"unpacked 扩展需要手动开发者模式开关才能加载"这道策略关（配置文件层面的 patch 会被 Chrome 的防篡改校验静默还原，绕不过去），SW 注册这层能确认（`--load-extension` 后 CDP target 列表能看到 `service_worker.js` 目标），但 side panel 页面本身没能在浏览器里跑起来验证——留给手动开一次开发者模式确认（跟 A3 当时的交互式验证是同一个遗留缺口）。

✅（08-27/Jay，Jay 手动浏览器验证 + 两处真实 bug 修复）真机测试 side panel：装上后能开面板，但 Lottie 猫渲不出来，Inspect 报错 `Content Security Policy...blocks the use of 'eval'`——`lottie-web` 默认打包（AE expressions 功能）内部用 `eval()`，MV3 扩展页面 CSP 硬性禁 `unsafe-eval`（不能像普通网站那样在 manifest 里放开）。改用 `lottie-web/build/player/lottie_light`（不含 expressions 的构建，同一套 SVG 渲染器/类型，`grep eval` 命中数 0），`cat.tsx` 一行 import 改掉即可，构建产物顺带小了 138KB（608→470KB）。

之后又用真实 YouTube 播放 8 分钟测试 DRIFT/STUCK，`action` 一直是 `DO_NOTHING`。排查发现是比 A8 更底层的问题：**心跳没有真正驱动重新评估**——`content-script.ts` 只在离散 DOM 事件（keydown/scroll/pause/seek/play）时才发消息，安静看视频不产生新事件；`background/index.ts` 的心跳 alarm 之前只调 `ensureCurrentTab()`，从没重新跑过 `computeFeatureFrame`/`evaluateFrame`。这正是契约v4 §3.1"事件静默 >60s 补帧"要求的行为，A7 阶段规划过但没有真正实现。修法：`frame-pipeline.ts` 抽出 `evaluateAndPersist()` 共享逻辑，新增 `recomputeOnHeartbeat(ctx, now, isDemoMode)`——复用已有 `eventHistory`、只是把 `now` 换成心跳触发的当前时刻（`anchorDetachedMs`/`stillnessMs` 都是 `now - 上次活动时间戳`，会正确继续增长）；`background/index.ts` 心跳回调里接上，顺带把结果推给 `pushPanelState()`。


✅（08-27/Jay）A8 LLM：使用Groq:
- **分类（高频、短文本、每页一次）**： Groq `openai/gpt-oss-20b` → 不行落回 `UNKNOWN`（原有 `DEMO_PRESET_CACHE`/黑名单短路不受影响）。
- **起步教练 + check-in 措辞（低频、需要措辞质量）**：Groq `openai/gpt-oss-120b`。check-in 措辞（B7 `wording.ts`）是 Joy 已经测试过的确定性模板函数，这次不碰，只把 Groq 120b 接进起步教练（B6）已有的 `StarterCoachLLMCall` 注入口——起步教练的 UI 本身还没建，这次只把"接上真实 LLM"这一步准备好，不接线。
- 新增 `src/platform/background/groq.ts`：Groq（OpenAI 兼容）chat completions 的共用 fetch 封装，key 走 `chrome.storage.local`（`anchor_groq_api_key`，跟 `anchor_llm_api_key`/`anchor_demo_mode` 同一套手动控制台配置模式），任何失败都返回 `null` 不 throw。
- 重写 `src/platform/background/classifier.ts`：`tryGroq()` 走 `gpt-oss-20b`.
- 新增 `src/platform/background/starter-coach.ts`：`groqStarterCoachCall`，实现 `coach.ts` 的 `StarterCoachLLMCall` 接口——只产出"第一步物理动作"，不重新推导 `taskDeclaration`/`archetype`（跟 `coach.ts` 自己的设计边界一致）；调用失败直接 `throw`，交给 `runStarterCoach()` 已有的 `FIRST_ACTION_FALLBACK` 兜底接住，不重复兜底一次。
- `anchor_llm_api_key`（Anthropic）不再被任何代码读取，是废弃配置，Jay 手动配过的话可以不用管（不影响任何东西，只是没人用）。
- 验证：`npm run typecheck` 两边干净，`npm test` 128/128，`npm run build` 正常出包（35 模块）。同样还没做真实 key 端到端验证——`groqStarterCoachCall` 目前也还没有任何调用方（起步教练 UI 未建），typecheck 干净只说明类型对得上，不代表跑过。

✅（08-27/Jay）Jay 端到端手测暴露出更多层问题（不是 bug，是设计边界一层层浮出来）：先是 YouTube 视频反复出现 `contextRelevance: UNKNOWN`，一路排查到根因——`taskDeclaration` 现在还是"无起步教练默认策略"给的占位文案（"No task declared..."），LLM 被问"这页面跟'没有任务'相关吗"本来就答不出来，`UNKNOWN` 反而是模型的正确保守回答，不是分类链路的锅。`defaultSessionContext()`（B1）没有问题，缺的是起步教练 UI 从没建过，没人真的把一个具体任务喂给 `SessionContext.taskDeclaration`。

跑了一轮 `/code-review`，4 条发现全部核实为真并修完：
- **check-in 答完 side panel 不刷新** → `panel.ts` 新增 `pushCompanionState()`，`index.ts` 的 `CHECK_IN_ANSWER` 处理完 `applyCheckInAnswer()` 后立刻调用，不再等下一次心跳/事件才把 `state:'checkin'` 摘掉——之前这段窗口期按钮还留在 DOM 里能点，手快会把 `applyCheckInFeedback` 触发两次。
- **持久化了 `BState` 里明确标注"不持久化"的持续器字段** → `frame-pipeline.ts` 新增 `toPersistable()`，落盘/`ensureBStateLoaded()` 水合时都只处理 `BStatePersistable` 那一半，`driftSustainer`/`stuckSustainer`/`passiveSince` 每次水合都给全新初值；顺带把本来重复造轮子的本地 storage key 逻辑换成 `state.ts` 已有的 `getBState`/`setBState`（之前是没人调用的死代码，见 08-27 早些时候记录），两处收敛成一处。
- **心跳里两次 `Date.now()`** → 改成只取一次 `now`，`recomputeOnHeartbeat` 和 `pushPanelState` 用同一个值。
- **`classifier.ts`/`starter-coach.ts` 各写一份 JSON 提取逻辑** → 提到 `groq.ts` 的 `extractJsonObject()`，两边共用，各自再做自己的字段校验。
- 验证：`npm run typecheck` 两边干净，`npm test` 128/128，`npm run build` 正常出包（35 模块）。

⚠️（08-27/Jay，记录待办，未动代码）**A8 和 B6 目前完全没接上**——查过 `session.ts`/`coach.ts`/`starter-coach.ts` 的调用关系，确认这是个真实缺口：
- `session.ts` 的 `getOrInitSessionContext()`（`taskDeclaration` 唯一的写入点）只调 `defaultSessionContext()`，从不知道 `runStarterCoach()` 的存在。
- `runStarterCoach()`（B6）只有 `coach.test.ts` 在调用它；`groqStarterCoachCall`（今天新增，Groq 版 LLM 调用）目前没有任何调用方。
- 后果：没有任何 UI/消息通道能让用户真正声明一个任务，`ctx.taskDeclaration` 永远停在占位文案"No task declared (default companion mode)"——这正是这几天测试时 A8 分类经常判成 `UNKNOWN` 的根因（模型被问"这页面跟'没有任务'相关吗"，答不出来是它的正确保守回答，不是分类链路本身的锅）。
- 这个缺口比现有的 B8/B9（桌宠接线/状态机）更窄、更具体——是"起步教练完全没有 UI 入口，也没人把它的产出写回 `SessionContext`"，卡在 B6 和 A13 之间，两边现有的任务描述都没直接点出来。先记录，等 B6 的真实 UI 动工时一起做。

✅（08-27/Jay）跟进上面同一次真机测试还发现的另一层问题：`texture: 'idle'`（120s 窗口内连 `PASSIVE_SCROLL` 都没有）在 IRRELEVANT 页面上既不触发 DRIFT 也不触发 STUCK（STUCK 本来就明确排除 IRRELEVANT）。核对过契约v4 §3.4/§3.5 参考伪代码，复核后确认这其实是设计漏洞（"完全不动 + 内容无关"没道理比"还在被动滚动 + 内容无关"更不算走神），改代码修复：
- `src/engine/detector.ts` 的 `isContinuouslyPassive()` 改名 `isContinuouslyDisengaged()`：原来 `f.texture !== 'passive'` 就重置证据计时器（等于把 `'idle'` 当"没证据"处理），改成只有 `f.texture === 'purposeful'`（用户还在主动操作）才重置——`'passive'`/`'idle'` 现在共用同一套 60s 连续纹理证据窗口。`isDrifting()` 调用处同步改名；`isStuck()` 没有改动，STUCK 依然明确排除 IRRELEVANT。
- `src/mock/frames.json` 新增场景25（回归测试）：照抄场景3（`passive` 纹理三步触发 DRIFT 的完整时间轴），只把 `texture` 换成 `'idle'`，其余完全一致——验证两种纹理现在走同一套判定。手动验证过测试真的能抓住这个 bug：临时 `git stash` 掉 `detector.ts` 的改动单独跑场景25，精确失败在预期那一步（`Expected "CHECK_IN_DRIFT", Received "DO_NOTHING"`）。
- 验证：`npm run typecheck` 两边干净，`npm test` **129/129 全绿**（`frames.test.ts` 22→23），`npm run build` 正常出包。这处改动碰的是 `detector.ts`（B1/B3 的内容）。


---

## 一、联合任务（A + B 共同，跨人的缝都在这里）

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| J1 | Day 1–2 | 共定三契约：`SignalEvent` / `FeatureFrame` / `SessionContext` | ✅ | 契约 v4 已定稿（`docs/契约v4.md`），含 22 条审计修订 |
| J2 | Day 1–2 | 准备两套 mock：`events.json`（A 用）+ `frames.json`（B 用） | ✅ | 代码核查：`events.json` 25 场景齐全；`frames.json` 覆盖场景 1-21/24 + metaScenarios 22/23，均已就绪 |
| J3 | Day 5 | 两半合流：感知半（A）+ 决策半（B）纯函数拼接，25 场景端到端全绿 | ✅ | `src/engine/integration.test.ts`：23/23 可测场景全绿（22/23 是独立函数验收，不适用），★关键检查点一达成 |
| J4 | Day 6–8 | 真实信号接入 + 桌宠组件进 MV3 side panel 联调 | ✅ | A11（真实信号→`FeatureFrame`→`DetectionResult`→`PanelState`→side panel 渲染桌宠→用户回答→`applyCheckInFeedback` 回写）+ B8/B9（`pet-state.ts` 真状态机接进 `frame-pipeline.ts`，`observing` 态不再是占位）+ B6/B7 UI（起步教练输入框 + check-in 微重启文案）全部合并进 J4（`715032e`），08-28 Jay 又修完 Joy 真机测试暴露的 4 个 bug（`715032e`→`59ee3f9`）。150/150 测试绿，`npm run build` 正常出包。下一步是 J5（真实浏览器走查两个反差瞬间） |
| J5 | Day 8 | 真实浏览器复现两个反差瞬间（疯狂切 tab 不打扰 + 飘走触发 check-in） | ✅ | ★关键检查点二达成。08-28 Jay 真机走查后，重新配好 Groq key 完整复测两个反差瞬间——确认通过：疯狂切相关 tab 全程不打扰，飘到无关内容正确触发 DRIFT check-in |
| J6 | Day 9–10 | 确认 `SessionContext` 正确喂给 A 感知半（B→A 反向缝） | ✅ | 逐字段核对：`taskDeclaration`（classifier.ts 消费）、`profile.archetype`/`policy`（evaluateFrame 消费）、`anchor.domain`/`url`/`matchMode`（signals.ts `isAnchorMatch` 消费，exact/prefix 都已实现）、`graceUntil`（detector.ts 公共闸门消费，已按 DEMO_MODE 压缩）均正确接入。核对中发现 `sessionWhitelist` 只有读没有写的真缺口，08-28 补上：`panel.ts` 的 `PanelState` 新增 `domain` 字段（DRIFT 触发那一刻的 `frame.currentDomain`），经 `CHECK_IN_ANSWER` 消息带回，`applyCheckInAnswer()` 在 DRIFT+FALSE_POSITIVE 时写回 `ctx.sessionWhitelist` 并持久化 |
| J7 | Day 10 | 端到端闭环验证：起步 → 陪伴 → 拉回 → 收尾反思 | ✅ | 收尾反思已接入：session-summary.ts 进 index.ts，SESSION_END 分支存在，SummaryPanel 已挂 sidepanel main.tsx |
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
| A8 | Day 6 | `classifyDomainRelevance` 真实 LLM 实现（异步 + 惰性 + 缓存） | ✅ | `src/platform/background/classifier.ts`：Groq `gpt-oss-20b` → `UNKNOWN`（`docs/分类prompt-v0.md` §1 同一份 prompt，低置信度<0.7 强制 UNKNOWN；最初做过 Gemini Nano on-device 一级，08-27 按 Jay 要求为一致性移除，只留 Groq）；`frame-pipeline.ts` 的 `triggerLazyClassification()` 只在感知半已判 UNKNOWN 时才异步触发，fire-and-forget 写回 `classificationCache`，不阻塞当前帧。Groq key 走 `chrome.storage.local`（`anchor_groq_api_key`，手动控制台配置）；顺带把 Groq `gpt-oss-120b` 接进 B6 起步教练已有的 `StarterCoachLLMCall` 注入口（`src/platform/background/starter-coach.ts`），还没接线（B6 UI 未建）。08-27 `/code-review` 的 5 条发现已全部修复（详见日志） |
| A9 | Day 6 | 本地黑白名单兜底接入（断网/API 失败时的降级路径） | ✅ | 随 A8 一并做完：`classifyDomainRelevance` 任何失败（无 key/网络/超时/解析）都安全落回 `UNKNOWN`，从不 throw；`resolveContextRelevance`（A2）的短路优先级本来就是 DEMO_PRESET_CACHE/sessionWhitelist/黑名单排在 LLM 之前，LLM 不可用时这几层完全不受影响地继续工作 |
| A10 | Day 7 | demo 要用到的域名预热进缓存 | ⬜（已评估，决定不做） | 08-30：`warmup.ts` 做过一版手动触发的预热（SW 控制台发 `WARMUP_DEMO_CLASSIFICATIONS` 消息），排查真机问题时发现两个致命缺陷：①`cacheKey` 不含 `taskDeclaration`，预热时机早于起步教练完成的话，会用错误的任务上下文把错误判定写进缓存，且这个错误会一直留到下次起步教练重置；②手动切 SW 控制台跑预热在评委面前操作生硬，破坏演示节奏。原打算改成"起步教练完成时自动触发（仅 DEMO_MODE）"来解决两个问题，但同时验证到：不预热时 `triggerLazyClassification()` 现场分类也足够快（DRIFT 需要的 30s 持续证据窗口通常比 LLM 响应时间长得多），于是**决定不做这层保险，整个删掉**（`warmup.ts`、`WARMUP_DEMO_CLASSIFICATIONS` 消息类型、`frame-pipeline.ts` 的 `getClassificationCache` 导出全部移除）。风险接受：现场 Groq 抖动/限流的极小概率仍未兜底，demo 前建议至少手动把要用的页面访问一遍作为纯人工预热，不依赖代码机制 |
| A11 | Day 7 | 协助桌宠组件接入 side panel（感知半→UI 消息链路：`chrome.runtime`/`chrome.storage`） | ✅ | 对应 J4，A 侧负责部分。`vite.config.ts` 接入 React 插件；`src/platform/panel-state.ts`（共享 `PanelState` 形状）+ `src/platform/background/panel.ts`（`DetectionResult`→`PanelState` 翻译，`pushPanelState`/`pushCompanionState`）+ `src/sidepanel/main.tsx`（真实 React 入口，`chrome.storage.onChanged` 订阅）+ `messages.ts` 新增 `CheckInAnswerMessage` + `index.ts`/`frame-pipeline.ts` 的回传处理（`applyCheckInAnswer`）。Jay 08-27 真机验证过：装上后侧边栏能渲染桌宠，真实浏览（YouTube/Gemini Notebook）触发的 `SignalEvent`→`FeatureFrame`→`DetectionResult` 全链路日志正常。`companion`/`observing` 的区分目前是占位（真正状态机是 B9，还没开工），不影响这条消息链路本身的完成度 |
| A12 | Day 7 | 真实数据噪音处理：idle 抖动/tab 快切去抖节流 | ✅ | `src/platform/background/signals.ts`：①`onActivated`/`onFocusChanged`/`onUpdated` 三个"tab 快切"触发源统一走新增的 `emitSignalEventDebounced()`（300ms 尾部去抖，`currentTab` 仍同步赋值，只是延迟"要不要真的发一条 SignalEvent"这个决定）——只吞掉亚秒级的连续抖动，不影响 `jumpPattern` 关心的秒级往返跳转证据；②`idle.onStateChanged` 加防御性去重，状态没有真的变化就不重新跑一遍评估链路。`onCommitted`/`onHistoryStateUpdated`/content-script 交互（已在 content-script.ts 层 2s 节流）不受影响，仍然逐条记录。未补自动化测试——这层是真实 chrome API 代码，仓库沿用已知的"没有 chrome API mock 测试基建"缺口 |
| A13 | Day 9–10 | 消费 `SessionContext`：`anchor` 驱动锚点判定（matchMode）、`sessionWhitelist` 短路分类、跨 profile 验证准确性 | ✅ | 08-30 逐项核查，三块都已实现且有测试覆盖，没有新代码要写：①**anchor 驱动锚点判定**——平台层 `signals.ts` 的 `isAnchorMatch()` 按 `matchMode` 分流（`exact` 精确匹配 / `prefix` 走 `domainMatches()` 同域或子域），每条 `SignalEvent.isAnchor` 由它标记，引擎侧 `computeAnchorSignal()` 只信任这个标记，不重复判断；②**sessionWhitelist 短路分类**——`perceiver.ts` 的 `resolveContextRelevance()` 短路优先级本就是 `sessionWhitelist` 排第二（仅次于 demo 预置缓存），`perceiver.test.ts` 4 条专项测试覆盖（短路 RELEVANT/覆盖黑名单/子域匹配/纠正误判的购物域）；写入端是 J6 补的那个口子（`frame-pipeline.ts` 的 `applyCheckInAnswer`，DRIFT+FALSE_POSITIVE 时写回）；③**跨 profile 准确性**——`integration.test.ts` 23 个场景覆盖 CREATOR/READER/VIEWER 三档，`mock/events.json` 显式含 VIEWER×`matchMode=prefix`（系列课连播前缀匹配）场景，`metascenario.test.ts` 另有 `matchMode==='exact'` 的默认策略断言。顺带把 `session.ts` 顶部一条过期注释（"A13 才会接真正的起步教练产出"，写于 08-27 B6 UI 补上之前）改成如实反映现状。188/188 测试、typecheck、build 全干净 |
| A14 | Day 11–14 | 【阶段二】内容级分类落地（youtube/reddit/slack 按 `domain+path+title` 判并缓存） | ✅ | 08-31 核查：A8（Day6）做真实 LLM 分类时已经顺带做完了——`perceiver.ts` 的 `BUILTIN_ENTERTAINMENT_BLACKLIST` 本就明确不收 youtube/bilibili/reddit/x/facebook/pinterest 这类学习+娱乐混合站（见该表上方注释），这三家统一走 `resolveContextRelevance()` 兜底到 `cache.get(cacheKey(domain,url))`；`cacheKey()` 取 `domain+pathname+search`（含 query，`?v=videoId` 这类同域不同内容天然分开缓存，不会把不同视频/帖子误判成同一条）；`classifier.ts` 的 `classifyDomainRelevance` 拿 `title+path`（不是裸域名）喂给 LLM 判断（prompt 里明写"Judge by the page's specific content (title + path), not by the domain's general nature"），结果异步写回同一把 `cacheKey`。J7 依赖已满足（✅）。没有新代码要写 |
| A15 | Day 15–18 | 【阶段二】交互纹理精细化（keystroke/feed_scroll/media_seek 区分） | ✅ | 08-31 核查：判定逻辑本就已在（`perceiver.ts` 的 `computeTexture`，源自 A5 v4 契约§1信号3），三种交互没有被同等对待——`MEDIA_PAUSE`/`MEDIA_SEEK`（主动拖进度条/暂停找内容）和 `ACTIVE_INPUT`（keystroke，RELEVANT 页面上）都判 `purposeful`；单独的 `PASSIVE_SCROLL`（feed_scroll）判 `passive`，投入程度明显更低。核查时发现这三条分支缺单测覆盖（此前只测过 `ACTIVE_INPUT` 在 IRRELEVANT 页面降级的场景），补了 3 条：`PASSIVE_SCROLL`→passive、`MEDIA_SEEK`→purposeful、`MEDIA_PAUSE`→purposeful（`perceiver.test.ts`）。209/209 测试绿 |
| A16 | Day 15–18 | 【阶段二】短视频流形态硬判 + 更多 `contentKind` | ✅ | 08-31：`heuristics.ts` 的 `guessContentKind()` 域名覆盖太窄，`reddit.com`/`x.com`/`twitter.com`/`facebook.com`/`pinterest.com`/`threads.net`（`docs/分类prompt-v0.md` §3.2 明确列为"学习+娱乐混合站"、故意不进域名黑名单、要走 LLM 内容级分类兜底的那批站）全部落到 `unknown`，`social_feed`/`article` 这两个契约里声明的 `contentKind` 值实际代码里从未被产出过。补了：①`SOCIAL_DOMAINS`（上述几个混合站）→ `social_feed`；②`ARTICLE_DOMAINS`（wikipedia.org/medium.com/zhihu.com）→ `article`；③短视频流形态硬判补 `facebook.com` 的 `/reel/`、`/reels/` 路径（Meta Reels 官方 URL 形态）→ `short_feed`，跟已有的 youtube/bilibili `/shorts/` 判定同一个优先级层（先判具体路径形态，再落回该域名的默认 `contentKind`），不影响 `resolveContextRelevance()` 短路优先级（短视频形态硬判排 sessionWhitelist 之后、内置黑名单之前，契约v4 §1）。新建 `heuristics.test.ts`（17 项，此前这个文件没有测试）+ typecheck/build 干净，226/226 测试绿 |
| A17 | Day 19–22 | 【阶段二】信号优雅降级（异常不崩、断网走本地兜底） | ⬜ | 依赖 A9 |
| A18 | Day 23–25 | 【阶段二】联调修 bug + 备技术 Q&A 数字（误报率、缓存命中率） | ⬜ | 依赖 A14-17、J9；★ v4：指标定义见 `docs/契约v4.md` §5.4 |

---

## 三、B（决策侧）工作流程

| 编号 | 时间 | 任务 | 状态 | 说明/产出 |
|---|---|---|---|---|
| B1 | Day 3–5 | 决策半实现：置信度模型 + `applyProfileMuting` + `isDrifting` / `isStuck` 阈值 + 宽限期 → `DetectionResult` | ✅ | `isDrifting`/`isStuck`/`evaluateFrame` 齐全；`defaultSessionContext`/`restReminderDue`（Joy 08-26 产出）补上了 metaScenario 22/23，`src/engine/metascenario.test.ts` 18 条全绿；08-26 code review 顺带修了 `startRest`/`lastCheckInTs`/共享数组等几个真 bug；08-27 真机测试又修了一个：`isContinuouslyPassive()`→`isContinuouslyDisengaged()`，`texture: 'idle'` 现在跟 `'passive'` 一样算 DRIFT 纹理证据（原来只认 `'passive'`），见上方日志 |
| B2 | Day 3–5 | 自适应退让启发式（单会话，据 `CheckInFeedback` 调阈值） | ✅ | `applyCheckInFeedback()`（Joy 08-26 产出，`detector.ts`）：STUCK 通道按回答推进/重置阶梯，DRIFT 通道清空持续计时器，`src/engine/b2.test.ts` 7 条全绿；08-26 code review 修了空阶梯（VIEWER 档）静默跳过重置的 bug |
| B3 | Day 3–5 | 手写 `frames.json`：25 场景期望 `FeatureFrame` | ✅ | 代码核查：`src/mock/frames.json` 已就绪，含 `lastAnchorSnapshot`/`systemIdle` 相关场景；08-27 新增场景25（`texture: 'idle'` 的 DRIFT 回归测试，照抄场景3 的 `passive` 版本） |
| B4 | Day 3–5 | 独立 React 桌宠组件（陪伴/观察/check-in 三态），暂不进扩展 | ✅ | `src/pet/cat.tsx`+`.css`+`assets/cat.json`（Joy 08-26 产出）：Lottie 矢量猫，三态靠锚徽章+气泡颜色区分，不靠猫变色；`src/devpreview/` 本地预览工具（路径 bug 已修，实测能正常打开三态预览）；08-26 code review 修了 check-in 按钮隐藏态仍可被键盘触发的问题 |
| B5 | Day 5 | 单元测试：`frames.json` → 断言 `DetectionResult` 动作正确 | ✅ | `src/engine/frames.test.ts`（Joy 08-26 产出）：25 场景里可测的 22 条直接喂 `evaluateFrame()`，用 `frames.json` 自带的 `initialState.*SinceOffset` 摆好持续器起始状态，不逐帧重放；过程中揪出场景14 一个真数据 bug（两步间少了"刚越过阈值"的中间帧）已修，22/22 全绿 |
| B6 | Day 9–10 | 起步教练最小版：单次 LLM 调用出第一步物理动作 + 产出 `SessionContext` | ✅ | `src/engine/coach.ts`+`coach.test.ts`（Joy 08-26 产出）：`runStarterCoach()` 落实 `taskDeclaration` ≥8 字符追问义务（最多2轮，不占用"单次"LLM调用额度），LLM 调用通过参数注入（跟 `perceiver.ts` 的 `ClassificationCache` 同一思路），失败有兜底文案；`SessionContext` 复用已测过的 `defaultSessionContext()`。11/11 测试绿。08-27 Jay 把 Groq `gpt-oss-120b` 接进这个注入口（`src/platform/background/starter-coach.ts`），还没接线（起步教练 UI 本身还没建） |
| B7 | Day 6–8 | check-in / 微重启措辞 v1（像朋友不像监工） | ✅ | `src/engine/wording.ts`+`wording.test.ts`（Joy 08-26 产出）：`buildCheckInMessage()` 区分 DRIFT（问离开前那件事，数据源 `lastAnchorSnapshot`，★v4 强调）和 STUCK（问当前停留这件事，数据源当前页标题）；`buildMicroRestartMessage()` 是用户回答后的一句短反馈；测试专门用正则挡掉"should/stop/again/why"这类说教味词汇。13/13 测试绿 |
| B8 | Day 6–8 | 协助桌宠组件接入 MV3 side panel | ✅ | Joy 08-27 产出：`frame-pipeline.ts` 是唯一同时拿得到 `action`/`BState` 的地方，状态机实例放这里推进，算出的 `PetState` 跟 `DetectionResult` 一起返回；`panel.ts` 退化成纯翻译层，`signals.ts`/`index.ts` 各透传一行 |
| B9 | Day 6–8 | 状态机建模（陪伴/观察/check-in，手写或 XState） | ✅ | `src/engine/pet-state.ts`+`pet-state.test.ts`（Joy 08-27 产出，16 条测试）：手写状态机，`observing` 态首次真正有代码产出——信号来源是 `BState.driftSustainer`/`stuckSustainer.since` 非 null（证据已开始累积但没满窗口），不用改 `detector.ts` 判定逻辑；`MIN_OBSERVING_MS=15s` 迟滞防抖 + 休息期强制 `companion`；`detector.ts` 的 `scaled()` 导出复用（08-28 又把它的规范实现搬到了 `types.ts`，见上方日志） |
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

