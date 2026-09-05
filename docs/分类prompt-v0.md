# Anchor · 域-任务相关性分类 Prompt v0（A2 产出）

> 对应表单任务：A2（Day 1–2）· 下游使用方：A8（`classifyDomainRelevance` 真实 LLM 实现）
> 上游契约：`docs/契约v4.md` §1 信号1（页面级分类，标题级语义，非域级）

---

## 1. 分类器 Prompt（内容级）

```text
You are a relevance classifier for a focus-assistant browser extension.

The user declared their current task as:
"{taskDeclaration}"

They are currently viewing this page:
- URL: {url}
- Title: {title}
{snippetLine}
Question: Is THIS PAGE relevant to the declared task?
Judge by the page's specific content (title + path), not by the domain's general nature.
For example, youtube.com can be relevant (a tutorial) or irrelevant (entertainment) — decide per page.
A question about prerequisite or foundational knowledge for the task counts as relevant too —
e.g. if the task is "study neural networks", asking "how much calculus do I need to know" or
"tutorial on classical machine learning basics" is RELEVANT (it's the groundwork for the task),
not a tangent. Don't require the exact task keywords to appear — infer topical closeness.

Answer with exactly one of:
RELEVANT   — the page directly supports the task (docs, code, related video/article, AI chat about the task)
IRRELEVANT — the page is clearly off-task entertainment/social/shopping
UNKNOWN    — genuinely ambiguous, or a general-purpose page whose content can't be determined from title alone

Output format (JSON only, no extra text):
{"verdict": "RELEVANT" | "IRRELEVANT" | "UNKNOWN", "confidence": 0.0-1.0}
```

`{snippetLine}`：仅当 `input.contentSnippet` 有值时才插入这一行——`\nThey just typed this in the page: "{contentSnippet}"\n`，否则是空字符串。覆盖 `heuristics.ts` `AI_CHAT_DOMAINS` 收录的全部 AI 对话网站（claude.ai/chatgpt.com/chat.openai.com/gemini.google.com/grok.com/perplexity.ai/copilot.microsoft.com/chat.deepseek.com/poe.com，09-05 扩），非 AI 对话域名这一行始终不存在，prompt 形状跟这次改动之前完全一样。★ 名单上除 claude.ai 外的站点选择器还没有真机验证，实际能不能抓到取决于 `chat-sites.ts` 里的选择器是否命中真实 DOM。

## 2. 输出约束与红线语义

| 规则 | 实现 |
|---|---|
| 三态输出 | `RELEVANT` / `IRRELEVANT` / `UNKNOWN`，无其他值 |
| **低置信回 UNKNOWN** | LLM 返回 `confidence < 0.7` 时，A 侧强制覆盖为 `UNKNOWN`（契约红线1：判出前一律保守） |
| **一致性** | `temperature: 0`（09-05 新增，`groq.ts` `callGroq()`）——真机复现过同一个标题两次分类给出不同结果，分类是"是/否"判断，一致性比多样性重要 |
| 缓存键 | `domain + pathname + search + 标题 + contentSnippet`（perceiver.ts `cacheKey()` 已实现，09-05 两次加字段——先加标题：AI 对话类页面 URL 全程不变但话题会飘，只按 URL 缓存会把第一次判定冻结一辈子；标题变了自然是全新的 key，未命中会自动回落 `UNKNOWN` 触发重新分类。后来发现标题也不是每轮对话都更新，又加了 `contentSnippet`（用户刚输入的文字，仅 `claude.ai`）——同一套"key 变了就重判"机制，不是两套逻辑） |
| 调用时机 | 惰性：每页每会话最多一次，结果写入 `ClassificationCache` |
| 短路优先于 LLM | 演示域预置缓存表 > sessionWhitelist > short_feed 硬判 > 内置娱乐黑名单 > LLM |

## 3. 本地黑白名单兜底表（A2 产出，代码实现见 `src/engine/perceiver.ts`）

> 红线2（分工v2.md §5）：LLM 调用失败/断网时必须有本地兜底路径，不能整条链路挂死。
> 短路优先级（§1，从高到低）：**演示域预置缓存 > sessionWhitelist（用户动态白名单）> short_feed 硬判 > 内置娱乐黑名单 > LLM 分类缓存 > UNKNOWN**

### 3.1 演示域预置缓存表 `DEMO_PRESET_CACHE`

优先级最高，专为 demo 现场不受网络/LLM 延迟影响而设：

| 域名 | 判定 | 理由 |
|---|---|---|
| vscode.dev / github.com / stackoverflow.com | RELEVANT | CREATOR 档常驻工具站 |
| react.dev / docs.google.com | RELEVANT | 文档/协作类工具站 |
| arxiv.org / scholar.google.com / coursera.org | RELEVANT | READER/VIEWER 档常见学习资源站 |
| weibo.com | IRRELEVANT | 纯娱乐/信息流站点，demo 用来演示"飘走"场景 |

**⚠️ AI 对话助手（claude.ai/chat.openai.com/gemini.google.com/grok.com 等）不进这张表**（09-05 先收进来过，真机反馈后撤销）：这张表是域级硬判，命中就不会走到 LLM，看不到标题。AI 对话工具的内容形态完全因对话而异——同一个 claude.ai 网址可能在聊任务，也可能中途飘去问"中午吃什么"，这跟 youtube/reddit/x.com 这类"域名下什么内容都可能出现"的混合站是同一类站点，必须走 LLM 按标题内容级判断，域级写死会让这种话题漂移永远检测不出来。

### 3.2 内置纯娱乐/购物/票务/网页游戏域黑名单 `BUILTIN_ENTERTAINMENT_BLACKLIST`

不含 youtube/bilibili/reddit/知乎等"学习+娱乐混合站"——那些站点内容形态多样（教程 vs. 纯娱乐），必须走 LLM 按标题内容级判断，写死会误伤真正在学习的场景。黑名单收纳几乎不存在任务相关用途、且误判成本可控的域名：

| 域名 | 理由 |
|---|---|
| douyin.com / kuaishou.com | 短视频，中文场景下最常见的走神目的地（`short_feed` 硬判规则已覆盖大部分场景，黑名单是兜底） |
| xiaohongshu.com | 种草/生活方式内容，几乎不含任务相关内容 |
| tiktok.com | 短视频，海外场景对应 douyin |
| instagram.com | 图片/短视频信息流为主，专业用途占比相对小 |
| snapchat.com | 阅后即焚社交，几乎不含任务相关内容 |
| netflix.com / hulu.com / disneyplus.com | 纯被动影视娱乐消费，找不到"任务相关"的合理场景 |
| taobao.com / tmall.com / jd.com / amazon.com | 购物聚合平台；08-25 决定纳入黑名单——边工作边网购的场景极少，即使误判（如任务确实是"调研/采购某产品"），用户可通过 `sessionWhitelist` 手动申诉纠正，成本可控 |
| ctrip.com / 12306.cn / ticketmaster.com / booking.com / getyourguide.com | 票务/旅行预订聚合平台，同上理由纳入黑名单 |
| zalando.com / temu.com | 购物聚合平台，同上理由纳入黑名单 |
| poki.com / crazygames.com / miniclip.com / y8.com / addictinggames.com | 网页小游戏聚合站；08-25 纳入黑名单——内容高度同质（即点即玩的小游戏）、纯被动/摸鱼消费、头部平台数量有限、误伤面接近零，是浏览器内"货真价实的游戏摸鱼"场景。与下面 Steam/Epic/Twitch 不同：这些站点不存在游戏开发/QA/直播等专业用途 |

**⚠️ x.com/twitter.com、facebook.com、pinterest.com 不进黑名单**（08-25 复盘后从黑名单移除，改走 LLM 内容级分类）：这三个站点和 youtube/bilibili 本质上是同一类"内容形态因页面而异"的混合站——x.com 上有大量 AI/技术讨论，facebook 有专业社群，pinterest 有设计/艺术类参考板，域级一刀切拉黑会误伤这些真实的任务相关用法。同理排除的还有 `twitch.tv`（程序员直播写代码越来越常见，混合站）和 Steam/Epic 等游戏商店（游戏开发/QA 任务会用到）。购物/票务站与这类"混合站"的区别在于：内容形态本身不因页面而异（一个订单页/一张票和另一个几乎同质），且边工作边网购/订票的合理场景本就稀少，域级黑名单的误伤面显著小于 x.com/facebook.com 这类信息聚合站。

**⚠️ 品牌官网长尾（Nike/Adidas/New Balance/Puma/Zara/H&M/Dior 等）不进黑名单**（08-25 明确设计边界）：全球品牌官网数量不可枚举、且不断有新品牌出现，逐个拉黑是维护不完的无底洞。解决思路是分层——只把**数量有限、体量巨大的头部聚合平台**（上面两个表格里的域名）纳入静态黑名单，品牌官网这类**长尾、单点流量**交给已有的 LLM 内容级分类兜底（本文档 §1），在真实 LLM 接入（A8）前默认保守判 `UNKNOWN`（契约红线1）。这也更准确：品牌官网并非总是纯消费页面，例如"调研运动品牌可持续发展策略"这类任务，nike.com/adidas.com 就是相关的，域级拉黑会误判。

命中黑名单直接判 `IRRELEVANT`，但 `sessionWhitelist` 优先级更高——用户一旦手动申诉过某个黑名单域名，当次会话内该域名会短路成 `RELEVANT`，不会被黑名单卡死。

## 4. 起步教练 Prompt（B6 使用，A2 顺带记录避免重复造）

```text
The user has a task they keep avoiding: "{userInput}"

Do two things:
1. If the task description is shorter than 8 characters or vague (e.g. "study", "学习"),
   ask ONE follow-up question for a more specific statement (e.g. "prepare for tomorrow's
   data-structures exam" or "debug the React login flow").
2. Once specific enough, output:
   - a refined task declaration (one sentence)
   - the FIRST physical action, absurdly small (e.g. "open the doc and type the title")
   - a session profile: one of CREATOR (coding/writing/making), READER (deep reading/study), VIEWER (video course/tutorial)

Output JSON only:
{"taskDeclaration": string, "firstAction": string, "archetype": "CREATOR"|"READER"|"VIEWER"}
```

## 5. check-in 措辞 Prompt（B7 使用，同样记录在册）

```text
You are Anchor, a warm focus companion (not a supervisor). Write ONE short check-in message.

Context:
- The user was working on: "{taskDeclaration}"
- Last anchor activity: "{lastAnchorSnapshot.title}" ({minutes} min ago)
- They drifted to: "{currentTitle}"

Rules:
- Ask, never assert. Use a tone of "I remember what you were doing", not "you got distracted!"
- Offer two implicit options: still researching / actually drifting
- Keep it under 30 words
```
