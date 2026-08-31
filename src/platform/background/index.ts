// Anchor · Service Worker 入口
// 契约v4 §3.1：alarms 心跳兼职 SW 保活/唤醒源；SW 启动/唤醒后从 chrome.storage.local 恢复状态
import type { RuntimeMessage } from '../messages';
import { getDemoMode, setDemoMode } from './state';
import { getOrInitSessionContext } from './session';
import { ensureCurrentTab, handleInteractionMessage, isTrackedTab, registerSignalListeners } from './signals';
import { applyCheckInAnswer, recomputeOnHeartbeat, getBStateForSession, persistBState } from './frame-pipeline';
import { pushPanelState, pushMicroRestartToast } from './panel';
import { pushOnboardingStatus, handleOnboardingSubmit } from './onboarding';
import { beginRest, endRest, refreshRestReminder } from './rest';
import { pullBackToAnchor } from './pull-back';
import { recordCheckInAnswer, recordRestStart, endSession, restartSession } from './session-summary';

const HEARTBEAT_ALARM_NAME = 'anchor-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1;

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
    })();
  }
});

registerSignalListeners();
// SW 刚被（重新）启动执行到这里时，currentTab 也是空的——不要等第一个 tabs 事件，主动查一次。
void ensureCurrentTab();

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
  if (message.type === 'RECHECK') {
    // 08-31：content script 按固定节奏（比 1min 心跳密得多）发来的"到点了，重新算一下"
    // tick——不追加 SignalEvent，只用当前 eventHistory + 最新 now 重新跑一遍判定，跟心跳复用
    // 同一条 recomputeOnHeartbeat 路径（见 messages.ts 顶部 RecheckMessage 注释）。跟
    // INTERACTION 一样只信任当前被追踪的锚点 tab 发来的——不然开着一堆无关标签页也会各自
    // 定时发 tick，白白跑一堆没有意义的计算。
    void ensureCurrentTab().then(async () => {
      if (sender.tab?.id === undefined || !isTrackedTab(sender.tab.id)) return;
      const now = Date.now();
      const isDemoMode = await getDemoMode();
      const ctx = await getOrInitSessionContext();
      const outcome = await recomputeOnHeartbeat(ctx, now, isDemoMode);
      if (!outcome) return;
      await pushPanelState(outcome.frame, outcome.result, outcome.petState, now);
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
      await handleOnboardingSubmit(message.text, message.roundsUsed, Date.now(), isDemoMode);
    })();
    return;
  }
  console.log('[Anchor SW] received message', message.type, 'from', sender.tab?.url);
});
