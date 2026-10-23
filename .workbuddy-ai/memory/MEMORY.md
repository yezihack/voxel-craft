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

## 提交风格
- 中文 commit message，祈使句，概括根因 + 新增内容。
