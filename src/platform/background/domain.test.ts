// Anchor · isInternalBrowserUrl 是纯字符串判断（不碰 chrome API），可以完整单测——
// 跟平台层其余代码（真实 chrome.tabs/storage 调用）不一样，这里没有"没有 chrome-API-mock
// 测试基建"这条已知缺口的限制。08-30 真机复现：起步教练提交时活动 tab 是 chrome://extensions/，
// 被误当成锚点，见 onboarding.ts/session.ts 的调用处注释。
import { describe, it, expect } from 'vitest';
import { isInternalBrowserUrl } from './domain';

describe('isInternalBrowserUrl', () => {
  it('chrome:// 页面（真机复现的具体场景：chrome://extensions/）判为内部页面', () => {
    expect(isInternalBrowserUrl('chrome://extensions/')).toBe(true);
  });

  it('chrome-extension:// 页面（本扩展自己的 side panel/其他扩展页面）判为内部页面', () => {
    expect(isInternalBrowserUrl('chrome-extension://abcdefg/sidepanel.html')).toBe(true);
  });

  it('devtools:// 和 about: 也判为内部页面', () => {
    expect(isInternalBrowserUrl('devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isInternalBrowserUrl('about:blank')).toBe(true);
  });

  it('真实网页（含 https/http）不判为内部页面', () => {
    expect(isInternalBrowserUrl('https://www.youtube.com/watch?v=aircAruvnKk')).toBe(false);
    expect(isInternalBrowserUrl('http://localhost:3000/')).toBe(false);
  });

  it('空字符串（没有活动 tab 时的兜底值）不判为内部页面——不应该被这条规则拦下来重复处理', () => {
    expect(isInternalBrowserUrl('')).toBe(false);
  });
});
