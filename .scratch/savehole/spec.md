# 工单：挖掉的方块活不过存档往返（导出导入后沟长回去了）

状态：已修复
范围：`src/game/save.js`（一处 3 行改成 9 行 + 一个 import）

---

## 一、现象

玩家挖出一条沟 → 导出存档 → 导入 → **沟没了，地形长回原样**；
但同一片区域里「放上去的方块」却还在。看起来像是「只有挖的动作没被记住」。

## 二、根因

`generate.js` 的 `setBlock` 是这样记录改动的：

```js
const base = getBlock(xi, yi, zi);
if (id === base) edits.delete(k);
else edits.set(k, id);
```

挖掉一格 = 写入 `id = 0`。所以**覆盖层里那条记录是「值 0」，不是「被删掉」** ——
这是必须的：`getEffective` 要能区分「这里本来就没东西」和「这里被我挖空了」。

而 `save.js` 的 `applySave` 恢复覆盖层时写的是：

```js
const id = pair[1] | 0
if (id > 0) m.set(pair[0], id)   // ← 0 全被丢掉
```

于是所有「挖空」的记录在读档时被静默丢弃，`getEffective` 回落到程序化地形 ——
沟自然就长回去了。放上去的方块 id > 0，一路畅通，所以「塔还在、沟没了」。

**关键点：存档文件本身一直是好的。** 导出、`editsToArray`、`JSON.stringify`
都没问题（探针实测导出内容里就是 `["5,18,5", 0]`）。丢数据发生在**读档**这一步，
而且 `applySave` 是 `loadGame` / 导入 / 自动读档共用的 ——
也就是说 F9 读档同样会丢沟，不只是导入。玩家只是先撞上了导入这条路径。

## 三、做法

```js
const key = pair[0]
const raw = +pair[1]
if (typeof key !== 'string' || !Number.isFinite(raw) || raw < 0) continue
const id = raw | 0
if (id !== 0 && !isBlockId(id)) continue   // 0 必须放行，其余走方块 id 校验
m.set(key, id)
```

顺手补上原来没有的两道护栏（原先 `id > 0` 同时扮演了「过滤垃圾」的角色，
但它挡不住超界 id 和非字符串键）：

- `id >= ID_ITEM_BASE(200)` 的一律丢弃 —— 否则手改存档能塞进 99999，
  渲染时会去查 `BLOCKS[99999]` 拿到 `undefined`；
- 键必须是字符串 —— 数字键 `4` 与 `'4'` 在 Map 里是两个不同的键，
  `getEffective` 永远读不到，等于往表里塞垃圾。

## 四、验证

```
node .scratch/savehole/probe.mjs   → 21 项断言全过（修前 15 过 6 挂）
node .scratch/saveio/probe.mjs     → 19 项全过（既有存档探针，无回归）
npx vite build                     → 105 modules，通过
```

`probe.mjs` 覆盖：
1. 挖掘确实留下一条值为 0 的记录（这是前提，不是巧合）
2. 存档 / 导出文件里带着这条 0
3. 读档后该格仍是空气，且放上去的方块也在
4. 护栏：超界 / 负数 / NaN / 非字符串键被挡掉，值为 0 与 3 的合法记录保留

端到端（`shot.mjs`，真实浏览器，真实 saveGame → exportSaveJson → deleteSave →
importSaveJson → loadNow）：
- 改动格数往返前后都是 62；50 格挖空逐格为空气、3 格柱子逐格仍在；页面零报错
- 三段对照截图：`hole-before.png`（挖好的坑）/ `hole-after.png`（往返之后）/
  `hole-bug.png`（按旧逻辑只保留 id>0 复刻 bug）
- 中央 640×480 区域像素差：A vs B **2.75%**，A vs C **30.20%**
  —— 往返后的画面就是原来那个坑；C 图里坑被填平而柱子还在，与玩家描述一致

## 五、踩坑记录

1. **像素比对不是「世界有没有变」的好指标。** 游戏里树叶摇曳取 `uTime`、
   手部摆动取 `worldTime`，任意两帧都会有全局细微差异（实测 37% 像素超阈值）。
   必须同时拍一张「确实变坏了」的对照组 C，用 `diff(A,B) ≪ diff(A,C)` 才有意义。
   而且坑在画面里太小时，摇曳噪声会把信号完全盖住 —— 得把相机拉近 + 只统计
   坑所在的中央区域。
2. **对照组要精确复刻旧逻辑。** 第一版直接 `dimEdits[0].clear()`，把柱子也删了，
   那不是旧 bug 的样子（旧逻辑只丢 `id === 0`，放的方块留着）。
3. **改完 save.js 必须换干净的 dev server 跑浏览器验证**，否则 HMR 会让探针
   拿到旧模块实例（本仓库的老坑，见 MEMORY.md）。

## 六、对已有存档的影响

无需重新导出。存档文件里一直带着这些值为 0 的记录，只是读档时被丢了；
换成修复后的版本，**现有的 .json 直接导入即可看到沟回来**。
