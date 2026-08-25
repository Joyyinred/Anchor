// Anchor · Service Worker 入口
// 契约v4 §3.1：alarms 心跳兼职 SW 保活/唤醒源；SW 启动/唤醒后从 chrome.storage.local 恢复状态
import type { RuntimeMessage } from '../messages';
import { getDemoMode, setDemoMode } from './state';
import { getOrInitSessionContext } from './session';
import { ensureCurrentTab, handleInteractionMessage, isTrackedTab, registerSignalListeners } from './signals';

const HEARTBEAT_ALARM_NAME = 'anchor-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1;

async function rehydrate(): Promise<void> {
  const isDemoMode = await getDemoMode();
  const ctx = await getOrInitSessionContext();
  console.log('[Anchor SW] rehydrated, isDemoMode =', isDemoMode, 'anchor =', ctx.anchor);
  // SW 每次重新启动，currentTab 这个内存变量都会归零——立刻补查一次当前活动 tab，
  // 不要干等下一个 tabs 事件（用户可能正安静待在同一个 tab 里，永远不会触发）。
  await ensureCurrentTab();
}

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
  console.log('[Anchor SW] received message', message.type, 'from', sender.tab?.url);
});
