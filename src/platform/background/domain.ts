// Anchor · 从 URL 取域名的共用小工具
// 原来 session.ts / signals.ts 各写了一份一模一样的实现，合并成这一份，避免以后改一处漏一处
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
