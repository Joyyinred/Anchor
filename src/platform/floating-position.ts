// Anchor · 悬浮桌宠的位置（B16，09-02）。background <-> 内容脚本之间共享的状态，
// 跟 panel-state.ts / rest-state.ts 同一个模式：传输层，不进引擎契约。
//
// ★ 为什么位置必须持久化：内容脚本**每次导航都会重新挂载**（换页 = 新页面 = 新的一份 DOM）。
//   不存的话，用户在 YouTube 上把猫拖到左下角，跳到下一页它又蹦回右下角了——
//   一个"记不住自己在哪"的桌宠比固定在角落还烦。
//
// ★ 为什么存百分比而不是像素：像素是绑死在某块屏幕上的。在 27 寸外接屏上拖到右边，
//   合上盖子换成笔记本屏，那个坐标直接落在可视区外面，再也够不着。百分比跟分辨率无关。
export const FLOATING_POSITION_KEY = 'anchor_floating_position';

/**
 * 悬浮层位置，单位是**视口百分比**（0~1），锚点是元素左上角。
 * 默认值放在右下角——那是桌面挂件的惯例位置，也最不容易挡住网页正文。
 */
export interface FloatingPosition {
  xRatio: number;
  yRatio: number;
}

// ★ 09-02：这里原来有一个 DEFAULT_FLOATING_POSITION = {0.98, 0.96}，已经删掉。
//   默认位置现在由 FloatingHost 用 CSS 的 right/bottom 直接表达（贴右下角），
//   **一次元素测量都不需要**——原来那条"用比例算默认位置"的路要先量元素尺寸，
//   而挂载那一刻量出来是 0，卡片被摆到视口底边外面，页面上什么都看不见。
//   这个类型现在只描述"用户拖到过哪里"，没拖过就是 null，不存在"默认比例"这回事。

/**
 * 把比例换算成像素，并夹回可视区内。
 *
 * ★ 夹回来这一步不能省：用户把猫拖到最右边之后把窗口缩窄，不夹的话它会停在可视区外面，
 *   鼠标够不着、也拖不回来——只能去清 storage，等于把自己锁在门外。
 *   这里同时兼顾了"存的时候是右下角、现在窗口变大了"这种反方向的情况。
 */
export function resolvePosition(
  pos: FloatingPosition,
  viewport: { width: number; height: number },
  size: { width: number; height: number }
): { left: number; top: number } {
  const maxLeft = Math.max(0, viewport.width - size.width);
  const maxTop = Math.max(0, viewport.height - size.height);
  return {
    left: Math.min(maxLeft, Math.max(0, pos.xRatio * viewport.width - size.width / 2)),
    top: Math.min(maxTop, Math.max(0, pos.yRatio * viewport.height - size.height / 2)),
  };
}

/** 像素坐标换回比例存盘。取元素中心点，这样窗口尺寸变化时"大致还在原来那个区域"。 */
export function toRatio(
  px: { left: number; top: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number }
): FloatingPosition {
  // 视口尺寸为 0 是不可能发生的情况（真发生了说明页面还没排版，那也不该在这时候存位置），
  // 但除法必须有兜底——存进去一个 NaN 的话，下次读出来会算出 NaN 坐标，卡片直接消失，
  // 而且会一直存在 storage 里，刷新也好不了。0.5 至少还在屏幕中间，看得见、拖得动。
  return {
    xRatio: viewport.width > 0 ? (px.left + size.width / 2) / viewport.width : 0.5,
    yRatio: viewport.height > 0 ? (px.top + size.height / 2) / viewport.height : 0.5,
  };
}
