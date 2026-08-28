// Anchor · B7 check-in / 微重启措辞 v1（Day 6–8）
// 依赖：B1（DetectionResult/FeatureFrame 已就绪）；J5 前需备好。
// 分工v2.md §2/§3："全部对话措辞...像朋友不像监工"，★ v4：check-in 措辞数据源是 lastAnchorSnapshot。
//
// 范围取舍：这里直接吃 FeatureFrame（而不是等一个目前还没人真正组装出来的完整 DetectionResult——
// evaluateFrame() 现在只返回 action 这个窄类型，DetectionResult.lastAnchorSnapshot/currentTitle
// 的组装是状态机/调用方接线时的事，不在 B7 范围内），FeatureFrame 本身已经带着"辅助，仅供措辞用"
// 的 lastAnchorSnapshot/currentTitle/currentDomain（types.ts 里原话），够 v1 版本用了。
// v2/v3 措辞反复调（B11，阶段二）时如果需要更多上下文，再扩这里的参数。
//
// 英文项目：全部字符串都是用户会看到的对话文案，统一英文。
import { FeatureFrame, CheckInChannel, CheckInAnswer } from './types';

function minutesAgo(ts: number, now: number): number {
  return Math.max(0, Math.round((now - ts) / 60_000));
}

function describeElapsed(minutes: number): string {
  if (minutes <= 0) return 'just now';
  if (minutes === 1) return '1 minute ago';
  return `${minutes} minutes ago`;
}

// 兜底文案：lastAnchorSnapshot.title / frame.currentTitle 为空时用（比如还没真正产出过快照、
// 或者起步教练被跳过、用户压根没声明锚点）——不能让措辞里出现空字符串拼出来的裸引号 "" 。
const UNTITLED_TASK_FALLBACK = 'what you were working on';
const UNTITLED_PAGE_FALLBACK = 'this';

// 08-28 真机测试：真实页面标题（YouTube 标题动辄 60-80 字符）会把气泡撑得比设计时预留的高度
// 还高，长到能顶穿 side panel 顶部、盖到 Chrome 原生的扩展标题栏下面。裁掉过长标题，气泡高度
// 才有个上限，顺带也是更好读的措辞——一整条没截断的视频标题堆在对话气泡里本身就不像朋友说话。
// ── B11：变体选择（阶段二"措辞反复调"）─────────────────────────────────────
// 每种情况只有一句固定文案时，一次会话里触发两三次 check-in（冷却 5 分钟，demo 里很容易）
// 就会看到一模一样的句子重复出现——那一瞬间"像朋友"的错觉就没了，变成很明显的模板机器人。
//
// 选择方式刻意用"按 now 的分钟数取模"而不是 Math.random()：
//   ① 测试可断言（同一个 now 永远出同一句），不会 flaky；
//   ② demo 可预演（走查时看到的就是现场会出的那句，不会临场抽到没排练过的文案）；
//   ③ 两次 check-in 之间至少隔 5 分钟冷却，分钟数必然不同，所以实际观感就是"每次都不一样"。
// 不用担心同一次 check-in 期间文案跳变：buildCheckInMessage() 每次触发只被调用一次
// （panel.ts 的 toPanelState → 写进 PanelState 存 storage），面板之后只显示存下来的那个字符串。
function pickVariant<T>(pool: readonly T[], now: number): T {
  const minutes = Math.floor(now / 60_000);
  // now 可能是负数或 NaN（测试里的极端值 / 时钟异常），取模后要保证落在合法下标内。
  const idx = Number.isFinite(minutes) ? ((minutes % pool.length) + pool.length) % pool.length : 0;
  return pool[idx];
}

const MAX_TITLE_LENGTH = 60;
function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * check-in 气泡文案。DRIFT 和 STUCK 用的上下文不一样：
 *   DRIFT  → 用户已经离开锚点，问的是"你离开的那件事"，数据源是 lastAnchorSnapshot（最后一次
 *            有意义的锚点交互，不是任意一帧、更不是走神后的当前页——见 integration.test.ts 场景25）。
 *   STUCK  → 用户还在锚点相关页面上，只是长时间不动，问的是"你现在停留的这件事"，数据源是
 *            frame.currentTitle（就是当前页，不是"离开的"那件事，因为压根没离开）。
 * 语气要求（分工v2.md："像朋友不像监工"）：疑问句，给两个体面的台阶（专注/查资料），不是指控。
 */
// 三个变体的共同约束（wording.test.ts 会对每一条逐一断言，以后改文案别破坏）：
//   · 必须引用那件事的标题（DRIFT 用 lastAnchorSnapshot，STUCK 用当前页）
//   · 必须带上"多久以前"这类时间线索
//   · 必须以问号收尾，且给两个体面的台阶——不能只留"你走神了"这一种解释
//   · 不能出现 should / stop / focus! / again 这类说教词
const DRIFT_TEMPLATES: readonly ((title: string, elapsed: string) => string)[] = [
  (t, e) => `You drifted from "${t}" ${e} — still around it somewhere, or did your mind wander?`,
  (t, e) => `"${t}" has been sitting there since ${e} — still circling it, or did something else catch you?`,
  (t, e) => `Last I saw you on "${t}", ${e} — heading back to it, or is this the thing now?`,
];

// 快照还没产出过时的兜底也做了变体：这条在真机上其实很常见（用户声明完任务、还没来得及
// 在锚点页面上动一下就飘走了），只有一句的话重复感反而比正常路径更明显。
const DRIFT_UNTITLED_TEMPLATES: readonly (() => string)[] = [
  () => `You drifted from ${UNTITLED_TASK_FALLBACK} — still around it somewhere, or did your mind wander?`,
  () => `Looks like ${UNTITLED_TASK_FALLBACK} got left behind — still on it, or did something else catch you?`,
];

const STUCK_TEMPLATES: readonly ((title: string) => string)[] = [
  (t) => `You’ve been sitting still on "${t}" for a while — stuck on something, or just deep in thought?`,
  (t) => `"${t}" hasn’t moved in a while — thinking it through, or stuck on a tricky bit?`,
  (t) => `Still on "${t}" — is it a hard part, or just a thinking pause?`,
];

/**
 * check-in 气泡文案。DRIFT 和 STUCK 用的上下文不一样：
 *   DRIFT  → 用户已经离开锚点，问的是"你离开的那件事"，数据源是 lastAnchorSnapshot（最后一次
 *            有意义的锚点交互，不是任意一帧、更不是走神后的当前页——见 integration.test.ts 场景25）。
 *   STUCK  → 用户还在锚点相关页面上，只是长时间不动，问的是"你现在停留的这件事"，数据源是
 *            frame.currentTitle（就是当前页，不是"离开的"那件事，因为压根没离开）。
 * 语气要求（分工v2.md："像朋友不像监工"）：疑问句，给两个体面的台阶（专注/查资料），不是指控。
 *
 * B11：同一种情况有多个变体，按 now 确定性地轮换（见 pickVariant 注释）。
 */
export function buildCheckInMessage(
  channel: CheckInChannel,
  frame: Pick<FeatureFrame, 'lastAnchorSnapshot' | 'currentTitle'>,
  now: number
): string {
  if (channel === 'STUCK') {
    const label = truncateTitle(frame.currentTitle.trim()) || UNTITLED_PAGE_FALLBACK;
    return pickVariant(STUCK_TEMPLATES, now)(label);
  }

  // DRIFT
  const snapshot = frame.lastAnchorSnapshot;
  const title = snapshot.title.trim();

  // 退化情况：这次会话里还没有过"锚点页面上的有意义交互"（perceiver.ts 的 computeAnchorSignal
  // 要求 isAnchor + ACTIVE_INPUT/PASSIVE_SCROLL/MEDIA_PAUSE/MEDIA_SEEK 才写快照），
  // 快照仍是初始值 { title: '', url: '', ts: 0 }。这时 ts=0 会让"多久以前"算成 now-0，
  // 也就是从 1970 年算起的分钟数（真机上见过 29798077 minutes ≈ 56 年）——宁可不说时间，
  // 也不能说一个一眼假的数字，那比没有信息更伤可信度。
  if (!title || snapshot.ts <= 0) {
    return pickVariant(DRIFT_UNTITLED_TEMPLATES, now)();
  }

  const elapsed = describeElapsed(minutesAgo(snapshot.ts, now));
  return pickVariant(DRIFT_TEMPLATES, now)(truncateTitle(title), elapsed);
}

/**
 * 用户点了气泡里的按钮之后，紧跟着的一句短反馈（"微重启"这一步的措辞，契约v4 §3.6/场景17：
 * 答"飘了"→ 微重启+重置阶梯；这里只管说什么，重置阶梯是 detector.ts 的 applyCheckInFeedback 已经在做的事）。
 * 一句话，不说教、不追问第二句——像朋友确认一下就翻篇，不是监工继续盘问。
 */
// 三种回答各自的变体池。B11 同样是为了消重复感——但这里比 check-in 更需要克制：
// 这是"确认一下就翻篇"的一句话，任何一个变体多说半句都会变成盘问。
// 三个池的内容必须互不重叠（测试断言三种回答产出的文案永远不相同）。
const MICRO_RESTART_TEMPLATES: Record<CheckInAnswer, readonly string[]> = {
  FOCUSED: ['Good, carry on.', 'Got it — carrying on.', 'All yours.'],
  // 不能出现 sorry / wrong / mistake：用户答"我在查资料"不是在道歉，桌宠也没做错什么，
  // 说"抱歉打扰了"反而把一次正常的确认变成双方都尴尬的事。
  FALSE_POSITIVE: ["Got it — I’ll leave that be.", "Noted — I’ll count that one as work.", 'Fair enough.'],
  // 不能出现 again / why / should have：用户刚承认自己飘了，这时候任何一点"你又来了"的
  // 味道都是监工不是朋友。只说"没事，回去吧"。
  DRIFTED: ["No worries, let’s head back.", 'Happens — back to it.', "Right, let’s pick that back up."],
};

/**
 * 用户点了气泡里的按钮之后，紧跟着的一句短反馈（"微重启"这一步的措辞，契约v4 §3.6/场景17：
 * 答"飘了"→ 微重启+重置阶梯；这里只管说什么，重置阶梯是 detector.ts 的 applyCheckInFeedback 已经在做的事）。
 * 一句话，不说教、不追问第二句——像朋友确认一下就翻篇，不是监工继续盘问。
 *
 * @param now 变体轮换用。可选：不传按 0，取每个池的第一个变体——这样 B7 时期只传一个参数的
 *            老调用方（panel.ts）行为完全不变，不用被迫一起改。
 */
export function buildMicroRestartMessage(answer: CheckInAnswer, now = 0): string {
  return pickVariant(MICRO_RESTART_TEMPLATES[answer], now);
}

// ── 休息模式措辞（契约v4 §3.8，场景23）──────────────────────────────────────
// 引擎侧 startRest()/restReminderDue() B1 早就写好也测过，但一直没有任何 UI 调用它们；
// 这几句是补上这条链路时缺的"话"。语气跟 check-in 一致：像朋友问一句，不是监工催你回去。

/**
 * 用户刚点下"休息"时的一句确认。不说"计时开始"这种功能性描述——
 * 用户要的是"知道它不会再打扰我了"这个安心感。
 */
export function buildRestStartMessage(): string {
  return "Taking a break — I'll stay quiet.";
}

/**
 * 休息满 15 分钟起的轻声提醒，之后每 5 分钟重复一次（节拍由 restReminderDue() 判定，
 * 这里只负责说什么）。带上"已经休息了多久"有两个作用：给用户一个真实的判断依据，
 * 以及让每 5 分钟重复一次的提醒不会是一模一样的一句话（连着看十遍同样的文案很烦人）。
 */
export function buildRestReminderMessage(restedMinutes: number): string {
  const rounded = Math.max(1, Math.round(restedMinutes));
  const unit = rounded === 1 ? 'minute' : 'minutes';
  return `You’ve been resting ${rounded} ${unit} — ready to pick things back up?`;
}

/**
 * 用户在提醒里点了"继续专注"之后的一句短反馈——跟 buildMicroRestartMessage() 同一个定位：
 * 一句话确认就翻篇，不追问第二句。
 */
export function buildRestEndMessage(): string {
  return 'Welcome back.';
}

// ── 收尾反思措辞（J7 最后一环 / B15 最小版）─────────────────────────────────
// 这一屏的语气比 check-in 更要小心：用户刚结束一场专注，此刻最不想看到的是一张成绩单。
// 原则：只陈述发生了什么，不打分、不评判、不鼓励式说教（"你真棒！"跟"你本可以更好"
// 一样都是在评价用户）。数字自己会说话，我们只负责把它摆得体面。

function describeDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 1) return 'less than a minute';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hPart = h > 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '';
  const mPart = m > 0 ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '';
  return [hPart, mPart].filter(Boolean).join(' ');
}

/** 收尾视图顶部的一句话。刻意不带感叹号——这是收工，不是庆功。 */
export function buildSessionSummaryHeadline(durationMs: number): string {
  return `That was ${describeDuration(durationMs)} of work.`;
}

/**
 * check-in 次数那一行。★ 零次是最常见也最容易写砸的情况：说"我一次都没打扰你"听起来
 * 像在邀功，说"没有检测到走神"又是在报告系统状态——这一行的正确定位是"顺带一提"，
 * 所以零次时干脆什么都不说（返回 null，调用方不渲染这一行）。
 */
export function buildCheckInTally(answeredCheckIns: number): string | null {
  if (answeredCheckIns <= 0) return null;
  const times = answeredCheckIns === 1 ? 'once' : `${answeredCheckIns} times`;
  return `We checked in ${times}.`;
}

/** 休息次数那一行。同样零次不说。 */
export function buildRestTally(rests: number): string | null {
  if (rests <= 0) return null;
  return rests === 1 ? 'You took one break.' : `You took ${rests} breaks.`;
}

/** 收尾视图底部那句收束。不问"下次要不要做得更好"，只是把门留开着。 */
export function buildSessionSummaryFooter(): string {
  return 'Whenever you’re ready for the next one.';
}
