// Anchor · 把"这一场的起点"变成一个会自己走的分钟数（B15，09-02）。
//
// ★ 为什么放在 src/pet/ 而不是 src/sidepanel/：
//   side panel 迟早会被悬浮桌宠（B16）取代，但这段逻辑跟宿主无关——它只吃一个时间戳、
//   吐一个数字，不碰 chrome API、不碰 storage。放这里的话，换宿主时只需要重接
//   "从 storage 读出 startedTs"那几行，这个 hook 和 CuteAnchorPet 一起原样搬走。
//   （`focusedMinutes` 这个 prop 收的本来就是纯数字，缝的位置一开始就是对的。）
//
// ★ 为什么需要定时器：面板本身是被 chrome.storage.onChanged 被动驱动的，而 storage 更新
//   是事件驱动的——用户安静看视频时可能几分钟一次都不触发。不自己走的话这个数字会卡住，
//   显示一个过时的"Focused 3 min"比不显示更糟（它在撒谎）。
import { useEffect, useState } from 'react';

// 30 秒。这个数字的定位是"配角，别喧宾夺主"（表单 B15 原话），分钟级粒度足够；
// 更密的心跳换不来任何可见收益，只是白白唤醒渲染。
const TICK_MS = 30_000;

/**
 * @param startedTs 这一场专注的起点（SessionStats.startedTs）。拿不到时传 undefined。
 * @returns 已专注的整分钟数；startedTs 缺失时返回 undefined，调用方据此整块不渲染。
 */
export function useFocusedMinutes(startedTs: number | undefined): number | undefined {
  const compute = (): number | undefined =>
    startedTs === undefined ? undefined : Math.max(0, Math.floor((Date.now() - startedTs) / 60_000));

  const [minutes, setMinutes] = useState<number | undefined>(compute);

  useEffect(() => {
    // startedTs 变了（新的一场）要立刻重算一次，不能等下一个 tick——否则上一场的数字
    // 会在新会话开头挂最多 30 秒。
    setMinutes(compute);
    if (startedTs === undefined) return;
    const timer = setInterval(() => setMinutes(compute), TICK_MS);
    return () => clearInterval(timer);
    // compute 每次渲染都是新函数，放进依赖会让定时器被反复重建——它只依赖 startedTs，
    // 而 startedTs 已经在依赖里了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedTs]);

  return minutes;
}
