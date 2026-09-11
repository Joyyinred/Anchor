
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
  // 09-05 新增：用户刚在页面里输入的文字（目前仅 AI 对话类网站，起步只做 claude.ai，
  // 见 src/platform/content/chat-sites.ts）。绝大多数域名这个字段是 undefined——只在能
  // 确定"这是用户刚打的字"时才有值，不是页面全文，也不是完整对话历史（数据最小化）。
  // 标题不一定随每轮对话更新（真机复现：连续问了 3 个无关问题，标题纹丝不动），这个字段
  // 是比标题更细粒度、真正跟着每一轮消息走的分类依据。见 docs/契约v4.md §5.3 隐私声明。
  contentSnippet?: string;
  // 09-11 新增：产生这条事件的浏览器 tab id（平台层 chrome.tabs API 概念，engine 本身不解释
  // 这个数字，只是原样透传进 lastAnchorSnapshot，供 pull-back.ts 精确判断"当初那个 tab
  // 有没有自己飘走"——见 pull-back.ts 顶部注释和 docs/契约v4.md §2）。可选：mock/测试场景
  // 没有真实 tab 概念，不传就是 undefined，不影响任何既有判定逻辑。
  tabId?: number;
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
  // 09-11 新增：当前页最近一条 MEDIA_PLAY/MEDIA_PAUSE 事件是不是 PLAY（真机复现：视频
  // `play` 事件只在开始播放那一刻发一次，持续播放中途不会再发，`stillnessMs`/`texture`
  // 因此把"安静看着一个仍在播放的视频"跟"人已经走开"算成同一回事——STUCK 需要这个字段
  // 单独豁免前者，见 detector.ts isStuck()）。可选：mock/测试场景不传就是 undefined/false，
  // 不影响任何既有判定逻辑。
  mediaPlaying?: boolean;

  // v4 新增
  systemIdle: boolean;
  lastAnchorSnapshot: {
    title: string;
    url: string;
    ts: number;
    // 09-11：产生这份快照的具体 tab（SignalEvent.tabId 原样带过来）。同域名下可能同时有
    // "当初判相关的那个 tab"和"后来又开的另一个同域不相关 tab"，pull-back.ts 需要这个字段
    // 才能分清"就是它自己飘走了"还是"这是另一个仍然合法的同域 tab"。
    tabId?: number;
  };

  // 辅助（不参与判定，仅供措辞用）
  currentDomain: string;
  currentTitle: string;
  currentContentKind: SignalEvent['contentKind'];
  // 09-11 新增：当前页完整 URL。真机复现：答 DRIFT+FALSE_POSITIVE 时只把 frame.currentDomain
  // 写进 sessionWhitelist——对 youtube.com 这类"内容形态因页面而异"的混合站，域级白名单会让
  // 用户纠正的那一个视频之外的所有视频（包括纯娱乐的）都跟着被判 RELEVANT。这个字段配合
  // perceiver.ts 已有的 pageKey() 让 applyCheckInAnswer() 对这类域名改成按具体页面（而不是
  // 整个域名）白名单，见 frame-pipeline.ts。
  currentUrl: string;
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

// 08-31 真机反馈后的产品决定：check-in 冷却不该对所有回答一视同仁——"飘了"（DRIFTED）
// 恰恰是"用户刚承认自己走神/被拉回去了"的信号，如果拉回去没多久又飘了，说明这次专注确实
// 吃力，更需要及时提醒，不该被跟"在专注"/"我在查资料"同一档的 5 分钟长冷却摁住；后两种
// 回答是用户主动确认"没问题"，给长冷却是合理的信任，不算过度打扰。所以冷却时长本身要跟着
// 上一次回答变，不能再是写死的常量——见下面 BStatePersistable.checkinCooldownMs。
export const CHECKIN_COOLDOWN_MS = 5 * 60_000; // FOCUSED/FALSE_POSITIVE 后：5 分钟
export const DRIFTED_CHECKIN_COOLDOWN_MS = 2 * 60_000; // DRIFTED 后：2 分钟

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
  // 09-11 新增：上一次休息"真正结束"的时刻（点 Back to it / endRest() 的那一刻）。
  // `restUntil` 现在是 Infinity（休息中）/-Infinity（未休息）的哨兵值，不再是真实时间戳
  // （见 detector.ts startRest() 顶部 09-11 的注释），isStuck() 算"净静止时长"要靠这个
  // 字段扣掉休息期间累积的静止，不能再拿 restUntil 当"休息刚结束"的基准点用。
  restEndedTs: number;
  // 09-11 新增：用户点了"再休息 5 分钟"——restReminderDue() 在这个时刻之前都不判定
  // "该提醒了"，见 detector.ts snoozeRest() 顶部注释。
  restSnoozedUntil: number;
  // 08-31 新增：下一次 check-in 冷却该用多久，由上一次 applyCheckInFeedback() 的回答决定
  // （DRIFTED 短冷却，FOCUSED/FALSE_POSITIVE 长冷却）；从没回答过时用 CHECKIN_COOLDOWN_MS
  // 这个长的默认值（createInitialBState 初始化）。
  checkinCooldownMs: number;
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
    restEndedTs: -Infinity,
    restSnoozedUntil: -Infinity,
    checkinCooldownMs: CHECKIN_COOLDOWN_MS,
    driftSustainer: { since: null },
    stuckSustainer: { since: null },
    passiveSince: null,
  };
}

// 契约v4 §3.2：DEMO_MODE 下所有时间常数压缩。这是唯一的规范实现——types.ts 是
// engine 内被 perceiver.ts/detector.ts 共同依赖的叶子模块，不会产生循环依赖，其余模块要压缩
// 时间一律从这里 import，不许各自再写一份（08-28 复盘：detector.ts 和 perceiver.ts 之前各自
// 维护了一份几乎一样的实现，defaultSessionContext 的 graceUntil 完全没接入压缩，就是因为
// 没有一个大家都能安全 import 的公共位置）。
// ★ 09-11：120 倍改成 30 倍——Jay 反馈 120x 下大部分阈值压到 1 秒以内，边操作边讲解跟不上，
// 演示显得很忙乱。30x 下典型 DRIFT 触发（错过页面 5min+60s 纹理+30s 持续）≈13s、STUCK
// （静止 15min+30s）≈31s、休息首次提醒（15min）≈30s——节奏放慢到能一边操作一边讲解，
// 又不至于跟真实模式一样要等几分钟。契约v4 §3.2/§4 场景24 写的"120x"这个具体数字随之更新，
// 压缩本身仍然只在这一处实现，不受影响。
const DEMO_TIME_SCALE = 1 / 30;
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