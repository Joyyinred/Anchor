// Anchor · A8：classifyDomainRelevance 真实实现（异步 + 惰性 + 缓存）
// 契约v4 §1 信号1 + docs/分类prompt-v0.md §1：页面级分类（标题级语义），不是域级——
// 这也是 A2 为什么把 youtube/bilibili/x.com 这类"内容形态因页面而异"的站点特意排除在
// 静态黑名单之外的原因：那些站点就是靠这里真正判出来的。
//
//
// 红线1（域名分类绝不阻塞引擎）：这个函数只由 frame-pipeline.ts 在感知半已经把当前页判成
// UNKNOWN（意味着 DEMO_PRESET_CACHE/sessionWhitelist/short_feed/黑名单/分类缓存全部没命中）
// 之后才触发，且是 fire-and-forget——分类结果只写回 ClassificationCache 供"下一次"重新
// 计算帧时使用，绝不会让当前这一帧等它。
// 红线2（LLM 失败必须有本地兜底）：没配 key / 网络失败 / 超时 / 解析失败 / 低置信度，
// 全部安全落回 'UNKNOWN'，这个函数从不 throw、调用方不需要 catch。
import type { ContextRelevance } from '../../engine/perceiver';
import { callGroq, extractJsonObject } from './groq';

const GROQ_CLASSIFY_MODEL = 'openai/gpt-oss-20b';
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

/**
 * 真实一次分类。Groq 调用失败/超时/没配 key（callGroq 已经处理，返回 null）都落回 'UNKNOWN'；
 * 答出来了但置信度不够（<0.7）同样落回 'UNKNOWN'——这两种情况在这个函数的返回值上没有区别，
 * 调用方不需要关心具体是哪一种。
 */
export async function classifyDomainRelevance(input: ClassifyInput): Promise<ContextRelevance> {
  const text = await callGroq(GROQ_CLASSIFY_MODEL, buildPrompt(input));
  if (!text) return 'UNKNOWN'; // callGroq 已经打过日志说明具体是没配 key / 请求失败 / 超时中的哪一种

  const parsed = extractJsonObject(text) as { verdict?: unknown; confidence?: unknown } | null;
  if (!parsed || !isValidVerdict(parsed.verdict)) {
    console.warn('[Anchor SW] Groq classify: response did not parse as expected JSON', text);
    return 'UNKNOWN';
  }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < CONFIDENCE_THRESHOLD) {
    console.log('[Anchor SW] Groq classify: below confidence threshold', parsed);
    return 'UNKNOWN';
  }
  // 08-30 真机排查：模型自己给出的答案就是 UNKNOWN 且置信度够（prompt 本来就把 UNKNOWN
  // 列为三个合法答案之一——"genuinely ambiguous, or a general-purpose page whose content
  // can't be determined from title alone"），这条路径原来完全没有日志。跟前面两条
  // "调用失败"/"低置信度"的 UNKNOWN 长得一模一样，但根因完全不同（不是故障，是模型
  // 判断力不够/prompt 给的上下文太薄），排查时误以为是 key/网络问题，翻遍日志找不到任何
  // Groq 相关输出——因为这条分支压根没打印过。
  if (parsed.verdict === 'UNKNOWN') {
    console.log('[Anchor SW] Groq classify: model confidently answered UNKNOWN', parsed);
  }
  return parsed.verdict;
}
