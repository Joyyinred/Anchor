// B7 单测：check-in / 微重启措辞 v1
import { describe, it, expect } from 'vitest';
import { buildCheckInMessage, buildMicroRestartMessage } from './wording';

const now = 1_000_000;

describe('B7: buildCheckInMessage — DRIFT（数据源 lastAnchorSnapshot，契约v4 ★）', () => {
  it('引用 lastAnchorSnapshot.title，不是 currentTitle（场景25同精神：问的是离开的那件事）', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'login.tsx debugging', url: 'https://vscode.dev/proj', ts: now - 10 * 60_000 }, currentTitle: 'Top 10 Funny Cats' },
      now
    );
    expect(msg).toContain('login.tsx debugging');
    expect(msg).not.toContain('Top 10 Funny Cats');
  });

  // 08-28 真机测试：真实页面标题（YouTube 标题常见 60-80 字符）会把气泡撑高到顶穿 side panel
  // 顶部、盖到 Chrome 原生标题栏下面——裁掉超长标题给气泡高度一个上限。
  it('超长标题会被裁短并加省略号，不会原样整条塞进措辞里', () => {
    const longTitle = 'Hailey Bieber Opens Up About Motherhood, Fame and Her $1 Billion Brand - YouTube';
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: longTitle, url: '', ts: now - 60_000 }, currentTitle: '' },
      now
    );
    expect(msg).not.toContain(longTitle);
    expect(msg).toContain('…');
  });

  it('elapsed 时间正确换算并格式化（10分钟前）', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'task', url: '', ts: now - 10 * 60_000 }, currentTitle: '' },
      now
    );
    expect(msg).toContain('10 minutes ago');
  });

  it('elapsed=1 分钟用单数 "1 minute ago"，不是 "1 minutes ago"', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'task', url: '', ts: now - 60_000 }, currentTitle: '' },
      now
    );
    expect(msg).toContain('1 minute ago');
    expect(msg).not.toContain('1 minutes ago');
  });

  it('elapsed<=0（刚发生）显示 "just now"，不显示负数或 0 minutes ago', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'task', url: '', ts: now }, currentTitle: '' },
      now
    );
    expect(msg).toContain('just now');
  });

  it('还没有过锚点交互（快照 ts=0）：不显示"多久以前"，不能算出 1970 年起的天文数字', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: '', url: '', ts: 0 }, currentTitle: '' },
      now
    );
    // 真机上出现过 "29798077 minutes ago"（≈56 年）——比没有信息更伤可信度
    expect(msg).not.toMatch(/minutes? ago/);
    expect(msg).not.toMatch(/d{4,}/);
    expect(msg).toContain('what you were working on');
  });

  it('快照有标题但 ts=0（理论上不该发生）也走同一条兜底，不算时间差', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'some title', url: '', ts: 0 }, currentTitle: '' },
      now
    );
    expect(msg).not.toMatch(/minutes? ago/);
  });

  it('title 为空字符串时用兜底文案，不拼出裸引号 ""', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: '', url: '', ts: now - 5 * 60_000 }, currentTitle: '' },
      now
    );
    expect(msg).not.toContain('""');
    expect(msg).toContain('what you were working on');
  });

  it('语气是疑问句，不是指控/说教（"像朋友不像监工"）', () => {
    const msg = buildCheckInMessage(
      'DRIFT',
      { lastAnchorSnapshot: { title: 'task', url: '', ts: now - 5 * 60_000 }, currentTitle: '' },
      now
    );
    expect(msg.endsWith('?')).toBe(true);
    expect(msg).not.toMatch(/you should|stop|focus!|又|走神了/i);
  });
});

describe('B7: buildCheckInMessage — STUCK（数据源 currentTitle，不是 lastAnchorSnapshot）', () => {
  it('引用 currentTitle，不是 lastAnchorSnapshot.title（STUCK 时用户没离开，问的是当前页）', () => {
    const msg = buildCheckInMessage(
      'STUCK',
      { lastAnchorSnapshot: { title: 'old anchor moment', url: '', ts: now - 30 * 60_000 }, currentTitle: 'thesis-chapter-3.pdf' },
      now
    );
    expect(msg).toContain('thesis-chapter-3.pdf');
    expect(msg).not.toContain('old anchor moment');
  });

  it('超长 currentTitle 同样会被裁短', () => {
    const longTitle = 'Hailey Bieber Opens Up About Motherhood, Fame and Her $1 Billion Brand - YouTube';
    const msg = buildCheckInMessage(
      'STUCK',
      { lastAnchorSnapshot: { title: '', url: '', ts: now }, currentTitle: longTitle },
      now
    );
    expect(msg).not.toContain(longTitle);
    expect(msg).toContain('…');
  });

  it('currentTitle 为空字符串时用兜底文案', () => {
    const msg = buildCheckInMessage(
      'STUCK',
      { lastAnchorSnapshot: { title: '', url: '', ts: now }, currentTitle: '' },
      now
    );
    expect(msg).not.toContain('""');
    expect(msg).toContain('this');
  });

  it('语气同样是疑问句，两个体面的台阶（卡住 / 在思考），不是指控', () => {
    const msg = buildCheckInMessage(
      'STUCK',
      { lastAnchorSnapshot: { title: '', url: '', ts: now }, currentTitle: 'thesis.pdf' },
      now
    );
    expect(msg.endsWith('?')).toBe(true);
  });
});

describe('B7: buildMicroRestartMessage（契约v4 §3.6/场景17：答"飘了"后的一句反馈）', () => {
  it('FOCUSED → 简短肯定，不追问第二句', () => {
    expect(buildMicroRestartMessage('FOCUSED')).toBe('Good, carry on.');
  });

  it('FALSE_POSITIVE → 确认收到，不带评判', () => {
    const msg = buildMicroRestartMessage('FALSE_POSITIVE');
    expect(msg).not.toMatch(/sorry|wrong|mistake/i);
  });

  it('DRIFTED → 不说教，直接带回去（微重启，不是训话）', () => {
    const msg = buildMicroRestartMessage('DRIFTED');
    expect(msg).not.toMatch(/again|why|should have/i);
  });

  it('三种回答互不相同（不能共用一句万能回复糊弄过去）', () => {
    const all = ['FOCUSED', 'FALSE_POSITIVE', 'DRIFTED'] as const;
    const messages = all.map(buildMicroRestartMessage);
    expect(new Set(messages).size).toBe(3);
  });
});