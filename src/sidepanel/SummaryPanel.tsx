// Anchor · 收尾反思视图（J7 最后一环 / B15 最小版）。
// 纯展示层，跟 OnboardingPanel/cat.tsx 同一个原则：只显示 SW 结算好的 SessionSummary，
// 自己不算任何东西；措辞全部走 B7/B11 那套 wording.ts，不在组件里写死句子。
//
// 语气定位（见 wording.ts 里同一处的注释）：这是收工不是成绩单——只陈述发生了什么，
// 不打分、不评判、不鼓励式说教。零次的统计行干脆不渲染（wording 返回 null）。
import {
  buildSessionSummaryHeadline,
  buildCheckInTally,
  buildRestTally,
  buildSessionSummaryFooter,
} from '../engine/wording';
import type { SessionSummary } from '../platform/session-summary-state';
import './summary.css';

interface SummaryPanelProps {
  summary: SessionSummary;
  /** 用户点了"Start something new"——调用方发 SESSION_RESTART 给 SW。 */
  onRestart: () => void;
}

export function SummaryPanel({ summary, onRestart }: SummaryPanelProps) {
  const tallies = [
    buildCheckInTally(summary.answeredCheckIns),
    buildRestTally(summary.rests),
  ].filter((line): line is string => line !== null);

  return (
    <div className="anchor-summary">
      <p className="anchor-summary-headline">
        {buildSessionSummaryHeadline(summary.endedTs - summary.startedTs)}
      </p>

      {/* 任务声明用引号包起来单独一行——这是用户自己写的话，把它原样还给他，
          比任何统计数字都更能唤起"这一场是关于什么的"。 */}
      <p className="anchor-summary-task">“{summary.taskDeclaration}”</p>

      {tallies.length > 0 && (
        <ul className="anchor-summary-tallies">
          {tallies.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <p className="anchor-summary-footer">{buildSessionSummaryFooter()}</p>
      <button type="button" onClick={onRestart}>
        Start something new
      </button>
    </div>
  );
}
