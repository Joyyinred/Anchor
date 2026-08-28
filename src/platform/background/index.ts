// Anchor · Service Worker 入口
// 契约v4 §3.1：alarms 心跳兼职 SW 保活/唤醒源；SW 启动/唤醒后从 chrome.storage.local 恢复状态
import type { RuntimeMessage } from '../messages';
import { getDemoMode, setDemoMode } from './state';
import { getOrInitSessionContext } from './session';
import { ensureCurrentTab, handleInteractionMessage, isTrackedTab, registerSignalListeners } from './signals';
import { applyCheckInAnswer, recomputeOnHeartbeat } from './frame-pipeline';
import { pushPanelState, pushMicroRestartToast } from './panel';
import { pushOnboardingStatus, handleOnboardingSubmit } from './onboarding';

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
  if (message.type === 'CHECK_IN_ANSWER') {
    // 来自 side panel，不是某个特定 tab 发的（sender.tab 通常是 undefined），
    // 不需要走 isTrackedTab 那道锚点 tab 校验。
    void (async () => {
      const ctx = await getOrInitSessionContext();
      const feedback = { channel: message.channel, answer: message.answer };
      await applyCheckInAnswer(ctx, feedback, Date.now(), message.domain);
      // check-in 已经处理完了——立刻把 panel 摘出 checkin 态，不能干等下一次心跳/事件
      // 才刷新（那样按钮还留在 UI 上能点，手快的话 applyCheckInFeedback 会被再触发一次）。
      // pushMicroRestartToast 会先短暂显示 B7 的一句反馈，过会儿再自己摘回空白 companion。
      await pushMicroRestartToast(feedback);
      console.log('[Anchor SW] applied check-in feedback', message.answer, message.channel);
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
