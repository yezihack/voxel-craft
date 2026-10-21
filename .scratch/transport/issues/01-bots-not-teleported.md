Status: resolved
Type: task

## 问题

AI 玩家走进传送门后既不被传送、也不消失，就站在门里发呆。

## 根因

实体没有维度字段（见 `spec.md`）。旧代码缺两件事：

1. `updateBots` 里没有任何传送门判定；
2. `switchDim` 无条件 `despawnAllBots()`。

## 做法

- `bots.js`：`botPortalId(b)` 复用 `portalIdInBox`，`updateBots` 清理循环里命中就地移除。
- `portal.js`：`switchDim` 在 `setDim` 前收集同门随行者，`rehomeBots` 在新维度落点
  5~12 格半径内放回来；半径下限 5 是硬约束（更近会落在回程门上被二次判定）。

## Answer

已修。`.scratch/transport/probe.mjs` 第 6、8 组覆盖：

- 站在门里的 AI 玩家 `botPortalId` 命中，`updateBots` 后从列表消失；
- 玩家 `switchDim` 后随行者在 `bots` 里出现、距玩家 < 20 格、且不在门里。

## 备注

probe 曾有一条假失败「玩家过门成功」，根因是 `const { dim } = await import(...)` 是值快照
而非活绑定。测试写法问题，不是产品缺陷。
