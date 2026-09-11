// Anchor · 桌宠组件（B4，独立于扩展）
// 纯展示层：state 由调用方算好了传进来，组件本身不判断"该不该走神提醒"——那是引擎（B1/B2）的事。
//
// 猫本体是 Lottie 矢量动画（assets/cat.json），保持它原本的配色和那根红线不做任何改动——
// 三态不再靠猫变色区分，而是靠猫耳朵旁边的小锚徽章（陪伴=描边／观察=描边+波纹脉冲／check-in=实心）
// 和 check-in 气泡的颜色。
//
// 素材：Kitty Cat Error 404 by Sepehr Radfar（LottieFiles），Lottie Simple License，
// 08-28 已确认可商用、可分发、署名非强制但鼓励。完整来源/授权/义务见 assets/LICENSE.md。
// ★ 那个文件是分发义务不是可选文档，别删（license 要求 Files 随附同一份条款）。
//   —— 原注释写的是"素材来源见 assets/cat.json 顶部注释"，但 JSON 不支持注释、
//      那个文件里一个来源信息都没有，是句指向空处的话，08-28 一并改掉。
import { useEffect, useRef, useState } from 'react';
// lottie-web 的默认打包（'lottie-web'）带 AE expressions 功能，内部用 eval() 实现——
// MV3 扩展页面的 CSP 硬性禁止 unsafe-eval（跟普通网站不同，这条不能靠 manifest 放开），
// 用不到 expressions 这个功能，改用不含 eval 的 "light" 构建（同一套 SVG 渲染器/类型）。
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light';
import catAnimation from './assets/cat.json';
import type { CuteAnchorPetProps } from './types';

const DEFAULT_MESSAGE = "Looks like you drifted off for a bit — still on this, or did your mind wander?";

// 08-28 真机测试反馈：这两句原来写得像"判定条件说明"（"signs"/"enough signs now"这种阈值
// 措辞），读起来像是在跟另一个开发者解释触发逻辑，不是在跟用户说话。改成第一人称、口语化，
// 跟气泡里 wording.ts 那种朋友口吻保持一致。
const CAPTION: Record<CuteAnchorPetProps['state'], string> = {
  companion: 'Quietly keeping you company.',
  observing: "Might be drifting a little — I'm keeping half an eye on things.",
  checkin: 'Just checking in for a sec.',
};

// 原始画布是 2000×2000，猫只占中间一小块（还带一大截红线甩到画面外）。
// 裁一个紧贴内容的 viewBox，猫才能撑满容器，徽章才能贴着猫耳朵而不是飘在半空。
const CROPPED_VIEW_BOX = '-13.86 496.86 1982.71 1109.39';

/**
 * 可爱桌宠：陪伴 / 观察 / check-in 三态，一只抱着红线球的猫（Lottie 矢量动画）。
 *
 * 用法：
 *   <CuteAnchorPet
 *     state="checkin"
 *     channel="DRIFT"
 *     message={result.message}
 *     onAnswer={(answer, channel) => applyCheckInFeedback(state, policy, { channel, answer }, now)}
 *   />
 *
 * B8 接线时预期只需要把 state/channel/message/onAnswer 接到状态机（B9）和 B2 上，组件本身不用改。
 */
export function CuteAnchorPet({
  state,
  message,
  focusedMinutes,
  channel,
  onAnswer,
  isResting,
  onRestStart,
  onRestEnd,
  isReminderDue,
  onRestSnooze,
  onSessionEnd,
  className,
}: CuteAnchorPetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  // B14（09-02）：这一次 check-in 是否已经被回答过。
  //
  // 修的是一个真实的重复计数 bug：点击 → 消息发给 SW → SW 记录/切标签页/写 storage →
  // 面板收到 storage.onChanged → 气泡才消失。这中间几十到两百毫秒（答 DRIFTED 要切标签页
  // 时更久）**按钮长得跟没点之前一模一样**，用户很自然会再点一下，而两下都会被真的处理：
  //   · recordCheckInAnswer 加两次 → 收尾统计说答了 2 次，其实只答了 1 次
  //   · applyCheckInFeedback 走两次 → 退让阶梯多跳一级，桌宠比设计的更沉默
  // index.ts 里那句"立刻 pushMicroRestartToast 把 checkin 态摘掉"防的就是这个，但那个
  // "立刻"要绕 SW + storage 走一圈——**窗口只是变窄了，没关上**。真正关上它只能在组件本地，
  // 不依赖任何往返。
  const [answered, setAnswered] = useState(false);

  // 新的 check-in 到来时必须解锁。两次 check-in 之间面板一定会经过非 checkin 态
  // （pushMicroRestartToast 先推一句反馈、再摘回空白 companion），所以"离开 checkin 就复位"
  // 是可靠的；不这么做的话，第一次回答之后所有后续 check-in 都会是灰的，比原 bug 更糟。
  useEffect(() => {
    if (state !== 'checkin') setAnswered(false);
  }, [state]);

  // 点第一下就锁住整组按钮。`disabled` 属性已经挡住了绝大多数情况，这里再拦一次是因为
  // React 的状态更新是异步的：同一批事件里连着两次点击有可能都读到 answered === false。
  const answerOnce = (answer: Parameters<NonNullable<typeof onAnswer>>[0]): void => {
    if (answered) return;
    setAnswered(true);
    onAnswer?.(answer, channel);
  };

  // "Done for today" 也是一次性动作（结算一次会话），同样只允许触发一次。
  const endSessionOnce = (): void => {
    if (answered) return;
    setAnswered(true);
    onSessionEnd?.();
  };

  // 只在挂载时创建一次动画实例，state 变化不重新加载，只影响徽章/气泡（见下方 JSX）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: catAnimation,
    });
    animRef.current = anim;

    // 裁剪 viewBox 得等 SVG 真正渲染出来之后才能拿到节点。
    anim.addEventListener('DOMLoaded', () => {
      const svg = container.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', CROPPED_VIEW_BOX);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    });

    return () => {
      anim.destroy();
      animRef.current = null;
    };
  }, []);

  const wrapperClass = className ? `anchor-pet ${className}` : 'anchor-pet';
  // 休息期间说明文案不走 CAPTION 那三态——那三句讲的是"我在怎么观察你"，休息时
  // 一句都不成立（此刻双通道全静默，什么都没在看）。
  const caption = isResting ? 'Resting — I’ll stay out of the way.' : CAPTION[state];
  // checkin 态：气泡必现（没传 message 时用默认占位文案）。非 checkin 态：只有明确传了
  // message 才短暂露一下（比如 B7 的微重启一句话反馈），没传就是空——这不是第四态，只是
  // "这一刻要不要说句话"的开关，data-bubble-visible 由这个值驱动，不再是 data-state 本身。
  const bubbleText = state === 'checkin' ? message ?? DEFAULT_MESSAGE : message ?? '';

  return (
    <div className={wrapperClass}>
      <div
        className="anchor-pet-stage"
        data-state={state}
        data-bubble-visible={Boolean(bubbleText)}
        data-resting={Boolean(isResting)}
      >
        {/* ★ 08-29：气泡从 .anchor-pet-wrap 里搬出来，成为 stage 的直接子元素。
            原来它是 position:absolute + translateY(-100%)——锚在底边往上长，靠 stage 一个
            写死的 padding-top 给它腾空间。内容一超过那个 padding，顶部就跑出可视区，
            于是那个数字一路从 60px 猜到 320px：猜小了截断、猜大了短消息时留一大片空白。
            现在它是文档流里的普通块，stage 高度跟着内容走，多长都不会溢出。 */}
        <div className="anchor-pet-bubble" role="status" aria-live="polite">
            <span>{bubbleText}</span>
            {/* 气泡本身在非 checkin 态只是靠 CSS opacity/pointer-events 隐藏（cat.css 的
                [data-state="checkin"] 规则），不是 display:none——只挡鼠标，不挡键盘 tab 顺序。
                之前这里只判断 onAnswer 是否传了值，state==="companion"/"observing" 时按钮
                仍然渲染在 DOM 里，键盘用户能 tab 到看不见的按钮上按回车触发 onAnswer。
                这里额外判断 state === 'checkin'，不在 checkin 态时按钮压根不进 DOM。 */}
            {/* data-answered 让 CSS 知道整组已经锁住了（变灰、不再响应 hover）：
                disabled 本身只挡交互、不改外观，用户需要看得出"我点到了、正在处理"，
                否则跟"卡住了"分不清。 */}
            {state === 'checkin' && onAnswer && (
              <div className="anchor-pet-chips" data-answered={answered}>
                {/* 09-11 真机反馈：DRIFT 通道下 "Still focused"/"Just researching" 两个按钮
                    原文很含糊，实际效果差很多——只有 FALSE_POSITIVE（"This counts as work"）
                    会把域名写进白名单、以后不再对它触发 DRIFT；FOCUSED（"Still on track"）
                    只清空这一次的证据计时器，不记得这个页面，冷却一过同一个页面还会再问一遍
                    （真机复现过反复点"Still focused"却一直被重新 check-in）。换了一套更贴近
                    DRIFT 真实效果的文案。
                    ★ STUCK 通道原本也有一个 FALSE_POSITIVE（"Just researching"）——查证后
                    发现它在 STUCK 下跟"什么都不点"没有任何区别（`applyCheckInFeedback()` 只在
                    `FOCUSED` 分支里让阈值梯子升级，`FALSE_POSITIVE` 分支不存在，落不到任何
                    有效果的代码），Jay 反馈"不知道什么情况该点这个"——与其编一个文案硬凑出
                    第三种含义，不如直接去掉这个没有实际作用的选项，STUCK 只保留 FOCUSED（有
                    持续效果：阈值梯子升级）和 DRIFTED（微重启）两个真正做事的按钮。 */}
                <button type="button" disabled={answered} onClick={() => answerOnce('FOCUSED')}>
                  {channel === 'DRIFT' ? 'Still on track' : 'Deep in thought'}
                </button>
                {channel === 'DRIFT' && (
                  <button type="button" disabled={answered} onClick={() => answerOnce('FALSE_POSITIVE')}>
                    This counts as work
                  </button>
                )}
                <button type="button" disabled={answered} onClick={() => answerOnce('DRIFTED')}>
                  Drifted - pull me back
                </button>
                {/* 契约要求"结束专注"随时可点，check-in 那一刻也不例外——但视觉上要弱于
                    上面三个真正在回答问题的按钮，不能让它看起来像第四个判定选项。 */}
                {onSessionEnd && (
                  <button
                    type="button"
                    className="anchor-pet-chip-quiet"
                    disabled={answered}
                    onClick={endSessionOnce}
                  >
                    Done for today
                  </button>
                )}
              </div>
            )}
        </div>

        <div className="anchor-pet-wrap">
          <div className="anchor-pet-lottie-wrap">
            <div className="anchor-pet-lottie" ref={containerRef} />
            <span className="anchor-pet-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.3} strokeLinecap="round">
                <circle cx="12" cy="6" r="2.3" />
                <path d="M12 8.3V19" />
                <path d="M6 13c0 4 2.7 6.5 6 6.5s6-2.5 6-6.5" />
                <path d="M4 13h4M16 13h4" />
              </svg>
            </span>
            {/* 紧跟在锚徽章后面才能吃到 cat.css 里 .anchor-pet-badge:hover + .anchor-pet-focus-tag
                这条相邻兄弟选择器——鼠标悬停在锚上才弹出，不再是常驻在右上角的标签。 */}
            {focusedMinutes !== undefined && (
              <span
                className="anchor-pet-focus-tag"
                data-visible={state === 'companion'}
              >
                Focused {focusedMinutes} min
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="anchor-pet-caption" style={{ textAlign: 'center', fontSize: 13, marginTop: 10 }}>
        {caption}
      </p>

      {/* 休息/结束专注入口——契约v4 §3.8："可随时'继续专注'或'结束专注'"，08-29 真机检查
          发现这两个按钮之前被焊死在 isRestReminder（15min 首次提醒才出现）上，休息中途
          想提前回来完全点不到，是个真 bug，不是"故意等提醒"。改成常驻同一行：
          不在休息时是「休息 + 结束专注」的入口，休息中是「回来 + 结束专注」的出口——
          "结束专注"本身不跟"是否在休息"绑定，同一个按钮换个邻居而已。
          checkin 态不显示这一整行——那一刻已经在问用户一个问题了，再叠一组决定容易选花眼；
          "结束专注"在 checkin 态改从气泡内部的小字入口走（见上面 chips 那段），不消失。
          resting && checkin 不会同时发生（休息期间双通道全静默，见 detector.ts），
          所以这里不需要再叠一次 state !== 'checkin' 判断。 */}
      {!isResting && state !== 'checkin' && (onRestStart || onSessionEnd) && (
        <div className="anchor-pet-rest-row">
          {onRestStart && (
            <button type="button" className="anchor-pet-rest-button" onClick={onRestStart}>
              Take a break
            </button>
          )}
          {onSessionEnd && (
            <button type="button" className="anchor-pet-rest-button" onClick={onSessionEnd}>
              Done for today
            </button>
          )}
        </div>
      )}
      {isResting && (onRestEnd || onSessionEnd || (isReminderDue && onRestSnooze)) && (
        <div className="anchor-pet-rest-row">
          {/* 09-11：只在提醒正在显示时出现——平时休息中不该多一个按钮抢注意力，
              这个选项要解决的问题（"提醒赶不走"）也只在提醒真的弹出来时才存在。 */}
          {isReminderDue && onRestSnooze && (
            <button type="button" className="anchor-pet-rest-button" onClick={onRestSnooze}>
              5 more minutes
            </button>
          )}
          {onRestEnd && (
            <button type="button" className="anchor-pet-rest-button" onClick={onRestEnd}>
              Back to it
            </button>
          )}
          {onSessionEnd && (
            <button type="button" className="anchor-pet-rest-button" onClick={onSessionEnd}>
              Done for today
            </button>
          )}
        </div>
      )}
    </div>
  );
}
