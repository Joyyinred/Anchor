// Anchor · Service Worker 入口
// 契约v4 §3.1：alarms 心跳兼职 SW 保活/唤醒源；SW 启动/唤醒后从 chrome.storage.local 恢复状态
import type { RuntimeMessage } from '../messages';
import type { SessionContext } from '../../engine/types';
import { DEFAULT_TASK_DECLARATION } from '../../engine/types';
import { getDemoMode, setDemoMode } from './state';
import { getOrInitSessionContext, saveSessionContext } from './session';
import {
  ensureCurrentTab,
  getTrackedTabId,
  handleChatSnippetMessage,
  handleInteractionMessage,
  isTrackedTab,
  registerSignalListeners,
} from './signals';
import {
  applyCheckInAnswer,
  recomputeOnHeartbeat,
  resetSessionState,
  getBStateForSession,
  persistBState,
} from './frame-pipeline';
import { pushPanelState, pushMicroRestartToast } from './panel';
import { pushOnboardingStatus, handleOnboardingSubmit } from './onboarding';
import { beginRest, endRest, refreshRestReminder } from './rest';
import { pullBackToAnchor } from './pull-back';
import { recordCheckInAnswer, recordRestStart, endSession, restartSession } from './session-summary';
import { REST_STATE_KEY } from '../rest-state';
import { PANEL_STATE_KEY } from '../panel-state';
import { SESSION_SUMMARY_KEY, SESSION_STATS_KEY } from '../session-summary-state';

const HEARTBEAT_ALARM_NAME = 'anchor-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1;

const ALIVE_MARKER_KEY = 'anchor_sw_alive_marker';

/**
 * 08-31 真机反馈：chrome://extensions 里把插件关掉再打开，UI 停在上次关闭前的页面（桌宠/
 * check-in），没有重新走一遍起步教练，修改：把"关掉再打开"当成
 * 一次会话结束，强制重新声明任务（附带影响：浏览器整个重启后也会一样重置，不会接着上一次
 * 的任务继续）。
 *
 * 难点：MV3 没给扩展"我刚被重新启用"这件事一个专门的订阅口——`onInstalled` 只在首次安装/
 * 版本更新/浏览器版本更新时触发，`onStartup` 只在浏览器进程启动时触发，两个都不认"用户在
 * chrome://extensions 里手动关了再开"这个动作；而 SW 因为 MV3 常规回收（空闲 ~30s 后被
 * 终止，下次事件来了再重新跑一遍这个文件的顶层代码）也会重新执行这段顶层代码——光看"顶层
 * 代码又跑了一次"，分不清这次是"日常回收重启"还是"真的被关过又重新启用"。
 *
 * `chrome.storage.session` 正好卡在这两者中间：官方文档明确写着它在"扩展被禁用/重新加载/
 * 更新/浏览器重启"时会被清空，但不会因为单次 SW 实例被 MV3 常规回收而清空（回收只影响这个
 * SW 实例本身，不影响它，数据仍在同一个"浏览器会话"里存活）。用它放一个"活着"标记：标记
 * 还在 → 只是常规回收重启，什么都不做；标记没了 → 要么第一次装、要么刚被关闭再启用过、
 * 要么浏览器刚重启，一律当成"上一场会话已经结束"处理。
 */
async function resetIfFreshStart(): Promise<void> {
  const stored = await chrome.storage.session.get(ALIVE_MARKER_KEY);
  const isFreshStart = !stored[ALIVE_MARKER_KEY];
  await chrome.storage.session.set({ [ALIVE_MARKER_KEY]: true });
  if (!isFreshStart) return;

  console.log('[Anchor SW] fresh start detected (installed / re-enabled / browser restarted) — ending previous session');
  const ctx = await getOrInitSessionContext();
  // 跟 session-summary.ts 的 endSession() 同一套清法（会话结束的两个入口，理应清同一批东西）：
  // taskDeclaration 打回默认值（onboarding.ts 的 pushOnboardingStatus() 就是拿它判断该不该
  // 显示起步输入框）、sessionWhitelist 清空（针对上一个任务的申诉不该带进下一场）、
  // REST/PANEL/收尾统计/收尾快照四个 UI 状态一并清（不清的话残留的休息态/气泡文案/上一场
  // 摘要会在新会话里冒出来）、resetSessionState 清掉引擎侧的 eventHistory/BState/分类缓存。
  const freshCtx: SessionContext = { ...ctx, taskDeclaration: DEFAULT_TASK_DECLARATION, sessionWhitelist: [] };
  await saveSessionContext(freshCtx);
  await chrome.storage.local.remove([REST_STATE_KEY, PANEL_STATE_KEY, SESSION_SUMMARY_KEY, SESSION_STATS_KEY]);
  resetSessionState(freshCtx.sessionId);
  await pushOnboardingStatus(freshCtx);
}

async function rehydrate(): Promise<void> {
  const isDemoMode = await getDemoMode();
  const ctx = await getOrInitSessionContext();
  console.log('[Anchor SW] rehydrated, isDemoMode =', isDemoMode, 'anchor =', ctx.anchor);
  // SW 每次重新启动，currentTab 这个内存变量都会归零——立刻补查一次当前活动 tab，
  // 不要干等下一个 tabs 事件（用户可能正安静待在同一个 tab 里，永远不会触发）。
  await ensureCurrentTab();
  // 起步教练该显示输入框还是直接显示桌宠，每次 SW 重新启动时先算一遍推给 side panel
  // 兜底；面板挂载时还会再发一次 ONBOARDING_STATUS_REQUEST 主动问一遍（见下方消息处理），
  // 两条路径都指向同一个 pushOnboardingStatus()，互为保险，不会互相矛盾。
  await pushOnboardingStatus(ctx);
}

// 点工具栏图标直接弹出 side panel，不用再从 Chrome 自带的侧边栏下拉菜单里翻——manifest 加了
// `action` 字段后必须显式声明这个行为，否则点图标默认什么都不会发生。
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Anchor SW] onInstalled');
  chrome.alarms.create(HEARTBEAT_ALARM_NAME, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
  // 存储读写 round-trip，验证 chrome.storage.local 可用
  await setDemoMode(false);
  await rehydrate();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Anchor SW] onStartup');
  void rehydrate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM_NAME) {
    console.log('[Anchor SW] heartbeat fired at', new Date().toISOString());
    // 心跳是 currentTab 的最后一道保险：如果 SW 被回收后一直没有 tab 切换/导航事件重新填充它，
    // 最多 1 分钟后心跳也会把它补回来，不会无限期哑火。
    void ensureCurrentTab();
    // 契约v4 §3.1"事件静默 >60s 补帧"：安静看视频/停在锚点页面发呆这类场景不会产生新的
    // SignalEvent，只靠事件触发那条路径，anchorDetachedMs/stillnessMs 会永远停在最后一个
    // 事件的时间戳上——心跳周期性用当前时刻重新跑一次评估，不需要新事件也能让证据继续累积。
    void (async () => {
      const now = Date.now(); // 一次心跳只有一个"此刻"——frame/result 和推给 panel 的
      // 文案（"X 分钟前"）必须算的是同一个 now，不能分两次各取各的，见 08-27 code review。
      const isDemoMode = await getDemoMode();
      const ctx = await getOrInitSessionContext();
      // 休息提醒节拍（契约v4 §3.8：15min 首次，之后每 5min）跟"有没有新事件"无关，
      // 独立于 recomputeOnHeartbeat 的 eventHistory 空则 null-return 那条早退路径。
      const restState = await getBStateForSession(ctx);
      await refreshRestReminder(restState, now);
      const outcome = await recomputeOnHeartbeat(ctx, now, isDemoMode);
      if (!outcome) return;
      await pushPanelState(outcome.frame, outcome.result, outcome.petState, now);
      console.log('[Anchor SW] heartbeat FeatureFrame', outcome.frame);
      console.log('[Anchor SW] heartbeat DetectionResult', outcome.result);
      console.log('[Anchor SW] graceUntil', ctx.graceUntil, 'stillInGrace', now < ctx.graceUntil);
    })();
  }
});

registerSignalListeners();
// SW 刚被（重新）启动执行到这里时，currentTab 也是空的——不要等第一个 tabs 事件，主动查一次。
void ensureCurrentTab();
// 见上面 resetIfFreshStart() 顶部注释——每次这个文件的顶层代码执行都要查一遍"活着"标记，
// 不止 onInstalled/onStartup 那两个事件覆盖的场景（两者都不认"手动关再开"）。
void resetIfFreshStart();

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
  if (message.type === 'INTERACTION') {
    // 只信任当前被追踪的锚点 tab 发来的交互信号（契约v4 §5.1：单一锚点模型）；
    // 先补一次 currentTab（SW 可能是被这条消息本身唤醒的，currentTab 还是空的）再判断。
    void ensureCurrentTab().then(() => {
      if (sender.tab?.id !== undefined && isTrackedTab(sender.tab.id)) {
        handleInteractionMessage(message.interactionType);
      }
    });
    return;
  }
  if (message.type === 'CHAT_SNIPPET') {
    // 09-05：跟 INTERACTION 同一个模式——只信任当前被追踪的锚点 tab 发来的内容快照，
    // 不然开着一堆无关的 AI 对话标签页也会各自往里灌无关的分类信号。
    // 排查补：这条路径真机验证之前完全没有日志，RECHECK 那次踩过的坑（收不到消息时无法
    // 分清"content script 没发"还是"发了但被过滤"）不要再踩一次——先打一条"收到了"。
    console.log('[Anchor SW] received CHAT_SNIPPET from tab', sender.tab?.id, message.snippet);
    void ensureCurrentTab().then(() => {
      if (sender.tab?.id === undefined || !isTrackedTab(sender.tab.id)) {
        console.log('[Anchor SW] CHAT_SNIPPET ignored — not the tracked tab (tracked =', getTrackedTabId(), ')');
        return;
      }
      handleChatSnippetMessage(message.snippet);
    });
    return;
  }
  if (message.type === 'RECHECK') {
    // 08-31：content script 按固定节奏（比 1min 心跳密得多）发来的"到点了，重新算一下"
    // tick——不追加 SignalEvent，只用当前 eventHistory + 最新 now 重新跑一遍判定，跟心跳复用
    // 同一条 recomputeOnHeartbeat 路径（见 messages.ts 顶部 RecheckMessage 注释）。跟
    // INTERACTION 一样只信任当前被追踪的锚点 tab 发来的——不然开着一堆无关标签页也会各自
    // 定时发 tick，白白跑一堆没有意义的计算。
    // 08-31 排查补：真机反馈完全看不到任何 recheck 日志，怀疑是下面 isTrackedTab 校验或
    // recomputeOnHeartbeat 提前 return 把它在到达底部日志之前就悄悄吞掉了——先打一条"收到了"
    // 的日志，跟最终结果日志分开两处，才能分清是"content script 压根没发"还是"发了但被过滤"。
    console.log('[Anchor SW] received RECHECK from tab', sender.tab?.id, sender.tab?.url);
    void ensureCurrentTab().then(async () => {
      if (sender.tab?.id === undefined || !isTrackedTab(sender.tab.id)) {
        console.log('[Anchor SW] recheck ignored — not the tracked tab (tracked =', getTrackedTabId(), ')');
        return;
      }
      const now = Date.now();
      const isDemoMode = await getDemoMode();
      const ctx = await getOrInitSessionContext();
      const outcome = await recomputeOnHeartbeat(ctx, now, isDemoMode);
      if (!outcome) {
        console.log('[Anchor SW] recheck skipped — no eventHistory yet');
        return;
      }
      await pushPanelState(outcome.frame, outcome.result, outcome.petState, now);
      console.log('[Anchor SW] recheck FeatureFrame', outcome.frame);
      console.log('[Anchor SW] recheck DetectionResult', outcome.result);
      console.log('[Anchor SW] graceUntil', ctx.graceUntil, 'stillInGrace', now < ctx.graceUntil);
    });
    return;
  }
  if (message.type === 'CHECK_IN_ANSWER') {
    // 来自 side panel，不是某个特定 tab 发的（sender.tab 通常是 undefined），
    // 不需要走 isTrackedTab 那道锚点 tab 校验。
    void (async () => {
      const ctx = await getOrInitSessionContext();
      const feedback = { channel: message.channel, answer: message.answer };
      const now = Date.now();
      await applyCheckInAnswer(ctx, feedback, now, message.domain);
      await recordCheckInAnswer(feedback, now);
      // 0830 真机测试发现的 bug：这里原来只判断 answer==='DRIFTED'，没管是哪条 channel——
      // STUCK 通道现在（08-30 那次修复后）只在 contextRelevance==='RELEVANT' 时才会触发，
      // 意味着用户压根还停留在相关页面上，根本没有"脱离锚点"这回事；STUCK+DRIFTED 的语义
      // 是"我人是在这页上，但刚才走神了"（applyCheckInFeedback 里对应的是阶梯重置，不是导航），
      // 不是"我跑去了别的页面，带我回去"。之前的写法会把 pullBackToAnchor(ctx) 切到
      // ctx.anchor.domain——那可能是很久以前（甚至是跳过起步教练时，SW 第一次启动那一刻
      // 恰好停留的某个不相关 tab，例如开发时常开着的 chrome://extensions/）锁定的锚点，
      // 跟用户此刻正在做的事毫无关系，会把人从一个真正相关的页面上生拉硬拽走。
      // pull-back.ts 自己的边界注释也明确写着"只在答 DRIFTED 时做"，指的是 DRIFT 通道那次
      // "真的导航去了别处"的 DRIFTED，不是任何通道的任何 DRIFTED——这里补上 channel 判断。
      // ★ STUCK+DRIFTED 分支的 pulledBack 必须给 false（不是 true）：buildMicroRestartMessage
      // 只在 answer==='DRIFTED' 时才会看 pulledBack，给 true 会让文案照样说出"let's head back"
      // 这种没发生过的承诺——只是换了一种方式重复同一个"说了不算"的问题，不是真的修好。
      // FOCUSED/FALSE_POSITIVE 两种答案不会走进 wording.ts 那条 pulledBack 分支，值给 true
      // 只是保持"默认不特殊处理"的语义，不影响任何文案。
      // 08-30：目标从 ctx.anchor.domain 改成 message.anchorUrl（触发那一刻 PanelState.anchorUrl
      // 原样带回来的 frame.lastAnchorSnapshot.url）——check-in 文案是拿 lastAnchorSnapshot 拼的，
      // "带我回去"必须去文案说的那个地方，不能各读各的（见 pull-back.ts 顶部注释）。
      let pulledBack = true;
      if (feedback.answer === 'DRIFTED') {
        pulledBack = feedback.channel === 'DRIFT' && message.anchorUrl
          ? await pullBackToAnchor(message.anchorUrl)
          : false;
      }
      // check-in 已经处理完了——立刻把 panel 摘出 checkin 态，不能干等下一次心跳/事件
      // 才刷新（那样按钮还留在 UI 上能点，手快的话 applyCheckInFeedback 会被再触发一次）。
      // pushMicroRestartToast 会先短暂显示 B7 的一句反馈，过会儿再自己摘回空白 companion。
      await pushMicroRestartToast(feedback, pulledBack);
      console.log('[Anchor SW] applied check-in feedback', message.answer, message.channel, 'pulledBack =', pulledBack);
    })();
    return;
  }
  if (message.type === 'REST_START') {
    void (async () => {
      const ctx = await getOrInitSessionContext();
      const now = Date.now();
      const state = await getBStateForSession(ctx);
      await beginRest(state, now);
      persistBState(ctx, state);
      await recordRestStart(now);
      console.log('[Anchor SW] rest started');
    })();
    return;
  }
  if (message.type === 'REST_END') {
    void (async () => {
      const ctx = await getOrInitSessionContext();
      const state = await getBStateForSession(ctx);
      await endRest(state);
      persistBState(ctx, state);
      console.log('[Anchor SW] rest ended');
    })();
    return;
  }
  if (message.type === 'SESSION_END') {
    void (async () => {
      const ctx = await getOrInitSessionContext();
      await endSession(ctx, Date.now());
      console.log('[Anchor SW] session ended');
    })();
    return;
  }
  if (message.type === 'SESSION_RESTART') {
    void (async () => {
      await restartSession();
      console.log('[Anchor SW] session restarted');
    })();
    return;
  }
  if (message.type === 'ONBOARDING_STATUS_REQUEST') {
    // side panel 挂载时问一次——不能只信任面板自己缓存的旧值，SW 可能在这次打开之间
    // 已经完成过一次 onboarding。
    void (async () => {
      const ctx = await getOrInitSessionContext();
      await pushOnboardingStatus(ctx);
    })();
    return;
  }
  if (message.type === 'ONBOARDING_SUBMIT') {
    void (async () => {
      const isDemoMode = await getDemoMode();
      await handleOnboardingSubmit(message.text, message.roundsUsed, Date.now(), isDemoMode, message.priorDeclaration);
    })();
    return;
  }
  console.log('[Anchor SW] received message', message.type, 'from', sender.tab?.url);
});
