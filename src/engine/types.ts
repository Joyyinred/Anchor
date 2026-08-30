
// Anchor · 决策半（B）核心类型定义
// 来源：契约v4.md §2，逐字段照抄，不要擅自改字段名
// 契约 Types 定义 (FeatureFrame, SessionContext 等)


// ── SignalEvent：A 的原始信号（B 不需要直接消费，仅供理解上游）──
export interface SignalEvent {
  timestamp: number;
  domain: string;
  url: string;
  title: string;
  contentKind: 'code' | 'docs' | 'video' | 'short_feed' | 'social_feed'
             | 'article' | 'pdf' | 'ai_chat' | 'music' | 'unknown';
  isAnchor: boolean;
  interactionType: 'ACTIVE_INPUT' | 'PASSIVE_SCROLL' | 'IDLE' | 'HIDDEN'
                 | 'MEDIA_PLAY' | 'MEDIA_PAUSE' | 'MEDIA_SEEK';
  entryIntent: 'search' | 'direct_link' | 'feed' | 'autoplay' | 'unknown';
  systemIdle: boolean;
}

// ── FeatureFrame：A → B 的主缝，B 的所有判断都从这里读数据 ──
export interface FeatureFrame {
  timestamp: number;
  sessionId: string;

  // 四信号
  contextRelevance: 'RELEVANT' | 'IRRELEVANT' | 'UNKNOWN';
  anchorDetachedMs: number;
  texture: 'purposeful' | 'passive' | 'idle';
  jumpPattern: 'task_orbit' | 'rabbit_hole' | 'stable';

  // 扩展信号
  stillnessMs: number;
  entryIntent: 'purposeful' | 'feed_driven' | 'unknown';
  contentFormat: 'short_feed' | 'standard';

  // v4 新增
  systemIdle: boolean;
  lastAnchorSnapshot: {
    title: string;
    url: string;
    ts: number;
  };

  // 辅助（不参与判定，仅供措辞用）
  currentDomain: string;
  currentTitle: string;
  currentContentKind: SignalEvent['contentKind'];
}

// ── SessionContext：B 写 / A·B 读 ──
export interface SessionContext {
  sessionId: string;
  taskDeclaration: string;
  profile: SessionProfile;
  anchor: {
    domain: string;
    url: string;
    matchMode: 'exact' | 'prefix';
  };
  sessionWhitelist: string[];
  graceUntil: number;
}

export interface SessionProfile {
  archetype: 'CREATOR' | 'READER' | 'VIEWER' | 'COMMUNICATOR' | 'CUSTOM';
  policy: SignalPolicy;
}

export interface SignalPolicy {
  muteJumpPattern: boolean;
  mutePassiveTexture: boolean;
  stuckChannelEnabled: boolean;
  anchorDetachedThresholdMs: number;
  stuckLadderMs: number[];
}

// ★ v4 新增：策略校验器（防止 policy 字段缺省导致判断失控）
export function validatePolicy(p: SignalPolicy): SignalPolicy {
  // 兜底时拷贝一份 DEFAULT_STUCK_LADDER，不能直接把模块级常量的引用挂上去——
  // applyCheckInFeedback/调用方一旦以后有原地改 stuckLadderMs 的操作（本文件已有这个先例），
  // 会连带把这个全局共享常量也改坏，殃及所有走这条兜底路径的会话。
  if (p.stuckLadderMs.length === 0) p.stuckLadderMs = [...DEFAULT_STUCK_LADDER];
  if (p.anchorDetachedThresholdMs <= 0) p.anchorDetachedThresholdMs = DEFAULT_ANCHOR_THRESHOLD;
  return p;
}
export const DEFAULT_STUCK_LADDER = [10 * 60_000, 20 * 60_000];
export const DEFAULT_ANCHOR_THRESHOLD = 8 * 60_000;

// ── DetectionResult：B 的最终输出，喂给 UI 层 ──
export interface DetectionResult {
  action: 'DO_NOTHING' | 'CHECK_IN_DRIFT' | 'CHECK_IN_STUCK';
  lastAnchorSnapshot?: FeatureFrame['lastAnchorSnapshot'];
  currentTitle: string;
}

// ── CheckInFeedback：用户对一次 check-in 的回答（B2 自适应退让的输入，分工v2 §2 B 职责）──
// channel 记录这次 check-in 是哪个通道触发的，决定 answer 该怎么解读：
//   STUCK + FOCUSED       → "在专注"：阶梯往上走一格（契约v4 §3.6）
//   STUCK + DRIFTED       → "飘了"：微重启，阶梯重置回第 0 格
//   DRIFT + DRIFTED       → "飘了"：微重启，不涉及阶梯（DRIFT 没有阶梯概念）
//   DRIFT + FALSE_POSITIVE→ "我在查资料"/"没有"：误判，调用方另行把 domain 写进
//                           SessionContext.sessionWhitelist（不是 BState 字段，这里不管）
export type CheckInChannel = 'DRIFT' | 'STUCK';
export type CheckInAnswer = 'FOCUSED' | 'DRIFTED' | 'FALSE_POSITIVE';

export interface CheckInFeedback {
  channel: CheckInChannel;
  answer: CheckInAnswer;
}

// ── B 内部持久化状态（契约v4 §3.1）──
export interface BStatePersistable {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;
  // 休息开始时刻——restReminderDue() 算"该不该再提醒一次"要靠它。跟 restUntil 一起由
  // detector.ts 的 startRest() 写入，不再是一个 evaluateFrame() 之外单独游离、容易被忘记
  // 接线的返回值。
  restStartTs: number;
}

// ── B 内部运行时状态（不持久化的部分：持续器）──
export interface EvidenceSustainer {
  since: number | null;
}

export interface BState extends BStatePersistable {
  driftSustainer: EvidenceSustainer;
  stuckSustainer: EvidenceSustainer;
  passiveSince: number | null;
}

// 三预设参数（契约v4 §2 三预设参数表）
export const PROFILE_PRESETS: Record<'CREATOR' | 'READER' | 'VIEWER', SignalPolicy & { matchMode: 'exact' | 'prefix' }> = {
  CREATOR: {
    muteJumpPattern: true,
    mutePassiveTexture: false,
    stuckChannelEnabled: true,
    // 08-30 真机测试后从 8min 调到 5min：黑名单命中的页面现在走 detector.ts 里独立的
    // 15s 快速通道（不再等这个阈值），这个通用值实际上只剩"LLM 判 IRRELEVANT 但不在
    // 静态黑名单里"这类没那么确定的情况在用——3min 对分类器置信度勉强够格的边界判断
    // 偏激进，5min 留了缓冲，比原来的 8min 快得多但不至于对模糊判定反应过度。
    anchorDetachedThresholdMs: 5 * 60_000,
    stuckLadderMs: [15 * 60_000, 20 * 60_000],
    matchMode: 'exact',
  },
  READER: {
    muteJumpPattern: false,
    mutePassiveTexture: false,
    stuckChannelEnabled: true,
    anchorDetachedThresholdMs: 8 * 60_000,
    stuckLadderMs: [10 * 60_000, 20 * 60_000],
    matchMode: 'exact',
  },
  VIEWER: {
    muteJumpPattern: false,
    mutePassiveTexture: true,
    stuckChannelEnabled: false,
    anchorDetachedThresholdMs: 20 * 60_000,
    stuckLadderMs: [],
    matchMode: 'prefix',
  },
};

export function createInitialBState(profile: 'CREATOR' | 'READER' | 'VIEWER'): BState {
  const preset = PROFILE_PRESETS[profile];
  return {
    stuckThresholdMs: preset.stuckLadderMs[0] ?? DEFAULT_STUCK_LADDER[0],
    stuckLadderIndex: 0,
    lastCheckInTs: -Infinity,
    lastAnswerTs: -Infinity,
    restUntil: -Infinity,
    restStartTs: -Infinity,
    driftSustainer: { since: null },
    stuckSustainer: { since: null },
    passiveSince: null,
  };
}

// 契约v4 §3.2：DEMO_MODE 下所有时间常数压缩 120 倍。这是唯一的规范实现——types.ts 是
// engine 内被 perceiver.ts/detector.ts 共同依赖的叶子模块，不会产生循环依赖，其余模块要压缩
// 时间一律从这里 import，不许各自再写一份（08-28 复盘：detector.ts 和 perceiver.ts 之前各自
// 维护了一份几乎一样的实现，defaultSessionContext 的 graceUntil 完全没接入压缩，就是因为
// 没有一个大家都能安全 import 的公共位置）。
const DEMO_TIME_SCALE = 1 / 120;
export function scaled(ms: number, isDemoMode?: boolean): number {
  return isDemoMode ? ms * DEMO_TIME_SCALE : ms;
}

// ── 无起步教练时的默认策略（契约v4 §2「无起步教练时的默认策略」，场景22）──
export const DEFAULT_GRACE_MS = 2 * 60_000; // graceUntil = now + 2分钟
export const DEFAULT_TASK_DECLARATION = 'No task declared (default companion mode)';

// 自动推断出的锚点：来自 A 平台层「前两次 tab 切换后，当前活跃时长最久的 tab」这一推断结果。
// 推断过程本身依赖多次 tab 切换事件的累计观察，不是纯函数，不适合放在决策半引擎里；
// 这里只负责把推断结果组装进 SessionContext。
export interface InferredAnchor {
  domain: string;
  url: string;
}

/**
 * 用户跳过起步教练、直接开始工作时的兜底 SessionContext。
 * - 默认画像 = CREATOR + 默认 policy（过 validatePolicy 兜底，防御性处理，防止预设被意外改坏）
 * - 锚点 = 调用方传入的推断结果；调用方尚无法推断时（比如刚开始还没攒够 tab 切换样本）可不传，
 *   此时锚点留空，等 A 侧推断出结果后由调用方另行更新 SessionContext.anchor
 * - graceUntil = now + 2分钟
 */
export function defaultSessionContext(
  now: number,
  inferredAnchor: InferredAnchor = { domain: '', url: '' },
  sessionId: string = `default-${now}`,
  isDemoMode?: boolean
): SessionContext {
  return {
    sessionId,
    taskDeclaration: DEFAULT_TASK_DECLARATION,
    profile: {
      archetype: 'CREATOR',
      // { ...PROFILE_PRESETS.CREATOR } 只是浅拷贝——stuckLadderMs 这个数组本身还是和模块级
      // PROFILE_PRESETS.CREATOR.stuckLadderMs 同一个引用，得单独展开一层才是真正的防御性拷贝，
      // 不然以后谁原地改了某个会话的阶梯，会连带污染全局共享的预设。
      policy: validatePolicy({ ...PROFILE_PRESETS.CREATOR, stuckLadderMs: [...PROFILE_PRESETS.CREATOR.stuckLadderMs] }),
    },
    anchor: {
      domain: inferredAnchor.domain,
      url: inferredAnchor.url,
      matchMode: 'exact',
    },
    sessionWhitelist: [],
    // 08-28 修复：之前这里是 now + DEFAULT_GRACE_MS 绝对值，没有接 isDemoMode——起步教练一
    // 做完（或跳过起步直接进默认策略）宽限期都会是 2 个真实分钟，demo 模式压缩不到它，紧接着
    // 切走会被 detector.ts 的公共闸口 `now < ctx.graceUntil` 全部静默掉。
    graceUntil: now + scaled(DEFAULT_GRACE_MS, isDemoMode),
  };
}