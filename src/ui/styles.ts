// Anchor · 给 Shadow DOM 用的样式字符串（B16，09-02）。
//
// 为什么不能让组件自己 `import './x.css'`：那种写法会被 vite 编译成"往宿主文档的 head 里
// 插一个 <style>"。在 side panel 里这正是我们要的；但在内容脚本里它有两个问题——
//   ① **污染别人的网页**：我们的 <style> 被塞进用户正在看的那个网站的 head；
//   ② **照不进 shadow root**：外部样式表本来就不穿透 Shadow DOM 边界，widget 会裸奔。
// 所以统一改成"宿主决定样式怎么进来"：side panel 那边显式 import 三个 .css 文件（副作用），
// 这边用 `?inline` 把同样三份拿成字符串，塞进 shadow root 里的 <style>。
//
// ★ 两条路引的是**同一批源文件**，改样式只有一处要动，不会出现"面板好了悬浮层没跟上"。
import catCss from '../pet/cat.css?inline';
import onboardingCss from '../sidepanel/onboarding.css?inline';
import summaryCss from '../sidepanel/summary.css?inline';

/** 三份样式拼在一起，供 Shadow DOM 宿主注入。 */
export const ANCHOR_CSS = [catCss, onboardingCss, summaryCss].join('\n');
