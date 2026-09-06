import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

// 构建时间戳，编译期替换成字面量（见 src/vite-env.d.ts 的类型声明）。
//
// ★ 为什么需要这个：09-02 排查悬浮桌宠时，连着三轮真机测试跑的都是**旧代码**——
//   改完必须 `npm run build` → 重新加载扩展 → **硬刷新页面** 三步都做，漏掉最后一步的话
//   页面上跑的还是注入时那份内容脚本，看到的现象跟改动完全无关，白白绕了三圈。
//   把这个印在控制台第一行，"你看到的是哪一版"从此是一个可以直接核对的事实，不用靠回忆。
const BUILD_STAMP = new Date().toISOString().replace('T', ' ').slice(0, 19);

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  define: {
    __ANCHOR_BUILD__: JSON.stringify(BUILD_STAMP),
  },
});
