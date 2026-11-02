# voxel-craft 长期记忆

## 渲染 / 几何约定
- `isOpaque(id)`（generate.js）判断面剔除：凡带 `shape`（cross/plate）的方块
  一律不算不透明，薄片不遮挡邻面 —— 改这里会影响火把/铁轨等薄片是否透视。
- mesher.js `buildChunk` 用 6 面邻居 `isOpaque` 做面剔除；薄片（火把/铁轨）
  若被误判不透明会让相邻实心块朝向它的面被剔 → 透视穿帮。
- **超平坦世界（flatWorld）会生成结构**（村庄/遗迹/矿井），但不生成树/花草/
  仙人掌/水。`generate.js` 的 flatWorld 分支里 `structBlockAt` 必须放在最前面
  且覆盖**所有 y**（村庄有地基、矿井整条在地下），之后才是草/土/石分层。

## 生物（mobs.js）架构约定
- MOB_TYPES 条目用 flag 分派 AI：`boss` 必须放在 `if (D.hostile)` **之前**，
  boss 走独立 AI 分支，不混 hostile/guard/passive。
- 飞行 boss 用 `fly:true`，mobPhysics 在岩浆灼烧之后、`wasGround` 之前做 `D.fly`
  短路跳过重力与贴地，只做三轴 AABB 扫掠防穿墙。
- boss 用 `!MOB_TYPES[m.type].boss` 豁免 updateMobs 末尾的距离回收，不会被远距剔除。
- 远程攻击可复用骷髅 `shootArrowAt(foe:true)`（只认玩家）。
- 凋灵爆破：只借 `explodeMob` 的球形破坏方块循环，**不要**直接调 `explodeMob`
  （那会置 `m.dead=true` 让 boss 自杀），伤害单独算。
- **僵尸 / 骷髅白天见光烧**：`SUNBURN_TYPES` + `underOpenSky`（头顶扫到 H=64，
  遇实心方块即遮住）+ 每 0.4 秒重算一次（`m.skyT`）。挂在 updateMobs 的
  mobPhysics 之后、dead 检查之前，和岩浆烧死走同一条收尸路径。
  渲染三态 tint 里**燃烧不能复用「受伤红」** —— sunburnTick 用 hurtFlash=0.12
  当底噪，按 `>0` 判受伤会把绿通道压到 0，僵尸变一块血红。判 `>0.2`。

## 贴图（textures.js）
- 程序化贴图走 noiseTile 基础 + 覆盖层；物品蛋图标正则 `^item_egg_\w+$`
  自动走 `eggIconTile`，不占新格。boss 需显式登记 MOB_TILE_COLORS 基色。
- **16×16 逻辑格图标必须用 `PQ()`，不能用 `P()`**（2026-11-02 踩）：`P` 是 32×32
  格里的**单像素**，拿 0..15 的坐标直接调 `P` 只会画在格子左上四分之一，
  右下三块空白 —— 瓶子/蛋这类图标会缩成四分之一大。`PQ` 无 alpha 参数，
  需要透明度时在函数内定局部 `Q(x,y,col,a)`（`IU = TP/16 = 2` 倍块）。
- 玻璃瓶类图标：瓶身最外列**不能**用纯玻璃灰，会把整只瓶子洗白、液体只剩中间一条。
  正确做法是先铺 `shade(c,-34)` 再叠玻璃灰 alpha 0.42。

- 导入导出（2026-10-29）：save.js 的 `exportSaveJson` 导出的就是 SAVE_KEY
  原始 JSON（无档退回内存快照）；`importSaveJson` 只做 parse+版本校验后
  **原样写回 SAVE_KEY**，字段容错全在 applySave —— 两条路永不分叉。
  导入动作 = 覆盖浏览器存档 + loadNow 立即进世界（uiActions.importSaveFile）。
## 装备与存档约定
- 减伤入口只有 `survival.hurt(n, reason, opts)`：环境伤害（摔落/缺氧/岩浆/
  仙人掌/饥饿）必须传 `{pierce:true}`，外部打击不传 → 走护甲 + 盾牌减免。
  护甲与盾牌**相乘**叠加，最低保留 1 点。
- `armor.js` **只准依赖 config.js**，不能 import survival.js ——
  否则 `survival → armor → survival` 成环，hurt() 拿不到减伤值。
  背包的扣减/退回一律放 uiActions.js（那边才认识 inv）。
- 存档 `save.js`：地形是纯函数**不入档**，只存「世界参数 + 8 维度 edits + 玩家状态」。
  读档顺序：种子/世界类型 → 清 colCache+structShapeCache → 重建 dimEdits →
  setDim → **重指 setEdits** → 时间 → 玩家 → 背包 → 盔甲 → 模式 → initChunks。
  读档后必须清场（mobs/bots/掉落物/carts/arrows），`dead` 一律清掉。
- 配方字符：26 个大写已被占满，新材料的字符只能用未占用的小写（d/t/u）。
- **覆盖层里的 `0` 是有意义的**（2026-10-31 修）：`setBlock(x,y,z,0)` 挖空一格写的是
  `edits.set(k, 0)`，不是删掉这条 —— `getEffective` 靠它区分「原本没东西」和
  「被我挖空了」。读档时 `applySave` 曾写 `if (id > 0)`，把 0 全过滤掉，
  症状是「挖的沟读档后长回去、放的方块却还在」。改档恢复覆盖层时**永远不要**
  用 `id > 0` 当过滤条件；只挡负数 / NaN / 非字符串键 / 超界 id（`isBlockId`）。
  这个 bug 在 `loadGame` 和导入两条路上都成立，不只是导入。

## 附魔 / 词条（enchant.js，2026-10-31 建立）
- **词条记在「装备种类」上、同类共享**（`ench = { [物品id]: {词条: 等级} }`）。
  根因是 `inv` 只有 `id → 数量`、没有单件身份；要改成「给这一把剑附魔」就得给每格
  加实例对象，改动会顺 `invSlots`/存档/合成格/盔甲槽/快捷栏一路铺开。别去改。
- 八条词条一一对应已有机制，加新词条必须接进真机制，不做纯数字装饰：
  锋利→`attackDamage()`、效率→`toolSpeedOn()`、守护→`armorPoints()`、
  轻羽→摔落、吸血→`tryAttackMob` 击杀、幸运→掉落、弓术→`fireArrow`、坚守→盾牌格挡。
- `enchant.js` **只依赖 config.js**。反向边（config 要用 enchantLevel）走注入：
  `setEnchantReader` / `setEnchantSummaryReader`，在 enchant.js **文件末尾**调用。
  代价：enchant.js 必须被求值一次，否则全部词条**静默失效**（数值一点不变，最难查）。
- `inscribe()` **不扣材料**（纯状态变更，方便无头驱动）；材料账在 `uiActions.enchantInscribe`。
- `enchantRestore` **逐条校验**（键存在 / fits 通过 / 等级夹 1..max / id 可附魔）——
  存档是玩家能手改的文件，不校验就是给人送 999 伤害。`applySave` 里**无条件**调用它，
  老档没 `ench` 字段时全清，否则读老档会残留上一局的词条。
- 效率倍率**乘算**（钻石镐 ×8 → 效率 III ×20）；成本 = 基础 × 目标等级。
- 开台走 `actions.tryOpenEnchant()`，在 `doPlace()` 里放在 `heldId()` **之前**
  （空手也能开台），右键不再贴方块。

## 药水（potions.js，2026-11-02 建立）
- `potions.js` **只依赖 config.js**，不碰 DOM/GL/player/survival。反向边（`toolSpeedOn`
  要急迫倍率）走注入 `setPotionHasteReader`，在 potions.js **文件末尾**调用 ——
  同 enchant 的代价：模块必须被求值一次，否则急迫**静默失效**。
- 12 种效果全部接进真机制：治疗→`survival.heal`、迅捷/跳跃→`player.updatePhysics`、
  力量→`mobs.js` 挥击、抗性→`hurt()` 末段乘算、再生/剧毒→`updateSurvival` 秒级累加器、
  夜视→`loop.js` 的 `uAmbient`、水肺→溺水判定、抗火→岩浆 tick、急迫→`toolSpeedOn`。
- **同种药水不叠层**：重复喝取 `Math.max(剩余, dur)`，否则连喝五瓶迅捷 = 5 倍速。
- `potionRestore` **逐条校验**（键存在 / 非即时型 / `Math.min(t, dur)`），
  `applySave` 里**无条件**调用（老档无字段时全清）。存档是玩家能手改的文件。
- 饮用顺序：先 `applyPotion` 再 `invTake`，反过来失败时药水凭空消失。
- 配方统一 `['a'+X]` 1×2，`a` = 空瓶；12 种材料两两不同，保证配方不互相吃。
- HUD `PotionHud.vue` 在右上角（圆环倒计时），`.touch` 时下移 56px ——
  遵守「底部整条是拇指区」，不碰底部居中。

## 界面 / 触屏约定
- 游戏内**不放常驻文字 HUD**（2026-10-27 按玩家要求整块删除 HudPanel / helpKeys）。
  状态只准用图形表达（Vitals 的心形鸡腿气泡、准星、挖掘环、蓄力条）；
  文字只走瞬时 `Toast`。加新 UI 时别在左上角再挂卡片。
- 触屏手势分工是硬约定：**画布只负责转视角**（`input.js` 的 `touchmove` → `addLook`），
  挖掘/放置走 `uiActions.touchMine` / `touchPlace` 两个专用按钮。
  别再把「按住挖 / 长按放」塞回画布 —— 电容屏分不清停顿与长按。
- `pointerdown` 必须跳过 `pointerType === 'touch'`，否则 pointer 与 touch 两套监听
  会把同一次滑动各算一遍。
- **触屏视角（input.js）**：`TOUCH_LOOK = 1.15`（滑 100px 转 14.5°），
  单次 touchmove 用 `TOUCH_STEP_MAX = 90` 封顶。`PITCH_LIM = π/2 - 0.0005` ——
  只留这点余量防视图矩阵在正好 ±π/2 时退化（画面翻转），**不能真删**。
  `endLook` 必须有「identifier 对不上但页面上没手指 → 无条件复位」兜底：
  少了它 `lookId` 会永久挂着，下一次滑动的 delta 是几百像素，
  视角瞬间甩到边界（表现为「一低头就跳到最抬头」）。
- `touchPlace` 维护的是 `placeHeld` + `placeRepeat`，所以弓蓄力、盾牌格挡、
  连发铺路全部自动复用；新增长按类功能时优先接这两个 flag，别再开新状态。
- 触屏控件隐藏时必须复位按住状态（摇杆/挖掘/放置/跳/潜），
  否则遮罩抢走焦点后 `touchend` 不来，人会自己一直往前走。
- 摇杆 → 方向键的换算在 **`stick.js`**（`applyStickInput`），
  靠 `stickInput.active` 的「接管期」保证**归零那一帧也写 false**。
  别在 loop 里再写 `if (stickVec.x || stickVec.y)` —— 那样松手后向量归零、
  分支被跳过，上一帧的 `input.f = true` 没人清，人会一直往前走。
- `engine.js` 给模板会用到的动作铺了 noop 占位：引擎是异步拉起的，开始面板
  第一帧就可点，不铺占位会抛 `engine.xxx is not a function`。
- 触屏渲染倍率上限 1.5（桌面 2.0），见 `loop.js` 的 `resize()`。
- 触屏没有键盘：存档/读档/暂停/换模式都要有按钮入口（暂停面板 + 右上系统按钮）。
- **竖屏底部整条是拇指区**：左摇杆 + 右 2×2 动作区底边都在 `bottom: 100px`，
  所以 `Vitals`（生命/饥饿/氧气）**不能放底部居中**，触屏一律走 `.vitals.touch`
  挪到左上角 `top: 52px`（低于右上系统栏，360 宽时会撞）。
  加任何新的底部居中 HUD 之前，先想清楚它会不会压在拇指区上。
- 底部 9 格物品栏在 ≤400px 要缩到 32×40、≤350px 缩到 28×36（见 `ItemSlot.vue`），
  否则 360 宽的安卓机就会裁掉首尾两格。`HotBar` 只收 gap/padding，**不设 max-width**。
- 手机闪退三堵（2026-10-28）：触屏判定放宽到 `coarse || innerWidth <= 900`
  （有的安卓 WebView 报 fine）；`pointerlockerror` 在 `ui.touch` 下直接 return；
  `webglcontextlost` → 存档 + reload，`visibilitychange` 切后台 → 存档 + 暂停，
  `window.onerror` / `unhandledrejection` → `FatalNotice` 亮出真实错误。别删这几处。

## AI 玩家（bots.js）与 mobs 的边界
- bots.js 已 import mobs.js，**反向 import 必成环**：mobs 侧只留
  `export const botHook = { list, damage }`，由 bots 的幂等 `installBotHook()`
  注入（`boot()` + `spawnBot()` 各调一次）。
- **别在 bots.js 顶层调 `registerBots`**：mobs.js 的 `const botHook` 还没初始化，
  必撞 «Cannot access 'botHook' before initialization»（TDZ）。
- bot 的回血有多路（eat / home / 定时），`damageBot` 一律置 `b.regenBlockT = 6`，
  **所有回血分支都要判 `regenBlockT <= 0`** —— 否则回血快过僵尸 3/s 的输出，
  表现就是「挨打血条不动」。

## 循环 import 与钩子注入（通用）
- 既有环：`actions → mobs → input → uiActions → actions`。**任何模块顶层调用
  `setXxxHook()` 都会撞 TDZ**（对方那个 `let onXxx` 还没初始化），报
  «Cannot access 'onXxx' before initialization»。一律改成导出 `installXxxHook()`，
  由 `boot.js` 的 `boot()` 调（`installBotHook` / `installEnchantHook` 同款）。
- `requestPointerLock()` 现在**返回 Promise**：无用户手势时 reject →
  `unhandledrejection` → `App.vue` 的 fatal 兜底把英文报错糊满屏幕。
  所有加锁点必须走 `uiActions.requestLockSafe()`（内部 catch 掉）。

## 交互距离
- `REACH = 13`（挖/放/上车/召唤/点燃）与 `REACH_ATTACK = 9`（打怪/打 bot/旁观射线）
  **必须分开**。攻击也吃 13 会变成隔空点杀。

## 无头测试（.scratch/<topic>/probe.mjs）踩坑
- **改完代码跑测试前必须重启 dev server**。HMR 会让 `import('/src/game/xxx.js')`
  拿到**另一个模块实例**：`player.pitch` 恒 0、`mobs[0].burning` 恒 false，
  看着像改动没生效，其实画面上一切正常。判断改动是否生效优先看截图。
- **`import('/src/engine.js')` 在 dev 下拿到的是另一个模块实例**（vite 的 HMR query
  与组件不同），读到的是 `NOT_READY_KEYS` 占位 noop。判断「按钮能不能点」只能靠
  DOM 观察（`.veil` 有没有 `hide`），别 import 后读 `engine.xxx`。
- 等「地形就绪」要**连续 3 次采样一致**，只等一次会在进度条抖动时假通过。
- 生物测试里怪会追玩家（实测 1.3 秒走 5 格）：截图要开 `player.fly` 悬停 +
  `setInterval` 把怪钉在原地；测「头顶遮挡」要盖**整片**天花板，只盖一格它走两步就晒到。
- textures.js 顶部 `document.createElement('canvas')` 在 node 直跑会报
  `document is not defined`：probe 不要 import textures.js，改用迷你 BLOCKS 表
  纯逻辑复刻谓词做等价校验。
- `const { dim } = await import('./state.js')` 拿到的是**值快照**非活绑定，
  切维度后仍是旧值；必须 `const S = await import(...)` 再读 `S.dim`。
- 手动调 mobPhysics/mobAI 时记得递增 `m.animT`（通常由 updateMobs 负责），
  否则 `sin(animT*freq)` 恒 0 导致 boss 不移动。
- **`position: fixed` 元素的 `offsetParent` 恒为 `null`**（2026-10-31）：用它判
  「面板是否显示」永远得到「不可见」。改读 `getComputedStyle(el).display !== 'none'`。
- **`page.evaluate` 的回调在浏览器里跑**，访问不到 node 侧的 `errs` 之类变量，
  必须 `return {...}` 出来再在 node 侧打印。
- HMR 的 `?t=` 时间戳会让 `import('/src/game/xxx.js')` 拿到另一个实例，
  症状是「状态改对了但数值一点不变」。除了重启 dev server，探针还应从
  `performance.getEntriesByType('resource')` 捞页面真实加载的 URL 再 import。
- **截图逐像素比对不能直接当「世界有没有变」的指标**（2026-10-31）：
  树叶摇曳取 `uTime`、手部摆动取 `worldTime`，任意两帧都有全局细微差异
  （实测 37% 像素超阈值，肉眼看不出）。要证明「往返无损」，必须同时拍一张
  **确实变坏了**的对照组 C，用 `diff(A,B) ≪ diff(A,C)` 说话；且目标物体在
  画面里要够大，必要时只统计它所在区域的像素差。

## 验证流程
1. `npx vite build` 必须过（当前 105 modules、贴图格 219/256、index js 约 234 kB / gzip 90）。
2. `.scratch/<topic>/probe.mjs` 跑断言全过。
3. 写 `.scratch/<topic>/spec.md` 工单（根因 / 做法 / 验证）。
4. `.workbuddy-ai/memory/YYYY-MM-DD.md` 追加当日工作；`git add -A && git commit`。

## 宣传页与素材（2026-10-30 建立）
- `intro.html` 是独立宣传页，**必须留在 `vite.config.js` 的
  `rollupOptions.input` 里**，否则 Vite 只认 index.html，它不进 dist，
  线上访问等于 404。素材路径一律写 `/media/...`（public 约定），
  写相对路径 `media/...` 会让 build 去 HTML 同级目录解析而失败。
- 素材生产脚本全在 `.scratch/promo/`：`capture.mjs`（截图）、`record.mjs`（录屏）、
  `postprocess.sh`（转码 + 裁片头）、`qr.mjs`、`verify-intro.mjs`、`qr-check.mjs`。
  `.scratch/**/*.{png,webm,mp4,webp}` 已 gitignore，成品只进 `public/media/`。
- **Playwright 录屏灰边**：窗口外框比内容面大**恒定 34×104**，差额用灰底补齐。
  要 1280×720 就请求视口 **1314×824**。
- **Playwright 的 WebM 是变帧率**：直接 `-ss` 裁/抽帧会偏 5 秒以上，
  必须先 `-r 25` 转 CFR 母版，后续时间轴操作全部基于母版。
- 录屏从创建 context 就开始，地形要 8~9 秒才就绪 → 片头有一段静止开始面板，
  靠 `postprocess.sh` 的 `TRIM` 裁掉。改录制节奏后要重新核对 TRIM。
- 视频请求的 `ERR_ABORTED` 是浏览器拿够数据后主动掐断 range，
  `readyState === 4` 即正常，验收脚本单独归类，别当失败。

## 已知边界 bug
- **指针锁被拒时背包面板关不掉**：`openBag()` 拿不到指针锁会 `pauseGame()`
  把 `running` 置 false，而 `input.js` 的 `KeyE` 条件是 `k === 'KeyE' && running`
  → 第二次按 E 被忽略。只剩「点遮罩」和 Esc 两个出口。
  脚本化时绕过办法：调 `startGame(false)`（内部 closeBag + 恢复 running）。

## 仓库与线上环境（2026-10-28 建立）
- GitHub：https://github.com/yezihack/voxel-craft（public）。
  `main` 是发布分支，`fix` 是开发分支（2026-10-28 已与 main 同步），`dev` 停在旧的学习层规划提交。
- Cloudflare Pages 项目名 `voxel-craft`，production branch = `main`，
  线上 <https://voxel-craft-516.pages.dev/>。重新部署：
  `npm run build && npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main`
- 构建产物：~99 modules，gzip 合计约 126 kB（JS 120 + CSS 4.5）。
  `public/_headers` 给 `/assets/*` 配 immutable 缓存，index.html 不长缓存。
- 线上验收脚本 `.scratch/cf/verify.mjs`：Playwright 打开真实地址，
  断言标题 / WebGL 上下文 / 零控制台报错。改动渲染或启动流程后跑一次。

## 部署踩坑
- `npx wrangler` 不带版本会 notarget 失败，用 `npx wrangler@3`。
- `wrangler login` 的 OAuth 授权页只有 2 分钟有效期，超时重来。
- 后台跑交互式命令不要接管道（`| head` 会缓冲到进程退出才出内容），
  用 `> file.log 2>&1` 再 `cat`。
- playwright 的 ESM import 不吃 `NODE_PATH`，要
  `createRequire(PW_ROOT + '/x.js')` 再 `req('playwright')`。
- `.scratch/**/*.log` 必须 gitignore：wrangler 的 login/whoami 日志带账号邮箱。

## 提交风格
- 中文 commit message，祈使句，概括根因 + 新增内容。
