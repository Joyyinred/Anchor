// Anchor · Side Panel 入口。
//
// ★ 09-02 起这里只剩"挂载 + 引样式"：应用主体搬去了 src/ui/AnchorApp.tsx，因为 B16 的
//   页面内悬浮层要渲染同一份 UI。两个宿主共用一个组件，不会出现两套逻辑各自演化。
// ★ side panel 没有被废弃：悬浮层是新主战场，但这个入口零维护成本，留着当保险——
//   悬浮层在某些页面注不进去（chrome:// / 商店 / PDF），面板永远打得开。
//
// 样式在这里显式引入（而不是各组件自己 import）：内容脚本那条路要把同一批 CSS 注进
// Shadow DOM，组件里的普通 import 会被 vite 塞进宿主页面的 head——既污染别人的页面，
// 又照不进 shadow root。所以统一由宿主决定样式怎么进来，见 src/ui/styles.ts。
import { createRoot } from 'react-dom/client';
import { AnchorApp } from '../ui/AnchorApp';
import '../pet/cat.css';
import './onboarding.css';
import './summary.css';

createRoot(document.getElementById('root')!).render(<AnchorApp />);
