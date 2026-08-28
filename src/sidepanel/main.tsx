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

  useEffect(() => {
    void chrome.storage.local.get([PANEL_STATE_KEY, ONBOARDING_STATE_KEY]).then((stored) => {
      const existingPanel = stored[PANEL_STATE_KEY] as PanelState | undefined;
      if (existingPanel) setPanelState(existingPanel);
      const existingOnboarding = stored[ONBOARDING_STATE_KEY] as OnboardingState | undefined;
      if (existingOnboarding) setOnboardingState(existingOnboarding);
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
      if (changes[PANEL_STATE_KEY]) setPanelState(changes[PANEL_STATE_KEY].newValue as PanelState);
      if (changes[ONBOARDING_STATE_KEY]) {
        setOnboardingState(changes[ONBOARDING_STATE_KEY].newValue as OnboardingState);
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  function handleAnswer(answer: CheckInAnswer, channel?: CheckInChannel) {
    // channel 理论上 state==='checkin' 时才会被点到，此时 panelState.channel 必然有值——
    // 防御性判断一下，避免拼出一条 channel 缺失的消息。
    if (!channel) return;
    // domain 原样带回触发那一刻的 panelState.domain（不是"用户点按钮这一刻在哪个域名"——
    // sticky 面板允许气泡还没消失时用户已经切走，见 panel.ts 的注释）。
    const message: RuntimeMessage = {
      type: 'CHECK_IN_ANSWER',
      answer,
      channel,
      domain: panelState.domain,
      timestamp: Date.now(),
    };
    void chrome.runtime.sendMessage(message);
  }

  const showOnboarding = !onboardingDismissed && onboardingState.status !== 'DONE';
  if (showOnboarding) {
    return <OnboardingPanel state={onboardingState} onDone={() => setOnboardingDismissed(true)} />;
  }

  return (
    <CuteAnchorPet
      state={panelState.state}
      message={panelState.message}
      channel={panelState.channel}
      onAnswer={handleAnswer}
    />
  );
}

createRoot(document.getElementById('root')!).render(<SidePanelApp />);
