// Anchor · 从 URL 取域名的共用小工具
// 原来 session.ts / signals.ts 各写了一份一模一样的实现，合并成这一份，避免以后改一处漏一处
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// 08-30 真机复现的 bug：起步教练提交任务那一刻，如果当前活动 tab 恰好是开发者自己开着
// 调试用的 chrome://extensions/（真机测试离不开 SW 控制台，这个场景很容易撞上），
// `getOrInitSessionContext()`/`onboarding.ts` 会把这个跟用户任务毫不相关的内部页面锁成
// 整场会话的锚点——后果是 YouTube 上发生的所有事件 `isAnchor` 全是 false，
// `lastAnchorSnapshot` 永远是空的，答 DRIFTED 时 `pullBackToAnchor()` 会把用户拉去
// chrome://extensions/ 而不是他真正在看的页面。chrome://、chrome-extension://、
// devtools:// 这类浏览器内部页面不该被当成任何人的"锚点候选"——调用方在推断锚点前
// 用这个判断一下，命中就当作没有活动 tab 处理（域名/url 都留空，退回"暂无锚点"状态，
// 而不是硬把一个错误页面锁进去）。
export function isInternalBrowserUrl(url: string): boolean {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url);
}
