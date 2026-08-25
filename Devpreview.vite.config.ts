// 临时的本地预览配置，只用来看 B4 桌宠组件长什么样，不影响扩展本身的构建。
// 用法：npx vite --config devpreview.vite.config.ts   然后打开终端里打印的 http://localhost:xxxx
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'devpreview',
  plugins: [react()],
});