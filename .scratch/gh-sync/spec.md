# 工单：GitHub 同步与 Cloudflare 发布（2026-11-06）

## 任务
把本地领先 `origin/main` 的 14 个提交推到 GitHub，并把当前**已提交**代码发布到 Cloudflare Pages 生产分支。工作区另有并行会话在写箱子系统（17 个未提交文件），不纳入本次发布。

## 根因：git push 通道不可用
- 本机代理（`https_proxy`）对 `CONNECT github.com:443` 返回 502 / 超时；`git fetch` 报 `schannel: failed to receive handshake`，绕过代理直连则 `Could not connect to server`。
- 同一代理下 `api.github.com` 200、`codeload.github.com` 301、`raw.githubusercontent.com` 301；`ssh.github.com` / `gist.github.com` 不通。`netsh winhttp show proxy` 为直连；扫描全部 loopback 监听端口，无一可作为到 `github.com` 的 HTTP 代理。
- 结论：git 智能 HTTP（端点只在 `github.com`）与 SSH 都不可用，唯一出口是 REST API。代理端口会在会话中变化（62149 → 56249），命令里必须用 `$https_proxy`，不能硬编码。

## 做法
1. **干净构建**：`git worktree add --detach` 到仓库外的 `voxel-craft-deploy-d6ee82c`，用 Node `fs.symlinkSync(..., 'junction')` 链接主仓库 `node_modules`，执行 `npm run build`。避免把并行会话的半成品编进产物。
2. **部署**：`CI=1 npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`。
3. **GitHub 同步**：`.scratch/gh-sync/push-via-api.mjs` 经 `api.github.com` 的 Git Database API 增量重建提交：
   - 起点取远端 `GET /git/ref/heads/main` 的真实 SHA，只处理 `remote..HEAD`，并校验它是本地 HEAD 的祖先；
   - 每个提交用 `git diff-tree` 取变更、`git cat-file blob` 取内容；文本内联到 `POST /git/trees` 的 `content`，二进制（webp/mp4/webm）走 `POST /git/blobs` 的 base64；
   - `base_tree` 复用上一步 tree，避免重传整棵树；
   - author / committer / message 从 `git cat-file commit` 原始对象提取，日期按 `unix + 时区` 还原成带 offset 的 ISO8601，保证重建对象字节一致；
   - 只有最后 `PATCH /git/refs/heads/main` 改变远端分支；中途失败只留下悬空对象，重跑安全。

## 验证
| 项 | 结果 |
|---|---|
| GitHub 重建 | 14/14 提交 SHA 与本地一致（`=`），远端 ref `d6ee82cf16526bca46b243b80c4697b6824e56c2` |
| GitHub 内容抽样 | `compare/95e9ee2...d6ee82c` = `ahead_by 14`；`src/game/input.js` 含 `wrapAngle`；`public/media/demo.mp4` 4,843,026 B 完整 |
| 构建 | 108 modules；`index-DlEqUwJv.js` 246.20 kB / gzip 93.84 kB |
| CF 部署 | `https://2b6bc1a0.voxel-craft-516.pages.dev`（production `main`） |
| 线上 HTTP | `/` 200、`/intro` 200、`assets/index-*.js` 200 |
| 浏览器验收 | HTTP 200、标题「方块世界」、WebGL ok、游玩画布 1280×800、零控制台报错 |

## 踩坑
- Playwright 缓存是 `chromium_headless_shell-1169`，验收脚本期望 1148 → 用 `CHROME_PATH` 指向系统 Chrome。
- `Buffer.isUtf8` 不是 `Buffer` 的静态方法；判定文本改用 `TextDecoder('utf-8', { fatal: true })` 加 NUL 检查。
- 清理 worktree 里的 `node_modules` junction 只能用 .NET `Directory.Delete(path, false)`；`rm -rf` 会穿透到主仓库的真实依赖。
