// Anchor · A8：classifyDomainRelevance 真实 LLM 实现（异步 + 惰性 + 缓存）
// 契约v4 §1 信号1 + docs/分类prompt-v0.md §1：页面级分类（标题级语义），不是域级——
// 这也是 A2 为什么把 youtube/bilibili/x.com 这类"内容形态因页面而异"的站点特意排除在
// 静态黑名单之外的原因：那些站点就是靠这里真正判出来的。
//
// 红线1（域名分类绝不阻塞引擎）：这个函数只由 frame-pipeline.ts 在感知半已经把当前页判成
// UNKNOWN（意味着 DEMO_PRESET_CACHE/sessionWhitelist/short_feed/黑名单/分类缓存全部没命中）
// 之后才触发，且是 fire-and-forget——分类结果只写回 ClassificationCache 供"下一次"重新
// 计算帧时使用，绝不会让当前这一帧等它。
// 红线2（LLM 失败必须有本地兜底）：没配置 API key / 网络失败 / 超时 / 响应解析不出来，
// 全部安全落回 'UNKNOWN'，这个函数从不 throw、调用方不需要 catch。
import type { ContextRelevance } from '../../engine/perceiver';

// 跟 anchor_demo_mode 是同一个模式：08-27 已经和 Jay 对齐——今天先不做专门的 options 页面，
// 手动在 SW DevTools 控制台跑 chrome.storage.local.set({ anchor_llm_api_key: '...' }) 配置，
// key 只留在本机 chrome.storage.local 里，不随扩展分发、不写进代码仓库。
const API_KEY_STORAGE_KEY = 'anchor_llm_api_key';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const REQUEST_TIMEOUT_MS = 10_000;
// docs/分类prompt-v0.md §2："低置信回 UNKNOWN"（契约红线1：判不准就不判）
const CONFIDENCE_THRESHOLD = 0.7;

export interface ClassifyInput {
  taskDeclaration: string;
  url: string;
  title: string;
}

// 跟 docs/分类prompt-v0.md §1 是同一份 prompt，改一处记得改另一处。
function buildPrompt(input: ClassifyInput): string {
  return `You are a relevance classifier for a focus-assistant browser extension.

The user declared their current task as:
"${input.taskDeclaration}"

They are currently viewing this page:
- URL: ${input.url}
- Title: ${input.title}

Question: Is THIS PAGE relevant to the declared task?
Judge by the page's specific content (title + path), not by the domain's general nature.
For example, youtube.com can be relevant (a tutorial) or irrelevant (entertainment) — decide per page.

Answer with exactly one of:
RELEVANT   — the page directly supports the task (docs, code, related video/article, AI chat about the task)
IRRELEVANT — the page is clearly off-task entertainment/social/shopping
UNKNOWN    — genuinely ambiguous, or a general-purpose page whose content can't be determined from title alone

Output format (JSON only, no extra text):
{"verdict": "RELEVANT" | "IRRELEVANT" | "UNKNOWN", "confidence": 0.0-1.0}`;
}

function isValidVerdict(v: unknown): v is ContextRelevance {
  return v === 'RELEVANT' || v === 'IRRELEVANT' || v === 'UNKNOWN';
}

// 模型偶尔会不听指令包一层 markdown 代码块——找第一个 {...} 块，不假设整段 text 就是纯 JSON。
function extractJson(text: string): { verdict?: unknown; confidence?: unknown } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * 真实一次 LLM 调用。任何环节出问题（没配 key / 网络失败 / 超时 / 解析不出来 / 低置信）
 * 都安全落回 'UNKNOWN'——调用方不需要关心具体失败原因。
 */
export async function classifyDomainRelevance(input: ClassifyInput): Promise<ContextRelevance> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  if (!apiKey) return 'UNKNOWN';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Anthropic API 默认按服务端调用设计，不带这个头会直接 CORS 拒绝浏览器发起的跨源请求——
        // 这是官方给"纯前端直接调用"开的口子，代价是 key 暴露在客户端。这里可接受：这是我们自己
        // 本机跑的扩展，key 是用户自己在本机 chrome.storage.local 里配置的，不会随扩展打包分发。
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 50,
        messages: [{ role: 'user', content: buildPrompt(input) }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return 'UNKNOWN';

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text;
    if (!text) return 'UNKNOWN';

    const parsed = extractJson(text);
    if (!parsed || !isValidVerdict(parsed.verdict)) return 'UNKNOWN';
    if (typeof parsed.confidence !== 'number' || parsed.confidence < CONFIDENCE_THRESHOLD) {
      return 'UNKNOWN';
    }
    return parsed.verdict;
  } catch {
    return 'UNKNOWN';
  } finally {
    clearTimeout(timeout);
  }
}
