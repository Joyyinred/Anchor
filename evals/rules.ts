// Anchor · 起步教练评测集的规则断言层（B12，09-01）
//
// 为什么只做规则、不做 LLM-as-judge：v1→v4 四个版本真实踩过的每一个坑，**全部是机械可检测的**
// （编造编号 / 假设已拥有 / 零信息量 / 超长 / 多步 / 复述目标 / 计划伪装 / 前置条件 / 加油打气）。
// 便宜的这一半拿走了几乎全部价值；而用同一家小模型当 judge，它跟被测对象有同一套盲区
// （v3 那个"合规但没用"的答案，judge 大概率判 pass），还要多付非确定性抖动的代价。
// 需要人判断的语义细节，留给 `docs/起步教练prompt-v0.md` §6 的真机手测清单。
//
// 这一层是纯字符串函数，不碰网络、不碰 chrome API——所以 rules.test.ts 能进 `npm test`
// （离线、确定性）。真正打 Groq 的是 run-starter-coach.ts，那个永远不进 npm test。
import { hasFabricatedSpecific } from '../src/platform/background/starter-coach';

export interface Violation {
  /** 规则代号，用于按失败模式归类统计 */
  code: string;
  /** 给人看的一句话解释，直接印在跑分结果里 */
  detail: string;
}

const MAX_WORDS = 12;

/** 停用词：算"任务词重合度"时要排掉，不然 the/of/for 会把重合度虚高 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or', 'my', 'your',
  'i', 'me', 'is', 'it', 'this', 'that', 'with', 'about', 'new', 'wanna', 'want',
]);

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function contentWords(s: string): string[] {
  return words(s).filter((w) => !STOP_WORDS.has(w));
}

// ── 逐条规则。每条都返回 Violation | null，方便 checkFirstAction 汇总。 ──

/** 12 词上限：气泡只有 220px 宽，超了撑坏布局（v1 起就有这条约束）。 */
function checkLength(action: string): Violation | null {
  const n = words(action).length;
  return n > MAX_WORDS
    ? { code: 'TOO_LONG', detail: `${n} 词，超过上限 ${MAX_WORDS}` }
    : null;
}

/** 一串步骤：起步教练的意义就是"只给一步"，给了序列用户看完更不想动。 */
function checkSequence(action: string): Violation | null {
  if (/\b(then|after that|next,|first[, ].*\bthen\b)\b/i.test(action)) {
    return { code: 'SEQUENCE', detail: '出现 then/after that，是多步而不是一步' };
  }
  // "A, B, and C" 这种三段并列也是变相的序列
  if ((action.match(/,/g) ?? []).length >= 2) {
    return { code: 'SEQUENCE', detail: '两个以上逗号分段，读起来是一串步骤' };
  }
  return null;
}

/** 复述目标：用户刚说了要做什么，把它换个动词重说一遍等于没说。 */
function checkRestatesGoal(action: string): Violation | null {
  return /^\s*"?(start|begin|work on|continue|get started)\b/i.test(action)
    ? { code: 'RESTATES_GOAL', detail: '以 start/begin/work on 开头，是复述目标不是动作' }
    : null;
}

/** 计划伪装成开始——最常见的拖延陷阱，听起来很负责实际一个字没写。 */
function checkPlanning(action: string): Violation | null {
  return /\b(outline|plan|brainstorm|think about|make a list|organi[sz]e your thoughts|map out|figure out what)\b/i.test(action)
    ? { code: 'PLANNING', detail: '属于"先规划一下"，是拖延伪装成准备' }
    : null;
}

/**
 * 搜索伪装成的计划（09-01 第一次跑分发现）：`debug the login flow in our app`
 * → `"search for login flow debugging steps"`。**搜"怎么做"不是做**，跟 `Plan your approach`
 * 是同一种病，只是换了件搜索的外衣，checkPlanning 的关键词表抓不到。
 * ★ 刻意不收 "guide"：`study for the test` → "search for the test study guide" 里，
 *   study guide 是**材料本身**而不是"关于怎么做的建议"，收进来会误杀。
 */
function checkSearchAsPlanning(action: string): Violation | null {
  return /\b(search|look up|google)\b[^.]*\b(steps?|how to|tips?|best practices|tutorials?|advice)\b/i.test(action)
    ? { code: 'SEARCH_AS_PLANNING', detail: '搜的是"怎么做"而不是材料本身——搜索外衣下的计划' }
    : null;
}

/** 前置条件不是动作，而且说出来有点侮辱人。 */
function checkPrerequisite(action: string): Violation | null {
  return /\b(open|turn on|boot|unlock)\s+(your\s+)?(laptop|computer|browser|chrome|machine|phone)\b/i.test(action)
    ? { code: 'PREREQUISITE', detail: '"打开电脑"是前提不是动作' }
    : null;
}

/** 加油打气式空话：什么信息都没有，而且跟"像朋友不像监工"的语气要求冲突。 */
function checkCheerleading(action: string): Violation | null {
  if (/!/.test(action)) return { code: 'CHEERLEADING', detail: '出现感叹号（prompt 明令禁止）' };
  return /\b(you can do this|you've got this|you got this|believe in yourself|don't worry)\b/i.test(action)
    ? { code: 'CHEERLEADING', detail: '加油打气式空话，没有任何信息' }
    : null;
}

/** v1 的病：编造任务里根本没给过的编号。复用生产代码里那道守卫，两边判据永远一致。 */
function checkFabrication(action: string, task: string): Violation | null {
  return hasFabricatedSpecific(action, task)
    ? { code: 'FABRICATED_NUMBER', detail: '出现任务里没给过的编号（chapter/page/lecture…）' }
    : null;
}

/**
 * v2 的病：假设用户已经拥有某样东西。
 * "your notes"/"your textbook" 对一门还没开始的新课按定义不存在——不具体 ≠ 安全。
 * 任务里自己提过就不算假设（说了"复习我的笔记"，那笔记当然存在）。
 */
const POSSESSION_PATTERN =
  /\byour\s+(notes?|textbooks?|books?|slides?|outlines?|drafts?|materials?|syllabus|handouts?|readings?|deck)\b/gi;

function checkPossession(action: string, task: string): Violation | null {
  const taskWords = new Set(words(task));
  const hits = (action.match(POSSESSION_PATTERN) ?? []).filter((m) => {
    // "your notes" → 看 notes/note 在不在任务里
    const noun = words(m)[1];
    return !taskWords.has(noun) && !taskWords.has(noun.replace(/s$/, ''));
  });
  return hits.length > 0
    ? { code: 'ASSUMES_POSSESSION', detail: `假设用户已经有「${hits.join('、')}」，任务里没提过` }
    : null;
}

/**
 * v3 的病：合规但零信息量。做完之后拥有/知道的东西跟十秒前一模一样。
 * 两条判据：
 *   ① 直接点名"打标题/写任务名"这类句式；
 *   ② 打进去的内容就是任务本身（"type down data structure and algorithm"）——
 *      用任务实词重合度判，写一句真正的开头（"write one rough sentence"）不会命中。
 */
function checkZeroInformation(action: string, task: string): Violation | null {
  // "type just the title" —— 动词和宾语之间常有 just/only/simply 这类副词，不吃掉会漏判
  if (/\b(?:typ(?:e|ing)|writ(?:e|ing)|jot|put)\s+(?:just\s+|only\s+|simply\s+|merely\s+)?(?:down\s+|out\s+)?(?:the\s+|your\s+|a\s+)?(?:title|task name|course name|topic name|subject)\b/i.test(action)) {
    return { code: 'ZERO_INFO', detail: '"打个标题/写下任务名"——做完等于没做' };
  }
  const typed = action.match(/\b(?:typ(?:e|ing)|writ(?:e|ing)|jot|put)\s+(?:down\s+|out\s+)?(.+)$/i)?.[1];
  if (typed) {
    const typedWords = contentWords(typed);
    if (typedWords.length > 0) {
      const taskSet = new Set(contentWords(task));
      const overlap = typedWords.filter((w) => taskSet.has(w)).length / typedWords.length;
      if (overlap >= 0.6) {
        return { code: 'ZERO_INFO', detail: `要打的字有 ${Math.round(overlap * 100)}% 就是任务本身，信息量为零` };
      }
    }
  }
  return null;
}

/** 英文项目：用户用中文声明任务时模型很容易跟着回中文。 */
function checkEnglish(action: string): Violation | null {
  return /[一-鿿぀-ヿ가-힯]/.test(action)
    ? { code: 'NOT_ENGLISH', detail: '输出里有 CJK 字符，必须全英文' }
    : null;
}

/**
 * v5 的防讨好检查（09-01）：给了一个**跟任务无关**的当前页面时，产出里不许出现它。
 *
 * 模型有强烈的"把给它的东西用上"倾向。"study neural networks" + 用户正开着 Gmail，
 * 很容易得到 "Search your inbox for the course email."——**那是编造换了个真实的锚**，
 * 比原来凭空编章节号更难识破，因为对象确实存在。
 *
 * 判据：拿页面标题的实词 + 域名主体，排掉任务里本来就有的词，剩下的一个都不许出现在动作里。
 * 只在用例显式标了 anchorShouldBeIgnored 时才跑——"这个页面到底相不相关"是语义判断，
 * 规则层做不了，只能由写用例的人标注。
 */
export function checkBorrowedIrrelevantPage(
  action: string,
  task: string,
  anchor: { title: string; url: string }
): Violation | null {
  const taskWords = new Set(words(task));
  const domainCore = (anchor.url.match(/https?:\/\/(?:www\.)?([^./]+)/i)?.[1] ?? '').toLowerCase();
  const candidates = [...contentWords(anchor.title), domainCore]
    .filter((w) => w.length >= 3 && !taskWords.has(w));
  const actionWords = new Set(words(action));
  const hits = [...new Set(candidates)].filter((w) => actionWords.has(w));
  return hits.length > 0
    ? { code: 'BORROWED_IRRELEVANT_PAGE', detail: `把无关页面硬凑进来了（出现「${hits.join('、')}」）` }
    : null;
}

/**
 * v5 的另一半（09-01 第一次 v5 跑分发现）：给了一个**跟任务相关**的页面，产出却还是"去搜索"。
 *
 * 真机原句：任务 `finish chapter 3 of the react docs`、页面开着 react.dev 的对应章节，
 * 产出仍然是 `"Open a new tab and search for React docs chapter 3"`——**材料就在眼前，
 * 却被支去重新找一遍**。这是"白给的信息没用上"，跟把无关页面硬凑进来正好是一对。
 *
 * 判据故意简单：形态是 SEARCH 就算失败。相关页面已经在眼前时，再去搜索几乎不可能是最优第一步；
 * 真出现"页面相关但仍该搜"的反例，再放宽不迟——**现在宁可严一点，免得又靠肉眼发现问题**。
 */
export function checkIgnoredRelevantPage(action: string): Violation | null {
  return classifyShape(action) === 'SEARCH'
    ? { code: 'IGNORED_OPEN_PAGE', detail: '相关材料就开在眼前，却让用户去重新搜一遍' }
    : null;
}

/**
 * 把一条产出按全部规则过一遍。空数组 = 通过。
 *
 * @param firstAction LLM 这次给出的第一步
 * @param taskDeclaration 用户的任务声明——多条规则要拿它做"这是不是用户自己给的"判断
 * @param ignoredAnchor   仅当用例标注了"这个页面跟任务无关、应当被忽略"时才传，见 checkBorrowedIrrelevantPage
 * @param relevantAnchor  仅当用例标注了"这个页面跟任务相关、必须用上"时才传，见 checkIgnoredRelevantPage
 */
export function checkFirstAction(
  firstAction: string,
  taskDeclaration: string,
  ignoredAnchor?: { title: string; url: string },
  relevantAnchor?: boolean
): Violation[] {
  const checks = [
    checkLength(firstAction),
    checkSequence(firstAction),
    checkRestatesGoal(firstAction),
    checkPlanning(firstAction),
    checkSearchAsPlanning(firstAction),
    checkPrerequisite(firstAction),
    checkCheerleading(firstAction),
    checkFabrication(firstAction, taskDeclaration),
    checkPossession(firstAction, taskDeclaration),
    checkZeroInformation(firstAction, taskDeclaration),
    checkEnglish(firstAction),
    ignoredAnchor ? checkBorrowedIrrelevantPage(firstAction, taskDeclaration, ignoredAnchor) : null,
    relevantAnchor ? checkIgnoredRelevantPage(firstAction) : null,
  ];
  return checks.filter((v): v is Violation => v !== null);
}

// ── 形态分布：不是"对不对"，是"会不会只会一招"（09-01 第一次跑分肉眼发现的问题）──
// 第一次真机跑分，4 条能跑通的用例产出了 4 条搜索——包括 `finish chapter 3 of the react docs`
// 也被建议"去搜索 react docs chapter 3"，而人明明就在读那个文档。
// 每一条单独看都合规、都能过全部规则，**但它们是同一个动作**。
// 逐条断言看不见这种问题，必须在**整批**上统计才看得出来，所以单列一个指标。
export type ActionShape = 'SEARCH' | 'PLAY' | 'WRITE' | 'READ' | 'OPEN_EXISTING' | 'OTHER';

/**
 * 按"用户最终真正做的那件事"归类，而不是按第一个动词。
 * "Open a blank doc and write one sentence" 的价值在 write 不在 open，所以判 WRITE；
 * "Open a new tab and search for X" 判 SEARCH。
 */
export function classifyShape(action: string): ActionShape {
  if (/\b(search|look(ing)? up|google)\b/i.test(action)) return 'SEARCH';
  if (/\b(press play|hit play|play|watch|resume)\b/i.test(action)) return 'PLAY';
  if (/\b(writ(e|ing)|typ(e|ing)|jot|draft|sketch)\b/i.test(action)) return 'WRITE';
  if (/\b(read|skim|scroll|re-?read)\b/i.test(action)) return 'READ';
  if (/\bopen\b/i.test(action)) return 'OPEN_EXISTING';
  return 'OTHER';
}

/** 所有规则代号，跑分脚本用它输出"哪类失败最多"的归类统计。 */
export const ALL_RULE_CODES = [
  'TOO_LONG',
  'SEQUENCE',
  'RESTATES_GOAL',
  'PLANNING',
  'SEARCH_AS_PLANNING',
  'PREREQUISITE',
  'CHEERLEADING',
  'FABRICATED_NUMBER',
  'ASSUMES_POSSESSION',
  'ZERO_INFO',
  'NOT_ENGLISH',
  'BORROWED_IRRELEVANT_PAGE',
  'IGNORED_OPEN_PAGE',
] as const;
