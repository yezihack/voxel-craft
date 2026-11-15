# 删除场上生物数量上限

## 根因

`mobs.js` 里有一个 `MOB_CAP = 64`（历史上 26 → 38 → 64 一路放宽过），通过 4 道闸限制**同时存在的生物总数**：

| 位置 | 拦截 |
|---|---|
| `mobs.js:425` `summonGolem()` | `mobs.length >= MOB_CAP` → 返回 null，傀儡核心点了没反应也不报错 |
| `mobs.js:903` boss 援军 | `mobs.length < MOB_CAP` 才允许召唤 |
| `mobs.js:1143` `updateMobSpawn()` | 自然刷怪总闸提前 return |
| `actions.js:290` `trySpawnEgg()` | 刷怪蛋被挡 + toast「场上生物太多了，先清一清再放」 |

玩家明确要求**不再限制场上生物数量**。这类「静默拒绝」尤其糟糕：傀儡核心和刷怪蛋都是消耗品路径，撞上限时没有任何反馈（傀儡那条连 toast 都没有）。

## 做法

删掉 `MOB_CAP` 常量与全部 4 道引用，`actions.js` 的 import 里同步移除 `MOB_CAP` / `mobs`（后者在删掉拦截后已无其它用途）。保留 `player.dead` 门控（死亡时不刷怪是另一件事，不该一起删）。

**刻意保留两类配额**，它们不是「场上生物总数」上限，而是各自来源的生成节奏：

- `GUARD_CAP = 3`：村庄自己长出来的守卫傀儡数量（不含玩家手动召唤的）。
- `summonAdds.cap = 4`：远古守卫周期召唤的小史莱姆配额。

`voxel-craft.html` 是只读的单文件对照基准，不参与 `vite.config.js` 的构建入口，未改动。

原注释位置改成一段防回归说明：不要再往 `spawnMob` / `summonGolem` / `updateMobSpawn` / 刷怪蛋里加 `mobs.length >= N` 总闸；唯一的自然节流是 `updateMobs` 的 48 格远距回收（傀儡 / boss / 附身目标除外）—— 它管「走远了清掉」，不管「同时最多几只」。

## 验证

`.scratch/mob-cap/probe.mjs`（复用 `boss/probe.mjs` 的 DOM/WebGL stub，node 直跑真实模块）**10/10**：

- `MOB_CAP` 不再导出；
- `spawnMob` 连放 200 只全部成功（旧上限 64）；
- `summonGolem` 在 200+ 只之后仍能召唤；
- `updateMobSpawn` 在 200+ 只时仍进入刷怪逻辑 —— 用「`mobRng` 是否被消费」判定（在 import 前替换 `Math.random` 计数），不依赖地形能否真刷出怪，能精确区分「数量闸提前 return」与「放行」；
- 对照组：`player.dead = true` 时 RNG 零消费，证明保留的门控仍生效；
- `GUARD_CAP` / `summonAdds.cap` 仍在；
- 源码里已无 `MOB_CAP` 引用与「场上生物太多」提示。

`npx vite build` 通过（115 modules）。

## 已知风险

没有硬上限后，玩家长时间挂机、且怪都聚在 48 格内时，`mobs` 可无限增长并最终拖垮帧率（手机端尤其明显）。这是「删掉上限」的必然代价，玩家已明确接受；如后续要兜底，应加**远距/超时回收**而不是再加一个数量闸。
