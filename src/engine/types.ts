
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
  if (p.stuckLadderMs.length === 0) p.stuckLadderMs = DEFAULT_STUCK_LADDER;
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

// ── B 内部持久化状态（契约v4 §3.1）──
export interface BStatePersistable {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;
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
    anchorDetachedThresholdMs: 8 * 60_000,
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
    driftSustainer: { since: null },
    stuckSustainer: { since: null },
    passiveSince: null,
  };
}