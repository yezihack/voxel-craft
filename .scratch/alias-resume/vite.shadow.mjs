/* 影子 vite 配置 —— 只给探针起 dev server 用。
 *
 * 为什么需要它：仓库里的 vite.config.js 目前是**语法错误**状态
 *   const root = dirname(fileURLToPath(import.meta.url))
 *   /* 注释 *\/
 *     .replace(...)          ← 这里断链了，ASI 也救不了
 * 那是并行会话正在改的文件（Windows 盘符大小写修复），本功能线不碰它，
 * 所以复制一份干净的配置放在这里跑探针。等并行会话修好后本文件可删。
 *
 * 放在 .scratch/ 下是有意的：node 解析 @vitejs/plugin-vue 时会从本文件所在
 * 目录逐级向上找 node_modules，最终命中仓库根的 node_modules。 */
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

/* 仓库根 = 本文件所在目录的上一级 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default defineConfig({
  root,
  plugins: [vue()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        intro: resolve(root, 'intro.html'),
      },
    },
  },
})
