# 传送 / 轨道 / 超平坦

一次补齐三件事：AI 玩家过门不传送的缺陷、一批新方块（火把 / 红石 / 铁轨 / 传送带），
以及超平坦世界类型。

## 根因：AI 玩家为什么不过门

实体**没有维度字段**。`bots` / `mobs` / `arrows` / `carts` 一律隐式属于「当前维度」，
只有玩家有 `dim`。所以「AI 玩家被传送」这个说法在现有数据模型下不成立 ——
它唯一可观测的效果是：从这一维度消失、在那一维度出现。

旧代码里两处缺失导致这个效果根本没发生：

1. `bots.js` 的 `updateBots` 只做「清理死亡 / 清理超距 / 补人 / 逐个 step」，
   没有任何传送门判定。AI 玩家站在门里和站在草地上完全一样。
2. `portal.js` 的 `switchDim` 无条件 `despawnAllBots()`。即便玩家把 AI 玩家
   推进门里，玩家自己过门之后它们也会被一并清掉。

修法对应两点：

- `bots.js` 新增 `botPortalId(b)` → `portalIdInBox(b.x, b.y, b.z)`，
  在 `updateBots` 的清理循环里判定：站进门里就地移除（附紫色粒子 + toast）。
- `switchDim` 在 `setDim` **之前**统计「站在同一扇门里、且门的目标维度就是本次目标」
  的 AI 玩家，清场之后用 `rehomeBots` 在落点 5~12 格半径内原样放回来。
  半径下限 5 是硬约束：更近会直接落在回程门上，下一帧又被判「在门里」而消失。

顺序有讲究，两件事都必须在 `setDim` 之前做完 —— 那之后 `getEffective` 读的就是新维度了。

## 新增方块与物品

| id | 名称 | 形状 | 碰撞 | 说明 |
|---|---|---|---|---|
| 78 | 火把 | cross | 否 | `light:1` 自发光 |
| 79 | 红石火把 | cross | 否 | `power:1` 电源 |
| 80 | 红石块 | 立方 | 是 | `power:2` 电源 |
| 81 | 铁轨 | plate | 否 | `rail:1` |
| 82 | 充能铁轨 | plate | 否 | `rail:1 poweredRail:1`，需供电才加速 |
| 83 | 传送带 | 立方 | 是 | `belt:1`，方向按放置时 yaw 写入 |
| 84 | 传送板 | plate | 否 | `pad:1`，两两配对互传 |
| 257 | 矿车 | 物品 | — | 右键放到铁轨上 |
| 258 | 传送珠 | 物品 | — | 右键短距瞬移（26 格 / 0.7s 冷却） |

贴图格 183 / 256，仍有余量。

## 非立方几何

`mesher.js` 加 `sheetCorners(shape)`：`cross` 是两张对角薄片，`plate` 是一张贴地薄板。
这两类走 `uCutout`（`MAT_FOLIAGE`），由 shader 的 `discard` 按纹素 alpha 裁掉透明部分，
不走半透明趟 —— 否则排序问题会把铁轨搅成一团。薄片一律正反各画一遍，
因为 `CULL_FACE` 开着，只画正面会让铁轨从下面看不见。

## 超平坦

`state.flatWorld` + `world.FLAT_H = 18`。`colInfo` 在平坦模式下直接返回恒高、
无树无村庄。`generate.getBlock` 的表层分支按 `flatWorld` 走。
`uiActions.pickWorldType` 切换时清三张缓存（colCache / structShapeCache / 区块几何）
并清场（人 / 怪 / 车），否则会读到上一张地形算出的高度。

## 验证

`.scratch/transport/probe.mjs` 无头冒烟，27 条断言全过。

注意 probe 里必须用命名空间对象取 `dim`（`const S = await import(...)` 后 `S.dim`）；
`const { dim } = await import(...)` 解出来的是**快照**，切换后仍是 0。
