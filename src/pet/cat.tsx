// Anchor · 桌宠组件（B4，独立于扩展）
// 纯展示层：state 由调用方算好了传进来，组件本身不判断"该不该走神提醒"——那是引擎（B1/B2）的事。
//
// 猫本体是 Lottie 矢量动画（assets/cat.json），保持它原本的配色和那根红线不做任何改动——
// 三态不再靠猫变色区分，而是靠猫耳朵旁边的小锚徽章（陪伴=描边／观察=描边+波纹脉冲／check-in=实心）
// 和 check-in 气泡的颜色。素材来源见 assets/cat.json 顶部注释，接入前请确认授权条款。
import { useEffect, useRef } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import './cat.css';
import catAnimation from './assets/cat.json';
import type { CuteAnchorPetProps } from './types';

const DEFAULT_MESSAGE = '你好像飘了一会儿？还在忙这件事，还是走神啦？';

const CAPTION: Record<CuteAnchorPetProps['state'], string> = {
  companion: '安静陪着你，不打扰。',
  observing: '有点飘的迹象，先悄悄多看两眼。',
  checkin: '证据攒够了，问一句——像朋友，不像监工。',
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
  className,
}: CuteAnchorPetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);

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
  const bubbleText = state === 'checkin' ? message ?? DEFAULT_MESSAGE : '';

  return (
    <div className={wrapperClass}>
      <div className="anchor-pet-stage" data-state={state}>
        {focusedMinutes !== undefined && (
          <span
            className="anchor-pet-focus-tag"
            data-visible={state === 'companion'}
          >
            专注 {focusedMinutes} 分钟
          </span>
        )}

        <div className="anchor-pet-wrap">
          <div className="anchor-pet-bubble" role="status" aria-live="polite">
            <span>{bubbleText}</span>
            {/* 气泡本身在非 checkin 态只是靠 CSS opacity/pointer-events 隐藏（cat.css 的
                [data-state="checkin"] 规则），不是 display:none——只挡鼠标，不挡键盘 tab 顺序。
                之前这里只判断 onAnswer 是否传了值，state==="companion"/"observing" 时按钮
                仍然渲染在 DOM 里，键盘用户能 tab 到看不见的按钮上按回车触发 onAnswer。
                这里额外判断 state === 'checkin'，不在 checkin 态时按钮压根不进 DOM。 */}
            {state === 'checkin' && onAnswer && (
              <div className="anchor-pet-chips">
                <button type="button" onClick={() => onAnswer('FOCUSED', channel)}>
                  在专注
                </button>
                <button type="button" onClick={() => onAnswer('FALSE_POSITIVE', channel)}>
                  查资料呢
                </button>
                <button type="button" onClick={() => onAnswer('DRIFTED', channel)}>
                  飘了，拉我一下
                </button>
              </div>
            )}
          </div>

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
          </div>
        </div>
      </div>

      <p className="anchor-pet-caption" style={{ textAlign: 'center', fontSize: 13, marginTop: 10 }}>
        {CAPTION[state]}
      </p>
    </div>
  );
}
