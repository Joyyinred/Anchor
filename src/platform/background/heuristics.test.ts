// A16：guessContentKind() 覆盖面测试——纯函数（不碰 chrome API），沿用 domain.test.ts
// 开的先例（平台层也可以测纯函数，不是只有 src/engine 才有测试基建）。
import { describe, it, expect } from 'vitest';
import { guessContentKind, mapEntryIntent } from './heuristics';

describe('guessContentKind', () => {
  it('arxiv.org 判 pdf（不看路径）', () => {
    expect(guessContentKind('https://arxiv.org/abs/2301.00001', 'arxiv.org')).toBe('pdf');
  });

  it('.pdf 结尾的 url 判 pdf（不看域名）', () => {
    expect(guessContentKind('https://example.com/paper.pdf', 'example.com')).toBe('pdf');
  });

  it('code 域（含子域）判 code', () => {
    expect(guessContentKind('https://github.com/foo/bar', 'github.com')).toBe('code');
    expect(guessContentKind('https://gist.github.com/x', 'gist.github.com')).toBe('code');
  });

  it('docs 域判 docs', () => {
    expect(guessContentKind('https://react.dev/reference/hooks', 'react.dev')).toBe('docs');
  });

  it('ai_chat 域判 ai_chat', () => {
    expect(guessContentKind('https://claude.ai/chat/abc', 'claude.ai')).toBe('ai_chat');
  });

  it('music 域判 music', () => {
    expect(guessContentKind('https://open.spotify.com/track/1', 'open.spotify.com')).toBe('music');
  });

  it('youtube 普通视频判 video，/shorts/ 路径判 short_feed', () => {
    expect(guessContentKind('https://www.youtube.com/watch?v=abc', 'www.youtube.com')).toBe('video');
    expect(guessContentKind('https://www.youtube.com/shorts/abc', 'www.youtube.com')).toBe('short_feed');
  });

  it('bilibili 同 youtube 逻辑', () => {
    expect(guessContentKind('https://www.bilibili.com/video/BV1', 'www.bilibili.com')).toBe('video');
    expect(guessContentKind('https://www.bilibili.com/shorts/BV1', 'www.bilibili.com')).toBe('short_feed');
  });

  it('facebook.com 的 /reel/ 或 /reels/ 路径硬判 short_feed（Meta Reels URL 形态）', () => {
    expect(guessContentKind('https://www.facebook.com/reel/123', 'www.facebook.com')).toBe('short_feed');
    expect(guessContentKind('https://www.facebook.com/reels/123', 'www.facebook.com')).toBe('short_feed');
  });

  it('facebook.com 非 reel 路径判 social_feed（域级不能一刀切，见 A16 注释）', () => {
    expect(guessContentKind('https://www.facebook.com/groups/devs', 'www.facebook.com')).toBe('social_feed');
  });

  it('reddit/x/twitter/pinterest/threads 判 social_feed', () => {
    expect(guessContentKind('https://www.reddit.com/r/programming', 'www.reddit.com')).toBe('social_feed');
    expect(guessContentKind('https://x.com/home', 'x.com')).toBe('social_feed');
    expect(guessContentKind('https://twitter.com/home', 'twitter.com')).toBe('social_feed');
    expect(guessContentKind('https://pinterest.com/pin/1', 'pinterest.com')).toBe('social_feed');
    expect(guessContentKind('https://www.threads.net/@x', 'www.threads.net')).toBe('social_feed');
  });

  it('wikipedia/medium/zhihu 判 article', () => {
    expect(guessContentKind('https://en.wikipedia.org/wiki/Focus', 'en.wikipedia.org')).toBe('article');
    expect(guessContentKind('https://medium.com/@x/post', 'medium.com')).toBe('article');
    expect(guessContentKind('https://www.zhihu.com/question/1', 'www.zhihu.com')).toBe('article');
  });

  it('未登记的域名判 unknown', () => {
    expect(guessContentKind('https://some-random-site.com/page', 'some-random-site.com')).toBe('unknown');
  });
});

describe('mapEntryIntent', () => {
  it('pushState 保守判 unknown（SPA 内部跳转无可靠 transitionType）', () => {
    expect(mapEntryIntent('pushState')).toBe('unknown');
  });

  it('typed/reload/auto_bookmark/link 判 direct_link', () => {
    expect(mapEntryIntent('typed')).toBe('direct_link');
    expect(mapEntryIntent('reload')).toBe('direct_link');
    expect(mapEntryIntent('auto_bookmark')).toBe('direct_link');
    expect(mapEntryIntent('link')).toBe('direct_link');
  });

  it('generated/keyword/keyword_generated 判 search', () => {
    expect(mapEntryIntent('generated')).toBe('search');
    expect(mapEntryIntent('keyword')).toBe('search');
    expect(mapEntryIntent('keyword_generated')).toBe('search');
  });

  it('未知 transitionType 判 unknown', () => {
    expect(mapEntryIntent('form_submit')).toBe('unknown');
  });
});
