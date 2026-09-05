// Anchor · 评测集规则层自己的单测（B12，09-01）
//
// 为什么规则也要测：跑分脚本输出的数字全靠这层判定。规则写错的话，**分数会撒谎**——
// 而且是往好看的方向撒谎（漏判 = 通过率虚高），比没有评测集更危险。
// 这里全部离线、确定性，所以进 `npm test`；真正打 Groq 的 run-starter-coach.ts 永远不进。
//
// 用例来源：v1~v4 四版真机上见过的坏答案原句 + v4 prompt 里那三条 Good 范例。
import { describe, it, expect } from 'vitest';
import { checkBorrowedIrrelevantPage, checkFirstAction, checkIgnoredRelevantPage, classifyShape } from './rules';

/** 断言这条产出干净通过（一条违规都没有） */
function expectClean(action: string, task: string): void {
  expect(checkFirstAction(action, task)).toEqual([]);
}

/** 断言这条产出被某个规则拦下 */
function expectViolation(action: string, task: string, code: string): void {
  expect(checkFirstAction(action, task).map((v) => v.code)).toContain(code);
}

describe('评测规则 · 四版真机踩过的坑', () => {
  it('v1：编造任务里没给过的章节号', () => {
    expectViolation(
      'Open the network textbook, flip to chapter 4.',
      'review computer network for the exam',
      'FABRICATED_NUMBER'
    );
  });

  it('v2：假设用户已经有笔记（新课的笔记按定义不存在）', () => {
    expectViolation(
      'Pick up your notes and read the first line.',
      'I wanna prestudy my new course advanced data structure and algorithm',
      'ASSUMES_POSSESSION'
    );
  });

  it('v3：合规但零信息量——把课程名打进空文档', () => {
    expectViolation(
      'Open a new doc, type down data structure and algorithm.',
      'pre study for my new course data structure and algorithm',
      'ZERO_INFO'
    );
  });

  it('v3 变体：给空文档起个标题，同样是零信息量', () => {
    expectViolation('Open a blank doc and type just the title.', 'write my thesis intro', 'ZERO_INFO');
  });

  it('09-05 真机复现：相关页面里随手选中/复制第一句话，跟打标题是同一种零信息量', () => {
    expectViolation('Select the first sentence on the page and copy it.', 'starter coach', 'ZERO_INFO');
  });
});

describe('评测规则 · v1 就有的四类废话', () => {
  const task = 'write the essay about urban planning';

  it('复述目标', () => expectViolation('Start writing the essay.', task, 'RESTATES_GOAL'));
  it('计划伪装成开始', () => expectViolation('Plan your essay structure.', task, 'PLANNING'));
  it('前置条件当动作', () => expectViolation('Open your laptop.', task, 'PREREQUISITE'));
  it('一串步骤', () => expectViolation('Open the doc, then outline, then write.', task, 'SEQUENCE'));
  it('加油打气式空话', () => expectViolation('You can do this! Just begin.', task, 'CHEERLEADING'));
});

describe('评测规则 · 09-01 跑分批量视角发现的', () => {
  it('搜索伪装成的计划：搜"怎么 debug"不是 debug', () => {
    expectViolation(
      'Open a new tab and search for "login flow debugging steps"',
      'debug the login flow in our app',
      'SEARCH_AS_PLANNING'
    );
  });

  it('搜材料本身不算——study guide 是材料，不是"关于怎么做的建议"', () => {
    expectClean('Open a new tab and search for the test study guide', 'study for the test');
  });

  it('搜大纲/论文这类材料一律放行', () => {
    expectClean('Open a new tab and search for the course syllabus.', 'study data structures');
    expectClean('Open a new tab and search for transformer paper PDF', 'read the transformer paper');
  });
});

describe('评测规则 · 其余硬约束', () => {
  it('超过 12 词（气泡只有 220px 宽）', () => {
    expectViolation(
      'Open the document you were working on yesterday and read through the last paragraph carefully',
      'finish the report',
      'TOO_LONG'
    );
  });

  it('中文声明任务时输出跟着回了中文', () => {
    expectViolation('打开课本读第一页。', '准备明天的数据结构考试', 'NOT_ENGLISH');
  });
});

describe('评测规则 · 必须放行的（误杀比漏判更难发现）', () => {
  it('v4 的三条 Good 范例全部干净通过', () => {
    const task = 'pre study for my new course data structure and algorithm';
    expectClean('Open a new tab and search for the course syllabus.', task);
    expectClean('Open a blank doc and write one rough sentence of the intro.', task);
    expectClean('Look up what the first week of the course covers.', task);
  });

  it('用户自己给了 chapter 3，原样复用不算编造', () => {
    expectClean('Open chapter 3 and read the first paragraph.', 'finish chapter 3 of the react docs');
  });

  it('用户自己提了 notes，说 your notes 就不是假设', () => {
    expectClean('Open your notes and read the last thing you wrote.', 'review my notes before the exam');
  });

  it('"write one rough sentence" 是产出真东西，不是零信息量', () => {
    expectClean('Open a blank doc and write one rough sentence.', 'write a blog post about my trip');
  });

  it('单个逗号的正常句子不算序列', () => {
    expectClean('Open the syllabus, read the first line.', 'study for the test');
  });

  it('"read the first slide" 里的 slide 没跟数字，不算编造', () => {
    expectClean('Open the deck and read the first slide.', 'prepare the presentation');
  });
});

describe('动作形态归类（用来发现"每条都合规但只会一招"）', () => {
  it('按用户最终真正做的那件事归类，不是按第一个动词', () => {
    // "Open a new tab and search…" 的价值在 search，不在 open
    expect(classifyShape('Open a new tab and search for the syllabus.')).toBe('SEARCH');
    // "Open a blank doc and write…" 的价值在 write
    expect(classifyShape('Open a blank doc and write one rough sentence.')).toBe('WRITE');
    expect(classifyShape('Open chapter 3 and read the first paragraph.')).toBe('READ');
    expect(classifyShape('Press play on the lecture you have open.')).toBe('PLAY');
    expect(classifyShape('Open the syllabus.')).toBe('OPEN_EXISTING');
  });

  it('09-01 第一次跑分那四条产出，全部归到 SEARCH——这就是当时肉眼看到的问题', () => {
    const four = [
      'Search for computer network exam review on your browser',
      'Open a new tab and search for advanced data structure and algorithm',
      'Open a new tab and search for data structure and algorithm syllabus',
      'Open a new tab and search for "react docs chapter 3"',
    ];
    expect(four.map(classifyShape)).toEqual(['SEARCH', 'SEARCH', 'SEARCH', 'SEARCH']);
  });
});

describe('v5 防讨好：无关页面不许被硬凑进来', () => {
  const gmail = { title: 'Inbox (128) - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' };

  it('把 Gmail 硬凑进"学神经网络"里——编造换了个真实的锚', () => {
    expect(
      checkBorrowedIrrelevantPage('Search your inbox for the course email.', 'study neural networks', gmail)?.code
    ).toBe('BORROWED_IRRELEVANT_PAGE');
  });

  it('域名主体也算（说 gmail 而不说 inbox 一样拦）', () => {
    expect(
      checkBorrowedIrrelevantPage('Open gmail and look for the syllabus.', 'study neural networks', gmail)?.code
    ).toBe('BORROWED_IRRELEVANT_PAGE');
  });

  it('正确地忽略了无关页面就该放行', () => {
    expect(
      checkBorrowedIrrelevantPage('Open a new tab and search for a neural network course.', 'study neural networks', gmail)
    ).toBeNull();
  });

  it('任务里本来就有的词不算"借用页面"', () => {
    // 任务提了 email，页面也提了 email——这时说 email 是照着任务说的，不是照着页面说的
    const inbox = { title: 'Inbox - Gmail', url: 'https://mail.google.com' };
    expect(checkBorrowedIrrelevantPage('Open your inbox and read the first email.', 'clear my email inbox today', inbox)).toBeNull();
  });

  it('只有标了 anchorShouldBeIgnored 才跑这条——不传 anchor 时 checkFirstAction 不管它', () => {
    expect(checkFirstAction('Search your inbox for the course email.', 'study neural networks')).toEqual([]);
  });
});

describe('v5 另一半：相关页面就在眼前，不许再让人去搜', () => {
  it('真机原句：开着 react.dev 却去搜 React docs chapter 3', () => {
    expect(checkIgnoredRelevantPage('Open a new tab and search for React docs chapter 3')?.code)
      .toBe('IGNORED_OPEN_PAGE');
  });

  it('用上了眼前的页面就放行', () => {
    expect(checkIgnoredRelevantPage('Press play on the video you already have open.')).toBeNull();
    expect(checkIgnoredRelevantPage('Scroll to the first code example on this page.')).toBeNull();
  });

  it('只有标了 anchorShouldBeUsed 才跑这条——对照组不受影响', () => {
    expect(checkFirstAction('Open a new tab and search for React docs chapter 3', 'finish chapter 3 of the react docs')).toEqual([]);
  });
});
