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
    const label = frame.currentTitle.trim() || UNTITLED_PAGE_FALLBACK;
    return `You've been sitting still on "${label}" for a while — stuck on something, or just deep in thought?`;
  }

  // DRIFT
  const label = frame.lastAnchorSnapshot.title.trim() || UNTITLED_TASK_FALLBACK;
  const elapsed = describeElapsed(minutesAgo(frame.lastAnchorSnapshot.ts, now));
  return `You drifted from "${label}" ${elapsed} — still around it somewhere, or did your mind wander?`;
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