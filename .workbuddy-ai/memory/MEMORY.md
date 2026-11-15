# voxel-craft 长期记忆

## 架构 / 依赖（改动前必读）
- 循环 `actions → mobs → input → uiActions → actions`；模块顶层调 `setXxxHook()` 会撞 TDZ，一律导出 `installXxxHook()` 由 `boot.js` 的 `boot()` 调。
- bots.js 已 import mobs.js，反向 import 必成环：mobs 只留 `export const botHook = { list, damage }`，由 bots 的幂等 `installBotHook()` 注入。
- `armor/enchant/potions.js` 只准依赖 config.js；反向靠 `setEnchantReader`/`setPotionHasteReader`（文件末尾调用，模块必须被求值一次，否则词条/急迫静默失效）。
- `requestPointerLock()` 返回 Promise，无手势 reject → 满屏英文报错；加锁一律走 `uiActions.requestLockSafe()`。
- `src/engine.js` 用 NOT_READY_KEYS 给模板动作铺 noop 占位（引擎异步拉起）；新增引擎导出要同步登记。
- `REACH=13`（挖/放/上车/召唤/点燃）≠ `REACH_ATTACK=9`（打怪/打 bot/旁观射线）。
- bot 回血有多路（eat/home/定时），`damageBot` 置 `b.regenBlockT=6`，所有回血分支判 `<=0`。

## 渲染 / 几何
- `isOpaque(id)`：带 `shape`（cross/plate）的方块一律不算不透明；mesher `buildChunk` 用 6 面邻居剔除，薄片误判会让相邻实心块被剔面 → 透视穿帮。
- 超平坦生成结构（村庄/遗迹/矿井）不生树/花/水；`generate.js` flatWorld 分支里 `structBlockAt` 必须最前且覆盖所有 y，之后才分层。
- 结构格 `CELL=96`，`structAt(gx,gz)` 一格一结构（`structAnchor`/`structShapeCache` 按 gx,gz 单值缓存）。矿井密度只调 `dims.js` 的 `STRUCT_FILL`/`MINE_EXTRA`/`MINE_PLAIN_TAIL`；份额必须走独立 hash `hash2(gx,gz,SEED+9013)` 且在群系分支之前，复用 `pick` 会等量吃掉村庄/遗迹。`worldCensus()` 样方 `SAMPLE_N=96` 只覆盖 4 格，面板显示「0 条废弃矿井」是正常采样。

## 生物（mobs.js）
- MOB_TYPES 用 flag 分派 AI：`boss` 分支放在 `if (D.hostile)` 之前；`fly:true` 在 mobPhysics 岩浆灼烧后、`wasGround` 前短路跳重力，只做三轴 AABB；`!boss` 才参与距离回收。
- 远程攻击复用骷髅 `shootArrowAt(foe:true)`；凋灵爆破只借 `explodeMob` 的球形破坏循环（不能直接调，会置 `dead` 自杀），伤害单独算。
- 白天烧：`SUNBURN_TYPES` + `underOpenSky`（头顶扫到 H=64）+ 每 0.4s 重算 `m.skyT`，挂 mobPhysics 之后、dead 检查之前；渲染 tint 燃烧判 `hurtFlash>0.2`（底噪 0.12），否则绿通道被压到 0 变血块。
- **1 格宽沟（squeeze）**：贴地探测「AABB 覆盖任一格实心就算站住」，w≥1 生物架隐形桥；蜘蛛/大史莱姆挂 `squeeze:true` → 水平+贴地用 `Math.min(D.w/2, 0.4)`，竖直扫掠另用 `CENTER_HW=0.02`；`w` 仍是渲染/命中盒宽度；小史莱姆 w=0.55 别挂 squeeze。
- 配套三件缺一不可：① 贴地吸附加 `m.y >= footY+1-GROUND_SNAP_TOL(0.06)` 禁止上拽，且必须加 `D.squeeze` 守卫；② `inShaft`（身体层两侧都实心）禁沟内爬墙，判据别加「两侧上方是空气」；③ 贴地探测不能收成中心列。1 格宽走廊里 `inShaft` 会误禁爬墙，属已知取舍。
- **玩家可攻击判定只有一个**：`survival.js` 的 `playerAttackable()`（`mode===SURVIVAL && !player.dead`），`hurt()`/`hostileTarget()`/foe 命中/爆炸击退四处共用。创造模式免伤在 `hurt()`，但击退/特效/追踪/引信/boss 爆破都不走 hurt，只断目标选择会漏掉已飞的箭与独立结算的爆炸；爆炸破坏方块是世界行为，别挡。

## 贴图（textures.js）
- 程序化贴图 = noiseTile 基础 + 覆盖层；`^item_egg_\w+$` 自动走 `eggIconTile`；boss 需登记 MOB_TILE_COLORS。
- 16×16 逻辑格图标用 `PQ()` 不能用 `P()`（`P` 是 32×32 格里的单像素）；`PQ` 无 alpha，函数内定局部 `Q(x,y,c,a)`。
- `P()` 必须钳制 RGB 到 0..255（`shade(c,-76)` 出负数会让 `rgb()` 无效，canvas 沿用上次 fillStyle）。亮基色（雪 240/铁 198）±26 噪声，深基色（凋灵 28）固定色；玻璃瓶最外列先 `shade(c,-34)` 再叠玻璃灰 alpha 0.42。
- 贴图集 16×16=256 格，当前用量 242。

## 存档 / 装备 / 附魔 / 药水
- `save.js`：地形是纯函数**不入档**，只存「世界参数 + 8 维度 edits + 玩家状态」。读档顺序：种子/类型 → 清 colCache+structShapeCache → 重建 dimEdits → setDim → **重指 setEdits** → 时间 → 玩家 → 背包 → 盔甲 → 模式 → initChunks；之后清场（mobs/bots/掉落/carts/arrows），`dead` 清掉。
- **覆盖层 `0` 有意义**：`setBlock(x,y,z,0)` 写 `edits.set(k,0)`；恢复时永远不要用 `id>0` 过滤，只挡负数/NaN/非字符串键/越界（`isBlockId`）。loadGame 与导入两条路都成立。
- **持久化后端 = Cloudflare D1（2026-11-15 起已上线生产）**：`localStorage` 只是读缓存 + 离线层，D1 是真源。身份 = 匿名 UUID（`voxel-craft:owner`，`getOwner()`），请求带 `x-owner` 头；清数据/换设备即失联。后端 `functions/api/save.js`：GET 全量（`?meta=1` 仅摘要）、PUT 增量（`saves` upsert + `edits` 逐格 upsert/delete，全走 `db.batch`）、DELETE 删档；`edits` 按 `(owner,slot,dim,x,y,z)` 存、`id=0` 仍表挖空。增量 diff 在 `src/game/cloudDelta.js` 的 `buildEditDelta`（纯函数）；`saveGame` 顺带 `pushToCloud`、`loadFromCloud` 无本地档回退云端。`wrangler.toml` 绑 `DB` + `migrations_dir`，`database_id=d78f2229-81ce-4d41-ba0d-a6b1ac23f1c7`。本地用 `npx wrangler@3 pages dev dist --local`（是 `pages dev`，不是 `dev`）。
- 空档 GET 一律 200（`{has:false}` / `{save:null}`）：用 404 会被浏览器记成控制台资源错误，验收脚本要求零报错。`pushToCloud` 的 PUT 失败必须清 `lastPushed` 基线，否则这批增量永不重发。
- **开始面板云端区**：匿名 UUID 显式显示为「存档码」（可复制），`setOwner(code)` 认领换设备档（换身份必 `invalidateCloud()`；空码要还原身份，别把当前世界推到别人的空档位）；状态分 checking/empty/ok/offline，随 `ui.saveRev` 刷新。「☁️ 从云端继续」只在本地无档时显示。
- **引擎就绪时序**：`StartVeil` 比 `App.onMounted` 早挂载，首帧 `engine.*` 全是 NOT_READY noop；`initEngine` 里 `Object.assign` 后必须置 `ui.engineReady = true`，`save` computed 与云端检查都挂这个依赖，否则有档也不显示「继续 / 从云端继续」。
- 减伤入口只有 `survival.hurt(n, reason, opts)`：环境伤害（摔落/缺氧/岩浆/仙人掌/饥饿）传 `{pierce:true}`；护甲 × 盾牌相乘，最低留 1 点；背包扣减/退回放 uiActions.js。
- 配方字符 26 个大写已占满，新材料只用未占小写（d/t/u/a/j/c/g）。
- 词条记在「装备种类」上、同类共享（`ench = {[物品id]:{词条:等级}}`），inv 只有 `id→数量` 没有单件身份，别改成单件。八条词条必须接真机制；`inscribe()` 不扣材料（账在 uiActions）；`enchantRestore` 逐条校验、`applySave` 无条件调用；效率倍率**乘算**；开台走 `actions.tryOpenEnchant()`，放在 `doPlace()` 的 `heldId()` 之前（空手可开）。
- 12 种药水全接真机制；**同种不叠层**（重复喝取 `max(剩余,dur)`）；`potionRestore` 逐条校验、`applySave` 无条件调用；饮用先 `applyPotion` 再 `invTake`；配方统一 `['a'+X]` 1×2（`a`=空瓶）。`PotionHud.vue` 右上角圆环，`.touch` 时下移 56px。

## 输入 / 界面 / 触屏
- 游戏内**不放常驻文字 HUD**，状态只用图形（Vitals 气泡、准星、挖掘环、蓄力条），文字只走瞬时 Toast。
- 画布只负责转视角（touchmove → addLook），挖/放走 `uiActions.touchMine`/`touchPlace`；`pointerdown` 必须跳过 `pointerType==='touch'`。
- **视角无边界**（2026-11-04 起）：`addLook` 不 clamp 俯仰，yaw/pitch 用 `wrapAngle` 折回 [-π,π)（防漂移；非有限输入归零，别让 NaN 进存档）；`M4.view` 的 r/u/f 任意 pitch 下都正交，越过 90° 上下颠倒是自然结果。`SENS=0.0022`/`TOUCH_LOOK=1.15`。
- 单次 touchmove 的 `TOUCH_STEP_MAX=90` 已删；三道兜底不能省：`touchstart` 里 identifier 复用刷新基准、旧手指是否还活着、`endLook` 里 id 对不上但页面没手指则无条件复位。
- `touchPlace` 维护 `placeHeld`+`placeRepeat`，长按功能优先接这两个 flag；触屏控件隐藏时必须复位所有按住状态。
- 摇杆换算在 `stick.js` 的 `applyStickInput`，靠 `stickInput.active` 接管期保证归零那帧也写 false，别在 loop 再判 `stickVec`。
- 触屏渲染倍率上限 1.5（桌面 2.0，`loop.js resize()`）；无键盘，存档/读档/暂停/换模式都要按钮。
- 竖屏底部整条拇指区（摇杆 + 2×2 动作区 `bottom:100px`），Vitals 走 `.vitals.touch` 挪左上 `top:52px`；≤400px 物品栏 32×40、≤350px 28×36；`HotBar` 不设 max-width。
- 手机闪退三堵：触屏判定 `coarse || innerWidth<=900`；`pointerlockerror` 在 `ui.touch` 下直接 return；`webglcontextlost` → 存档+reload，`visibilitychange` → 存档+暂停，`onerror`/`unhandledrejection` → FatalNotice。别删。
- 拼写面板（`spellPanel.js`/`SpellBook.vue`）：`CraftBox` 两种模式都显示；字块是学习材料不占背包账，放料直接写 `craftSlots` 不走 `craftPlace`，`clearCraft/craftClearAt` 靠 `isGlyphBlock` 挡 `invAdd`；`spellBookEntries()` 只列 3×3 摆得下的词（≤9 字母、A–Z 齐备）且同 key 取 `arr[0]`，与 `takeCraftResult` 的 `entries[0]` 一致；NOT_READY_KEYS 同步登记 `placeGlyph/pickSpellEntry/undoGlyph`。

## 已知边界 bug
- 指针锁被拒时背包关不掉：`openBag()` 拿不到锁会 `pauseGame()` 置 `running=false`，而 KeyE 条件是 `k==='KeyE' && running`。脚本绕过：调 `startGame(false)`。

## 无头测试（.scratch/<topic>/probe.mjs）
- **改完代码跑测试前必须重启 dev server**：HMR 的 `?t=` 会让 `import('/src/game/xxx.js')` 拿到另一个模块实例；探针从 `performance.getEntriesByType('resource')` 捞真实 URL 再 import。
- dev 下 `import('/engine.js')` 拿到的是 NOT_READY_KEYS noop；判断按钮可点只能看 DOM（`.veil` 有没有 `hide`）。
- 等地形就绪要连续 3 次采样一致；生物测试开 `player.fly` 悬停 + 定时把怪钉住，测遮挡盖整片天花板；手动调 mobPhysics/mobAI 要递增 `m.animT`。
- textures.js 顶层 `document.createElement` 在 node 直跑会炸，probe 别 import 它，用迷你 BLOCKS 表纯逻辑复刻。
- `const { dim } = await import('./state.js')` 是值快照，切维度后仍是旧值；要 `const S = await import(...)` 再读 `S.dim`。
- `position:fixed` 的 `offsetParent` 恒为 null，判可见性改读 `getComputedStyle(el).display`。
- `page.evaluate` 回调在浏览器里跑，访问不到 node 变量，必须 `return {...}` 出来。
- 截图逐像素比对不能单独当「世界没变」：树叶取 `uTime`、手部取 `worldTime`；要拍确实变坏的对照组 C，用 `diff(A,B) ≪ diff(A,C)` 说话。
- `scroll-behavior:smooth` 会让无头截图截到半路；断言前把 `documentElement.style.scrollBehavior` 改 `auto` 再 `scrollTo`，核对 `nav.getBoundingClientRect().top===0`。
- **线上（生产 bundle）探针不能 import 页面模块**：没有 `/src/game/*.js`，只能纯 DOM 真实点击；触屏 context 点 `.tb.sys`「背包」可绕开指针锁/KeyE。`v-show` 与长列表首帧有竞态，点击前 `waitForSelector(..., {state:'visible'})`，别用固定 sleep。参考 `.scratch/spell-craft/online-probe.mjs`。
- **线上找产物标记不能只扫初始 resource**：游戏逻辑在异步加载的 `index-*.js` chunk，入口 `main-*.js` 只留引用名 —— 从入口文本正则解析 chunk 名再 `fetch('/assets/<name>')` 一起找。就绪等待用 `/地形就绪（/`；进游戏等 `.veil.hide`，别用固定 sleep。参考 `.scratch/mine-density/online-probe.mjs`。
- **历史 mob 探针默认跑在 CREATIVE**：`gap-fall`/`boss` 靠怪追玩家驱动，从不显式设 mode；改动「怪是否锁定玩家」会成片假阴性 —— 两处已补 `setModeState(MODE.SURVIVAL)`，新 mob 探针也要显式设模式。

## 验证流程 / 提交
1. `npx vite build` 必须过（115 modules、贴图 242/256、index js 约 260 kB/gzip 99；D1 改动后 108→115）。
2. `.scratch/<topic>/probe.mjs` 断言全过。
3. 写 `.scratch/<topic>/spec.md`（根因/做法/验证）。
4. 追加 `.workbuddy-ai/memory/YYYY-MM-DD.md`；`git add` 自己改的文件后 commit（中文祈使句，概括根因+新增）。工作区常有并行会话未提交代码，别 `git add -A`。
5. 同一文件叠两条功能线时：`git show HEAD:<file>` 取 blob → 脚本按唯一锚点只施加本线 hunk → `git hash-object -w` + `git update-index --cacheinfo 100644,<sha>,<path>` 写暂存区；工作区保持原样。参考 `.scratch/spell-craft/split.mjs`。

## 宣传页 / 素材 / 部署
- `intro.html` 必须留在 `vite.config.js` 的 `rollupOptions.input`；素材路径一律 `/media/...`；成品只进 `public/media/`；`.scratch/**/*.{png,webm,mp4,webp,log}` 已 gitignore。
- 素材脚本在 `.scratch/promo/`：capture/record/postprocess/qr/verify-intro/qr-check。Playwright 录屏窗口外框比内容大恒定 34×104；WebM 变帧率，裁/抽帧前先 `-r 25` 转 CFR；片头静止靠 `postprocess.sh` 的 TRIM；视频 `ERR_ABORTED` 正常（readyState 4 够）。
- 素材库 `#media` 8 卡 + `#lb` 查看器：整卡是透明 `<button>`、下载是独立 `<a>`，**不能把 `<a>` 嵌进 `<button>`**；视频按需创建；SVG 体积 gzip 后读不准，干脆不报。`shot-mobile.webp` 是 780×1688，16:9 框用 `object-position:50% 95%`。
- 线上 Cloudflare Pages：`https://voxel-craft-516.pages.dev/`，项目 `voxel-craft`，production branch=`main`；部署 `npm run build && npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`（不带版本会 notarget；OAuth 授权页只有 2 分钟）。`public/_headers` 给 `/assets/*` 配 immutable。
- 线上特性：`/intro.html` 308 → `/intro`；HEAD 拿不到 `Content-Length`（回退带 `Range` 请求后立刻 `body.cancel()`）；线上若是旧的 1209 字节 index.html 兜底，说明没部署上去。
- `npx vite preview ... &` 会被回收（CONNECTION_REFUSED），用受管后台任务；后台交互式命令别接管道，用 `> file.log 2>&1`；playwright 的 ESM 不吃 NODE_PATH，要 `createRequire(PW_ROOT+'/x.js')`。
- 部署前 `git status` 查并行会话改动：有别人的在写就用 `git worktree add` 到仓库外检出当前提交、junction 一份 `node_modules` 再 build；删 junction 只能用 .NET `Directory.Delete(path,false)`，`rm -rf` 会删进真实依赖。
- 验收脚本 `.scratch/cf/verify.mjs`/`.scratch/promo-gallery/probe.mjs`：标题/WebGL/零控制台报错；Playwright 缓存浏览器版本不符时用 `CHROME_PATH` 指系统 Chrome。
- **GitHub 推送**：代理可能拒 `CONNECT github.com:443`（502），`git fetch/push` 与 SSH 不通但 `api.github.com` 通；命令里用 `$https_proxy` 别硬编码端口。此时 `GH_TOKEN="$(gh auth token)" node .scratch/gh-sync/push-via-api.mjs` 走 Git Database API 增量重建提交再 PATCH main ref，SHA 可保持一致；详见 `.scratch/gh-sync/spec.md`。
