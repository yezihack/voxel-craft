import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

/* 用配置文件自身的位置定位仓库根，而不是 process.cwd() ——
 * 后者在「从子目录调用 vite」时会指错地方，input 里就找不到 html 了。 */
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    /* 多页入口：index.html 是游戏本体，intro.html 是宣传页。
     * 不写进 input 的话 intro.html 根本不会进 dist —— 线上访问 /intro.html
     * 只会落到 404 / SPA 兜底，宣传页等于不存在。 */
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        intro: resolve(root, 'intro.html'),
      },
    },
  },
})
