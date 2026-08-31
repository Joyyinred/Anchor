// Anchor · SessionContext 的读写入口。getOrInitSessionContext() 首次调用时按下面的默认
// 策略现造一份并落盘；`onboarding.ts` 的 handleOnboardingSubmit() 完成后会用真正的起步教练
// 产出通过 saveSessionContext() 覆盖它——这里不区分"默认兜底"和"真实产出"两种来源，
// 两者共享同一个 storage key/格式（08-30：A13 消费 SessionContext 已确认，这条注释原来写的
// "A13 才会接真正的起步教练产出"是 08-27 Joy 补上 onboarding.ts/OnboardingPanel.tsx 之前
// 留下的过期说法，起步教练产出早就在接了）。
// 契约v4"无起步教练默认策略"：当前活动 tab 设为锚点、CREATOR 档、graceUntil = now + 2min
// 具体默认值规则由 src/engine/types.ts 的 defaultSessionContext()（纯函数，B1 产出，过了
// metaScenario 22 单测）定义——这里不再手写一份同样的逻辑（之前两处独立维护，容易改一处忘
// 另一处，见 08-26 code review ⑧）。这一层只负责平台层特有的部分：查当前活动 tab 拿锚点、
// 读写 chrome.storage.local。
import type { SessionContext } from '../../engine/types';
import { defaultSessionContext } from '../../engine/types';
import { domainOf, isInternalBrowserUrl } from './domain';
import { getDemoMode } from './state';

const SESSION_KEY = 'anchor_default_session';

export async function getOrInitSessionContext(): Promise<SessionContext> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const existing = stored[SESSION_KEY] as SessionContext | undefined;
  if (existing) return existing;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const rawUrl = activeTab?.url ?? '';
  // 08-30：同 onboarding.ts 的注释——chrome://extensions/ 这类内部页面不该被锁成锚点。
  const url = isInternalBrowserUrl(rawUrl) ? '' : rawUrl;
  const isDemoMode = await getDemoMode();

  const ctx = defaultSessionContext(Date.now(), { domain: domainOf(url), url }, 'default', isDemoMode);
  await chrome.storage.local.set({ [SESSION_KEY]: ctx });
  return ctx;
}

// 起步教练（B6）完成后，把它真正产出的 SessionContext 写回这同一个 storage key——
// getOrInitSessionContext() 下次读到的就是这份真实数据，不再是上面那份默认兜底。
// 只是个 setter，不重新推导任何字段，跟 getOrInitSessionContext() 共享同一份持久化格式。
export async function saveSessionContext(ctx: SessionContext): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: ctx });
}
