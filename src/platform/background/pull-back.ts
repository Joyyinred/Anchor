// Anchor · 用户点「Drifted - pull me back」之后真正把他带回锚点（B 侧，08-28 补的缺口）。
//
// 补的是一个"说了不算"的洞：这个按钮字面写着 pull me back、微重启文案也说
// "No worries, let's head back."，但在此之前代码只做了三件事——清空证据持续器、
// 记 lastAnswerTs、弹那句文案。**没有任何人真的回去。** 用户还留在无关页面上。
// 文案承诺了一个不存在的动作，这比一开始就不承诺更伤信任。
//
// ★ 边界（这条线很重要，是"朋友"和"监工"的分界）：
//   · 只切换、绝不关闭。用户授权的是"带我回去"，不是"把这个弄没"——关 tab 会毁掉
//     视频进度/写了一半的评论，而且不可逆。在"我们可能判错"的前提下只做可逆的动作。
//   · 只在答 DRIFTED 时做。FOCUSED（我在专注）和 FALSE_POSITIVE（你判错了）这两个
//     回答的意思恰恰是"别管我"，这时候切 tab 才真是监工。
//   · 找不到锚点 tab 时什么都不做，不新开一个。用户可能是故意关掉的，硬开回来又越权了。
import type { SessionContext } from '../../engine/types';
import { isAnchorMatch } from './signals';
import { domainOf } from './domain';

/**
 * 把用户切回锚点 tab。返回是否真的切成功了——调用方要用这个结果决定说哪句话
 * （切成功了才能说"我们回去吧"，没切成不能承诺）。
 */
export async function pullBackToAnchor(ctx: SessionContext): Promise<boolean> {
  if (!ctx.anchor.domain) return false; // 压根没有锚点（跳过起步教练又还没推断出来）

  const tabs = await chrome.tabs.query({});
  // 复用 signals.ts 判 isAnchor 用的同一条匹配逻辑，exact/prefix 两种模式都按同样的
  // 规则走——否则会出现"感知半认为你在锚点上、但拉回功能找不到那个 tab"这种自相矛盾。
  const anchorTab = tabs.find((t) => t.url && isAnchorMatch(domainOf(t.url), ctx.anchor));
  if (!anchorTab?.id) return false;

  await chrome.tabs.update(anchorTab.id, { active: true });
  // 锚点可能在另一个窗口里——只 active 那个 tab 的话用户屏幕上什么都不会变，
  // 得把那个窗口也提到前台，否则"拉回去了"这件事用户根本看不见。
  if (anchorTab.windowId !== undefined) {
    await chrome.windows.update(anchorTab.windowId, { focused: true });
  }
  return true;
}
