// Anchor · 用户点「Drifted - pull me back」之后真正把他带回锚点（B 侧，08-28 补的缺口）。
//
// 补的是一个"说了不算"的洞：这个按钮字面写着 pull me back、微重启文案也说
// "No worries, let's head back."，但在此之前代码只做了三件事——清空证据持续器、
// 记 lastAnswerTs、弹那句文案。**没有任何人真的回去。** 用户还留在无关页面上。
// 文案承诺了一个不存在的动作，这比一开始就不承诺更伤信任。
//
// ★ 08-30：目标从固定的 ctx.anchor.domain 改成 frame.lastAnchorSnapshot 指向的页面——
// perceiver.ts 的信号2已经改成"最后一次判定为 RELEVANT 的页面"，不再是起步教练最初声明
// 的那一个固定锚点（真实专注场景里会从 GitHub 切到 Jupyter 再切到 Notion）。check-in 文案
// 本来就是拿 lastAnchorSnapshot 拼的（"Last I saw you on X"），"带我回去"如果还照着旧的
// ctx.anchor.domain 走，会出现"文案说上次在 Jupyter，点了按钮却被带去 GitHub"这种自相
// 矛盾——两处必须指向同一个地方。目标 URL 由调用方（index.ts）从触发那一刻的
// PanelState.anchorUrl 传进来，不在这里读 SessionContext。
//
// ★ 边界（这条线很重要，是"朋友"和"监工"的分界）：
//   · 只切换、绝不关闭。用户授权的是"带我回去"，不是"把这个弄没"——关 tab 会毁掉
//     视频进度/写了一半的评论，而且不可逆。在"我们可能判错"的前提下只做可逆的动作。
//   · 只在答 DRIFTED 时做。FOCUSED（我在专注）和 FALSE_POSITIVE（你判错了）这两个
//     回答的意思恰恰是"别管我"，这时候切 tab 才真是监工。
//   · 找不到目标 tab 时什么都不做，不新开一个。用户可能是故意关掉的，硬开回来又越权了。
import { domainMatches } from '../../engine/perceiver';
import { domainOf } from './domain';

/**
 * 把用户切回 `targetUrl` 所在的 tab（同域即可，不要求 URL 完全相同——专注过程中同一个
 * 相关域名下的页面可能变了具体路径，比如 Notion 笔记从一个 block 滚到另一个）。
 * 返回是否真的切成功了——调用方要用这个结果决定说哪句话（切成功了才能说"我们回去吧"，
 * 没切成不能承诺）。
 */
export async function pullBackToAnchor(targetUrl: string): Promise<boolean> {
  const targetDomain = domainOf(targetUrl);
  if (!targetDomain) return false; // 压根没有可用的目标（从没有过 RELEVANT 页面的记录）

  const tabs = await chrome.tabs.query({});
  const targetTab = tabs.find((t) => t.url && domainMatches(domainOf(t.url), targetDomain));
  if (!targetTab?.id) return false;

  await chrome.tabs.update(targetTab.id, { active: true });
  // 目标可能在另一个窗口里——只 active 那个 tab 的话用户屏幕上什么都不会变，
  // 得把那个窗口也提到前台，否则"拉回去了"这件事用户根本看不见。
  if (targetTab.windowId !== undefined) {
    await chrome.windows.update(targetTab.windowId, { focused: true });
  }
  return true;
}
