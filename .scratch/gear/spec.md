# 工单：更强的武器 / 盔甲 / 盾牌 / 存档

状态：已完成
范围：`src/game/{config,armor,save,survival,player,loop,actions,mobs,crafting,textures,uiActions,selectors,uiSync,index}.js`
、`src/components/{ArmorPanel,BagPanel,InventoryPanel,StartVeil}.vue`、`src/data/{veilKeys,helpKeys}.js`

---

## 一、更强的武器（tier 5「星陨」）

### 根因 / 动机
原伤害上限是钻石剑 7 点（`TIER_DMG[4]=4` + `KIND_DMG.sword=3`）。
boss 系统（上一轮）掉的是钻石 / 金 / 黑曜石 —— 打 boss 的收益和「挖矿」重合，
缺少「只有打 boss 才能拿到」的东西，boss 的存在感偏弱。

### 做法
1. `config.js` 的 `ITEM_TIER_NAME / TIER_SPEED / TIER_DMG` 各追加第 6 项：
   `星陨 / 16 / 6`。星陨剑伤害 = 6 + 3 = **9**（钻石剑 7），挖掘倍率 ×16（钻石 ×8）。
2. 新增三件 boss 材料（id 262–264）：龙鳞 / 凋灵骨 / 守卫核心。
   由 `mobs.js` 的 `MOB_TYPES[boss].loot` 固定掉落（**不掷骰**，便于规划）：
   | Boss | 掉落 | 数量 |
   |---|---|---|
   | 末影龙 | 龙鳞 | 4 |
   | 凋灵 | 凋灵骨 | 4 |
   | 远古守卫 | 守卫核心 | 8 |
3. 新增 4 件武器（id 265–268）：星陨剑 / 星陨战斧 / 星陨镐 / 凋灵法杖。
   法杖走 `staff:{dmg,cd}` 元数据，右键发射魔法弹 —— 复用 `arrows` 数组，
   加 `magic:true` 字段使重力降到 6%（`ARROW_GRAV * 0.06`），命中方块时炸紫粒子。
   冷却用挂钟时间戳而不是帧累计（低帧率下不会「按十次出十发」）。

### 为什么只高「一档」而不是碾压
星陨是「打完 boss 才配拥有」的装备，但若伤害直接翻倍，钻石装备会当场作废，
玩家挖矿的动力一起消失。所以刻意压成「各高一档」：
收益明确、但不至于让既有内容失去意义。

---

## 二、盔甲

### 做法
1. 新模块 `armor.js`：`armorSlots`（reactive，4 槽）+ `armorPoints()` + `armorReduction()`。
   - **只依赖 `config.js`**，不 import `survival.js` —— 否则
     `survival → armor → survival` 成环，`hurt()` 拿不到减伤值。
     背包的扣减 / 退回交给 `uiActions.js`（那边才认识 `inv`）。
2. 16 件盔甲（id 269–284）= 4 部位 × 4 材质，`armor:{part, pts}`：

   | 材质 | 头/胸/腿/脚 | 整套点数 | 减伤 |
   |---|---|---|---|
   | 布（羊毛） | 1/3/2/1 | 7 | 22.4% |
   | 铁 | 2/6/5/2 | 15 | 48% |
   | 钻石 | 3/8/6/3 | 20 | 64% |
   | 星陨 | 4/9/7/4 | 24 | 72%（封顶） |

3. 减伤公式：`min(0.72, pts * 0.032)`。封顶的理由见 `armor.js` 顶部注释。
4. `survival.hurt(n, reason, opts)` 新增 `opts.pierce`：
   - 环境伤害（摔落 / 缺氧 / 岩浆 / 仙人掌 / 饥饿）传 `{pierce:true}` → 无视护甲；
   - 外部调用（僵尸近战 / 骷髅箭 / 苦力怕爆炸）不传 → 照常减免。
5. UI：`ArmorPanel.vue` 四槽 + 总览；背包里点护甲直接穿上（旧的自动退回），
   点槽位脱下。HUD 在穿着时显示 `🛡 <点数>`。

### 为什么环境伤害不吃护甲
护甲挡的是打击，挡不住缺氧和坠落势能；而且如果连饥饿都能被护甲抵消，
「吃东西」这个循环就彻底没意义了。

---

## 三、盾牌

### 做法
1. 2 面盾牌（id 285–286）：木盾 `block:0.50`、铁盾 `block:0.68`。
2. `player.blocking` 由 `loop.js` 每帧维护（**在 `updatePhysics` 之前**，
   保证这一帧的减速与减伤读到同一个值）：
   `mode === SURVIVAL && !dead && placeHeld && !!SHIELD_OF[heldId()]`。
3. `doPlace()` 里 `if (SHIELD_OF[id]) return;` —— 右键是举盾，不是放置。
4. `hurt()` 里护甲与盾牌**相乘**叠加：`n * (1 - armorRed) * (1 - shield.block)`，
   并保留 **1 点下限**（否则终局装备等于无敌，血条不动会让人失去危险判断）。
5. 代价：举盾时移动速度 ×0.42（`player.js`）。
6. 视觉：`post.js` 的 `drawHandView` 在 `blocking` 时把手上物上抬、内收、转正。

---

## 四、存档

### 设计前提
地形是**纯函数**（种子 + 坐标 → 方块），所以存档不保存地形，
只保存「世界参数 + 覆盖层 + 玩家状态」。原始地形零字节。

### 快照结构（`save.js` 的 `snapshot()`）
```js
{
  v: 1, t, seed, dim, flat, mode, time,
  player: { x, y, z, yaw, pitch, hp, food, air, spawn, fly },
  inv: [[id, count], …],
  slots: [ …54 ],
  armor: [head, chest, legs, feet],
  selected,
  edits: [ 8 个维度各一份 [[ "x,y,z", id ], …] ],
}
```

### 关键实现点
1. **Map → 数组**：`JSON.stringify(new Map())` 得到 `{}`，这是最容易踩的坑，
   必须显式转 `[...map.entries()]`。
2. **读档顺序**：种子/世界类型 → 清 `colCache` / `structShapeCache` →
   重建 8 张 `dimEdits` → `setDim` → **重指 `setEdits`**（否则仍指向上一个维度那张表）
   → 时间 → 玩家 → 背包 → 盔甲 → 模式 → `initChunks` 重排区块窗口。
3. **读档必须清场**：生物 / AI 玩家 / 掉落物 / 矿车 / 飞行中的箭，
   坐标都属于上一份世界（和 `switchDim` 同一个理由）。
4. **`dead` 一律清掉**：存档时停在死亡界面，读回来照样复活 ——
   否则读档第一秒就弹死亡面板，玩家会以为档坏了。
5. **槽位与背包对账**：`invSlots[i]` 只有在 `inv` 里真有时才保留，
   否则会留下「数量 0 的僵尸格子」。
6. **存储层降级**：浏览器走 `localStorage`，node 走内存 Map ——
   这样无头测试能把「存 → 读 → 比对」整条链路跑完。
   配额满 / 隐私模式禁用时 `saveGame()` 返回 `{ok:false, reason:'quota'}`，不抛异常。
7. **meta 单独存一份**（时间 / 维度 / 模式 / 改动格数）：开始面板要显示摘要，
   为这几个字去解析几 MB 的主存档太亏。
8. **自动存档 60 秒一次**，只在 `running && !paused` 时推进（暂停 / 背包打开时不存）。
9. **新世界 = 删档 + `location.reload()`**：要重置的引擎状态太多
   （缓存 / 区块 / 生物 / 传送门 / 运输装置…），逐项重置漏一个就是幽灵 bug。

### 入口
- `F5` 保存 / `F9` 读档（`F5` 必须 `preventDefault`，否则会把进度刷没）。
- 开始 / 暂停面板：有档时显示「📂 继续上次存档（时间 · 维度 · 模式 · N 格改动）」+ 删档按钮；
  没档时提示快捷键。

---

## 五、配方

材料字符 `d`（龙鳞）/ `t`（凋灵骨）/ `u`（守卫核心）——
26 个大写字母已被方块 + 工具 + 蛋壳占满，只能用未占用的小写。

| 产物 | 配方 | 成本 |
|---|---|---|
| 星陨剑 | `d / d / J` | 3 龙鳞 |
| 星陨战斧 | `dd_ / dJ_ / _J_` | 4 龙鳞 |
| 星陨镐 | `ddd / _J_ / _J_` | 3 龙鳞 |
| 凋灵法杖 | `ttt / _J_ / _J_` | 3 凋灵骨 |
| 星陨盔 | `uuu / u_u` | 5 守卫核心 |
| 星陨甲 | `u_u / uuu / uuu` | 8 守卫核心 |
| 星陨腿 | `uuu / u_u / u_u` | 7 守卫核心 |
| 星陨靴 | `u_u / u_u` | 4 守卫核心 |
| 布/铁/钻石甲 | 同形状换 `W` / `R` / `Y` | 5/8/7/4 |
| 木盾 | `PJP / PPP / _P_` | 6 木板 |
| 铁盾 | `RJR / RRR / _R_` | 6 铁矿 |

「凑齐一套星陨甲 = 打三场远古守卫 + 一场末影龙 + 一场凋灵 ≈ 五场 boss」。

---

## 六、验证

```
npx vite build        → 103 modules，通过
node .scratch/gear/probe.mjs → 全部通过（10 组、约 55 条断言）
```

probe 覆盖：
1. 贴图格 217 / 256（新增 25 件仍在预算内）
2. 新物品登记（16 甲 / 2 盾 / 1 杖 / isArmorItem / tier 5 / itemTip）
3. 伤害递进 木4 < 铁6 < 钻石7 < **星陨9**
4. 护甲点数与减伤（布 7→22.4%，星陨 24→72% 封顶）
5. `hurt()` 应用减伤（裸装 10→10；星陨整套 10→3；岩浆 pierce 吃满 4）
6. 盾牌格挡（木盾 10→5，铁盾 10→3，未举盾 10→10，甲+盾 →1 点下限）
7. 配方（含「9 龙鳞不误命中」「2×2 满羊毛不出布靴」两条反向断言）
8. boss 掉落（4/4/8，普通怪 0）
9. 存档往返（方块 / 背包 / 槽位 / 盔甲 / 坐标 / 朝向 / 血量 / 饥饿 / dead 清除 / blocking 清除）
10. localStorage 存 / 读 / 删（含「没存档时不抛错」「读档把坐标拨回」）

---

## 七、踩坑记录

1. **`save.js` 会拉进 WebGL 依赖**：它 import `mesher.js`（→ `textures.js`，顶层
   `document.createElement`）和 `portal.js`（→ `post.js`，顶层建 GL 程序）。
   probe 必须照抄 `bots/probe.mjs` 的完整挡板（document / window / WebGL / AudioContext）。
2. **`isArmorItem` 定义在 `SHIELD_OF` 之前**：箭头函数惰性求值不会真炸，
   但读起来像 TDZ 坑 —— 已把三张表全部建好再定义判定函数。
3. **`worldTime` 是 `let`**：`save.js` 不能直接赋值（ESM 导入绑定只读），
   所以在 `mobs.js` 加 `setWorldTime()`。
4. **`ui.saveRev` 版本号**：`localStorage` 变了但 Vue 侧没有响应式依赖，
   面板会一直显示旧摘要 —— 存 / 读 / 删档时 `saveRev++`，组件里读一下它即可。
