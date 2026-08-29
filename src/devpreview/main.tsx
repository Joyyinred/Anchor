// 只是本地看一眼各态长什么样，不参与扩展的真实构建。
// 跑法：npx vite --config Devpreview.vite.config.ts   然后打开终端里打印的地址
import { createRoot } from 'react-dom/client';
import { CuteAnchorPet } from '../pet/cat';
import { SummaryPanel } from '../sidepanel/SummaryPanel';
import {
  buildCheckInMessage,
  buildMicroRestartMessage,
  buildRestReminderMessage,
} from '../engine/wording';
import type { CheckInAnswer } from '../pet/types';

const log = (...args: unknown[]) => console.log(...args);

// ── 第一排：五个状态 ─────────────────────────────────────────
createRoot(document.getElementById('a')!).render(
  <CuteAnchorPet
    state="companion"
    focusedMinutes={12}
    onRestStart={() => log('REST_START')}
    onSessionEnd={() => log('SESSION_END')}
  />
);
createRoot(document.getElementById('b')!).render(
  <CuteAnchorPet
    state="observing"
    onRestStart={() => log('REST_START')}
    onSessionEnd={() => log('SESSION_END')}
  />
);
createRoot(document.getElementById('c')!).render(
  <CuteAnchorPet
    state="checkin"
    channel="DRIFT"
    message="You drifted from that login-page bug 10 minutes ago — still researching, or did you wander off?"
    onAnswer={(answer, channel) => log('answered:', answer, channel)}
    onRestStart={() => log('REST_START')}
    onSessionEnd={() => log('SESSION_END')}
  />
);
// 休息不是第四个 PetState：下面两格 state 都还是 'companion'，只是 isResting 打开了。
// 08-29：格 d 是"休息中但还没到提醒节拍"（比如刚休息 3 分钟）——修复前这一格是没有任何
// 按钮的死角，Back to it/Done for today 都焊死在提醒节拍上；现在两个按钮随时都在。
createRoot(document.getElementById('d')!).render(
  <CuteAnchorPet
    state="companion"
    isResting
    onRestEnd={() => log('REST_END')}
    onSessionEnd={() => log('SESSION_END')}
  />
);
createRoot(document.getElementById('e')!).render(
  <CuteAnchorPet
    state="companion"
    isResting
    message={buildRestReminderMessage(16)}
    onRestEnd={() => log('REST_END')}
    onSessionEnd={() => log('SESSION_END')}
  />
);

// ── 第二排：B11 措辞变体一览 ──────────────────────────────────
// 变体是按 now 的分钟数轮换的，所以这里用连续几个"整分钟"把每个池跑遍。
// 直接调真函数、不写死假文案——预览里看到的就是真机上会出的那几句。
const BASE = 1_700_000_000_000; // 任意固定基准，保证每次打开预览看到的顺序一致
const nowAt = (i: number) => BASE + i * 60_000;

function uniqueBy<T>(count: number, fn: (now: number) => T): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const v = fn(nowAt(i));
    const key = String(v);
    if (!seen.has(key)) { seen.add(key); out.push(v); }
  }
  return out;
}

const driftVariants = uniqueBy(8, (now) =>
  buildCheckInMessage(
    'DRIFT',
    { lastAnchorSnapshot: { title: 'login.tsx — auth bug', url: '', ts: now - 10 * 60_000 }, currentTitle: '' },
    now
  )
);
const stuckVariants = uniqueBy(8, (now) =>
  buildCheckInMessage('STUCK', { lastAnchorSnapshot: { title: '', url: '', ts: now }, currentTitle: 'thesis-ch3.pdf' }, now)
);
// 真机上很常见的退化路径：声明完任务还没在锚点页面上动一下就飘走了，快照是空的。
const untitledVariants = uniqueBy(8, (now) =>
  buildCheckInMessage('DRIFT', { lastAnchorSnapshot: { title: '', url: '', ts: 0 }, currentTitle: '' }, now)
);
// 标签用"用户实际点的那个按钮文字"，不用 CheckInAnswer 的枚举名——枚举名是内部标识符
// （FALSE_POSITIVE 是检测学里的"假阳性"，说的是系统判错了），评估文案时看着它容易出戏。
const ANSWER_LABELS: Record<CheckInAnswer, string> = {
  FOCUSED: '「Still focused」（我在专注）',
  FALSE_POSITIVE: '「Just researching」（判错了）',
  DRIFTED: '「Drifted - pull me back」（确实飘了）',
};

const microVariants = (['FOCUSED', 'FALSE_POSITIVE', 'DRIFTED'] as const).map((answer) => ({
  answer,
  lines: uniqueBy(8, (now) => buildMicroRestartMessage(answer as CheckInAnswer, now)),
}));

function VariantGroup({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="vg">
      <div className="vg-title">{title}<span className="vg-count">{lines.length} 个变体</span></div>
      <ol>{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
    </div>
  );
}

createRoot(document.getElementById('wording')!).render(
  <>
    <VariantGroup title="check-in · DRIFT（走神）" lines={driftVariants} />
    <VariantGroup title="check-in · STUCK（卡住）" lines={stuckVariants} />
    <VariantGroup title="check-in · DRIFT 无快照兜底" lines={untitledVariants} />
    {microVariants.map(({ answer, lines }) => (
      <VariantGroup key={answer} title={`微重启 · 用户点${ANSWER_LABELS[answer]}`} lines={lines} />
    ))}
    <VariantGroup title="休息提醒（随时长变化）" lines={[15, 20, 25, 30].map((m) => buildRestReminderMessage(m))} />
  </>
);

// ── 收尾反思（J7 最后一环）。两种：有统计 / 全程零打扰（统计行整个不渲染）──
createRoot(document.getElementById("summary1")!).render(
  <SummaryPanel
    summary={{
      taskDeclaration: "Study for tomorrow's data structures exam",
      startedTs: BASE,
      endedTs: BASE + 95 * 60_000,
      answeredCheckIns: 3,
      answers: { FOCUSED: 1, FALSE_POSITIVE: 1, DRIFTED: 1 },
      rests: 2,
    }}
    onRestart={() => log("SESSION_RESTART")}
  />
);
createRoot(document.getElementById("summary2")!).render(
  <SummaryPanel
    summary={{
      taskDeclaration: "Write the intro section of the report",
      startedTs: BASE,
      endedTs: BASE + 42 * 60_000,
      answeredCheckIns: 0,
      answers: { FOCUSED: 0, FALSE_POSITIVE: 0, DRIFTED: 0 },
      rests: 0,
    }}
    onRestart={() => log("SESSION_RESTART")}
  />
);
