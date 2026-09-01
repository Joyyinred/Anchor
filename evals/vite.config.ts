// Anchor · 只给 `npm run eval:coach` 用的最小 vite 配置。
//
// 为什么需要单独一份：根目录的 vite.config.ts 挂着 `crx()`（@crxjs 扩展打包插件），
// 它假定自己跑在真正的 build/dev server 里，被 vite-node 加载时会直接抛
// `Cannot read properties of null (reading 'ignored')`。评测脚本只需要"能跑 TS"，
// 不需要任何扩展打包能力——给它一份空配置比去动根配置安全得多。
export default {};
