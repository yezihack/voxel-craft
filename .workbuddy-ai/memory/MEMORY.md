# voxel-craft 长期记忆

## 架构 / 依赖（改动前必读）
- 环 `actions → mobs → input → uiActions → actions`：模块顶层调 `setXxxHook()` 撞 TDZ，一律导出 `installXxxHook()` 交给 `boot.js` 的 `boot()`。
- bots.js 已 import mobs.js：mobs 只留 `botHook={list,damage}`，由 bots 幂等 `installBotHook()` 注入；反向 import 成环。
- `armor/enchant/potions.js` 只依赖 config.js；反向靠 `setEnchantReader`/`setPotionHasteReader`（文件末尾调用，模块必须求值一次，否则词条/急迫静默失效）。
- 加锁只走 `uiActions.requestLockSafe()`：`requestPointerLock()` 返回 Promise，无手势 reject 会满屏英文报错。
- `engine.js` 用 NOT_READY_KEYS 铺 noop 占位（引擎异步拉起），新增导出要同步登记；`initEngine()` 的 `Object.assign` 后必须置 `ui.engineReady=true`（StartVeil 早挂载首帧全是占位；save computed / 云端检查依赖它）。
- `REACH=13`（挖/放/上车/召唤/点燃）≠ `REACH_ATTACK=9`（打怪/打 bot/旁观射线）。bot 回血多路，`damageBot` 置 `regenBlockT=6`，所有回血分支判 `<=0`。

## 渲染 / 几何
- `isOpaque(id)`：带 `shape`（cross/plate）一律不算不透明；mesher 6 面邻居剔除，薄片误判会剔掉相邻实心块的面 → 透视穿帮。
- 超平坦结构不生树/花/水；`generate.js` flatWorld 里 `structBlockAt` 必须最前且覆盖所有 y，之后才分层。
- 结构格 `CELL=96`，`structAt(gx,gz)` 一格一结构（`structShapeCache` 单值缓存）。矿井密度只调 `dims.js` 的 `STRUCT_FILL`/`MINE_EXTRA`/`MINE_PLAIN_TAIL`；份额用独立 hash `hash2(gx,gz,SEED+9013)` 且放在群系分支之前，复用 `pick` 会吃掉村庄/遗迹份额。`worldCensus()` 样方 `SAMPLE_N=96` 只覆盖 4 格，「0 条废弃矿井」是正常采样。

## 性能（2026-11-16 优化，勿回退）
- **线上卡顿先看 DevTools 脚本 vs 渲染占比**：本次是脚本 94%、渲染 2.8% → 瓶颈在主线程 JS，砍画质/视距没用。
- `structAt` 已带 `Map` 记忆化（`structAtRaw` 是原函数体）；**缓存跟 `SEED`/`flatWorld` 换桶**，否则换种子后读到旧判定（症状：换种子地形结构没变）。上限 600 超限整表清。
- `structAnchor` 只调 `structAt` **一次**（原来调两遍 = 最热路径成本翻倍）。
- `buildChunk` 开头一次性采样 chunk+1 格边进 `Int16Array`，面剔除与 AO 全走数组下标。**1 格边够用**（AO 沿面切线最多偏移 1 格）；地形纯函数，采样一次与现算等价。
- 脏区块重建按**时间预算** `loop.js` 的 `BUILD_BUDGET_MS=6`，不是区块个数（原来 4 个 = 56~290ms 一帧）。走一格脏 16 块，按 6ms/帧摊完。
- 效果：单 chunk 72.6ms → 12.3ms；挖方块单帧 87ms → 11.7ms（11.5fps → 85fps）。**同机 A/B 对照（worktree 检出 HEAD~1）**：单 chunk 153.6ms → 13.7ms（11.2×），挖方块帧 14fps → 84fps。**网格输出与优化前逐字节一致**（`proto.mjs` 逐顶点对拍）。
- 线上验收用 `online-frames.mjs`（纯 DOM，`CF_URL=`）：长任务 0 个、>100ms 帧 0 个。`after-frames.mjs` 依赖 dev server 的 `/src/game/` 模块路径，**线上（打包产物）跑不了**。
- 别给 `getEffective` 加**全局**缓存：它读 `edits` 覆盖层是有状态的，会返回过期方块；区块局部缓存每次重建重新采样才安全。
- 排除项（已评估，别再提）：降渲染倍率/关泛光/关 FXAA、缩短视距 `VIEW_CX/CZ`、Web Worker 化网格构建。见 `.scratch/perf/spec.md`。

## 生物（mobs.js）
- **不设场上生物数量上限**（2026-11-15 删 `MOB_CAP=64` 及 summonGolem / boss 援军 / updateMobSpawn / 刷怪蛋 4 道闸）。别再加 `mobs.length>=N` 总闸——撞顶静默拒绝最难查。唯一节流是 `updateMobs` 48 格远距回收（傀儡/boss/附身目标除外）。保留 `player.dead` 门控、`GUARD_CAP=3`、`summonAdds.cap=4`，都不是总闸。挂机怪聚 48 格内会无限累积掉帧，属已接受取舍；兜底加回收别加闸。见 `.scratch/mob-cap/spec.md`。
- AI 用 flag 分派：`boss` 分支放 `if(D.hostile)` 之前；`fly:true` 在 mobPhysics 岩浆灼烧后、`wasGround` 前短路跳重力，只做三轴 AABB；`!boss` 才参与回收。远程攻击复用 `shootArrowAt(foe:true)`；凋灵爆破只借 `explodeMob` 球形破坏循环（直接调会置 `dead` 自杀），伤害单独算。
- 白天烧：`SUNBURN_TYPES` + `underOpenSky`（头顶扫到 H=64）+ 每 0.4s 重算 `m.skyT`，挂 mobPhysics 后、dead 检查前；渲染 tint 判 `hurtFlash>0.2`（底噪 0.12），否则绿通道压 0 变血块。
- **1 格宽沟 squeeze**：贴地探测「AABB 覆盖任一格实心即站住」；蜘蛛/大史莱姆挂 `squeeze:true` → 水平+贴地用 `Math.min(D.w/2,0.4)`，竖直扫掠用 `CENTER_HW=0.02`；`w` 仍是渲染/命中盒宽度；小史莱姆 w=0.55 不挂。三件配套：① 贴地吸附加 `m.y>=footY+1-GROUND_SNAP_TOL(0.06)` 禁止上拽且加 `D.squeeze` 守卫；② `inShaft`（身体层两侧实心）禁沟内爬墙，判据别加「两侧上方是空气」；③ 贴地探测不能收成中心列。1 格走廊 `inShaft` 误禁爬墙属已知取舍。
- **玩家可攻击判定只有 `survival.playerAttackable()`**（`SURVIVAL && !dead`），`hurt()`/`hostileTarget()`/foe 命中/爆炸击退共用。创造免伤在 `hurt()`，但击退/特效/追踪/引信/boss 爆破不走 hurt；爆炸破坏方块是世界行为别挡。

## 贴图（textures.js）
- 程序化贴图 = noiseTile + 覆盖层；`^item_egg_\w+$` 自动走 `eggIconTile`；boss 登记 MOB_TILE_COLORS。贴图集 16×16=256 格，用量 242。
- 16×16 图标用 `PQ()`（`P()` 是 32×32 单像素）；`PQ` 无 alpha，函数内定 `Q(x,y,c,a)`。`P()` 必须钳制 RGB 到 0..255（`shade(c,-76)` 负数让 `rgb()` 无效、canvas 沿用上次 fillStyle）；亮基色 ±26 噪声、深基色固定，玻璃瓶最外列先 `shade(c,-34)` 再叠灰 alpha 0.42。

## 存档 / 云端 D1 / 装备
- `save.js`：地形纯函数不入档，只存「世界参数 + 8 维度 edits + 玩家状态」。读档顺序：种子/类型 → 清 colCache+structShapeCache → 重建 dimEdits → setDim → **重指 setEdits** → 时间 → 玩家 → 背包 → 盔甲 → 模式 → initChunks；之后清场（mobs/bots/掉落/carts/arrows）并清 `dead`。
- **覆盖层 `0` 有意义**：`setBlock(...,0)` 写 `edits.set(k,0)`；恢复绝不能用 `id>0` 过滤，只挡负数/NaN/非字符串键/越界（`isBlockId`）。loadGame 与导入都成立。
- **持久化 = Cloudflare D1**（2026-11-15 上线）：`localStorage` 只是读缓存+离线层，D1 是真源。身份匿名 UUID（`voxel-craft:owner`/`getOwner()`），请求带 `x-owner`。`functions/api/save.js`：GET 全量（`?meta=1` 摘要）、PUT 增量（`saves` upsert + `edits` 逐格 upsert/delete，全走 `db.batch`）、DELETE 删档；`edits` 按 `(owner,slot,dim,x,y,z)`、`id=0` 表挖空。增量 diff = `cloudDelta.js` 的 `buildEditDelta`；`saveGame` 顺带 `pushToCloud`，无本地档 `loadFromCloud` 回退。`wrangler.toml` 绑 DB + migrations_dir，`database_id=d78f2229-81ce-4d41-ba0d-a6b1ac23f1c7`。**本地用 `npx wrangler@3 pages dev dist --local`（`pages dev` 不是 `dev`）**；dev 日志写仓库外，否则文件监听让 Worker 重启。
- 空档 GET 一律 200（`{has:false}`/`{save:null}`），404 会被记成控制台资源错误；`pushToCloud` PUT 失败必须清 `lastPushed` 基线，否则增量永不重发。
- **开始面板云端区**：UUID 显示为「存档码」可复制；`setOwner(code)` 认领（换身份必 `invalidateCloud()`；空码还原身份，别把当前世界推到别人空档）；状态 checking/empty/ok/offline 随 `ui.saveRev` 刷新；「☁️ 从云端继续」只在本地无档时显示。
- **导出/导入存档 UI 已移除**（2026-11-16）；`exportSaveJson()`/`importSaveJson()` 保留作纯编解码供 `.scratch/saveio|savehole` 探针回归，别再接 UI。
- **别名体系（2026-11-16）**：`0002_aliases.sql` 的 `aliases(alias 归一化主键, owner UNIQUE, display)` + `functions/api/alias.js`；校验共用 `aliasName.js`（`normalizeAlias` 2–20 字、`isOwnerCode` 必须先判，否则 10 字符纯字母别名会被当 owner 写进 `x-owner`）。`save.js` 的 `getAlias/setAlias/lookupAlias/resolveOwner`，`ALIAS_KEY` 只做离线展示缓存；认领无档必须还原 owner，有档才 `loadFromCloud()` 后 `startGame()`。业务失败（`taken`/`invalid`）一律 **200 + body reason**，4xx 会被记成控制台资源错误。别名全局唯一、大小写不敏感、**不参与存档主键**；⚠️ 它是读档凭证不是账号，知道即可认领。首次引导 = `showGuide` + `voxel-craft:alias-guide`。见 `.scratch/alias/spec.md`。
- 减伤入口只有 `survival.hurt(n,reason,opts)`，环境伤害（摔落/缺氧/岩浆/仙人掌/饥饿）传 `{pierce:true}`；护甲 × 盾牌相乘最低留 1 点；背包扣减/退回在 uiActions.js。配方字符 26 个大写占满，新材料只用未占小写（d/t/u/a/j/c/g）。
- 词条记「装备种类」上同类共享（`ench={[物品id]:{词条:等级}}`），inv 只有 `id→数量` 无单件身份；八条词条接真机制，`inscribe()` 不扣材料（账在 uiActions），`enchantRestore` 逐条校验、`applySave` 无条件调用，效率倍率乘算；开台 `actions.tryOpenEnchant()` 放 `doPlace()` 的 `heldId()` 之前（空手可开）。
- 12 种药水接真机制；同种不叠层（取 `max(剩余,dur)`）；`potionRestore` 逐条校验、`applySave` 无条件调用；先 `applyPotion` 再 `invTake`；配方 `['a'+X]` 1×2（`a`=空瓶）。`PotionHud.vue` 右上圆环，`.touch` 下移 56px。

## 输入 / 界面 / 触屏
- 游戏内**不放常驻文字 HUD**：状态只用图形（Vitals、准星、挖掘环、蓄力条），文字只走瞬时 Toast。
- 画布只转视角（touchmove → addLook），挖/放走 `uiActions.touchMine`/`touchPlace`；`pointerdown` 必须跳过 `pointerType==='touch'`。**视角无边界**：`addLook` 不 clamp 俯仰，yaw/pitch `wrapAngle` 折回 [-π,π)（非有限归零，别让 NaN 进存档）；`M4.view` 任意 pitch 下 r/u/f 正交。`SENS=0.0022`/`TOUCH_LOOK=1.15`。
- `TOUCH_STEP_MAX` 已删；三道兜底：touchstart 里 identifier 复用刷新基准、旧手指是否活着、endLook id 对不上但页面没手指则无条件复位。`touchPlace` 维护 `placeHeld`+`placeRepeat`（长按优先接这两 flag）；触屏控件隐藏时复位所有按住状态。摇杆在 `stick.js` 的 `applyStickInput`，靠 `stickInput.active` 保证归零那帧也写 false，别在 loop 判 `stickVec`。
- 触屏渲染倍率上限 1.5（桌面 2.0）；无键盘，存档/读档/暂停/换模式都要按钮。竖屏底部整条拇指区（摇杆 + 2×2 动作区 `bottom:100px`），Vitals `.vitals.touch` 挪左上 `top:52px`；≤400px 物品栏 32×40、≤350px 28×36；`HotBar` 不设 max-width。
- 手机闪退三堵：触屏判定 `coarse || innerWidth<=900`；`pointerlockerror` 在 `ui.touch` 下 return；`webglcontextlost` → 存档+reload，`visibilitychange` → 存档+暂停，`onerror`/`unhandledrejection` → FatalNotice。别删。
- 拼写面板：`CraftBox` 两种模式都显示；字块是学习材料不占背包账，放料直接写 `craftSlots`，`clearCraft/craftClearAt` 靠 `isGlyphBlock` 挡 `invAdd`；`spellBookEntries()` 只列 3×3 摆得下的词（≤9 字母、A–Z 齐备）且同 key 取 `arr[0]`，与 `takeCraftResult` 的 `entries[0]` 一致；NOT_READY_KEYS 同步登记 `placeGlyph/pickSpellEntry/undoGlyph`。

## 已知边界 bug
- 指针锁被拒时背包关不掉：`openBag()` 拿不到锁会 `pauseGame()` 置 `running=false`，KeyE 条件含 `running`。脚本绕过 `startGame(false)`。

## 无头测试（.scratch/<topic>/probe.mjs）
- **改完代码跑测试前重启 dev server**：HMR `?t=` 会让 `import('/src/game/xxx.js')` 拿到另一实例；探针从 `performance.getEntriesByType('resource')` 捞真实 URL 再 import。dev 下 `import('/engine.js')` 是 noop，判断按钮可点只能看 `.veil` 有无 `hide`。
- 等地形就绪要连续 3 次采样一致；生物测试开 `player.fly` 悬停 + 定时钉怪，测遮挡盖整片天花板；手动调 mobPhysics/mobAI 要递增 `m.animT`。**历史 mob 探针默认 CREATIVE**，新探针要显式 `setModeState(MODE.SURVIVAL)`。
- textures.js 顶层 `document.createElement` 在 node 直跑会炸，probe 别 import，用迷你 BLOCKS 表复刻。`const {dim}=await import('./state.js')` 是值快照，要 `const S=await import(...)` 再读 `S.dim`。
- `position:fixed` 的 `offsetParent` 恒 null，判可见性读 `getComputedStyle(el).display`；`page.evaluate` 回调在浏览器跑，访问不到 node 变量，必须 `return {...}`。
- 截图逐像素比对不能单独当「世界没变」（树叶取 `uTime`、手部取 `worldTime`），要拍变坏的对照组 C 用 `diff(A,B)≪diff(A,C)`。`scroll-behavior:smooth` 会截到半路，断言前设 `scrollBehavior='auto'`。
- **线上探针不能 import 页面模块**：只能纯 DOM 真实点击；触屏 context 点 `.tb.sys`「背包」绕开指针锁/KeyE；`v-show` 竞态用 `waitForSelector(...,{state:'visible'})` 别用固定 sleep。参考 `.scratch/spell-craft/online-probe.mjs`。
- **线上找产物标记不能只扫初始 resource**：逻辑在异步 `index-*.js` chunk，从 `main-*.js` 正则解析 chunk 名再 `fetch('/assets/<name>')`；就绪等 `/地形就绪（/`，进游戏等 `.veil.hide`。参考 `.scratch/mine-density/online-probe.mjs`。
- Playwright ESM 不吃 NODE_PATH，要 `createRequire(PW_ROOT+'/x.js')`；浏览器版本不符用 `CHROME_PATH` 指系统 Chrome。**两个 WebGL 页面并行 + swiftshader 会让第二页完全不渲染**（selector 超时且零控制台报错）：浏览器探针串行开 context、纯 API 走 Node `fetch`。

## 验证流程 / 提交
1. `npx vite build` 过（贴图 242/256；模块数 D1 后 115、别名后 116，index js 约 260 kB/gzip 99）。
2. `.scratch/<topic>/probe.mjs` 断言全过；线上另跑 online/ui 探针，要求零控制台报错。
3. 写 `.scratch/<topic>/spec.md`（根因/做法/验证）；`to-spec` 模板 Problem/Solution/User Stories/Implementation/Testing/Out of Scope/Notes + `Status: ready-for-agent`。
4. 追加 `.workbuddy-ai/memory/YYYY-MM-DD.md`；`git add` 自己改的文件后 commit（中文祈使句概括根因+新增）；工作区常有并行会话，**别 `git add -A`**。
5. 同一文件叠两条功能线：`git show HEAD:<file>` 取 blob → 脚本按唯一锚点只施加本线 hunk → `git hash-object -w` + `git update-index --cacheinfo` 写暂存区，工作区保持原样。参考 `.scratch/spell-craft/split.mjs`。

## 宣传页 / 素材 / 部署
- `intro.html` 必须在 `vite.config.js` 的 `rollupOptions.input`；素材路径 `/media/...`，成品只进 `public/media/`；`.scratch/**/*.{png,webm,mp4,webp,log}` 已 gitignore。`.scratch/promo/` 脚本：录屏窗口外框比内容大 34×104，WebM 裁/抽帧前先 `-r 25` 转 CFR，片头静止靠 TRIM。
- `#media` 8 卡 + `#lb`：整卡是透明 `<button>`、下载是独立 `<a>`，**不能把 `<a>` 嵌进 `<button>`**；视频按需创建。`shot-mobile.webp` 780×1688，16:9 框用 `object-position:50% 95%`。
- 线上 Pages `https://voxel-craft-516.pages.dev/`，项目 `voxel-craft`，production branch `main`；部署 `npm run build && npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`（不带版本会 notarget；OAuth 只有 2 分钟）；迁移 `npx wrangler@3 d1 migrations apply voxel-craft-saves --remote`。`public/_headers` 给 `/assets/*` 配 immutable。
- 线上特性：`/intro.html` 308 → `/intro`；HEAD 拿不到 `Content-Length`（回退带 `Range` 请求后立刻 `body.cancel()`）；仍是旧 1209 字节 index.html 说明没部署上去。
- `npx vite preview ... &` 会被回收，用受管后台任务；后台交互式命令别接管道，用 `> file.log 2>&1`。部署前查 `git status` 看并行改动：有别人在写就 `git worktree add` 到仓库外检出当前提交、junction `node_modules` 再 build；删 junction 只能用 .NET `Directory.Delete(path,false)`，`rm -rf` 会删进真实依赖。
- 验收 `.scratch/cf/verify.mjs`/`.scratch/promo-gallery/probe.mjs`：标题/WebGL/零控制台报错。
- **GitHub 推送**：代理可能拒 `CONNECT github.com:443`（502），`git fetch/push` 与 SSH 不通但 `api.github.com` 通；用 `$https_proxy` 别硬编码端口。此时 `GH_TOKEN="$(gh auth token)" node .scratch/gh-sync/push-via-api.mjs` 走 Git Database API 重建提交再 PATCH main ref，SHA 可保持一致；见 `.scratch/gh-sync/spec.md`。
