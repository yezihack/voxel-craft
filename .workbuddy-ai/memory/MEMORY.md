# voxel-craft 长期记忆（索引）

> 只记「不能再犯」的硬结论。背景/数据看 `.scratch/<topic>/spec.md`、`.scratch/<topic>/probe.mjs` 与每日日志；
> 模块级细则看同目录 `REFERENCE.md`。

## 架构 / 依赖（改动前必读）
- 环 `actions → mobs → input → uiActions → actions`：模块顶层调 `setXxxHook()` 撞 TDZ，一律导出 `installXxxHook()` 交 `boot.js` 的 `boot()`。
- bots.js 已 import mobs.js：mobs 只留 `botHook={list,damage}`，由 bots 幂等 `installBotHook()` 注入；反向 import 成环。
- `armor/enchant/potions.js` 只依赖 config.js；反向靠 `setEnchantReader`/`setPotionHasteReader`（文件末尾调用，模块必须求值一次，否则词条/急迫静默失效）。
- 加锁只走 `uiActions.requestLockSafe()`：`requestPointerLock()` 返回 Promise，无手势 reject 会满屏英文报错。
- `engine.js` 用 NOT_READY_KEYS 铺 noop 占位（引擎异步拉起），新增导出要同步登记；`initEngine()` 的 `Object.assign` 后必须置 `ui.engineReady=true`。`uiState.js` 是界面状态中心（引擎写 / Vue 读）；`src/game/` 新模块要静态引入得走 `engine.js` 再导出。
- `REACH=13`（挖/放/上车/召唤/点燃）≠ `REACH_ATTACK=9`（打怪/打 bot/旁观射线）。

## 渲染 / 几何
- `isOpaque(id)`：带 `shape`（cross/plate）一律不算不透明；mesher 6 面邻居剔除，薄片误判会剔掉相邻实心块的面 → 透视穿帮。
- 超平坦结构不生树/花/水；`generate.js` flatWorld 里 `structBlockAt` 必须最前且覆盖所有 y，之后才分层。
- 结构格 `CELL=96`，`structAt(gx,gz)` 一格一结构（`structShapeCache` 单值缓存）。矿井密度只调 `dims.js` 的 `STRUCT_FILL`/`MINE_EXTRA`/`MINE_PLAIN_TAIL`；份额用独立 hash `hash2(gx,gz,SEED+9013)` 且放在群系分支之前，复用 `pick` 会吃掉村庄/遗迹份额。`worldCensus()` 样方 `SAMPLE_N=96` 只覆盖 4 格，「0 条废弃矿井」是正常采样。

## 性能（2026-11-16 优化，勿回退）
- **线上卡顿先看 DevTools 脚本 vs 渲染占比**：上次脚本 94%、渲染 2.8% → 瓶颈在主线程 JS，砍画质/视距没用。
- `structAt` 带 `Map` 记忆化（`structAtRaw` 是原函数体）；**缓存跟 `SEED`/`flatWorld` 换桶**，否则换种子后读到旧判定；上限 600 超限整表清。`structAnchor` 只调 `structAt` 一次（原来两遍 = 热路径翻倍）。
- `buildChunk` 开头一次性采样 chunk+1 格边进 `Int16Array`，面剔除与 AO 全走下标；1 格边够用（AO 沿面切线最多偏移 1 格）。
- 脏区块重建按**时间预算** `loop.js` 的 `BUILD_BUDGET_MS=6`，不是区块个数（原来 4 个 = 56~290ms 一帧）；走一格脏 16 块。效果：单 chunk 72.6→12.3ms，挖方块单帧 87→11.7ms（11.5→85fps）；同机 A/B（worktree 检出 HEAD~1）单 chunk 153.6→13.7ms、挖方块帧 14→84fps，**网格输出与优化前逐字节一致**（`proto.mjs` 逐顶点对拍）。
- 线上验收用 `online-frames.mjs`（纯 DOM，`CF_URL=`）：长任务 0 个、>100ms 帧 0 个。`after-frames.mjs` 依赖 dev server 的 `/src/game/` 路径，线上跑不了。
- 别给 `getEffective` 加**全局**缓存：它读 `edits` 覆盖层是有状态的，会返回过期方块；区块局部缓存每次重建重新采样才安全。
- 排除项（已评估，别再提）：降渲染倍率/关泛光/关 FXAA、缩短视距、Web Worker 化网格构建。

## 生物（mobs.js）
- **不设场上生物数量上限**（2026-11-15 删 `MOB_CAP=64` 及 summonGolem / boss 援军 / updateMobSpawn / 刷怪蛋 4 道闸）。别再加 `mobs.length>=N` 总闸——撞顶静默拒绝最难查。唯一节流是 `updateMobs` 48 格远距回收（傀儡/boss/附身目标除外）。保留 `player.dead` 门控、`GUARD_CAP=3`、`summonAdds.cap=4`，都不是总闸。挂机怪聚 48 格内会无限累积掉帧，属已接受取舍；兜底加回收别加闸。
- 玩家可攻击判定**只有** `survival.playerAttackable()`（`SURVIVAL && !dead`），`hurt()`/`hostileTarget()`/foe 命中/爆炸击退共用。创造免伤在 `hurt()`，但击退/特效/追踪/引信/boss 爆破不走 hurt；爆炸破坏方块是世界行为别挡。
- AI flag 分派：`boss` 分支放 `if(D.hostile)` 之前；`fly:true` 在 mobPhysics 岩浆灼烧后、`wasGround` 前短路跳重力，只做三轴 AABB；`!boss` 才参与回收。凋灵爆破只借 `explodeMob` 球形破坏循环（直接调会置 `dead` 自杀），伤害单独算。
- 白天烧：`SUNBURN_TYPES` + `underOpenSky`（头顶扫到 H=64）+ 每 0.4s 重算 `m.skyT`；渲染 tint 判 `hurtFlash>0.2`（底噪 0.12）。

## 存档 / 云端 D1 / 装备
- `save.js`：地形纯函数不入档，只存「世界参数 + 8 维度 edits + 玩家状态」。读档顺序：种子/类型 → 清 colCache+structShapeCache → 重建 dimEdits → setDim → **重指 setEdits** → 时间 → 玩家 → 背包 → 盔甲 → 模式 → initChunks；之后清场并清 `dead`。
- **覆盖层 `0` 有意义**：`setBlock(...,0)` 写 `edits.set(k,0)`；恢复绝不能用 `id>0` 过滤，只挡负数/NaN/非字符串键/越界（`isBlockId`）。
- **持久化 = Cloudflare D1**（2026-11-15 上线）：`localStorage` 只是读缓存+离线层，D1 是真源。身份匿名 UUID（`voxel-craft:owner`/`getOwner()`），请求带 `x-owner`。`functions/api/save.js`：GET 全量（`?meta=1` 摘要）、PUT 增量（`saves` upsert + `edits` 逐格 upsert/delete，全走 `db.batch`）、DELETE 删档；`edits` 按 `(owner,slot,dim,x,y,z)`、`id=0` 表挖空。增量 diff = `cloudDelta.js` 的 `buildEditDelta`；`saveGame` 顺带 `pushToCloud`。`wrangler.toml` 绑 DB + migrations_dir，`database_id=d78f2229-81ce-4d41-ba0d-a6b1ac23f1c7`。**本地用 `npx wrangler@3 pages dev dist --local`（不是 `dev`）**；dev 日志写仓库外。
- 空档 GET 一律 200（404 会被记成控制台资源错误）；`pushToCloud` PUT 失败必须清 `lastPushed` 基线，否则增量永不重发。
- `setOwner(code)` 认领：换身份必 `invalidateCloud()`；空码还原身份，别把当前世界推到别人空档；认领无档必须还原 owner，有档才 `loadFromCloud()` 后 `startGame()`。业务失败一律 **200 + body reason**。别名是读档凭证不是账号，知道即可认领。
- **别名有两套语义，别混**：`voxel-craft:alias`（展示缓存，「我现在这份档叫什么」，随身份变、`setOwner` 清）↔ `voxel-craft:alias-state`（**本机档案**，`aliasState.js`，「这台机器上我用过什么名字 + 它绑的 owner」，**不随身份变**，是换回自己存档的钥匙）。只存别名无法反查存档 —— 必须连 owner 一起存。`setAlias()` 成功写档案（唯一入口）、`deleteSave()` 清档案、`setOwner()` **不**清档案。
- **别名弹窗**（`AliasResume.vue`，z-index 45，`App.vue` 里必须排在 `<StartVeil />` **之前** —— StartVeil 只在自己 setup 读一次引导标记）：有档案→问「要不要加载」；无档案→引导设别名。**「先不用」后还弹不弹分两种**：身份一致（面板有等价入口）→ 不再弹；身份已换（弹窗是回自己档的唯一通路）→ **每次都弹**。加载按身份分流：一致→`loadNow()` 回落云端；已换→**只能云端**（localStorage 那份是别人的世界），先 `setOwner` 换回去，拉不到就换回原 owner。`aliasState.js` 是**纯函数叶模块（零 import）** → 可直接静态 import，不必经 engine 门面。
- 减伤入口只有 `survival.hurt(n,reason,opts)`，环境伤害传 `{pierce:true}`；护甲 × 盾牌相乘最低留 1 点；背包扣减/退回在 uiActions.js。配方字符 26 个大写占满，新材料只用未占小写（d/t/u/a/j/c/g）。
- 词条记「装备种类」上同类共享（`ench={[物品id]:{词条:等级}}`），inv 只有 `id→数量`；八条词条接真机制，`inscribe()` 不扣材料（账在 uiActions）；开台 `actions.tryOpenEnchant()` 放 `doPlace()` 的 `heldId()` 之前（空手可开）。
- 12 种药水接真机制；同种不叠层（取 `max(剩余,dur)`）；先 `applyPotion` 再 `invTake`；配方 `['a'+X]` 1×2（`a`=空瓶）。

## 输入 / 界面 / 触屏
- 游戏内**不放常驻文字 HUD**：状态只用图形，文字只走瞬时 Toast。快捷键说明这类**面板**是例外，但要能收起，别常驻挡视线。
- **设置体系**：`src/game/settings.js` 承载本机显示偏好（localStorage 键 `voxel-craft:settings`，不进存档不上 D1，`sanitize` 白名单+布尔）；StartVeil `.setrow` 里塞 `.setitem`，新增设置照这个模式加。快捷键速查表 = KeyHints.vue 左上角，`settings.showKeyHints`（默认 true）控制进游戏自动弹（12s 收起、每会话一次、暂停面板中途打开靠 `ui.keyHintsPending` 兑现），H 键手动唤出**不自动收起**；× 只给触屏渲染（指针锁定下 DOM 按钮点不到）。
- 画布只转视角，挖/放走 `uiActions.touchMine`/`touchPlace`；`pointerdown` 必须跳过 `pointerType==='touch'`。**视角无边界**：`addLook` 不 clamp 俯仰，yaw/pitch `wrapAngle` 折回 [-π,π)（非有限归零，别让 NaN 进存档）。`SENS=0.0022`/`TOUCH_LOOK=1.15`。
- `TOUCH_STEP_MAX` 已删；三道兜底：touchstart 里 identifier 复用刷新基准、旧手指是否活着、endLook id 对不上但页面没手指则无条件复位。`touchPlace` 维护 `placeHeld`+`placeRepeat`；触屏控件隐藏时复位所有按住状态。摇杆在 `stick.js` 的 `applyStickInput`，靠 `stickInput.active` 保证归零那帧也写 false，别在 loop 判 `stickVec`。
- 触屏渲染倍率上限 1.5（桌面 2.0）；无键盘，存档/读档/暂停/换模式都要按钮。竖屏底部整条拇指区（`bottom:100px`），Vitals `.vitals.touch` 挪左上 `top:52px`；≤400px 物品栏 32×40、≤350px 28×36；`HotBar` 不设 max-width。
- 手机闪退三堵：触屏判定 `coarse || innerWidth<=900`；`pointerlockerror` 在 `ui.touch` 下 return；`webglcontextlost` → 存档+reload，`visibilitychange` → 存档+暂停，`onerror`/`unhandledrejection` → FatalNotice。别删。
- 拼写面板：`CraftBox` 两种模式都显示；字块是学习材料不占背包账，放料直接写 `craftSlots`，`clearCraft/craftClearAt` 靠 `isGlyphBlock` 挡 `invAdd`；`spellBookEntries()` 只列 3×3 摆得下的词且同 key 取 `arr[0]`，与 `takeCraftResult` 的 `entries[0]` 一致；NOT_READY_KEYS 同步登记 `placeGlyph/pickSpellEntry/undoGlyph`。

## 多人 / 网络现状（2026-11-16 调研）
- **当前零网络层**：全仓无 WebSocket / Worker / BroadcastChannel / 轮询；两名玩家各开一个页面 = 两份互不可见的独立世界（各自 localStorage + 各自 D1 owner 档）。
- **地形是纯函数（SEED+坐标）→ 跨机天然一致**：两端 SEED/flat 相同则地形无需同步，只需同步 `edits` 覆盖层。这是多人化的最大简化（对比 Minecraft 要同步区块）。
- **方块改动唯一入口是 `generate.js` 的 `setBlock()`**（含 `dirtyChunkOf` + `fluidWake` + `edits.set/delete`）；`save.js` 的 `applySave` 是唯一旁路。远端改动应用时**必须走 setBlock 传绝对 id**（两端 base 相同故自洽；id=0 表示挖空）。
- **远端玩家渲染可白拿 AI 玩家的管线**：`bots.js` 的 `BOT_PARTS` 网格 + `post.js` `drawBots`（uTint 逐部件染色）+ `nametags.js`/`NameTags.vue`（DOM 投影标签）。若塞进 `bots` 数组须开三个洞：排除 `botStep` 本地 AI 驱动、排除 `hostileTarget`/`raycastBot` 命中、排除 `updateBots` 补人/回收。
- **已知一致性缺口**：`fluid.js` 的 `fluid` 水位表、`chests.js` 的 `containers`、`transport.js` 的 beltDirs/pads、`mobs.js` 的 `worldTime` 全是**客户端本地状态**，两端会漂；多人时需权威端或广播。
- **实体无维度字段**（bots/mobs/arrows 隐式属当前维度）：远端玩家协议必须自带 `dim`。
- **平台约束**：Cloudflare **Pages 内不能创建/部署 Durable Object**（需独立 Worker + binding，Pages 侧只能用 `env.X.getByName()` 转发）。Pages Functions 原生 WebSocket 支持官方文档未明确（第三方资料称仅 Advanced Mode）；Workers runtime 有完整 `WebSocketPair`。Pages 已进入维护模式，官方投入转向 Workers Static Assets。

## 已知边界 bug
- 指针锁被拒时背包关不掉：`openBag()` 拿不到锁会 `pauseGame()` 置 `running=false`，KeyE 条件含 `running`。脚本绕过 `startGame(false)`。

## 验证流程 / 提交
1. `npx vite build` 过（贴图 242/256；模块数 D1 后 115、别名后 116，index js 约 260 kB/gzip 99）。
2. `.scratch/<topic>/probe.mjs` 断言全过；线上另跑 online/ui 探针，要求零控制台报错。
3. 写 `.scratch/<topic>/spec.md`（根因/做法/验证）；`to-spec` 模板 Problem/Solution/User Stories/Implementation/Testing/Out of Scope/Notes + `Status: ready-for-agent`。
4. 追加 `.workbuddy-ai/memory/YYYY-MM-DD.md`；`git add` 自己改的文件后 commit（中文祈使句概括根因+新增）；工作区常有并行会话，**别 `git add -A`**。
5. 同一文件叠两条功能线：`git show HEAD:<file>` 取 blob → 脚本按唯一锚点只施加本线 hunk → `git hash-object -w` + `git update-index --cacheinfo` 写暂存区，工作区保持原样。
6. 无头测试细则（dev server 重启、地形就绪判据、线上探针只能纯 DOM 点击、Playwright ESM/Chrome 路径、两页并行 WebGL 不渲染）见 `REFERENCE.md`。
7. **部署 CF 用干净 worktree，别用主仓库工作区**：`git worktree add --detach <tmp> HEAD` → PowerShell `New-Item -ItemType Junction -Path <tmp>\node_modules -Target <主仓库>\node_modules` → 在 worktree 里 `npx vite build` + `CI=1 npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main` → `git worktree remove --force <tmp>`。理由：工作区常有**并行会话的未完成改动**（坏的 `vite.config.js`、没部署的 DO、新模块），用它构建会失败或把半成品上线。部署的是 **HEAD**，不是工作区。
8. **别用 grep 查 minified bundle**：超长单行会让 grep 按二进制处理而**漏报**中文串（实测 `grep -c "继续上次存档"` 返回 0，实际存在）。用 `node -e` 读文件 `String.includes()`。
9. **线上 longtask 数不可信**：同一部署两次跑 `online-frames.mjs` 可能一次 0 个一次 2 个（swiftshader 软渲染噪声）。判定回归必须做**同机 A/B**：两个版本各起 `vite preview`、交替顺序跑多轮比分布，别比单次数值。
