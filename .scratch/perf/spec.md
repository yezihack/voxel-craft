# 在线卡顿优化：结构查询记忆化 + 区块本地方块缓存

Status: ready-for-agent

## Problem

线上（`https://voxel-craft-516.pages.dev/`）玩起来卡。用户提供的 Chrome 性能剖析显示：

| 指标 | 数值 |
|---|---|
| 录制总时长 | 11.25 s |
| 脚本执行 | 10,572 ms（**94%**） |
| 渲染 | 312 ms（2.8%） |
| 绘制 | 123 ms（1.1%） |
| 垃圾回收 | 22 ms |
| 样式 / 强制回流 | 6 ms / 0 ms |

**结论：不是 GPU 瓶颈，是主线程 JS 瓶颈。** 优化方向必须落在减少 CPU 侧的方块查询，
而不是降画质、减特效或缩渲染倍率。

### 根因链

用 `node --cpu-prof` 对「构建 64 个 chunk」采样，自耗时排序（前 5 项占 80%）：

```
21.9%  structAnchor  (dims.js:375)
20.1%  structAt      (dims.js:335)
 5.7%  structAnchor
 5.5%  structAt
 4.2%  oreVein      (fluid.js:847)
```

`structAnchor` + `structAt` 合计 **60% 自耗时**。追下去是三条放大路径：

1. **`structAnchor` 把 `structAt` 调了两遍**
   （`if (!structAt(gx, gz)) return null;` 一次、`type: structAt(gx, gz)` 又一次）。
   `structAt` 本身带一次 `colInfo` + 一次「锚点周围 9 点高度极差」抽查（9 次 `colHeight`）。

2. **`structAt` 完全无缓存**。它是 `(gx, gz)` 的纯函数（只依赖 `SEED` 与当前列高），
   而 4×4 区块窗口只覆盖 **25 个结构格** —— 缓存命中率接近 100%，却一次都没命中过。

3. **`getEffective` 每次都重扫结构与树**。`getEffective → getBlock → structBlockAt`，
   `structBlockAt` 扫 3×3 = 9 个结构格，每格一次 `structAnchor`（= 2 次 `structAt`）；
   再加 `treeBlockAt` 扫 5×5 = 25 棵树。
   而 `buildChunk` 每个方块要取 6 个面 + 每面 4 顶点 × 3 次 AO 采样
   = **每个实心方块约 78 次 `getEffective`**。

实测数字（`.scratch/perf/probe.mjs`）：

```
buildChunk：72.6 ms / chunk（24×16×24 = 9216 格）
→ 64 个 chunk = 4,644 ms
→ 每帧脏区块预算 4 个 → 最坏 290 ms/帧 → 3.4 fps 上限
```

玩家侧的直接体感：

| 场景 | 触发量 | 结果 |
|---|---|---|
| 走路撞到区块边界 | 16 个脏区块 | 每帧 535 ms → **1.9 fps** |
| 挖/放一个方块 | 1 个脏区块 | 单帧 87 ms → **11.5 fps** |
| 启动预构建 | 64 个 chunk | **4.6 秒** |

## Solution

分两层，互不依赖，可分别落地：

### P0：结构查询记忆化（`src/game/dims.js`）

- 给 `structAt(gx, gz)` 加一个 `Map` 缓存，键为 `gx + ',' + gz`。
- 缓存随 `SEED` / `flatWorld` 变化失效（换种子、换世界类型必须清）。
- `structAnchor` 改成**只调一次** `structAt`，复用其结果，不再调第二遍。
- 缓存容量上限与 `structShapeCache` 同量级（600），超了整表清（结构格密度低，清了也很快回填）。

**为什么安全**：`structAt` 是纯函数，判定只依赖 `(gx, gz)`、`SEED` 与该锚点的列信息。
`structAnchor` 注释里已声明「同一个格子在任何时刻问都给出同一个答案」。
换种子时 `generate()` 会 `setColCacheSeed` + `setColCache(new Map())`，
记忆化缓存必须跟着一起换桶 —— 否则会读到上一轮种子的结构类型。

### P1：区块本地方块缓存（`src/game/mesher.js`）

- `buildChunk` 开头先把 `(chunk 范围 + 1 格边)` 的方块 id 全部采样进一个
  `Int16Array`（26×18×26 = 12,168 项）。
- 之后面剔除与 AO 采样全部走数组下标，**不再调用 `getEffective`**。
- 边界：AO 采样最多偏移 1 格，所以 1 格边足够；数组越界会读到 `undefined`，
  必须确保索引始终落在 `[0, NX)` / `[0, NY)` / `[0, NZ)` 内。

**为什么安全**：地形是纯函数，`getEffective` 对同一坐标永远返回同一个 id。
采样一次与每次现算结果完全相同 —— `.scratch/perf/proto.mjs` 做了逐坐标对拍
（30,000 个坐标 0 不一致）与 64 个 chunk 的网格逐顶点对拍（0 不一致）。

### 实测收益（已落地并验证）

| 指标 | 优化前 | 优化后 | 提升 |
|---|---|---|---|
| 单 chunk 网格构建 | 72.6 ms | **12.3 ms** | 5.9× |
| 挖/放一个方块的帧耗时 | 87 ms | **11.7 ms** | 7.4× |
| 该帧帧率上限 | 11.5 fps | **85 fps** | 7.4× |
| 走路撞格（16 脏区块）分摊到每帧 | 535 ms | **48 ms** | 11× |
| 启动预构建 64 chunk | 4,644 ms | **~790 ms** | 5.9× |

数据来自 `.scratch/perf/after-frames.mjs`（浏览器真实加载的模块，非 Node 模拟）：
单 chunk 12.3 ms、挖方块脏 1 块、单帧 11.7 ms、3 秒内 **0 个 longtask**、零控制台报错。

#### 同机 A/B 对照（`git worktree` 检出优化前提交，同一台机器、同一浏览器串行测量）

为排除"机器负载不同"的干扰，用 `git worktree add ... HEAD~1` 检出一份优化前的源码，
在 5174 端口起独立 dev server，与 5173 端口的优化版**串行**跑同一个探针：

| 指标 | 优化前（HEAD~1） | 优化后（HEAD） | 提升 |
|---|---|---|---|
| 单 chunk 网格构建 | 153.6 ms | **13.7 ms** | **11.2×** |
| 挖一个方块 → 单帧重建 | 70.2 ms | **11.9 ms** | 5.9× |
| 该帧理论帧率上限 | 14 fps | **84 fps** | 6.0× |

> 本机 CPU 比首轮测量时更慢，所以这组"优化前"绝对值（153.6 ms）高于首轮（72.6 ms）；
> 但两端在同一台机器同一浏览器上串行测量，**比值**才是可信的。
> 结论：单 chunk 提升 11.2×，挖方块帧从 14 fps 恢复到 84 fps。

线上（`https://voxel-craft-516.pages.dev/`，`online-frames.mjs` 纯 DOM 测量）：
静置 47 帧 / 行走 43 帧，**longtask 0 个（总计 0ms）**、**>100ms 的帧 0 个**、零控制台报错。
（headless 是 SwiftShader 软件渲染，帧间隔 64~80ms 是 GPU 侧固定开销，不代表真实显卡表现；
> 但"主线程没有长任务"这一项与 GPU 无关，是可信的。）

Node 侧原型对比（`.scratch/perf/proto.mjs`，改动前的基线数据）：

| 方案 | 64 chunk 总耗时 | 单 chunk | 相对基线 |
|---|---|---|---|
| 基线 | 4,644 ms | 72.6 ms | 1× |
| P1（区块本地方块缓存） | 1,713 ms | 26.8 ms | **2.7×** |
| P1 + P0（+ 结构查询记忆化） | 891 ms | 13.9 ms | **5.2×** |

> 注：proto 脚本里的「基线」读的是**当时的**真实实现。代码改完后重跑，
> 基线那一栏会变成优化后的数字（11.3 ms/chunk），此时三栏趋于一致 ——
> 这本身就是「优化已生效」的自证。

帧内影响（每帧最多重建 4 个脏区块）：

| | 每帧最坏耗时 | 帧率上限 |
|---|---|---|
| 优化前 | 290 ms | 3.4 fps |
| 优化后 | **45 ms** | **22 fps** |

而实际代码已进一步改成**时间预算**（6 ms/帧），所以真实每帧占用被压到 6 ms 以内，
上面这张表是「预算失效时」的安全上限。

### 配套：把「按区块个数」改成「按时间预算」

`loop.js` 现在是固定 `budget = 4` 个区块/帧。P0+P1 之后单 chunk 13.9 ms，
4 个仍是 56 ms，仍会掉帧。改成**时间预算**（如 6 ms/帧）更稳：

- 每帧只重建「预算内能做完」的区块数，剩余留到下一帧。
- 配合 P1，区块重建被摊平到多帧，玩家看到的是「慢慢补齐」而不是「突然卡死」。

### 不建议做的事

- **降渲染倍率 / 关泛光 / 关 FXAA**：渲染只占 2.8%，砍它换不来 1 ms。
- **减少区块视距**（`VIEW_CX`/`VIEW_CZ` 从 4 降到 3）：区块总数 64 → 36，
  看着省一半，但视野边界会肉眼可见地推近，牺牲太大。
- **给 `getEffective` 加全局缓存**：它是**有状态**的
  （读 `edits` 覆盖层，玩家挖的方块必须立刻可见），全局缓存会返回过期方块。
  P1 的区块局部缓存没有这个问题 —— 它每次重建都重新采样。

## User Stories

1. 作为玩家，我走路撞到区块边界时不应该卡顿到 1.9 fps。
2. 作为玩家，我挖/放方块时那一帧不应该掉到 11 fps。
3. 作为玩家，开始游戏等待「地形就绪」的时间应该显著缩短。
4. 作为开发者，优化不能改变地形外观 —— 同一坐标的方块 id 必须与改动前逐一致。
5. 作为开发者，优化不能破坏结构 / 树的分布 —— 换种子后结构类型必须跟着变。

## Implementation

### 1. `src/game/dims.js` — P0 结构查询记忆化

在 `structAt` 之前加缓存层：

```js
/* 结构类型记忆化。structAt(gx,gz) 是纯函数（只依赖 SEED 与列高），
 * 而 4×4 区块窗口只覆盖 25 个结构格 —— 缓存命中率接近 100%。
 * 换种子 / 换世界类型必须换桶，否则会读到上一轮的判定。 */
const structTypeCache = new Map();
let structTypeSeed = null, structTypeFlat = null;
function ensureStructTypeCache() {
  if (structTypeSeed !== SEED || structTypeFlat !== flatWorld) {
    structTypeCache.clear();
    structTypeSeed = SEED; structTypeFlat = flatWorld;
  }
}
export function structAt(gx, gz) {
  ensureStructTypeCache();
  const key = gx + ',' + gz;
  const hit = structTypeCache.get(key);
  if (hit !== undefined) return hit;
  const v = structAtRaw(gx, gz);
  if (structTypeCache.size > 600) structTypeCache.clear();
  structTypeCache.set(key, v);
  return v;
}
```

`structAtRaw` 是原来的函数体（原样搬过去）。
`structAnchor` 改成调一次：

```js
export function structAnchor(gx, gz) {
  const type = structAt(gx, gz);          // 一次即可（原来调了两遍）
  if (!type) return null;
  const cx = gx * CELL + CELL / 2, cz = gz * CELL + CELL / 2;
  return { gx, gz, type, x: cx, z: cz, info: colInfo(cx, cz) };
}
```

⚠ `dims.js` 需要 import `flatWorld`（`state.js` 已有）。

### 2. `src/game/mesher.js` — P1 区块本地方块缓存

`buildChunk` 开头加采样，之后把 `getEffective(...)` 换成 `at(...)`：

```js
export function buildChunk(c) {
  const pos = [], uv = [], lit = [], alp = [], flag = [];
  const idxOpa = [], idxBlend = [];
  const x0 = c.min[0], y0 = c.min[1], z0 = c.min[2];

  /* 区块本地方块缓存。面剔除与 AO 采样要问 78 次/方块，
   * 每次都走 getEffective → 9 次结构扫描 + 25 次树扫描。
   * 这里先一次性采样 (chunk + 1 格边)，之后全走数组下标。
   * AO 最多偏移 1 格，所以 1 格边足够。 */
  const NX = CW + 2, NY = CH + 2, NZ = CD + 2;
  const cache = new Int16Array(NX * NY * NZ);
  for (let ly = 0; ly < NY; ly++)
    for (let lz = 0; lz < NZ; lz++)
      for (let lx = 0; lx < NX; lx++)
        cache[(ly * NZ + lz) * NX + lx] = getEffective(x0 + lx - 1, y0 + ly - 1, z0 + lz - 1);
  const at = (x, y, z) => cache[((y - y0 + 1) * NZ + (z - z0 + 1)) * NX + (x - x0 + 1)];
  ...
}
```

⚠ `CH` 是 config.js 里的常量名（区块高度），`buildChunk` 里已经 import 了。
⚠ `Int16Array` 足够：方块 id 最大 300 出头，远小于 32767。

### 3. `src/game/loop.js` — 脏区块预算改为时间预算

```js
/* 1) 构建脏区块：按**时间**预算而不是区块个数。
 *    单 chunk 重建现在约 14 ms，固定 4 个 = 56 ms 仍会掉帧；
 *    改成时间预算后，每帧最多花 6 ms，剩下的留到下一帧。 */
const BUILD_BUDGET_MS = 6;
let budgetStart = performance.now();
for (const c of chunks) {
  if (!c.dirty) continue;
  uploadChunk(c, buildChunk(c));
  if (performance.now() - budgetStart >= BUILD_BUDGET_MS) break;
}
```

## Testing

1. `npx vite build` 通过 —— 116 模块，index chunk 260.12 kB / gzip 98.91 kB（与优化前一致）。
2. `.scratch/perf/proto.mjs` —— 原型对拍：
   - 方块查询对拍 30,000 坐标，0 不一致；
   - 64 个 chunk 网格逐顶点对拍，0 不一致（顶点 4536 / 索引 6804 完全相同）。
3. `.scratch/perf/walk.mjs` —— 场景量化：走路平移脏 16 / 28 个区块；挖方块单帧 12 ms。
4. `.scratch/perf/after-frames.mjs` —— **浏览器端实测**（真实加载的模块）：
   单 chunk 12.3 ms、挖方块单帧 11.7 ms、3 秒内 0 个 longtask、零控制台报错。
5. 既有回归全过：`.scratch/mine-density/probe.mjs`（结构分布不变：矿井占比 20.1%）、
   `.scratch/mob-cap/probe.mjs`、`.scratch/spell-craft/probe.mjs`、
   `.scratch/boss/probe.mjs`、`.scratch/bots/probe.mjs`、
   `.scratch/portal-nudge/probe.mjs`、`.scratch/transport/probe.mjs`、
   `.scratch/flat-stick/probe.mjs`。
6. 线上探针 `.scratch/perf/online-frames.mjs`：零控制台报错。

## Out of Scope

- 不做 Web Worker 化网格构建（要动整个生成链的依赖方向，风险远大于收益）。
- 不做 GPU 侧优化（渲染只占 2.8%）。
- 不改地形生成参数、不改结构密度、不改视距。
- 不动存档格式与云端 D1。

## Notes

- **线上探针的局限**：headless 环境是 SwiftShader 软件渲染，
  实测「静置 15 fps」是软件光栅化造成的假象（longtask 只有 60 ms）。
  用户的真实 GPU 环境正常，所以卡顿全部体现在主线程 JS 上。
  本方案的数字全部来自 Node CPU profile 与无头探针（真实源码路径），
  不受软件渲染影响。
- **P0 的缓存失效点**：`SEED` 变（`generate()`）与 `flatWorld` 变
  （`setFlatWorld`）。`flatWorld` 变时也要清 —— 超平坦会改列高，
  而 `structAt` 的「泡在水里不建」判定依赖列高。
- **不要把 `getEffective` 全局缓存**。它读 `edits` 覆盖层，是有状态的。
- **`structShapeCache` 与 `structTypeCache` 是两回事**：前者缓存结构**形状**
  （Map of 坐标→方块），后者缓存结构**类型**（格子→类型）。两者都要留。
- 后续可考虑：把 `oreVein`（4.2% 自耗时）的矿脉噪声也记忆化，
  以及把 `treeAt` 的 5×5 邻域扫描改成按树格缓存。

## 附：探针清单

| 文件 | 作用 |
|---|---|
| `.scratch/perf/probe.mjs` | 量化 `getEffective` / 结构树查询 / `buildChunk` 成本 |
| `.scratch/perf/prof.mjs` | CPU profile 采样（`--cpu-prof`） |
| `.scratch/perf/parse.mjs` | 解析 `.cpuprofile`，输出自耗时排序 |
| `.scratch/perf/proto.mjs` | 优化原型 + 逐顶点对拍 + 性能对比 |
| `.scratch/perf/walk.mjs` | 走路 / 挖掘场景的卡顿量化 |
| `.scratch/perf/frame.mjs` | 每帧常驻开销 vs 触发式开销拆分 |
| `.scratch/perf/online-frames.mjs` | 线上帧时间与 longtask 分布 |
