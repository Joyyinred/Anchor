// Anchor · 把悬浮桌宠挂到当前网页上（B16，09-02）。
//
// 这个文件是内容脚本里唯一碰宿主页面 DOM 的地方，做三件事：
//   ① 判断这个页面该不该挂（iframe / 非 http 页面一律不挂）
//   ② 建一个 Shadow DOM 容器，把样式和 React 树都关在里面
//   ③ 渲染 FloatingHost
//
// ★ 为什么必须 Shadow DOM 而不是普通 div：宿主页面是别人写的，它的 CSS 会毫无顾忌地
//   命中我们的元素——`button { ... }`、`* { box-sizing: content-box }`、
//   `div { font-family: 某个像素字体 }` 这类全局规则在真实网站上到处都是。
//   Shadow DOM 是唯一能保证"在任何网站上长得都一样"的手段；反过来它也保证我们的样式
//   不会漏出去改坏人家的页面。
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { FloatingHost } from './FloatingHost';
import { ANCHOR_CSS } from '../../ui/styles';
import floatingCss from './floating.css?inline';

const HOST_ID = 'anchor-floating-host';

/**
 * 这个页面该不该长出一只猫。
 *
 * ★ iframe 必须排除：内容脚本默认会注入进页面里的每一个同源 iframe（广告位、评论区、
 *   嵌入的播放器……），不挡的话一个页面上会冒出好几只猫。`window.top === window` 是
 *   最直接的判据。
 * ★ 非 http(s) 一律不挂：`about:blank`、`data:` 这类页面上挂了也没有意义，
 *   而且它们常常是别人临时造出来做别的事的容器。
 */
function shouldMount(): boolean {
  if (window.top !== window) return false;
  return location.protocol === 'http:' || location.protocol === 'https:';
}

let root: Root | null = null;

export function mountFloatingPet(): void {
  // ★ 诊断日志不是临时的，别删。这条链路上"提前返回"/"挂了但看不见"/"import 还没解决"
  //   三种情况在页面上表现完全一样（都是没有猫），没有日志只能靠猜——09-02 第一次真机
  //   就卡在这里。三个词能立刻分辨出是哪一种。
  if (!shouldMount()) {
    console.log(
      `[Anchor floating build ${__ANCHOR_BUILD__}] skipped —`,
      window.top !== window ? 'in iframe' : `protocol=${location.protocol}`
    );
    return;
  }
  // 扩展重新加载时旧的内容脚本可能还挂着一份——先清掉，否则页面上会有两只猫，
  // 而且旧那只的扩展上下文已经失效，点什么都没反应。
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;

  // ★ 09-06 真机 bug 的修法：**每一条都必须 !important**。
  //
  //   现场证据：`DIV#anchor-floating-host[display=none visibility=hidden] < HTML[...visible]`
  //   —— 我们自己的代码一处都没设过 display/visibility，是**宿主页面（或页面上另一个扩展，
  //   这个站点上还跑着"沉浸式翻译"）的某条 CSS 规则命中了我们的元素并把它关掉了**。
  //   到底是哪条规则不重要：内容脚本的 UI 活在别人的网页里，**不能假设自己不会被藏**。
  //
  //   `setProperty(..., 'important')` 写的是**行内 !important**，在层叠顺序里高于作者样式表的
  //   !important（同为作者来源时行内胜出），页面没有任何常规手段能盖掉它。
  //   原来那句 `host.style.all = 'initial'` 已经删掉：它写进去 ~350 条声明却全是普通优先级，
  //   一条都挡不住页面的规则，反而让 display 变成 inline，纯属噪音。隔离继承属性的活儿
  //   交给 shadow 里的 `:host { all: initial }` 去做，那是它该管的。
  //
  //   宿主本身不占布局、不吃事件：真正的卡片是 shadow 里那个 position:fixed 的 div。
  //   这里留了尺寸的话，会在页面左上角凭空多出一块能挡住点击的区域。
  const HOST_STYLE: Array<[string, string]> = [
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '0'],
    ['height', '0'],
    ['margin', '0'],
    ['padding', '0'],
    ['border', 'none'],
    ['z-index', '2147483647'],
    ['pointer-events', 'none'], // 宿主自己不吃事件，卡片在 shadow 里单独打开（见 floating.css）
  ];
  for (const [prop, value] of HOST_STYLE) host.style.setProperty(prop, value, 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // 顺序有讲究：外壳样式在前、组件样式在后——组件那边的 .anchor-pet 变量定义要能覆盖
  // 外壳里的 fallback 值（floating.css 里写的是 var(--ap-card, #fff) 这种带兜底的形式）。
  style.textContent = `${floatingCss}\n${ANCHOR_CSS}`;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  // ★ 挂到 documentElement 而不是 body：有些页面（尤其 SPA）会在路由切换时整块替换 body，
  //   挂在 body 里的话猫会跟着被删掉，而内容脚本不会重新执行——猫就此消失，
  //   直到用户手动刷新。挂在 <html> 上不受这种替换影响。
  document.documentElement.appendChild(host);

  root = createRoot(container);
  // render 同步抛错的话原来完全静默（createRoot 不会自己打日志），排查时看不到任何线索。
  try {
    root.render(createElement(FloatingHost));
  } catch (err) {
    console.error('[Anchor floating] root.render 抛错', err);
  }
  // ★ 构建时间戳印在这里：09-02 那次连着三轮真机测的都是旧代码（改完没硬刷新页面），
  //   现象跟改动完全对不上。有了这个数字，"你看到的是哪一版"是可以直接核对的事实。
  console.log(
    `[Anchor floating build ${__ANCHOR_BUILD__}] mounted; host in DOM =`,
    document.getElementById(HOST_ID) !== null
  );

  // ★ 挂载之后自报实际几何。`host in DOM = true` 只证明节点在，不证明**看得见**——
  //   09-02/09-06 两轮排查全卡在这条缝里：日志一切正常、DOM 也在，页面上就是没有东西。
  //
  //   ★ 必须轮询，不能只在一个 rAF 里看一眼：React 18 的 createRoot().render() 是**异步**的
  //   （走调度器，不保证在下一帧之前提交），第一次探针就是因为只看了一帧，把"还没提交"
  //   误报成了"渲染不出来"，白白把排查带偏到 React 侧。轮询到出现为止才分得清
  //   "晚一点会出现" 和 "永远不会出现"。
  const probeStart = performance.now();
  const PROBE_TIMEOUT_MS = 3000;
  const probe = (): void => {
    const card = shadow.querySelector('.anchor-floating');
    const elapsed = Math.round(performance.now() - probeStart);
    if (card) {
      const r = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      // ★ 祖先链：可继承属性（visibility 就是其中之一）会从宿主元素穿透 Shadow DOM 边界。
      //   09-06 真机测到 visibility:hidden + rect 全 0，而我们自己代码里一处都没设过——
      //   只能是从页面继承的。把每一层的 display/visibility 打出来，一眼看出是哪一层在藏我们，
      //   不用靠猜（尤其 `html { visibility: hidden }` 这种防闪烁写法很常见，而宿主挂在
      //   documentElement 上就正好是 body 的兄弟，页面把 body 设回 visible 也救不到我们）。
      const chain: string[] = [];
      for (let el: Element | null = host; el; el = el.parentElement) {
        const s2 = getComputedStyle(el);
        chain.push(`${el.tagName}${el.id ? '#' + el.id : ''}[display=${s2.display} visibility=${s2.visibility}]`);
      }
      const hostRect = host.getBoundingClientRect();
      console.log(
        `[Anchor floating] 祖先链: ${chain.join(' < ')} | host rect ${Math.round(hostRect.width)}x${Math.round(hostRect.height)}`
      );
      console.log(`[Anchor floating] geometry (渲染于 ${elapsed}ms)`, {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        position: cs.position,
        visibility: cs.visibility,
        display: cs.display,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        inset: `${cs.top} / ${cs.right} / ${cs.bottom} / ${cs.left}`,
      });
      return;
    }
    if (elapsed > PROBE_TIMEOUT_MS) {
      console.warn(
        `[Anchor floating] 等了 ${elapsed}ms 仍然没有 .anchor-floating —— React 真的没渲染出来。` +
          ` shadow 内容长度 = ${shadow.innerHTML.length}`
      );
      return;
    }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
}

/** 主要给热重载/调试用；正常路径下页面卸载时浏览器会自己收拾。 */
export function unmountFloatingPet(): void {
  root?.unmount();
  root = null;
  document.getElementById(HOST_ID)?.remove();
}
