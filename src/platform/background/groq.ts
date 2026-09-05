// Anchor · Groq（OpenAI 兼容）API 的共用 fetch 封装——两个不同用途共用同一个 helper：
// - classifier.ts：域名/页面相关性分类，gpt-oss-20b，高频、每页一次、追求速度
// - starter-coach.ts：起步教练第一步拆解，gpt-oss-120b，低频、追求措辞质量
// key 走 chrome.storage.local（跟 anchor_llm_api_key/anchor_demo_mode 同一个模式，手动控制台配置）。
const GROQ_API_KEY_STORAGE_KEY = 'anchor_groq_api_key';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 10_000;

export async function getGroqApiKey(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(GROQ_API_KEY_STORAGE_KEY);
  return stored[GROQ_API_KEY_STORAGE_KEY] as string | undefined;
}

/**
 * 单轮 chat completion，返回模型原始文本回复——不在这里假设内容是不是 JSON，
 * 分类 / 起步教练各自的调用方自己按各自的输出约定解析。
 * 任何失败（没配 key / 网络 / 超时 / 非 2xx）都返回 null，从不 throw——
 * 调用方（classifier.ts/starter-coach.ts）按各自的降级策略处理 null。
 */
// ★ 08-29：max_tokens 从写死 200 改成可选参数。
// gpt-oss 是**推理模型**，reasoning 的 token 算进 max_tokens——prompt 越复杂推理越长。
// 真机实测（起步教练 v1 prompt，422 prompt tokens）：200 的预算里 182 被 reasoning 吃掉，
// 只剩 18 个给 content，JSON 写到一半就被截断（finish_reason: "length"），解析必然失败。
// 默认值保持 200 是刻意的：A 侧分类的 prompt 短、输出也短，200 够用且省钱，行为一字不变；
// 只有确实需要更大预算的调用方（起步教练）才显式传。
export async function callGroq(
  model: string,
  userPrompt: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string | null> {
  const apiKey = await getGroqApiKey();
  // 08-28 真机测试：contextRelevance 长期卡 UNKNOWN，排查了很久才发现是 storage.local.clear()
  // 顺手把 Groq key 也清掉了——这条路径原来完全没有日志，没配 key/请求失败/低置信度这三种
  // 情况在 UI 上看起来一模一样，都是"分类不出来"。补上诊断日志，下次一眼就能看出是哪一种。
  if (!apiKey) {
    console.warn('[Anchor SW] Groq API key not configured — set anchor_groq_api_key in chrome.storage.local');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: options.maxTokens ?? 200,
        // 09-05：只在调用方显式传的时候才带这个字段——不像 maxTokens 那样给全局默认值。
        // classifier.ts 会显式传 0（真机反馈：没有这个参数时同一段输入两次调用给出过不同
        // 判定，同一个标题一次 UNKNOWN 一次 IRRELEVANT，分类这种"是/否"判断一致性比多样性
        // 重要）；starter-coach.ts 不传，维持它一直以来的行为不变，不因为这次改动被连带
        // 影响——它要的是措辞质量，不是判断一致性，两个调用方的需求方向不一样。
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn('[Anchor SW] Groq request failed', response.status, await response.text().catch(() => ''));
      return null;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn('[Anchor SW] Groq request errored (network/timeout)', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// 模型偶尔会不听指令包一层 markdown 代码块——找第一个 {...} 块，不假设整段 text 就是纯 JSON。
// classifier.ts 和 starter-coach.ts 共用这一份，各自再对解析出来的对象做自己的字段校验
// （两边要的字段形状不一样，不适合把校验也塞进这个共用函数里）。
export function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
