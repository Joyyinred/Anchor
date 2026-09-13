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
  // 09-05：用户刚在页面里输入的文字（目前仅 AI 对话类网站，见 SignalEvent.contentSnippet
  // 顶部注释）。标题不一定随每轮对话更新，这是比标题更细粒度、真正跟着当前这句话走的信号。
  contentSnippet?: string;
}

// 跟 docs/分类prompt-v0.md §1 是同一份 prompt，改一处记得改另一处。
function buildPrompt(input: ClassifyInput): string {
  // 09-05：有 contentSnippet 时多给一行——判的是"这句话"是不是任务相关，不只是"这个页面"，
  // 对 AI 对话页面尤其重要（标题可能还停在对话刚开始时的主题，但用户已经聊到别的地方了）。
  // 09-13 真机复现修复：光加这一行不够——之前的问句仍然是笼统的 "Is THIS PAGE relevant"，
  // 模型会把 title 和 snippet 当成同等权重的两条线索去综合，一个強相关的旧标题（"Basic
  // English grammar"）就能把一条明显跑题的新消息（"provide a tour plan to Crete"）平均
  // 成 RELEVANT。真正想问的是"用户刚问的这句话"是否相关，标题只是背景，不该参与投票——
  // 所以有 snippet 时问句本身要换成问 snippet，并且明说标题可能是旧话题、不能当作当前证据。
  const hasSnippet = !!input.contentSnippet;
  const snippetLine = input.contentSnippet
    ? `\nThey just typed this in the page: "${input.contentSnippet}"\n`
    : '';
  const question = hasSnippet
    ? `Question: Is the message they just typed — NOT the page title — relevant to the declared task?
This is an ongoing AI chat; the title reflects only the topic the conversation *started* with and may now be stale. Judge the most recent message on its own; a strongly on-task title does not make an off-task message relevant.`
    : `Question: Is THIS PAGE relevant to the declared task?
Judge by the page's specific content (title + path), not by the domain's general nature.`;
  return `You are a relevance classifier for a focus-assistant browser extension.

The user declared their current task as:
"${input.taskDeclaration}"

They are currently viewing this page:
- URL: ${input.url}
- Title: ${input.title}
${snippetLine}
${question}
For example, youtube.com can be relevant (a tutorial) or irrelevant (entertainment) — decide per page.
A question about prerequisite or foundational knowledge for the task counts as relevant too —
e.g. if the task is "study neural networks", asking "how much calculus do I need to know" or
"tutorial on classical machine learning basics" is RELEVANT (it's the groundwork for the task),
not a tangent. Don't require the exact task keywords to appear — infer topical closeness.
But "prerequisite" means a genuine dependency for THIS specific task, not just belonging to the
same broad category — e.g. if the task is "study english", a question about "how to learn Swedish"
is IRRELEVANT (a different language, not a stepping stone toward English), even though both are
"language learning". Calculus is a real dependency of neural networks; Swedish is not a dependency
of English, they're siblings under the same category. Don't let a shared category alone justify RELEVANT.

Answer with exactly one of:
RELEVANT   — it directly supports the task (docs, code, related video/article, an on-task message in an AI chat)
IRRELEVANT — it is clearly off-task entertainment/social/shopping, or (in a chat) an off-task message
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
  // 09-05 真机反馈：同一个标题两次分类给出过不同判定（UNKNOWN 一次、IRRELEVANT 一次）——
  // 分类是"是/否"判断，一致性比多样性重要，temperature=0 让同样的输入尽量给出同样的答案
  // （见 groq.ts callGroq 顶部注释；这个默认值只影响这里，不影响 starter-coach.ts）。
  // 09-11 真机复现：这条调用一直没传 maxTokens，吃 groq.ts 里的默认值 200——gpt-oss-20b
  // 是推理模型，reasoning 的 token 算进 max_tokens（groq.ts 顶部注释记过同一个坑：起步教练
  // 09-05 之前也踩过，200 的预算被 reasoning 吃掉大半，JSON 写到一半被截断）。分类的 prompt
  // 平时确实短，200 大多数时候够用（这也是当初选它的理由），但这次真机日志里能看到原始响应
  // 文本是 `{"verdict":"IRRELEVANT","confidence`——模型已经算出了正确答案，只是没写完就被
  // 截断，JSON.parse 自然失败，只能保守落回 UNKNOWN。不是分类判断力的问题，是预算不够。
  // 500 给了明显的余量，分类调用本身走 Groq 很快，多这点 token 预算不影响体感速度。
  const text = await callGroq(GROQ_CLASSIFY_MODEL, buildPrompt(input), { temperature: 0, maxTokens: 500 });
  if (!text) return 'UNKNOWN'; // callGroq 已经打过日志说明具体是没配 key / 请求失败 / 超时中的哪一种

  const parsed = extractJsonObject(text) as { verdict?: unknown; confidence?: unknown } | null;
  if (!parsed || !isValidVerdict(parsed.verdict)) {
    // 09-11：不是每次解析失败都是"截断"，但截断是最容易漏诊的一种——响应文本看起来完全正常，
    // 只是缺了收尾。加一个纯字符串判断的提示，下次再撞见不用再靠肉眼数括号猜。
    const looksTruncated = !text.trim().endsWith('}');
    console.warn(
      `[Anchor SW] Groq classify: response did not parse as expected JSON${looksTruncated ? ' (looks truncated — likely ran out of max_tokens before finishing)' : ''}`,
      text
    );
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
