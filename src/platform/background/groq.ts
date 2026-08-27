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
export async function callGroq(model: string, userPrompt: string): Promise<string | null> {
  const apiKey = await getGroqApiKey();
  if (!apiKey) return null;

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
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
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
