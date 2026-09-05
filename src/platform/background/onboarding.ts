// Anchor · 起步教练 UI 的 SW 侧逻辑（补上 B6 一直缺的那块：runStarterCoach()/
// groqStarterCoachCall 写好了，但从没有任何 UI/消息通道真正调用过它）。
//
// 结果推回 ONBOARDING_STATE_KEY，side panel 用 chrome.storage.onChanged 订阅——
// 跟 panel.ts 推 PanelState 是同一个模式，不用一次性 sendMessage（面板没打开时消息会丢，
// storage 里的值不会，下次打开读一次当前值就有）。
import { runStarterCoach } from '../../engine/coach';
import { DEFAULT_TASK_DECLARATION, type SessionContext } from '../../engine/types';
import { groqStarterCoachCall, groqTaskQualityCheckCall } from './starter-coach';
import { saveSessionContext } from './session';
import { resetSessionState } from './frame-pipeline';
import { startSessionStats } from './session-summary';
import { domainOf, isInternalBrowserUrl } from './domain';
import { ONBOARDING_STATE_KEY, type OnboardingState } from '../onboarding-state';

async function pushOnboardingState(state: OnboardingState): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_STATE_KEY]: state });
}

/**
 * side panel 挂载时调用一次：现在到底该显示起步输入框还是直接显示桌宠，由当前持久化的
 * SessionContext.taskDeclaration 是不是还是那句默认占位文案决定——不额外维护一个"onboarding
 * 有没有做过"的独立标记，省得这两处状态哪天不同步。
 */
export async function pushOnboardingStatus(ctx: SessionContext): Promise<void> {
  const status: OnboardingState =
    ctx.taskDeclaration === DEFAULT_TASK_DECLARATION ? { status: 'PENDING' } : { status: 'DONE' };
  await pushOnboardingState(status);
}

/**
 * 用户在起步输入框里提交了这一轮内容（第一轮是任务声明本身，追问后的后续轮次是回答）。
 * roundsUsed 由 side panel 原样带回上一次响应里的值（第一次提交传 0）。
 */
export async function handleOnboardingSubmit(
  text: string,
  roundsUsed: number,
  now: number,
  isDemoMode: boolean,
  priorDeclaration?: string
): Promise<void> {
  // 09-05 真机反馈修复：追问的回答是"补充"不是"替换"——runStarterCoach() 每次只认
  // 它收到的这一个字符串，不会记得上一轮说过什么（引擎侧保持无状态，见 coach.ts
  // runStarterCoach 的设计说明），拼接的责任落在这里。真机复现过：声明
  // "study neural network"，追问后单独答"beginner guide"，不拼接的话最终
  // taskDeclaration 会变成"beginner guide"，"neural network"这个关键词彻底丢失——
  // 后面整场会话的相关性分类全靠这句话，声明变空洞会导致明明该判 IRRELEVANT/RELEVANT
  // 的页面判不出来，长期卡 UNKNOWN。
  const combinedDeclaration = priorDeclaration ? `${priorDeclaration}. ${text}`.trim() : text;
  // 锚点：用户声明任务这一刻正看着的那个 tab，就是这次会话的锚点——跟 session.ts 的默认
  // 兜底路径取的是同一个东西（当前活动 tab），只是那边没有任务声明、这边有。
  // 之前这里漏传了 inferredAnchor/sessionId，导致 anchor 被覆盖成 { domain: '', url: '' }：
  // 空锚点匹配不上任何页面 → 没有任何事件会被判成"在锚点上" → lastAnchorTs 恒为 0 →
  // anchorDetachedMs 直接等于当前 epoch 时间戳（而不是"脱离了多久"），lastAnchorSnapshot
  // 也拿不到真实标题，B7 的 check-in 文案只能退回"what you were working on"那句兜底。
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const rawUrl = activeTab?.url ?? '';
  // 08-30：chrome://extensions/ 这类浏览器内部页面不该被锁成锚点——真机复现过：调试时
  // 开着这个 tab 提交任务，会把它当成锚点，后面 YouTube 上发生的事全部判不出"在锚点上"。
  const url = isInternalBrowserUrl(rawUrl) ? '' : rawUrl;
  // 09-01 B12 v5：把用户声明任务这一刻正开着的页面透传给起步教练的 LLM 调用。
  // 这是整条链路上唯一一份"不用猜"的真实信息——前四版 prompt 全部败在"模型只有一句
  // 任务字符串"（评测集实测：无上下文时 83% 的产出都是"去搜索"，见 evals/）。
  // ★ 复用上面那个 url 而不是 rawUrl：内部页面（chrome://extensions/ 之类）被过滤成空串，
  //   这里跟着不传 anchorContext，prompt 自动退回无上下文那一版——调试时开着扩展管理页
  //   提交任务，不会得到"打开你的扩展管理页"这种荒唐建议。
  const anchorContext = url ? { title: activeTab?.title ?? '', url } : undefined;
  const result = await runStarterCoach(
    combinedDeclaration,
    roundsUsed,
    groqStarterCoachCall,
    now,
    // sessionId 沿用 session.ts 那份的 'default'：BState/事件历史都按 sessionId 分 storage key，
    // 每次起步都生成一个新 id 的话，旧 key 会永远留在 chrome.storage.local 里没人清。
    'default',
    { domain: domainOf(url), url },
    isDemoMode,
    anchorContext,
    // 09-05：长度够但内容空洞（"调整并测试hackathon项目作品"）时主动追问缺的那部分，
    // 见 coach.ts TaskQualityCheckCall/starter-coach.ts groqTaskQualityCheckCall 顶部注释。
    groqTaskQualityCheckCall
  );

  if (result.status === 'NEEDS_FOLLOWUP') {
    await pushOnboardingState({
      status: 'NEEDS_FOLLOWUP',
      prompt: result.prompt,
      roundsUsed: result.roundsUsed,
      priorDeclaration: combinedDeclaration,
    });
    return;
  }

  // 08-30：起步教练每完成一次都是"新的一场专注"，理应从零开始——sessionId 目前一直是
  // 硬编码的 'default'，不清空的话上一场攒的 eventHistory/BState 会原样带进这一场，
  // 真机复现过：旧证据里"这一页最后一次交互"的陈旧时间戳直接让 STUCK 在新会话第一帧
  // 就顶格触发（详见 frame-pipeline.ts 的 resetSessionState 注释）。
  resetSessionState(result.sessionContext.sessionId);

  // READY：先把这次真实产出的 SessionContext 存回 getOrInitSessionContext() 读的那个 key，
  // 再推 UI 状态——两步顺序不能反，不然 UI 已经显示"完成"了，但下一次心跳/事件读到的
  // ctx 还是旧的默认占位值。
  await saveSessionContext(result.sessionContext);
  // 09-02：这一刻才是"这一场专注"真正的起点，把它记下来。不记的话，一场没有任何 check-in、
  // 也没点过休息的专注（= 最理想的那条路径）到结算时读不到统计，会被现造一份 startedTs=now，
  // 收尾视图于是说"That was less than a minute of work."——详见 session-summary.ts
  // 的 startSessionStats 注释。同时这也是桌宠"Focused N min"那个角标的数据源。
  await startSessionStats(now);
  await pushOnboardingState({ status: 'READY', firstAction: result.firstAction });
}