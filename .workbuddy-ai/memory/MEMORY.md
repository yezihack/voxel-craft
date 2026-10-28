# voxel-craft 长期记忆

## 渲染 / 几何约定
- `isOpaque(id)`（generate.js）判断面剔除：凡带 `shape`（cross/plate）的方块
  一律不算不透明，薄片不遮挡邻面 —— 改这里会影响火把/铁轨等薄片是否透视。
- mesher.js `buildChunk` 用 6 面邻居 `isOpaque` 做面剔除；薄片（火把/铁轨）
  若被误判不透明会让相邻实心块朝向它的面被剔 → 透视穿帮。

## 生物（mobs.js）架构约定
- MOB_TYPES 条目用 flag 分派 AI：`boss` 必须放在 `if (D.hostile)` **之前**，
  boss 走独立 AI 分支，不混 hostile/guard/passive。
- 飞行 boss 用 `fly:true`，mobPhysics 在岩浆灼烧之后、`wasGround` 之前做 `D.fly`
  短路跳过重力与贴地，只做三轴 AABB 扫掠防穿墙。
- boss 用 `!MOB_TYPES[m.type].boss` 豁免 updateMobs 末尾的距离回收，不会被远距剔除。
- 远程攻击可复用骷髅 `shootArrowAt(foe:true)`（只认玩家）。
- 凋灵爆破：只借 `explodeMob` 的球形破坏方块循环，**不要**直接调 `explodeMob`
  （那会置 `m.dead=true` 让 boss 自杀），伤害单独算。

## 贴图（textures.js）
- 程序化贴图走 noiseTile 基础 + 覆盖层；物品蛋图标正则 `^item_egg_\w+$`
  自动走 `eggIconTile`，不占新格。boss 需显式登记 MOB_TILE_COLORS 基色。

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

## 界面 / 触屏约定
- 游戏内**不放常驻文字 HUD**（2026-10-27 按玩家要求整块删除 HudPanel / helpKeys）。
  状态只准用图形表达（Vitals 的心形鸡腿气泡、准星、挖掘环、蓄力条）；
  文字只走瞬时 `Toast`。加新 UI 时别在左上角再挂卡片。
- 触屏手势分工是硬约定：**画布只负责转视角**（`input.js` 的 `touchmove` → `addLook`），
  挖掘/放置走 `uiActions.touchMine` / `touchPlace` 两个专用按钮。
  别再把「按住挖 / 长按放」塞回画布 —— 电容屏分不清停顿与长按。
- `pointerdown` 必须跳过 `pointerType === 'touch'`，否则 pointer 与 touch 两套监听
  会把同一次滑动各算一遍。
- `touchPlace` 维护的是 `placeHeld` + `placeRepeat`，所以弓蓄力、盾牌格挡、
  连发铺路全部自动复用；新增长按类功能时优先接这两个 flag，别再开新状态。
- 触屏控件隐藏时必须复位按住状态（摇杆/挖掘/放置/跳/潜），
  否则遮罩抢走焦点后 `touchend` 不来，人会自己一直往前走。
- 触屏渲染倍率上限 1.5（桌面 2.0），见 `loop.js` 的 `resize()`。
- 触屏没有键盘：存档/读档/暂停/换模式都要有按钮入口（暂停面板 + 右上系统按钮）。

## 无头测试（.scratch/<topic>/probe.mjs）踩坑
- textures.js 顶部 `document.createElement('canvas')` 在 node 直跑会报
  `document is not defined`：probe 不要 import textures.js，改用迷你 BLOCKS 表
  纯逻辑复刻谓词做等价校验。
- `const { dim } = await import('./state.js')` 拿到的是**值快照**非活绑定，
  切维度后仍是旧值；必须 `const S = await import(...)` 再读 `S.dim`。
- 手动调 mobPhysics/mobAI 时记得递增 `m.animT`（通常由 updateMobs 负责），
  否则 `sin(animT*freq)` 恒 0 导致 boss 不移动。

## 验证流程
1. `npx vite build` 必须过（目标 ~99 modules, 贴图格 ≤ 256）。
2. `.scratch/<topic>/probe.mjs` 跑断言全过。
3. 写 `.scratch/<topic>/spec.md` 工单（根因 / 做法 / 验证）。
4. `.workbuddy-ai/memory/YYYY-MM-DD.md` 追加当日工作；`git add -A && git commit`。

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
