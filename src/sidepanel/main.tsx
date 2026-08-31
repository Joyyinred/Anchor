// Anchor · Side Panel 入口（A11/J4）：订阅 background 算出的 PanelState，渲染桌宠三态。
// 这一层只管"显示 + 把用户的回答/起步声明发回去"，不做任何判断——contextRelevance/action/文案
// 全部是 SW 那边（frame-pipeline.ts + panel.ts + onboarding.ts）算好的，跟 cat.tsx 本身
// "纯展示层"的设计原则是同一层意思。
//
// 挂载时先看 onboardingState 是不是 'DONE'：不是就显示起步教练输入框（OnboardingPanel），
// 是就直接显示桌宠——这就是 B6 一直缺的那个 UI 缺口（runStarterCoach()/groqStarterCoachCall
// 写好了但没人调用），见 background/onboarding.ts 顶部注释。
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { CuteAnchorPet } from '../pet/cat';
import type { CheckInAnswer, CheckInChannel } from '../pet/types';
import { PANEL_STATE_KEY, type PanelState } from '../platform/panel-state';
import { ONBOARDING_STATE_KEY, type OnboardingState } from '../platform/onboarding-state';
import { REST_STATE_KEY, DEFAULT_REST_STATE, type RestState } from '../platform/rest-state';
import { SESSION_SUMMARY_KEY, type SessionSummary } from '../platform/session-summary-state';
import { SummaryPanel } from './SummaryPanel';
import { buildRestReminderMessage } from '../engine/wording';
import { OnboardingPanel } from './OnboardingPanel';
import type { RuntimeMessage } from '../platform/messages';

const DEFAULT_PANEL_STATE: PanelState = { state: 'companion' };
const DEFAULT_ONBOARDING_STATE: OnboardingState = { status: 'PENDING' };

function SidePanelApp() {
  const [panelState, setPanelState] = useState<PanelState>(DEFAULT_PANEL_STATE);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(DEFAULT_ONBOARDING_STATE);
  // 用户在 READY 屏点了"Let's go"之后本地翻篇——不需要 SW 再确认一次，onboarding 那边
  // 该持久化的（SessionContext）在 READY 出现之前就已经存好了。
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [restState, setRestState] = useState<RestState>(DEFAULT_REST_STATE);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  useEffect(() => {
    void chrome.storage.local
      .get([PANEL_STATE_KEY, ONBOARDING_STATE_KEY, REST_STATE_KEY, SESSION_SUMMARY_KEY])
      .then((stored) => {
      const existingPanel = stored[PANEL_STATE_KEY] as PanelState | undefined;
      if (existingPanel) setPanelState(existingPanel);
      const existingOnboarding = stored[ONBOARDING_STATE_KEY] as OnboardingState | undefined;
      if (existingOnboarding) setOnboardingState(existingOnboarding);
      const existingRest = stored[REST_STATE_KEY] as RestState | undefined;
      if (existingRest) setRestState(existingRest);
      const existingSummary = stored[SESSION_SUMMARY_KEY] as SessionSummary | undefined;
      if (existingSummary) setSummary(existingSummary);
    });

    // 面板挂载时主动问一次现在该显示起步输入框还是直接显示桌宠——不能只信任上面读到的
    // 缓存值，SW 可能在这次打开之间已经完成过一次 onboarding（见 background/index.ts 的
    // ONBOARDING_STATUS_REQUEST 处理）。
    const statusRequest: RuntimeMessage = { type: 'ONBOARDING_STATUS_REQUEST', timestamp: Date.now() };
    void chrome.runtime.sendMessage(statusRequest);

    // side panel 大概率是先打开、SW 后面才算出新一帧——storage.onChanged 是持续订阅，
    // 不是一次性 sendMessage（那样 panel 没打开时消息会直接丢，storage 里的值不会）。
    function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local') return;
      // ★ 08-30：每个 key 都必须处理"被删除"的情况——storage.onChanged 在 remove 时也会
      //   触发，此时 newValue 是 undefined。这一行原来是裸赋值，因为 PANEL_STATE_KEY 从来
      //   没被删过；endSession() 开始清它之后，setPanelState(undefined) 让渲染时读
      //   panelState.state 抛错，**整棵 React 树崩掉、桌宠直接消失**（白屏）。
      if (changes[PANEL_STATE_KEY]) {
        setPanelState((changes[PANEL_STATE_KEY].newValue as PanelState | undefined) ?? DEFAULT_PANEL_STATE);
      }
      if (changes[ONBOARDING_STATE_KEY]) {
        // 同上：现在没人删这个 key，但留着裸赋值就是下一个等着被踩的坑。
        setOnboardingState(
          (changes[ONBOARDING_STATE_KEY].newValue as OnboardingState | undefined) ?? DEFAULT_ONBOARDING_STATE
        );
      }
      if (changes[REST_STATE_KEY]) {
        setRestState((changes[REST_STATE_KEY].newValue as RestState | undefined) ?? DEFAULT_REST_STATE);
      }
      if (changes[SESSION_SUMMARY_KEY]) {
        // newValue 为 undefined 就是 SW 那边 remove 掉了（用户点了"Start something new"）
        setSummary((changes[SESSION_SUMMARY_KEY].newValue as SessionSummary | undefined) ?? null);
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  // ★ 08-30 真机 bug：onboardingDismissed 原来是"点过 Let's go 就永久为 true"的一次性
  //   本地记忆，收尾结算后没有任何人把它设回 false——于是用户点完"Start something new"，
  //   `!onboardingDismissed` 这半边恒为 false，起步教练根本没机会显示，直接落到桌宠界面。
  //   改成跟着 SW 推来的状态走：只要 SW 说现在是 PENDING（新一场、还没声明任务），
  //   本地那份"我已经翻过起步页"的记忆就作废。
  useEffect(() => {
    if (onboardingState.status === 'PENDING') setOnboardingDismissed(false);
  }, [onboardingState.status]);

  function handleAnswer(answer: CheckInAnswer, channel?: CheckInChannel) {
    // channel 理论上 state==='checkin' 时才会被点到，此时 panelState.channel 必然有值——
    // 防御性判断一下，避免拼出一条 channel 缺失的消息。
    if (!channel) return;
    // domain/anchorUrl 原样带回触发那一刻的 panelState 值（不是"用户点按钮这一刻"的最新
    // 状态——sticky 面板允许气泡还没消失时用户已经切走，见 panel.ts 的注释）。
    const message: RuntimeMessage = {
      type: 'CHECK_IN_ANSWER',
      answer,
      channel,
      domain: panelState.domain,
      anchorUrl: panelState.anchorUrl,
      timestamp: Date.now(),
    };
    void chrome.runtime.sendMessage(message);
  }

  // 休息模式的三个入口都只是"把用户的意图发给 SW"——什么时候该提醒、休息什么时候到期，
  // 全部由引擎侧（startRest/restReminderDue）判定，面板不自己算，跟 handleAnswer 同一个定位。
  function sendMessage(message: RuntimeMessage) {
    void chrome.runtime.sendMessage(message);
  }
  function sendRest(type: 'REST_START' | 'REST_END' | 'SESSION_END') {
    sendMessage({ type, timestamp: Date.now() });
  }

  // 提醒文案在面板这边现算，不走 PanelState.message：休息提醒每分钟心跳都可能重算，
  // 让 SW 反复写 storage 只为了更新一个"已休息 N 分钟"的数字不划算；而且这个数字纯粹是
  // restStartTs 的函数，面板自己有 restStartTs 就能算，没有任何需要 SW 参与的判断。
  const restedMinutes =
    restState.restStartTs !== undefined ? (Date.now() - restState.restStartTs) / 60_000 : 0;
  const restReminderText = restState.isReminderDue ? buildRestReminderMessage(restedMinutes) : undefined;

  // 收尾反思优先于一切：这一屏在的时候，这场会话已经结束了，桌宠/起步都不该再显示。
  if (summary) {
    return (
      <SummaryPanel
        summary={summary}
        onRestart={() => sendMessage({ type: 'SESSION_RESTART', timestamp: Date.now() })}
      />
    );
  }

  const showOnboarding = !onboardingDismissed && onboardingState.status !== 'DONE';
  if (showOnboarding) {
    return <OnboardingPanel state={onboardingState} onDone={() => setOnboardingDismissed(true)} />;
  }

  // 休息提醒的文案优先于引擎推来的 message：休息期间双通道全静默，PanelState.message
  // 本来也不会有新内容，但万一残留着上一次 check-in 的旧文案，这里要盖掉它。
  return (
    <CuteAnchorPet
      state={panelState.state}
      message={restReminderText ?? panelState.message}
      channel={panelState.channel}
      onAnswer={handleAnswer}
      isResting={restState.isResting}
      onRestStart={() => sendRest('REST_START')}
      onRestEnd={() => sendRest('REST_END')}
      onSessionEnd={() => sendRest('SESSION_END')}
    />
  );
}

createRoot(document.getElementById('root')!).render(<SidePanelApp />);
