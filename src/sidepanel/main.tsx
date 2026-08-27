// Anchor · Side Panel 入口（A11/J4）：订阅 background 算出的 PanelState，渲染桌宠三态。
// 这一层只管"显示 + 把用户的回答发回去"，不做任何判断——contextRelevance/action/文案
// 全部是 SW 那边（frame-pipeline.ts + panel.ts）算好的，跟 cat.tsx 本身"纯展示层"的
// 设计原则是同一层意思。
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { CuteAnchorPet } from '../pet/cat';
import type { CheckInAnswer, CheckInChannel } from '../pet/types';
import { PANEL_STATE_KEY, type PanelState } from '../platform/panel-state';
import type { RuntimeMessage } from '../platform/messages';

const DEFAULT_PANEL_STATE: PanelState = { state: 'companion' };

function SidePanelApp() {
  const [panelState, setPanelState] = useState<PanelState>(DEFAULT_PANEL_STATE);

  useEffect(() => {
    void chrome.storage.local.get(PANEL_STATE_KEY).then((stored) => {
      const existing = stored[PANEL_STATE_KEY] as PanelState | undefined;
      if (existing) setPanelState(existing);
    });

    // side panel 大概率是先打开、SW 后面才算出新一帧——storage.onChanged 是持续订阅，
    // 不是一次性 sendMessage（那样 panel 没打开时消息会直接丢，storage 里的值不会）。
    function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local' || !changes[PANEL_STATE_KEY]) return;
      setPanelState(changes[PANEL_STATE_KEY].newValue as PanelState);
    }
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  function handleAnswer(answer: CheckInAnswer, channel?: CheckInChannel) {
    // channel 理论上 state==='checkin' 时才会被点到，此时 panelState.channel 必然有值——
    // 防御性判断一下，避免拼出一条 channel 缺失的消息。
    if (!channel) return;
    const message: RuntimeMessage = { type: 'CHECK_IN_ANSWER', answer, channel, timestamp: Date.now() };
    void chrome.runtime.sendMessage(message);
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
