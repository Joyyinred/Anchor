// Anchor · 起步教练 UI（补 B6 一直缺的那块：runStarterCoach()/groqStarterCoachCall 写好了，
// 一直没有 UI/消息通道真正调用过它）。
// 纯展示层，跟 cat.tsx 同一个原则：只管"问 + 显示 + 转发用户输入"，不做任何判定——
// 契约v4 §5.5 的追问闸门逻辑全在 runStarterCoach()（SW 侧，见 background/onboarding.ts）里，
// 这里只是把输入转发过去、把 SW 推回来的状态显示出来。
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { OnboardingState } from '../platform/onboarding-state';
import type { RuntimeMessage } from '../platform/messages';
import './onboarding.css';

const INITIAL_PROMPT = 'What are you working on right now?';

interface OnboardingPanelProps {
  state: OnboardingState;
  /** 用户在 READY 屏点了"Let's go"——只是本地切到桌宠视图，不发消息（SW 那边已经处理完了）。 */
  onDone: () => void;
}

export function OnboardingPanel({ state, onDone }: OnboardingPanelProps) {
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);

  // SW 推回新状态（下一轮追问 / READY）就说明上一次提交已经处理完了，可以再次接受输入。
  useEffect(() => {
    setWaiting(false);
  }, [state]);

  if (state.status === 'READY') {
    return (
      <div className="anchor-onboarding anchor-onboarding-ready" role="status" aria-live="polite">
        <p className="anchor-onboarding-label">Your first step:</p>
        <p className="anchor-onboarding-first-action">{state.firstAction}</p>
        <button type="button" onClick={onDone}>
          Let's go
        </button>
      </div>
    );
  }

  const roundsUsed = state.status === 'NEEDS_FOLLOWUP' ? state.roundsUsed : 0;
  const prompt = state.status === 'NEEDS_FOLLOWUP' ? state.prompt : INITIAL_PROMPT;
  // 09-05：原样带回上一轮的声明，SW 侧拼接用（见 onboarding-state.ts 顶部注释）——
  // 这里只是转发，不做拼接，跟这个组件"只管问+显示+转发"的原则一致。
  const priorDeclaration = state.status === 'NEEDS_FOLLOWUP' ? state.priorDeclaration : undefined;

  function submit() {
    const text = input.trim();
    if (!text || waiting) return;
    setWaiting(true);
    const message: RuntimeMessage = {
      type: 'ONBOARDING_SUBMIT',
      text,
      roundsUsed,
      priorDeclaration,
      timestamp: Date.now(),
    };
    void chrome.runtime.sendMessage(message);
    setInput('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 提交，Shift+Enter 换行——跟大多数聊天输入框一致的手感。
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="anchor-onboarding">
      <p className="anchor-onboarding-prompt">{prompt}</p>
      <textarea
        className="anchor-onboarding-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="e.g. review data structures for tomorrow's exam"
        rows={3}
        disabled={waiting}
        autoFocus
      />
      <button type="button" onClick={submit} disabled={!input.trim() || waiting}>
        {waiting ? '…' : state.status === 'NEEDS_FOLLOWUP' ? 'Answer' : "Let's start"}
      </button>
    </div>
  );
}