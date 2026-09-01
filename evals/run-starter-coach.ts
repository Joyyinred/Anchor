// Anchor · 起步教练评测集跑分脚本（B12，09-01）
//
// 用法：
//   set GROQ_API_KEY=...            (PowerShell: $env:GROQ_API_KEY = "...")
//   npm run eval:coach
//   npm run eval:coach -- --runs 3  同一批用例连跑 3 次，看抖动
//
// ★ 这个脚本**永远不进 `npm test`**：它打真实网络、结果非确定性、要花 key 的额度。
//   `npm test` 那套必须离线且确定性——规则层自己的单测在 evals/rules.test.ts，那个进。
//
// ★ prompt 直接 import 生产代码里的 buildPrompt()，不在这里复制一份。
//   复制的话就是"评测跑 A 版、用户看 B 版"，分数完全没有意义（08-29 文档/代码漂移的同一个坑）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPrompt } from '../src/platform/background/starter-coach';
import { checkFirstAction, classifyShape, type Violation } from './rules';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';
// 跟生产一致：gpt-oss 的 reasoning 计入 max_tokens，200 会把 JSON 截断（08-29 实测）。
// ★ 不能为了跑得快把它调小——评测必须跟生产同参数，否则分数量的不是同一个东西。
const MAX_TOKENS = 1000;
const REQUEST_TIMEOUT_MS = 20_000;

// ── 限流（09-01 第一次真机跑分就撞上了：12 条里 8 条 429）──
// Groq 免费层 gpt-oss-120b 是 **8000 tokens/分钟**（TPM，不是 RPM）。
// 一次调用最坏 ≈600 prompt + 1000 completion ≈ 1600 tokens，也就是**一分钟最多五六次**。
// 串行不并发只解决了"同时打过去"，解决不了"一分钟内打太多次"，所以这里必须主动放慢。
const BASE_DELAY_MS = 12_000; // 每条之间固定等一会儿，稳态下压在 TPM 之内
const MAX_RETRIES = 4; // 429 之后的重试次数
const DEFAULT_RETRY_AFTER_MS = 25_000; // 响应头没给 retry-after 时的兜底等待

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EvalCase {
  id: string;
  task: string;
  why: string;
  /** 用户声明任务那一刻开着的页面（v5 起支持）。不填 = 测无上下文那条分支。 */
  anchor?: { title: string; url: string };
  /** 标注"这个页面跟任务无关"——产出里出现它就是把无关页面硬凑进来了，见 rules.ts。 */
  anchorShouldBeIgnored?: boolean;
  /** 标注"这个页面跟任务相关"——产出还是去搜索就是白给的材料没用上，见 rules.ts。 */
  anchorShouldBeUsed?: boolean;
}

interface CaseResult {
  id: string;
  task: string;
  hasAnchor: boolean;
  /** 'none' | 'use'（相关，必须用上）| 'ignore'（无关，必须忽略）——形态分布要按这个分组，混在一起读不出结论。 */
  anchorKind: 'none' | 'use' | 'ignore';
  firstAction: string | null;
  /** 调用/解析层面的失败（跟 prompt 质量无关，要跟规则违规分开统计） */
  error: string | null;
  violations: Violation[];
}

function loadCases(): EvalCase[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, 'starter-coach.cases.json'), 'utf8');
  return (JSON.parse(raw) as { cases: EvalCase[] }).cases;
}

/** 一次请求，不含重试。429 单独回报，交给外层决定等多久。 */
async function callOnce(
  prompt: string,
  apiKey: string
): Promise<{ ok: true; text: string | null } | { ok: false; rateLimited: boolean; retryAfterMs: number }> {
  // 不复用 src/platform/background/groq.ts：那个的 key 走 chrome.storage.local，
  // 这里跑在 Node 里没有 chrome。只有取 key 的方式不同，请求体保持一致。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });
    if (res.status === 429) {
      // Groq 会在 retry-after 里给出还要等几秒（可能是小数）——听它的比自己猜准。
      const header = res.headers.get('retry-after');
      const parsed = header ? Number(header) * 1000 : NaN;
      return {
        ok: false,
        rateLimited: true,
        retryAfterMs: Number.isFinite(parsed) && parsed > 0 ? parsed + 1_000 : DEFAULT_RETRY_AFTER_MS,
      };
    }
    if (!res.ok) {
      console.error(`  ! Groq ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return { ok: false, rateLimited: false, retryAfterMs: 0 };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { ok: true, text: data.choices?.[0]?.message?.content ?? null };
  } catch (err) {
    console.error('  ! 请求失败（网络/超时）：', err);
    return { ok: false, rateLimited: false, retryAfterMs: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

/** 带 429 退避重试。限流是环境问题不是 prompt 问题，绝不能让它污染分数。 */
async function callGroqDirect(prompt: string, apiKey: string): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await callOnce(prompt, apiKey);
    if (res.ok) return res.text;
    if (!res.rateLimited) return null;
    if (attempt === MAX_RETRIES) {
      console.error(`  ! 限流重试 ${MAX_RETRIES} 次仍未通过，这条记为调用失败`);
      return null;
    }
    const waitMs = res.retryAfterMs * (attempt + 1); // 线性退避，够用且好预测
    console.error(`  · TPM 限流，等 ${Math.round(waitMs / 1000)}s 后重试（第 ${attempt + 1}/${MAX_RETRIES} 次）`);
    await sleep(waitMs);
  }
  return null;
}

function extractFirstAction(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { firstAction?: unknown };
    return typeof parsed.firstAction === 'string' && parsed.firstAction.trim() ? parsed.firstAction : null;
  } catch {
    return null;
  }
}

async function runOnce(cases: EvalCase[], apiKey: string): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const [i, c] of cases.entries()) {
    // 串行 + 主动放慢：免费层是 8000 TPM，一分钟只够五六次调用。
    // 并发或不间断串行都会吃 429，而那种失败会被误读成"prompt 变差了"。
    if (i > 0) await sleep(BASE_DELAY_MS);
    process.stdout.write(`  [${i + 1}/${cases.length}] ${c.id} … `);
    const anchorKind: CaseResult['anchorKind'] = !c.anchor
      ? 'none'
      : c.anchorShouldBeIgnored
        ? 'ignore'
        : 'use';
    const text = await callGroqDirect(buildPrompt(c.task, c.anchor), apiKey);
    process.stdout.write(text === null ? '失败\n' : '完成\n');
    const firstAction = extractFirstAction(text);
    if (!firstAction) {
      results.push({ id: c.id, task: c.task, hasAnchor: c.anchor !== undefined, anchorKind, firstAction: null, error: text === null ? 'CALL_FAILED' : 'UNPARSEABLE', violations: [] });
      continue;
    }
    const ignoredAnchor = c.anchorShouldBeIgnored ? c.anchor : undefined;
    results.push({
      id: c.id,
      task: c.task,
      hasAnchor: c.anchor !== undefined,
      anchorKind,
      firstAction,
      error: null,
      violations: checkFirstAction(firstAction, c.task, ignoredAnchor, c.anchorShouldBeUsed),
    });
  }
  return results;
}

function report(all: CaseResult[][], cases: EvalCase[]): void {
  const runs = all.length;
  console.log('\n' + '='.repeat(78));
  console.log(`起步教练评测结果  ·  ${cases.length} 条用例 × ${runs} 轮  ·  模型 ${MODEL}`);
  console.log('='.repeat(78) + '\n');

  for (const [i, c] of cases.entries()) {
    const perRun = all.map((r) => r[i]);
    const passes = perRun.filter((r) => r.error === null && r.violations.length === 0).length;
    const mark = passes === runs ? '✅' : passes === 0 ? '❌' : '⚠️ ';
    console.log(`${mark} [${c.id}]  ${passes}/${runs} 通过`);
    console.log(`   任务: ${c.task}`);
    if (c.anchor) console.log(`   开着: "${c.anchor.title}"${c.anchorShouldBeIgnored ? '   ← 无关，必须被忽略' : ''}`);
    for (const r of perRun) {
      if (r.error) {
        console.log(`   → (调用失败: ${r.error})`);
        continue;
      }
      const tag = r.violations.length === 0 ? 'ok  ' : 'FAIL';
      console.log(`   → ${tag} "${r.firstAction}"`);
      for (const v of r.violations) console.log(`          · ${v.code}: ${v.detail}`);
    }
    console.log('');
  }

  const flat = all.flat();
  const usable = flat.filter((r) => r.error === null);
  const passed = usable.filter((r) => r.violations.length === 0).length;
  const rate = usable.length > 0 ? Math.round((passed / usable.length) * 100) : 0;

  console.log('-'.repeat(78));
  console.log(`通过率: ${passed}/${usable.length}  (${rate}%)` + (flat.length !== usable.length ? `   [另有 ${flat.length - usable.length} 次调用失败，不计入]` : ''));

  const byCode = new Map<string, number>();
  for (const r of usable) for (const v of r.violations) byCode.set(v.code, (byCode.get(v.code) ?? 0) + 1);
  if (byCode.size > 0) {
    console.log('\n失败模式归类（改 prompt 时优先打分最高的那一类）：');
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)} × ${code}`);
    }
  }

  // 形态分布：逐条断言看不见"每条都合规但全是同一招"，只能在整批上看。
  // ★ v5 起按"有没有当前页面"分两组打印：**这两组的差值就是 anchorContext 到底值不值**。
  //   合在一起看会被稀释——真正要回答的问题是"给了页面之后，它还只会搜索吗"。
  const shapeTable = (rows: CaseResult[], label: string): void => {
    if (rows.length === 0) return;
    const byShape = new Map<string, number>();
    for (const r of rows) {
      if (r.firstAction) byShape.set(classifyShape(r.firstAction), (byShape.get(classifyShape(r.firstAction)) ?? 0) + 1);
    }
    console.log(`\n动作形态分布 · ${label}（n=${rows.length}）：`);
    const sorted = [...byShape.entries()].sort((a, b) => b[1] - a[1]);
    for (const [shape, n] of sorted) {
      const pct = Math.round((n / rows.length) * 100);
      console.log(`  ${String(n).padStart(3)} × ${shape.padEnd(14)} ${'█'.repeat(Math.round(pct / 5))} ${pct}%`);
    }
    const [topShape, topN] = sorted[0] ?? ['', 0];
    if (topN / rows.length > 0.6) {
      console.log(`  ⚠️  ${topShape} 占了 ${Math.round((topN / rows.length) * 100)}%——每条都合规，但模型只会这一招。`);
      console.log('      逐条通过率看不出这个问题，改 prompt 时要一起盯。');
    }
  };
  // ★ 三组分开，不能只按"有没有页面"分两组（09-01 第一次 v5 跑分时我就是这么读错的）：
  //   无关页面那两条**本来就该退回搜索**，把它们和相关页面混在一起，SEARCH 占比毫无意义。
  shapeTable(usable.filter((r) => r.anchorKind === 'none'), '无当前页面（对照组）');
  shapeTable(usable.filter((r) => r.anchorKind === 'use'), '页面相关 · 期望用上它');
  shapeTable(usable.filter((r) => r.anchorKind === 'ignore'), '页面无关 · 期望忽略它（SEARCH/WRITE 才是对的）');
  console.log('-'.repeat(78) + '\n');
}

async function main(): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('缺少 GROQ_API_KEY 环境变量。');
    console.error('  PowerShell:  $env:GROQ_API_KEY = "你的key"');
    console.error('  bash:        export GROQ_API_KEY=你的key');
    process.exitCode = 1;
    return;
  }
  const runsArg = process.argv.indexOf('--runs');
  const runs = runsArg !== -1 ? Number(process.argv[runsArg + 1]) || 1 : 1;
  const cases = loadCases();

  console.log(`跑 ${cases.length} 条用例 × ${runs} 轮，串行调用，请稍等…`);
  const all: CaseResult[][] = [];
  for (let i = 0; i < runs; i += 1) {
    if (runs > 1) console.log(`\n—— 第 ${i + 1}/${runs} 轮 ——`);
    all.push(await runOnce(cases, apiKey));
  }
  report(all, cases);
}

void main();
