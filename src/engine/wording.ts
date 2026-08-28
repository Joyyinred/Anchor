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
export function buildCheckInMessage(
  channel: CheckInChannel,
  frame: Pick<FeatureFrame, 'lastAnchorSnapshot' | 'currentTitle'>,
  now: number
): string {
  if (channel === 'STUCK') {
    const label = truncateTitle(frame.currentTitle.trim()) || UNTITLED_PAGE_FALLBACK;
    return `You've been sitting still on "${label}" for a while — stuck on something, or just deep in thought?`;
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
    return `You drifted from ${UNTITLED_TASK_FALLBACK} — still around it somewhere, or did your mind wander?`;
  }

  const elapsed = describeElapsed(minutesAgo(snapshot.ts, now));
  return `You drifted from "${truncateTitle(title)}" ${elapsed} — still around it somewhere, or did your mind wander?`;
}

/**
 * 用户点了气泡里的按钮之后，紧跟着的一句短反馈（"微重启"这一步的措辞，契约v4 §3.6/场景17：
 * 答"飘了"→ 微重启+重置阶梯；这里只管说什么，重置阶梯是 detector.ts 的 applyCheckInFeedback 已经在做的事）。
 * 一句话，不说教、不追问第二句——像朋友确认一下就翻篇，不是监工继续盘问。
 */
export function buildMicroRestartMessage(answer: CheckInAnswer): string {
  switch (answer) {
    case 'FOCUSED':
      return 'Good, carry on.';
    case 'FALSE_POSITIVE':
      return "Got it — I'll leave that be.";
    case 'DRIFTED':
      return "No worries, let's head back.";
  }
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