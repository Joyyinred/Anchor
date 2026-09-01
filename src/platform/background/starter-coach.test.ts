// Anchor · B12 v2（08-31）：起步教练"编造具体细节"的运行时守卫。
//
// 只测 hasFabricatedSpecific 这一个纯字符串函数——它不碰 chrome API 也不碰 Groq，
// 跟 domain.test.ts 同一个道理，不受"平台层代码不做自动化测试"这条现有共识的限制。
// groqStarterCoachCall / callGroq / prompt 质量本身仍然只能真机手测（prompt 的好坏
// 没法用断言表达，见 docs/起步教练prompt-v0.md §6 的手测清单）。
import { describe, it, expect } from 'vitest';
import { hasFabricatedSpecific } from './starter-coach';

describe('hasFabricatedSpecific', () => {
  // ── 该拦的：任务里根本没提过的编号 ──

  it('真机复现的原句：任务没提章节，动作里冒出 "chapter 4"', () => {
    expect(
      hasFabricatedSpecific('Open the network textbook, flip to chapter 4.', 'review computer network for the exam')
    ).toBe(true);
  });

  it('编号词表里的其它词一样拦（page / lecture / section / slide …）', () => {
    const task = 'study for the test';
    expect(hasFabricatedSpecific('Turn to page 42 and read the summary.', task)).toBe(true);
    expect(hasFabricatedSpecific('Pull up lecture 5 slides.', task)).toBe(true);
    expect(hasFabricatedSpecific('Reread section 2 of your notes.', task)).toBe(true);
    expect(hasFabricatedSpecific('Open slide 3 and read the title.', task)).toBe(true);
    expect(hasFabricatedSpecific('Do problem 1 on paper.', task)).toBe(true);
    expect(hasFabricatedSpecific('Start week 6 of the course.', task)).toBe(true);
  });

  it('大小写不影响判定（模型可能写 "Chapter 4" 也可能写 "chapter 4"）', () => {
    expect(hasFabricatedSpecific('Open Chapter 4 of the book.', 'review networking')).toBe(true);
  });

  it('任务给了 chapter 3，动作却说 chapter 4——换了个数字也是编的', () => {
    expect(
      hasFabricatedSpecific('Open chapter 4 of the react docs.', 'finish chapter 3 of the react docs')
    ).toBe(true);
  });

  it('一句话里多个编号，只要有一个是编的就拦', () => {
    expect(
      hasFabricatedSpecific('Open chapter 3, then page 12.', 'finish chapter 3 of the react docs')
    ).toBe(true);
  });

  // ── 不该拦的：用户自己给的细节，必须原样放行 ──

  it('任务里明确写了 chapter 3，动作复用它不算编造', () => {
    expect(
      hasFabricatedSpecific('Open chapter 3 and read the first page.', 'finish chapter 3 of the react docs')
    ).toBe(false);
  });

  it('任务和动作大小写不一致也算用户给过（"Chapter 3" vs "chapter 3"）', () => {
    expect(hasFabricatedSpecific('Open Chapter 3 now.', 'finish chapter 3 tonight')).toBe(false);
  });

  it('任务里多打了空格（"chapter  3"）不该误杀——归一化之后仍算给过', () => {
    expect(hasFabricatedSpecific('Open chapter 3 now.', 'finish chapter  3 tonight')).toBe(false);
  });

  // ── prompt v2 想要的那类回答：泛化但真实，一律放行 ──

  it('v2 的三条 Good 范例都不含编号，全部放行', () => {
    const task = 'review computer network for the exam';
    expect(hasFabricatedSpecific('Open the essay doc and type just the title.', task)).toBe(false);
    expect(hasFabricatedSpecific('Pull up your slides and read the first one.', task)).toBe(false);
    expect(hasFabricatedSpecific('Put your textbook on the desk, open to today’s topic.', task)).toBe(false);
  });

  it('编号词单独出现、后面没跟数字时不拦（"read the first slide" 是合法表述）', () => {
    const task = 'review computer network for the exam';
    expect(hasFabricatedSpecific('Read the first slide out loud.', task)).toBe(false);
    expect(hasFabricatedSpecific('Open your notes to the chapter you left off.', task)).toBe(false);
  });

  it('无关的数字（时长、条数）不在词表里，不该被当成编造', () => {
    expect(hasFabricatedSpecific('Write 3 sentences of the intro.', 'write the blog post')).toBe(false);
    expect(hasFabricatedSpecific('Set a 5 minute timer and start.', 'write the blog post')).toBe(false);
  });

  // ── 已知局限：写成测试是为了让它不被误当成"已经修好了" ──

  it('★ 已知局限：编造的书名/文件名挡不住（非数字型胡诌，只能靠 prompt）', () => {
    expect(
      hasFabricatedSpecific('Open Tanenbaum and read the intro.', 'review computer network for the exam')
    ).toBe(false);
  });
});
