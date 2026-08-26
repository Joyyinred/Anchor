// 临时的本地预览配置，只用来看 B4 桌宠组件长什么样，不影响扩展本身的构建。
// 用法：npx vite --config devpreview.vite.config.ts   然后打开终端里打印的 http://localhost:xxxx
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/devpreview',
  plugins: [react()],
  // 默认只绑定 IPv6 回环地址（::1），浏览器/curl 敲 127.0.0.1 会连不上、敲 localhost 却能通
  // （取决于 DNS 解析走 IPv4 还是 IPv6）——这才是之前"服务器显示 ready 但打不开"的真实原因，
  // 不是防火墙/安全软件。host:true 让它同时监听 IPv4 和 IPv6 回环，两种写法都能连上。
  server: { host: true },
});