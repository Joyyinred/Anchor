

## 0824 
### joy
1. understand all docs and codes
2. based on docs and events add frames.json
3. update file structure
4. add schema interface to engine/types
5. todo-detector.ts and test, will do it later today or tmr

### jay
0. 工作流程表单：方便检查进度，会在我这边每日更新。
1. update `events.json` based on "契约v4: 4.场景"
2. Set up test environment:
    - `package.json`: devDependencies：
        - TypeScript 5.9、Vitest 3.2
        - cripts.test / scripts.test:watch：npm test
    - `tsconfig.json`: TypeScript compilation config. 开了 strict（严格类型检查）、noUnusedLocals/noUnusedParameters（防止死代码堆积）、resolveJsonModule（允许直接 import .json 文件，这样测试代码才能把 events.json/frames.json 当模块导入）。
    - `package-lock.json`（npm install 自动生成）: 锁定依赖的精确版本号，保证以后的 CI 装出来的包版本完全一致。
3. complete task A5, A6: 
    - `src/engine/perceiver.ts`: signal1 - `resolveContextRelevance`, signal2 - `computeAnchorSignal`, signal3 - `computeTexture`, signal4 - `computeJumpPattern`, `computeFeatureFrame` - combine signals and feed data to decision parts.
4. create test files and check J3:
    - `src/engine/perceiver.test.ts`: test perceiver.ts
    - `src/engine/integration.test.ts`: 把perceiver.ts & detector.ts真正接起来跑的端到端测试, "两半合流"。核心是一个"细粒度步进重放"模拟器：把 events.json 的 25 个场景，按真实时间轴一步步推进（不是只看最后一刻），因为 B 的判定逻辑需要证据"持续满 30 秒"才会真的触发提醒，必须真正把时间推进过去才能测出来。23 个可测场景（另外2个是独立函数验收，不适用这条主线）全部验证通过。
5. `detector.ts` debug and update: find one bug in integration test. 
    - DEMO_MODE（演示模式，时间压缩120倍）下，anchorDetachedThresholdMs（锚点阈值）和 stuckThresholdMs（卡住阈值）这两个策略常量一直没有被压缩函数 scaled() 包裹，导致"演示模式下 8 分钟阈值应该变成 4 秒"这条契约规定的行为实际没生效。
6. 跑项目目前需要的 commands：
    - `npm install`：装依赖（第一次拉仓库、或 package.json 有更新时跑一次，生成/更新 node_modules）
    - `npm test`：跑全部单测（perceiver.test.ts + integration.test.ts + detector.smoke.test.ts），一次性跑完就退出
    - `npm run test:watch`：跑测试并监听文件变化，改代码时自动重跑，开发时常驻用这个
    - `npx tsc --noEmit`：只做类型检查、不产出编译文件，提交前建议跑一下确保没有类型错误
    - `npx vitest run <文件路径>`：只跑某一个测试文件，比如 `npx vitest run src/engine/perceiver.test.ts`
    - `npx vitest run -t "关键词"`：只跑名字里含某关键词的用例，调试单个场景时好用（比如 `-t "场景 24"`）

## 0825
### Jay

complete A1234（A1 平台预研 + A2 分类黑白名单 + A3 扩展骨架 + A4 真实信号采集）, refined A2 BUILTIN_ENTERTSINMENT_BLACKLIST.

1. **A1 产出：`docs/MV3平台预研.md`**——写代码前先把 Chrome 扩展这个平台的"规矩"摸清楚。
    - 要申请哪些浏览器权限（tabs/idle/storage/alarms/webNavigation/sidePanel + host_permissions），以及各自为什么必须要。
    - 后台脚本会被浏览器随时"杀掉、清空内存"，怎么保证用户状态不丢。
    - 怎么在网页里监听用户的键盘/滚动/播放行为（content script 注入策略）。
    - 扩展各部件（网页脚本/后台/侧边栏）之间怎么互相传消息（消息链路设计）。
    - "判断用户是怎么进到这个页面的"这件事在哪些场景下拿不到准确信息、只能靠猜（entryIntent 可行性结论，SPA 内部跳转保守判 unknown）。
    - 用什么工具打包扩展（构建工具选型：CRXJS+Vite+TS）。
    - demo 演示模式的开关怎么存、怎么读（DEMO_MODE flag 存储方案）。

2. **A2 产出：`docs/分类prompt-v0.md`**——"AI 怎么判断一个网站跟当前任务相不相关"的说明书。
    - §1-2：判相关性用的 AI 提示词（按网页内容判断，不是按域名一刀切）+ 给 AI 输出结果定的规矩（AI 拿不准时强制标"未知"、结果要缓存、优先走更快的判断路径）。
    - §3：黑白名单兜底表——不用等 AI 判断，命中就直接放行/拦截，对应 `perceiver.ts` 里已经写好的 `DEMO_PRESET_CACHE`/`BUILTIN_ENTERTAINMENT_BLACKLIST`。
    - §4-5：给桌宠"开场白"（起步教练 B6）、"提醒话术"（check-in B7）用的提示词，顺带记一下避免以后重复写。

3. **A3：MV3 扩展骨架，从零搭建**——把扩展从"一堆空文件夹"变成"能装进 Chrome、真的会跑"的东西（新增文件）：
    - `manifest.json`：扩展的"说明书"，声明权限 + 后台 service worker + 侧边栏 + 网页采集脚本。
    - `vite.config.ts`：接入 `@crxjs/vite-plugin` 打包工具，把 `manifest.json` 处理成 Chrome 能直接读的 `dist/` 文件夹。
    - `tsconfig.engine.json` / `tsconfig.platform.json`：把原来一份 `tsconfig.json` 拆成两份——engine 版专门管 `src/engine`（不认识浏览器 API，保证这块纯逻辑代码能脱离浏览器单独测试），platform 版管 `src/platform`/`src/sidepanel`（认识浏览器 API）。根 `tsconfig.json` 改成继承 engine 版，编辑器默认按更严格的那份标准检查。
    - `src/platform/background/index.ts`：后台 Service Worker 的入口文件。注册了 1 分钟一次的心跳闹钟（`chrome.alarms`，专门防后台被浏览器闲置回收、记录后台启动/唤醒的日志、把网页脚本发来的消息转给对应逻辑处理。
    - `src/platform/background/state.ts`：负责往本地存储读写数据——存 demo 模式的开关、存状态持久化用的 key（对应契约里的 `BStatePersistable`）。
    - `src/platform/background/session.ts`：今天先给一个"默认设定"（因为真正的起步引导流程 B6/A13 还没做）——自动把当前打开的网页当作锚点、给个默认档位、给 2 分钟宽限期，存进本地供后面复用。
    - `src/platform/content/content-script.ts`：注入到所有网页里的采集脚本骨架，真正的采集逻辑见下方 A4 ）。
    - `src/platform/messages.ts`：定义网页脚本和后台之间传递消息的格式。
    - `src/sidepanel/index.html` + `main.ts`：侧边栏的占位页面（先显示"Anchor is running"），**后续由B负责，可以在这里建立真正的桌宠界面**。
    - `package.json`：新增了打包需要的几个依赖包，新增了 `build`（打包）、`dev`（开发模式）、`typecheck:engine`/`typecheck:platform`（分别检查两块代码的类型对不对）这几个命令。
    - 验证：`npm run build` 能正常产出 `dist/` 文件夹；用自动化脚本连了一次本地 Chrome，确认装上扩展后后台能成功注册、没有报错。

4. **A4：真实信号采集实现**——把"知道用户在干嘛"这件事真正接到浏览器 API 上（新增文件，用到 chrome.tabs/idle/webNavigation）：
    - `src/platform/background/heuristics.ts`：两个小工具函数。一个用简单的域名表猜"这个网页是代码/文档/视频/PDF/AI聊天中的哪一种"（比如 github→代码，youtube→视频）；另一个把浏览器给的"用户是怎么跳转过来的"原始信息，翻译成我们自己定义的分类，遇到单页应用内部跳转（比如 YouTube 自动换下一个视频）就统一标"未知"，因为这种情况本来就猜不准。
    - `src/platform/background/signals.ts`：今天 A4 的核心文件。监听"用户切了哪个 tab / 同一个 tab 里网址标题变了""用户是不是空闲了""用户是整页跳转还是单页应用内部跳转"这几类浏览器事件，把它们拼成一份完整的"当前信号快照"，再判断一下"这是不是用户设定的锚点页面"，最后打印到控制台方便检查数据对不对（今天还没做存储持久化，留给后面真正接入判断逻辑时再做）。
    - `content-script.ts` ：监听键盘、滚动（这两种事件很频繁，每 2 秒才发一次，避免刷屏）、页面是否被切到后台（不限流，立刻发）、以及视频的播放/暂停/跳转（用 `MutationObserver` 应对单页应用换视频时播放器被整个替换掉的情况，这是 A1 预研里提前标出来的风险点）。这些信息通过消息发回后台，后台只信任当前锚点页面发来的消息，避免被其他网页乱发消息干扰。
    - 验证方式（等我们后续手动测）：切 tab / 触发空闲 / 切走页面 / 播放视频，看后台控制台打出来的信号内容是否合理；心跳闹钟是否按时打日志。

5. 今日新增/常用 commands：
    - `npm run build`：`vite build`，产出 `dist/` 供 Chrome load-unpacked。
    - `npm run dev`：`vite`，CRXJS 开发模式（带 HMR）。
    - `npm run typecheck:engine`：`tsc -p tsconfig.engine.json --noEmit`，验证 `src/engine` 零 chrome 依赖。
    - `npm run typecheck:platform`：`tsc -p tsconfig.platform.json --noEmit`，验证平台层类型正确。
6. New Branch 'J4' is for integrating A,B's jobs when A7, B4 are completed. A will work on personal brance 'A7' before merging to J4. B is suggested to create own branch 'B4' and work on B1-B4 before merging to J4.


### Joy

complete B1、B2（引擎侧逻辑），B4 桌宠组件定稿并接入 Lottie 动画，8.26完成本地测试环境的踩坑排查。

1. **B1 产出：`src/engine/types.ts` + `src/engine/detector.ts`**
    - `defaultSessionContext()`：给一次新会话生成默认的 `SessionContext`（默认档位 CREATOR、2 分钟宽限期 `DEFAULT_GRACE_MS`、默认任务声明）。
    - `restReminderDue()` + `createRestState()`：休息提醒的节流逻辑（首次提醒延迟 + 之后按固定间隔重复提醒）。
    - 新增 `src/engine/metaScenarios.test.ts`（15 条用例，对着 `frames.json` 的 metaScenarios 规格验证），已直接改进项目、跑通。

2. **B2 产出：`src/engine/types.ts` + `src/engine/detector.ts`**
    - 新增 `CheckInChannel`/`CheckInAnswer`/`CheckInFeedback` 类型。
    - `applyCheckInFeedback()`：处理用户在气泡里点的三种回答——STUCK 通道下"在专注"会让阈值梯子往上爬一级（更难触发下次提醒）、"飘了"会把梯子重置到底；DRIFT 通道下清空对应的持续计时器。
    - 新增 `src/engine/b2.test.ts`（6 条用例，对着 `integration.test.ts` 里 `SCENARIO_OVERRIDES[7]` 的 fixture 验证），已跑通。

3. **B4 桌宠组件：`src/pet/CuteAnchorPet.tsx` + `.css` + `assets/cat.json`**
    - 经历了几轮设计迭代（软糖水滴 → CSS/SVG 猫耳猫尾 → 像素画风 → 最终定稿：从Lottie网站找到的矢量动画猫，可以免费试用，版权问题8.26会再次确认）。
    - 猫本体是一份 Lottie JSON，三态（陪伴/观察/check-in）不靠猫变色区分，改成猫耳朵旁边的小锚徽章（描边/描边+波纹脉冲/实心）+ check-in 气泡颜色。
    - 组件用 `lottie-web`（不是 `lottie-react`）手动挂载动画，并在加载完成后裁剪 SVG 的 `viewBox`，让猫撑满容器、徽章能贴着耳朵而不是飘在空中；`state` 切换不会重新加载动画，只影响徽章样式和气泡。
    - 新依赖：`lottie-web`（还需要 `react`/`react-dom`/`@vitejs/plugin-react` 等 React 相关依赖，项目里原来没有）。
    - 附带交付了一个临时的本地预览工具（`devpreview.vite.config.ts` + `devpreview/`），不影响扩展本身构建，纯粹用来肉眼确认三态长什么样。
    - ![有背景](image.png)
    - ![无背景](image-1.png)
    - 我觉得无背景气泡的更符合桌宠的感觉？but feel free to give advice for this.

4. **今日本地测试环境排查**（还在进行中，未完全解决）：
    - 发现 `tsconfig.platform.json` 的 `include` 里漏了 `src/pet`，导致编辑器对 `CuteAnchorPet.tsx` 按默认严格规则检查、给 `.css` 引入标红线（命令行 `tsc` 实际不受影响，因为 `moduleResolution: bundler` 本身就允许非 JS 后缀的引入）——这是个真实遗漏，修法是把 `src/pet` 加进 `tsconfig.platform.json` 的 `include` 数组，已修复
    - `devpreview` 本地预览服务器起得来（`vite` 终端显示 `ready`），但浏览器和 `curl` 都连不上 `127.0.0.1`，且失败前有 ~2 秒延迟（不是瞬间拒绝）——判断是本机防火墙/安全软件在拦截 Node 监听的端口，还没确认具体是哪个软件，待我8.26本机排查后回填结论。

5. **0826todo**
   - debug pet preview failure problem
   - 版权问题
   - 根据意见修改b4 pet ui, 对话会改成英文
   - finish b5,b6

