# 工单：附魔台与自定义词条系统

状态：已完成
范围：新增 `src/game/enchant.js`、`src/components/EnchantPanel.vue`；
改动 `src/game/{config,textures,crafting,armor,survival,mobs,actions,uiActions,boot,uiState,selectors,index,save,input}.js`、`src/engine.js`、`src/App.vue`

---

## 一、核心取舍：词条记在「装备种类」上，同类共享

### 根因
本作的背包是一张 `id → 数量` 的 Map（`survival.js` 的 `inv`），`invSlots` 只存 id。
两把钻石剑在内存里就是同一个数字，**没有单件物品的身份** —— 没耐久、没自定义名。

要做「给这一把剑附魔」，就得给每一格物品加实例对象，改动会顺着
`invSlots` / 存档 / 合成格 / 盔甲槽 / 快捷栏一路铺开。收益远小于风险。

### 做法
铭刻记在装备种类上：`ench = { [物品id]: { [词条键]: 等级 } }`。
换一把同种新剑不用重刻 —— 这**不是漏洞而是与物品模型一致的表述**，
世界里本来就只有「钻石剑」这一种东西。界面上照实写清楚，不含糊过去。

---

## 二、八条词条，一一对应已有机制

没有一条是「只加个数字好看」：

| 词条 | 标签 | 上限 | 适用 | 每级效果 | 接进哪里 |
|---|---|---|---|---|---|
| 锋利 sharp | 攻 | 3 | 剑 / 斧 | 近战伤害 +1 | `config.attackDamage()` |
| 效率 eff | 速 | 3 | 镐 / 斧 / 锹 | 对口挖掘 ×(1+0.5lv) | `config.toolSpeedOn()` |
| 守护 ward | 护 | 3 | 任意护甲 | 护甲 +2 点 | `armor.armorPoints()` |
| 轻羽 feather | 羽 | 2 | 靴 | 安全落高 +1.2 格 | `survival` 摔落分支 |
| 吸血 leech | 吸 | 2 | 剑 | 击杀回 2 血 | `mobs.tryAttackMob()` |
| 幸运 fortune | 运 | 2 | 镐 | 30% 额外掉一份 | `survival` 掉落分支 |
| 弓术 power | 弓 | 2 | 弓 | 箭伤 +1 | `mobs.fireArrow()` |
| 坚守 bulwark | 盾 | 2 | 盾 | 格挡比例 +8% | `survival` 盾牌分支 |

### 两个刻意的数值决定
1. **效率是乘算不是加算**。钻石镐 ×8 → 效率 III ×2.5 → ×20。
   加算的话星陨镐(16) 只到 17.5，越好的工具词条越没意义。
2. **成本 = 基础量 × 目标等级**（`costOf`）。第 n 级要 n 份，越往上越贵 ——
   于是「给十件装备各铺一个 I 级」和「把一把剑堆到 III」成为两种不同的花法。

---

## 三、依赖方向：为什么走注入

`enchant.js` 只依赖 `config.js`（叶模块），不碰 inv / DOM / WebGL，于是
`armor → enchant`、`survival → enchant`、`mobs → enchant` 三条边都不成环。

唯独 `config.js` 自己要用（`attackDamage` / `toolSpeedOn` / `itemTip`），
这是**反向边**，只能依赖注入：

```js
// config.js
export let enchantLevel = () => 0;
export function setEnchantReader(fn) { enchantLevel = fn; }
// enchant.js 文件末尾
setEnchantReader(enchantLevel);
```

沿用既有的 `readHeldId` 套路。**代价**：`enchant.js` 必须被求值一次，
否则注入不上去、所有词条静默失效（数值一点不变，最难查的那种）。
保证来自两处：`index.js` 导出它、`uiActions.js` 引它 —— 改 import 图时别把两条都删了。

---

## 四、方块与配方

- 新方块 `附魔台` 追加在 `BLOCKS` 表尾（id 85），`hard: 2.40`、`light: 1`、
  贴图 `enchant_top` / `enchant_side`（侧面底走 `obsidian`）、`BLOCK_MAT` 归 `stone` 组。
- 配方 `[' E ', 'YEY', 'PPP']` = 2 黑曜石 + 2 钻石 + 3 木板。
- 贴图：`TILE_GEN.enchant_top` 紫石面 + 双层符文环 + 四向刻痕 + 中心亮芯；
  `enchant_side` 黑曜石噪点 + 竖向紫光缝。坐标全走 `TP/TPH`，无裸 16。
  贴图集用掉 219 / 256 格。

---

## 五、交互：右键开台，不是贴方块

```js
// actions.js
export function tryOpenEnchant() {
  const hit = raycast(REACH);
  if (!hit || hit.id !== I.ENCHANT) return false;
  onOpenEnchant(hit);
  return true;
}
// doPlace() 里，在 heldId() 之前
if (tryOpenEnchant()) return;
```

放在 `heldId()` **之前**是刻意的：空手也能开台（否则必须先拿个方块）。
钩子用 `installEnchantHook()` 由 `boot()` 安装，理由见「踩坑 1」。

面板行为：
- 打开时默认把手持的可附魔装备摆上台面（少点一次）。
- 生存模式列背包里真有的装备；创造模式列全部可附魔物品。
- 材料账在 `uiActions.enchantInscribe()`（那边才认识 inv），
  `enchant.inscribe()` 只做「等级 +1」这一件纯状态变更 —— 方便无头测试直接驱动。
- 与背包面板互斥：`openBag()` 先 `closeEnchant(true)`，反之亦然；
  `pauseGame()` 的遮罩抑制条件改成 `ui.bagOpen || ui.enchantOpen`。

---

## 六、存档

- `snapshot()` 加 `ench: enchantSnapshot()`，形状就是 `ench` 本身，读写不分叉。
- `applySave` **无条件** `enchantRestore(d.ench)` —— 老档没有这个字段时全清，
  否则读老档会残留上一局刻的词条。
- `enchantRestore` **逐条校验**：词条键得存在、`fits` 得通过、等级夹到 `1..max`、
  物品 id 得真的可附魔。
  为什么校验而不是照抄：存档是玩家能手改的文件（导入功能就是为它开的门），
  一条 `{ 226: { sharp: 999 } }` 会让攻击伤害变成 999 —— 校验是唯一便宜的护栏。

---

## 七、验证

```
npx vite build                  → 105 modules，通过（intro.html 仍在）
node .scratch/enchant/probe.mjs → 全部通过（52 项断言，页面零报错）
```

probe 六组：
- **A 词条表自洽** —— 每条 `fits` 至少命中一件、`desc` 每级都出文案、上限为正
- **B 铭刻状态机与存档往返** —— 刻 / 升级 / 超上限拒绝 / 不适用拒绝；
  `saveNow → loadNow` 真跑一遍，多刻的词条被清掉；手改存档的越级项被夹到上限
- **C 八条词条逐条接进系统**（逐条断言，不抽样）：
  锋利 III `7→10`；效率 III `8→20`；守护 II `8→12`；轻羽 II 摔伤 `5→3`；
  幸运 II 掉落 `+2`；坚守 II 受伤 `3→2`；弓术 II 箭伤 `3→5`；吸血 II 击杀回血 `10→14`
- **D 方块与配方** —— id 85 存在、可合成且唯一，且「新配方没抢走旧配方形状」
  （唯一例外是玻璃 / 沙岩同料的既有设计）
- **E 面板 DOM 与真点击** —— 开面板、词条行数、台面默认摆手持、按钮文案
  「铭刻/升级/已满」、缺料禁用、真点击铭刻且红石 `8→6`、换装备词条跟着换
- **F 右键分派** —— 右键附魔台开台，且**没有**同时贴一个方块上去

视觉核对（`shot.mjs` 三张）：台面符文环与紫光缝清晰可辨、桌面面板左右分栏舒展、
手机竖屏 390×844 自动转上下布局无溢出。

---

## 八、踩坑记录

1. **`setOpenEnchantHook()` 不能写在模块顶层 → TDZ 报错**
   `actions → mobs → input → uiActions → actions` 已成环，`uiActions.js` 顶层调用时
   `actions.js` 的 `let onOpenEnchant` 还在 TDZ，报
   `Cannot access 'onOpenEnchant' before initialization`。
   改成导出 `installEnchantHook()`，由 `boot()` 调（与 `bots.js` 的 `installBotHook` 同款）。

2. **`requestPointerLock()` 现在返回 Promise**
   无用户手势时 reject → `unhandledrejection` → `App.vue` 的 fatal 兜底把英文报错
   糊在屏幕上（`A user gesture is required to request Pointer Lock.`）。
   加 `requestLockSafe()` 接住，`startGame` / `closeBag` / `closeEnchant` 全改用它。

3. **Vite HMR 的 `?t=` 时间戳让探针拿到另一个模块实例**
   现象极具误导性：词条确实刻上了、`inscribe` 返回 ok，但伤害数值一点不变。
   真因是 `import('/src/game/player.js')` 与页面加载的是两个实例
   （`diag.mjs` 里看到 `player` 有两份，坐标一份 `[0,30,0]` 一份 `[14.5,32.2,8.5]`）。
   解法两条一起上：**改完代码重启 dev server**；探针从
   `performance.getEntriesByType('resource')` 捞出页面真实加载的 URL 再 import。

4. **`position: fixed` 元素的 `offsetParent` 恒为 `null`**
   用它判面板可见性会永远得到「不可见」。改读 `getComputedStyle(el).display`。

5. **`page.evaluate` 里访问不到 node 侧变量**
   probe 第 229 行 `errs is not defined` —— 回调在浏览器里跑。改成 `return { R }`。

6. **探针驱动游戏不能走 `engine.*`**
   `src/engine.js` 的 `NOT_READY_KEYS` 给这些键铺的是 noop 占位，
   而探针 import 的 engine 又是另一个实例。必须直接 import `uiActions.js` / `state.js`。

---

## 九、已知瑕疵（未修）

`itemTip()` 里「对口材质 ×N」仍显示基础倍率，未含效率加成；
伤害处已含锋利。属显示层小瑕疵，不影响实际手感，留待后续统一。
