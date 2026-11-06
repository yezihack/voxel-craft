# voxel-craft 长期记忆

## 架构 / 依赖（改动前必读）
- 既有循环：`actions → mobs → input → uiActions → actions`。**任何模块顶层调 `setXxxHook()` 都会撞 TDZ**；一律导出 `installXxxHook()`，由 `boot.js` 的 `boot()` 调用。
- bots.js 已 import mobs.js，反向 import 必成环：mobs 只留 `export const botHook = { list, damage }`，由 bots 的幂等 `installBotHook()` 注入；别在 bots 顶层调 `registerBots`。
- `armor.js` / `enchant.js` / `potions.js` **只准依赖 config.js**。反向边走注入（`setEnchantReader` / `setPotionHasteReader`），且都在文件末尾调用 —— 代价：模块必须被求值一次，否则词条/急迫**静默失效**。
- `requestPointerLock()` 返回 Promise，无手势时 reject 会触发 `unhandledrejection` → 满屏英文报错。所有加锁点走 `uiActions.requestLockSafe()`（内部 catch）。
- `engine.js` 为模板动作铺 noop 占位：引擎异步拉起，开始面板第一帧就可点。
- `REACH = 13`（挖/放/上车/召唤/点燃）与 `REACH_ATTACK = 9`（打怪/打 bot/旁观射线）必须分开。
- `bot` 回血有多路（eat/home/定时），`damageBot` 置 `b.regenBlockT = 6`，所有回血分支都要判 `<= 0`。

## 渲染 / 几何
- `isOpaque(id)`（generate.js）：带 `shape`（cross/plate）的方块一律不算不透明；mesher `buildChunk` 用 6 面邻居做剔除，薄片误判会让相邻实心块被剔面 → 透视穿帮。
- 超平坦世界会生成结构（村庄/遗迹/矿井），不生成树/花/水；`generate.js` flatWorld 分支里 `structBlockAt` 必须最前且覆盖所有 y（矿井在地下），之后才分层。

## 生物（mobs.js）
- MOB_TYPES 用 flag 分派 AI：`boss` 分支必须放在 `if (D.hostile)` 之前；`fly:true` 在 mobPhysics 岩浆灼烧后、`wasGround` 前短路跳过重力，只做三轴 AABB；`!boss` 才参与距离回收。
- 远程攻击复用骷髅 `shootArrowAt(foe:true)`。凋灵爆破只借 `explodeMob` 的球形破坏循环，**不能直接调**（会置 `dead` 自杀），伤害单独算。
- 白天烧：`SUNBURN_TYPES` + `underOpenSky`（头顶扫到 H=64）+ 每 0.4s 重算 `m.skyT`，挂 mobPhysics 之后、dead 检查之前。渲染三态 tint 里燃烧判 `hurtFlash > 0.2`（底噪 0.12），否则绿通道被压到 0 变血块。

## 贴图（textures.js）
- 程序化贴图 = noiseTile 基础 + 覆盖层；`^item_egg_\w+$` 自动走 `eggIconTile`；boss 需登记 MOB_TILE_COLORS。
- **16×16 逻辑格图标用 `PQ()` 不能用 `P()`**（`P` 是 32×32 格里的单像素）；`PQ` 无 alpha，函数内定局部 `Q(x,y,c,a)`。
- `P()` 必须钳制 RGB 到 0..255：`shade(c,-76)` 出负数会让 `rgb()` 无效，canvas 保留上次 fillStyle，画出上一格颜色。
- 亮基色（雪 240 / 铁 198）要 ±26 大颗粒噪声；深基色（凋灵 28）用固定色。玻璃瓶最外列先铺 `shade(c,-34)` 再叠玻璃灰 alpha 0.42，否则整瓶洗白。
- 贴图集 16×16 = 256 格，当前用量 242。

## 存档 / 装备 / 附魔 / 药水
- 减伤入口只有 `survival.hurt(n, reason, opts)`：环境伤害（摔落/缺氧/岩浆/仙人掌/饥饿）必须传 `{pierce:true}`；护甲 × 盾牌相乘，最低留 1 点。背包扣减/退回放 uiActions.js。
- `save.js`：地形是纯函数**不入档**，只存「世界参数 + 8 维度 edits + 玩家状态」。读档顺序：种子/类型 → 清 colCache+structShapeCache → 重建 dimEdits → setDim → **重指 setEdits** → 时间 → 玩家 → 背包 → 盔甲 → 模式 → initChunks；之后清场（mobs/bots/掉落/carts/arrows），`dead` 清掉。
- **覆盖层里的 `0` 有意义**：`setBlock(x,y,z,0)` 写 `edits.set(k,0)`，`getEffective` 靠它区分「原本没东西」和「被挖空」。改档恢复时**永远不要**用 `id > 0` 过滤，只挡负数/NaN/非字符串键/越界（`isBlockId`）。loadGame 与导入两条路都成立。
- 配方字符 26 个大写已占满，新材料只用未占小写（d/t/u/a/j/c/g）。
- 词条记在「装备种类」上、同类共享（`ench = { [物品id]: {词条: 等级} }`），因为 inv 只有 `id → 数量` 没有单件身份 —— 别去改成单件。八条词条必须接真机制；`inscribe()` 不扣材料（账在 uiActions）；`enchantRestore` 逐条校验（存档能手改），`applySave` 无条件调用；效率倍率**乘算**（钻石镐 ×8 → 效率 III ×20）；开台走 `actions.tryOpenEnchant()`，放在 `doPlace()` 的 `heldId()` 之前（空手可开）。
- 12 种药水效果全部接真机制；**同种不叠层**（重复喝取 `max(剩余, dur)`）；`potionRestore` 逐条校验、`applySave` 无条件调用；饮用先 `applyPotion` 再 `invTake`；配方统一 `['a'+X]` 1×2（`a` = 空瓶）。`PotionHud.vue` 右上角圆环，`.touch` 时下移 56px。

## 输入 / 界面 / 触屏
- 游戏内**不放常驻文字 HUD**，状态只用图形（Vitals 气泡、准星、挖掘环、蓄力条），文字只走瞬时 Toast。
- 画布只负责转视角（touchmove → addLook），挖/放走 `uiActions.touchMine` / `touchPlace`；`pointerdown` 必须跳过 `pointerType === 'touch'`。
- **视角无边界（2026-11-04 起，推翻 .scratch/look 的旧约定）**：`addLook` 不再 clamp 俯仰，yaw/pitch 都用 `wrapAngle` 折回 [-π,π)（等价角折叠，防浮点漂移；非有限输入归零，别让 NaN 进存档）。`M4.view` 的 r/u/f 在任意 pitch 下都是单位正交基，旧「±90° 会让矩阵退化」判断不成立；越过 90° 画面上下颠倒是自由翻转的自然结果。`SENS = 0.0022` / `TOUCH_LOOK = 1.15` 不变。
- 单次 touchmove 的 `TOUCH_STEP_MAX = 90` 已删，按真实位移转头。**配套三道兜底不能省**：`touchstart` 里「identifier 被复用 → 刷新基准」（touchend 被吞 + 同 id 重新按下，没了封顶会一次甩飞几百像素）、「旧手指是否还活着」，以及 `endLook` 的「identifier 对不上但页面上没手指 → 无条件复位」。
- `touchPlace` 维护 `placeHeld` + `placeRepeat`，长按类功能优先接这两个 flag。触屏控件隐藏时必须复位所有按住状态，否则人会自己一直走。
- 摇杆 → 方向键换算在 `stick.js` 的 `applyStickInput`，靠 `stickInput.active` 接管期保证归零那帧也写 false；别在 loop 里再判 `stickVec`。
- 触屏渲染倍率上限 1.5（桌面 2.0，见 `loop.js resize()`）；无键盘，存档/读档/暂停/换模式都要按钮。
- 竖屏底部整条是拇指区（摇杆 + 2×2 动作区 `bottom:100px`），Vitals 走 `.vitals.touch` 挪左上 `top:52px`；≤400px 物品栏缩 32×40、≤350px 缩 28×36；`HotBar` 不设 max-width。
- 手机闪退三堵：触屏判定放宽到 `coarse || innerWidth <= 900`；`pointerlockerror` 在 `ui.touch` 下直接 return；`webglcontextlost` → 存档+reload，`visibilitychange` → 存档+暂停，`onerror`/`unhandledrejection` → FatalNotice。别删。

## 已知边界 bug
- 指针锁被拒时背包关不掉：`openBag()` 拿不到锁会 `pauseGame()` 置 `running=false`，而 KeyE 条件是 `k === 'KeyE' && running`。脚本绕过：调 `startGame(false)`。

## 无头测试（.scratch/<topic>/probe.mjs）
- **改完代码跑测试前必须重启 dev server**：HMR 的 `?t=` 会让 `import('/src/game/xxx.js')` 拿到另一个模块实例（状态改对了数值不变）；探针应从 `performance.getEntriesByType('resource')` 捞页面真实加载的 URL 再 import。
- `import('/engine.js')` 在 dev 下拿到的是 NOT_READY_KEYS 占位 noop；判断按钮能否点只能看 DOM（`.veil` 有没有 `hide`）。
- 等地形就绪要**连续 3 次采样一致**；生物测试要开 `player.fly` 悬停 + 定时把怪钉住，测遮挡要盖整片天花板；手动调 mobPhysics/mobAI 要递增 `m.animT`。
- textures.js 顶层 `document.createElement` 在 node 直跑会炸，probe 别 import 它，用迷你 BLOCKS 表纯逻辑复刻。
- `const { dim } = await import('./state.js')` 是值快照，切维度后仍是旧值；要 `const S = await import(...)` 再读 `S.dim`。
- `position: fixed` 的 `offsetParent` 恒为 null，判可见性改读 `getComputedStyle(el).display`。
- `page.evaluate` 回调在浏览器里跑，访问不到 node 变量，必须 `return {...}` 出来。
- 截图逐像素比对不能单独当「世界没变」：树叶取 `uTime`、手部取 `worldTime`，任意两帧都有差异；要拍一张**确实变坏**的对照组 C，用 `diff(A,B) ≪ diff(A,C)` 说话。
- `scroll-behavior:smooth` 会让无头截图截到半路；断言前把 `documentElement.style.scrollBehavior` 改 `auto` 再 `scrollTo`，核对 `nav.getBoundingClientRect().top === 0`。

## 验证流程 / 提交
1. `npx vite build` 必须过（108 modules、贴图 242/256、index js 约 246 kB / gzip 94）。
2. `.scratch/<topic>/probe.mjs` 断言全过。
3. 写 `.scratch/<topic>/spec.md`（根因 / 做法 / 验证）。
4. 追加 `.workbuddy-ai/memory/YYYY-MM-DD.md`；`git add` 自己改的文件后 commit（**中文祈使句**，概括根因+新增内容）。注意工作区常有并行会话的未提交代码，别顺手 `git add -A` 把别人的半成品带上。

## 宣传页 / 素材 / 部署
- `intro.html` 必须留在 `vite.config.js` 的 `rollupOptions.input`；素材路径一律 `/media/...`（public 约定）；成品只进 `public/media/`，`.scratch/**/*.{png,webm,mp4,webp,log}` 已 gitignore（wrangler 日志带账号邮箱）。
- 素材脚本在 `.scratch/promo/`：capture/record/postprocess/qr/verify-intro/qr-check。Playwright 录屏窗口外框比内容大恒定 34×104（要 1280×720 就请求 1314×824）；WebM 是变帧率，裁/抽帧前先 `-r 25` 转 CFR；片头静止靠 `postprocess.sh` 的 TRIM 裁；视频 `ERR_ABORTED` 是正常的（readyState 4 即够）。
- 素材库 `#media` 8 张卡片 + `#lb` 查看器共用一套：整卡是透明 `<button>`、下载是独立 `<a>`，**不能把 `<a>` 嵌进 `<button>`**；视频按需创建。体积现读 `Content-Length`，文本资源（SVG）gzip 后读不准，干脆不报。`shot-mobile.webp` 是 780×1688 竖屏，16:9 框用 `object-position:50% 95%`。
- 线上 Cloudflare Pages：`https://voxel-craft-516.pages.dev/`，项目 `voxel-craft`，production branch = `main`；部署 `npm run build && npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`（不带版本会 notarget；OAuth 授权页只有 2 分钟）。`public/_headers` 给 `/assets/*` 配 immutable。
- 线上特性：`/intro.html` 308 → `/intro`（Pretty URLs）；HEAD 拿不到 `Content-Length`（回退带 `Range` 请求后立刻 `body.cancel()`）。线上若是旧的 1209 字节 index.html 兜底，说明文件压根没部署上去。
- `npx vite preview ... &` 会被回收（CONNECTION_REFUSED），用受管后台任务。后台交互式命令别接管道，用 `> file.log 2>&1`。playwright 的 ESM 不吃 NODE_PATH，要 `createRequire(PW_ROOT + '/x.js')`。
- 部署前 `git status` 查并行会话改动：有别人的在写就用 `git worktree add` 到仓库外检出当前提交、junction 一份 `node_modules` 再 build；删 junction 只能用 .NET `Directory.Delete(path,false)`，`rm -rf` 会删进真实依赖。
- 验收脚本 `.scratch/cf/verify.mjs` / `.scratch/promo-gallery/probe.mjs`：标题 / WebGL / 零控制台报错。Playwright 缓存浏览器版本与脚本期望不符时，用 `CHROME_PATH` 指向系统 Chrome。
- **GitHub 推送**：本机代理可能拒 `CONNECT github.com:443`（502），`git fetch/push` 与 SSH 全不通，但 `api.github.com` 通；代理端口会变，命令里用 `$https_proxy` 别硬编码。此时用 `GH_TOKEN="$(gh auth token)" node .scratch/gh-sync/push-via-api.mjs` 走 Git Database API 增量重建提交，SHA 可保持一致，最后才 PATCH main ref；详见 `.scratch/gh-sync/spec.md`。
