// Anchor · 09-05：AI 对话类网站的"最新用户消息"抓取器。
//
// 为什么要这个：contextRelevance 判断到目前为止只看得到 chrome.tabs 的 title/url，但 AI
// 对话页面的标题不一定随每轮对话更新——真机复现：在一个标题是"Junction 2026 hackathon
// 新手参赛指南"的 claude.ai 对话里连续问了 3 个完全无关的问题，标题从头到尾没变，
// contextRelevance 长期卡在旧标题算出的判定上。这个模块给 content-script.ts 提供一个
// 可插拔的"抓取器"接口，读取用户刚在对话框里发送的最新一条消息文字，作为比标题更细
// 粒度、真正跟着每一轮对话走的分类依据（见 SignalEvent.contentSnippet 顶部注释）。
//
// 09-05 当天先只做了 claude.ai（选择器验证过，真机确认工作正常），这次（Jay 反馈"claude
// 功能成功，可扩展到所有已收录的ai"）扩到 `heuristics.ts` AI_CHAT_DOMAINS 里注册的全部
// 域名——两份列表都在管"这是不是一个 AI 对话网站"这同一个事实，理应覆盖同一批域名，
// 不应该出现"contentKind 判成 ai_chat，但 contentSnippet 抓取器不认识"这种半吊子状态。
//
// ★ 选择器需要真机验证——只有 claude.ai 是当天做完就真机确认过的；下面新增的其余站点
//   （chatgpt.com/gemini.google.com/grok.com/perplexity.ai/copilot.microsoft.com/
//   chat.deepseek.com/poe.com）我没有办法逐一打开真机检查实际 DOM 结构，选择器是按每个
//   站点已知/常见的约定给的起始猜测，置信度各不相同（见每条候选选择器旁的注释）。抓不到
//   就静默返回 null，不影响任何既有功能——这些新增站点在验证之前，contentSnippet 大概率
//   就是"悄悄地什么都不做"，不会比现在更差，但也还没真正生效，需要 Jay 用得到时用
//   DevTools 逐个核对、调整。
import { domainMatches } from '../../engine/perceiver';

export interface ChatSiteExtractor {
  matches(domain: string): boolean;
  /** 抓不到（选择器落空/页面结构变了）一律返回 null，绝不抛错——见文件顶部注释。 */
  extractLatestUserMessage(): string | null;
}

const MAX_SNIPPET_LENGTH = 200;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function truncate(text: string): string {
  return text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…` : text;
}

/**
 * 通用实现：按顺序尝试一组候选选择器，取第一个抓到非空文本的，用它最后一个节点
 * （对话里最新的一条）。多个候选选择器是为了在没有真机验证的情况下增加命中概率——
 * 不同站点的实现约定不一样，与其赌一个选择器，不如按可能性从高到低试几个。
 */
function extractFromSelectors(selectors: string[]): string | null {
  try {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      const last = nodes[nodes.length - 1];
      const text = last?.textContent;
      if (text && normalize(text)) return truncate(normalize(text));
    }
    return null;
  } catch {
    return null;
  }
}

interface DomainSpec {
  /** 跟 domainMatches 语义一致：同域或其子域都算命中。 */
  domain: string;
  /** 按可能性从高到低排列的候选选择器。 */
  selectors: string[];
  /** 置信度备注，纯文档用途，不参与逻辑。 */
  note: string;
}

const DOMAIN_SPECS: DomainSpec[] = [
  {
    domain: 'claude.ai',
    selectors: ['[data-testid="user-message"]'],
    note: '09-05 真机验证过，工作正常。',
  },
  {
    // chat.openai.com 是旧域名，chatgpt.com 是现在的主域名，两者共用同一套前端。
    domain: 'chatgpt.com',
    selectors: ['[data-message-author-role="user"]'],
    note: '较高置信度——ChatGPT 网页版给用户消息打 data-message-author-role="user" 是长期稳定、被广泛引用的约定，但仍未真机验证，需要确认。',
  },
  {
    domain: 'chat.openai.com',
    selectors: ['[data-message-author-role="user"]'],
    note: '跟 chatgpt.com 同一套前端，同一个选择器。',
  },
  {
    domain: 'gemini.google.com',
    selectors: ['user-query .query-text', 'user-query'],
    note: '低置信度猜测——Gemini 网页版是 Angular 自定义元素 <user-query>，具体内部结构未经验证。',
  },
  {
    domain: 'grok.com',
    selectors: ['[data-testid="user-message"]', '[data-message-author-role="user"]'],
    note: '未知，借用另外两个已知约定试一下，命中概率不确定。',
  },
  {
    domain: 'perplexity.ai',
    selectors: ['[data-testid="user-message"]'],
    note: '低置信度——Perplexity 的交互形态跟典型聊天气泡不同（用户提问常展示成页面标题），这个选择器很可能抓不到，需要重新观察真实结构。',
  },
  {
    domain: 'copilot.microsoft.com',
    selectors: ['[data-testid="user-message"]', '[data-content="user-message"]'],
    note: '未知，纯猜测。',
  },
  {
    domain: 'chat.deepseek.com',
    selectors: ['[data-testid="user-message"]'],
    note: '未知，纯猜测——国内团队产品常用 CSS-in-JS/模块化哈希类名，data-testid 命中概率偏低。',
  },
  {
    domain: 'poe.com',
    selectors: ['[data-testid="user-message"]', '[class*="rightSideMessageBubble" i]'],
    note: '未知，纯猜测。',
  },
];

const CHAT_SITE_EXTRACTORS: ChatSiteExtractor[] = DOMAIN_SPECS.map((spec) => ({
  matches: (domain) => domainMatches(domain, spec.domain),
  extractLatestUserMessage: () => extractFromSelectors(spec.selectors),
}));

export function findChatSiteExtractor(domain: string): ChatSiteExtractor | undefined {
  return CHAT_SITE_EXTRACTORS.find((e) => e.matches(domain));
}
