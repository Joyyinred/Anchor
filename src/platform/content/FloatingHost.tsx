// Anchor · 悬浮层的外壳（B16，09-02）：负责"挂在哪、能不能拖"，里面装的还是那个 AnchorApp。
//
// 跟 side panel 那个宿主的唯一区别就是这一层——状态订阅、消息发送、三屏切换全在 AnchorApp
// 里，两个宿主共用同一份，不会各自演化。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnchorApp } from '../../ui/AnchorApp';
import {
  FLOATING_POSITION_KEY,
  resolvePosition,
  toRatio,
  type FloatingPosition,
} from '../floating-position';

// 位移超过这个距离才算"拖"，否则算"点"。
// ★ 不设阈值的话 check-in 气泡里那四个按钮会点不动：手指按下去抖一两像素是常事，
//   那一两像素会被当成拖拽开始，pointer 事件被外壳捕获，click 永远不会派发到按钮上。
const DRAG_THRESHOLD_PX = 4;

// 没拖过时贴在右下角，离边多远。用 CSS 的 right/bottom 直接摆，不需要量元素尺寸。
const CORNER_INSET_PX = 16;

export function FloatingHost() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // null = 用户从没拖过 → 走"贴右下角"那条零测量路径（见下方 style）。
  // 只有拖过一次之后才需要真的算像素坐标。
  const [pos, setPos] = useState<FloatingPosition | null>(null);
  const [px, setPx] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 拖拽过程中的中间量走 ref 不走 state：这些值每次 pointermove 都变（一秒钟几十次），
  // 放 state 会触发同样频次的重渲染，而里面装着一个 Lottie 动画。
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);

  /** 按当前视口和元素实际尺寸把比例换算成像素。视口变化、元素尺寸变化时都要重算。 */
  const reposition = useCallback((next: FloatingPosition) => {
    const el = rootRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    // ★ 09-02 真机 bug 的修法：量到 0 就**不要下结论**，等下一帧再量。
    //   第一次挂载时 useLayoutEffect 跑得比内容排版早，offsetHeight 量出来是 0。
    //   高度按 0 算，resolvePosition 里"夹回可视区"那一步就什么都夹不到——卡片被放在
    //   0.96×视口高 的位置，而它真实高度约 200px，于是整块伸到视口下面去，
    //   页面上只剩最底下一条边。DOM 在、日志正常、样式也对，就是看不见，极难查。
    //   （现场证据：style="top: 1021.44px"，反解出测量时 height ≈ 30px。）
    if (width === 0 || height === 0) {
      requestAnimationFrame(() => reposition(next));
      return;
    }

    setPx(
      resolvePosition(
        next,
        { width: window.innerWidth, height: window.innerHeight },
        { width, height }
      )
    );
    // reposition 递归调用自己，必须放进依赖——但它本身不依赖任何 props/state，
    // useCallback 空依赖数组下引用稳定，递归安全。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 挂载时读一次存下来的位置，并订阅变化——同一个浏览器里可能开着多个标签页，
  // 每个页面都有一只猫；在一个页面里拖动，其它页面的猫应该跟着挪到同一个位置，
  // 否则切回去会发现它"没听话"。
  useEffect(() => {
    void chrome.storage.local.get(FLOATING_POSITION_KEY).then((stored) => {
      const saved = stored[FLOATING_POSITION_KEY] as FloatingPosition | undefined;
      setPos(saved ?? null);
    });

    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local' || !changes[FLOATING_POSITION_KEY]) return;
      // remove 时 newValue 是 undefined——回默认位置，不能裸赋值（09-01 白屏那次的教训）。
      setPos((changes[FLOATING_POSITION_KEY].newValue as FloatingPosition | undefined) ?? null);
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // 位置比例变了就重算像素。用 useLayoutEffect 是为了避免"先画在默认位置、下一帧才跳过去"
  // 的那一下闪烁——每次导航都会重新挂载一次，闪烁会非常显眼。
  useLayoutEffect(() => {
    if (pos && !dragging) reposition(pos);
  }, [pos, dragging, reposition]);

  // 窗口尺寸变化要夹回可视区。不做的话：拖到右下角 → 缩小窗口 → 猫跑到视口外，
  // 鼠标够不着也拖不回来，用户只能去清 storage。
  useEffect(() => {
    function onResize() {
      if (pos) reposition(pos);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, reposition]);

  // check-in 气泡展开/收起会让元素高度突变，也要重新夹一次——否则展开时底部会被切掉。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pos && !dragRef.current) reposition(pos);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pos, reposition]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 只接管左键/主指针；右键菜单、中键这些交给页面自己。
    if (e.button !== 0) return;
    // 按在按钮/输入框上时不启动拖拽判定：那些元素有自己的交互，被 setPointerCapture
    // 抢走之后连 focus 都拿不到。
    if ((e.target as HTMLElement).closest('button, input, textarea, a, select')) return;
    // 起点从 getBoundingClientRect 现读，不依赖 px——没拖过时卡片是用 right/bottom
    // 摆的，px 本来就是 null。这一刻元素肯定已经排好版了（用户都摸到它了），量得准。
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      // 真正开始拖了才捕获指针——在阈值之前捕获会吃掉按钮的 click。
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const el = rootRef.current;
    if (!el) return;
    const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - el.offsetHeight);
    setPx({
      left: Math.min(maxLeft, Math.max(0, drag.originLeft + dx)),
      top: Math.min(maxTop, Math.max(0, drag.originTop + dy)),
    });
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return; // 只是点了一下，什么都不做，让 click 正常派发
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = toRatio(
      { left: rect.left, top: rect.top },
      { width: window.innerWidth, height: window.innerHeight },
      { width: el.offsetWidth, height: el.offsetHeight }
    );
    setPos(next);
    void chrome.storage.local.set({ [FLOATING_POSITION_KEY]: next });
  }

  return (
    <div
      ref={rootRef}
      className="anchor-floating"
      data-dragging={dragging}
      // ★ 09-02 真机 bug 的真正修法：**永远不要靠隐藏来等一个测量结果**。
      //   原来这里写的是"px 算出来之前先 visibility:hidden"，而 px 依赖挂载时读
      //   offsetWidth/offsetHeight——那个测量在真机上不可靠（有时量到 0、有时时序更早
      //   连 effect 都还没跑）。结果就是"位置算错了"这个小毛病被放大成"页面上什么都没有"，
      //   DOM 在、日志正常、样式也对，查了很久。
      //   现在的规则：没拖过就用 right/bottom 贴右下角——**CSS 自己会算，一次测量都不需要**；
      //   拖过之后才用像素坐标，而那时元素早就排好版了。任何一条路径都不会隐藏自己，
      //   最坏情况是"位置不太对"，而不是"消失"。
      style={
        pos && px
          ? { left: px.left, top: px.top }
          : { right: CORNER_INSET_PX, bottom: CORNER_INSET_PX }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <AnchorApp />
    </div>
  );
}
