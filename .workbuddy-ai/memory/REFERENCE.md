# voxel-craft 参考细则（REFERENCE）

> `MEMORY.md` 的展开版：模块级细节与可从 spec / 日志查证的流程。MEMORY.md 只留「不能再犯」的硬结论。

## 无头测试细则（.scratch/<topic>/probe.mjs）
- **改完代码跑测试前重启 dev server**：HMR `?t=` 会让 `import('/src/game/xxx.js')` 拿到另一实例；探针从 `performance.getEntriesByType('resource')` 捞真实 URL 再 import。dev 下 `import('/engine.js')` 是 noop，判断按钮可点只能看 `.veil` 有无 `hide`。
- 等地形就绪要连续 3 次采样一致；生物测试开 `player.fly` 悬停 + 定时钉怪，测遮挡盖整片天花板；手动调 mobPhysics/mobAI 要递增 `m.animT`。**历史 mob 探针默认 CREATIVE**，新探针要显式 `setModeState(MODE.SURVIVAL)`。
- textures.js 顶层 `document.createElement` 在 node 直跑会炸，probe 别 import，用迷你 BLOCKS 表复刻。`const {dim}=await import('./state.js')` 是值快照，要 `const S=await import(...)` 再读 `S.dim`。
- `position:fixed` 的 `offsetParent` 恒 null，判可见性读 `getComputedStyle(el).display`；`page.evaluate` 回调在浏览器跑，访问不到 node 变量，必须 `return {...}`。
- 截图逐像素比对不能单独当「世界没变」（树叶取 `uTime`、手部取 `worldTime`），要拍变坏的对照组 C 用 `diff(A,B)≪diff(A,C)`。`scroll-behavior:smooth` 会截到半路，断言前设 `scrollBehavior='auto'`。
- **线上探针不能 import 页面模块**：只能纯 DOM 真实点击；触屏 context 点 `.tb.sys`「背包」绕开指针锁/KeyE；`v-show` 竞态用 `waitForSelector(...,{state:'visible'})` 别用固定 sleep。参考 `.scratch/spell-craft/online-probe.mjs`。
- **线上找产物标记不能只扫初始 resource**：逻辑在异步 `index-*.js` chunk，从 `main-*.js` 正则解析 chunk 名再 `fetch('/assets/<name>')`；就绪等 `/地形就绪（/`，进游戏等 `.veil.hide`。参考 `.scratch/mine-density/online-probe.mjs`。
- Playwright ESM 不吃 NODE_PATH，要 `createRequire(PW_ROOT+'/x.js')`；浏览器版本不符用 `CHROME_PATH` 指系统 Chrome。**两个 WebGL 页面并行 + swiftshader 会让第二页完全不渲染**（selector 超时且零控制台报错）：浏览器探针串行开 context、纯 API 走 Node `fetch`。

## 贴图细则（textures.js）
- 程序化贴图 = noiseTile + 覆盖层；`^item_egg_\w+$` 自动走 `eggIconTile`；boss 登记 MOB_TILE_COLORS。贴图集 16×16=256 格，用量 242。
- 16×16 图标用 `PQ()`（`P()` 是 32×32 单像素）；`PQ` 无 alpha，函数内定 `Q(x,y,c,a)`。`P()` 必须钳制 RGB 到 0..255（`shade(c,-76)` 负数让 `rgb()` 无效、canvas 沿用上次 fillStyle）；亮基色 ±26 噪声、深基色固定，玻璃瓶最外列先 `shade(c,-34)` 再叠灰 alpha 0.42。

## 生物细则（mobs.js）
- **1 格宽沟 squeeze**：贴地探测「AABB 覆盖任一格实心即站住」；蜘蛛/大史莱姆挂 `squeeze:true` → 水平+贴地用 `Math.min(D.w/2,0.4)`，竖直扫掠用 `CENTER_HW=0.02`；`w` 仍是渲染/命中盒宽度；小史莱姆 w=0.55 不挂。三件配套：① 贴地吸附加 `m.y>=footY+1-GROUND_SNAP_TOL(0.06)` 禁止上拽且加 `D.squeeze` 守卫；② `inShaft`（身体层两侧实心）禁沟内爬墙，判据别加「两侧上方是空气」；③ 贴地探测不能收成中心列。1 格走廊 `inShaft` 误禁爬墙属已知取舍。
- bot 回血多路，`damageBot` 置 `regenBlockT=6`，所有回血分支判 `<=0`。
- 远程攻击复用 `shootArrowAt(foe:true)`。

## 存档细则（save.js / D1）
- 开始面板云端区：UUID 显示为「存档码」可复制；状态 checking/empty/ok/offline 随 `ui.saveRev` 刷新；「☁️ 从云端继续」只在本地无档时显示。导出/导入存档 UI 已移除（2026-11-16）；`exportSaveJson()`/`importSaveJson()` 保留作纯编解码供 `.scratch/saveio|savehole` 探针回归，别再接 UI。
- 别名体系（2026-11-16）：`0002_aliases.sql` 的 `aliases(alias 归一化主键, owner UNIQUE, display)` + `functions/api/alias.js`；校验共用 `aliasName.js`（`normalizeAlias` 2–20 字、`isOwnerCode` 必须先判，否则 10 字符纯字母别名会被当 owner 写进 `x-owner`）。`save.js` 的 `getAlias/setAlias/lookupAlias/resolveOwner`，`ALIAS_KEY` 只做离线展示缓存。别名全局唯一、大小写不敏感、**不参与存档主键**。首次引导 = `showGuide` + `voxel-craft:alias-guide`。见 `.scratch/alias/spec.md`。
- 词条：`ench={[物品id]:{词条:等级}}` 按装备种类共享；八条词条接真机制，`inscribe()` 不扣材料（账在 uiActions），`enchantRestore` 逐条校验、`applySave` 无条件调用，效率倍率乘算。
- 药水：12 种接真机制；同种不叠层；`potionRestore` 逐条校验、`applySave` 无条件调用。`PotionHud.vue` 右上圆环，`.touch` 下移 56px。

## 宣传页 / 素材 / 部署
- `intro.html` 必须在 `vite.config.js` 的 `rollupOptions.input`；素材路径 `/media/...`，成品只进 `public/media/`；`.scratch/**/*.{png,webm,mp4,webp,log}` 已 gitignore。`.scratch/promo/` 脚本：录屏窗口外框比内容大 34×104，WebM 裁/抽帧前先 `-r 25` 转 CFR，片头静止靠 TRIM。
- `#media` 8 卡 + `#lb`：整卡是透明 `<button>`、下载是独立 `<a>`，**不能把 `<a>` 嵌进 `<button>`**；视频按需创建。`shot-mobile.webp` 780×1688，16:9 框用 `object-position:50% 95%`。
- 线上 Pages `https://voxel-craft-516.pages.dev/`，项目 `voxel-craft`，production branch `main`；部署 `npm run build && npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`（不带版本会 notarget；OAuth 只有 2 分钟）；迁移 `npx wrangler@3 d1 migrations apply voxel-craft-saves --remote`。`public/_headers` 给 `/assets/*` 配 immutable。
- 线上特性：`/intro.html` 308 → `/intro`；HEAD 拿不到 `Content-Length`（回退带 `Range` 请求后立刻 `body.cancel()`）；仍是旧 1209 字节 index.html 说明没部署上去。
- `npx vite preview ... &` 会被回收，用受管后台任务；后台交互式命令别接管道，用 `> file.log 2>&1`。部署前查 `git status` 看并行改动：有别人在写就 `git worktree add` 到仓库外检出当前提交、junction `node_modules` 再 build；删 junction 只能用 .NET `Directory.Delete(path,false)`，`rm -rf` 会删进真实依赖。
- 验收 `.scratch/cf/verify.mjs`/`.scratch/promo-gallery/probe.mjs`：标题/WebGL/零控制台报错。
- **GitHub 推送**：代理可能拒 `CONNECT github.com:443`（502），`git fetch/push` 与 SSH 不通但 `api.github.com` 通；用 `$https_proxy` 别硬编码端口。此时 `GH_TOKEN="$(gh auth token)" node .scratch/gh-sync/push-via-api.mjs` 走 Git Database API 重建提交再 PATCH main ref，SHA 可保持一致；见 `.scratch/gh-sync/spec.md`。
