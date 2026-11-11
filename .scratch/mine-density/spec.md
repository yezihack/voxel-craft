# 让废弃矿井生成得更多一些

## 需求

> 让废弃矿井生成得更多一些。

口径：提高矿井在**世界里出现的数量**；不改矿井本身的形状 / 长度 / 战利品，不改存档格式，不把村庄、遗迹、神殿挤少。

## 根因

结构生成按 `CELL = 96` 的格子划分，每格用 `structAt(gx, gz)` 决定放什么，**一格最多一个结构**（`structAnchor` / `structShapeCache` 都按 `gx,gz` 单值缓存）。旧版 `structAt` 里矿井只有一条极窄的出口：

```js
if (r > 0.58) return 0;                  // 42% 的格子有结构（再扣掉水域）
...
if (bio === BIOME.SNOW)   return pick < 0.72 ? 6 : 7;   // 雪原：雪屋 / 冰屋
if (bio === BIOME.JUNGLE) return pick < 0.60 ? 5 : 3;   // 丛林：神庙 / 村庄
if (bio === BIOME.DESERT) return pick < 0.55 ? 4 : 2;   // 沙漠：神殿 / 遗迹
if (flat <= 4 && pick < 0.62) return 3;                 // 平原：村庄
if (pick < 0.80) return 2;                              // 平原：遗迹
return 1;                                               // 平原：废弃矿井
```

两条限制叠加：

1. **群系限制**：三种非平原群系在前面的分支里就 `return` 了，矿井只在平原生成。
2. **区间限制**：平原里也只有 `pick >= 0.80` 这 20% 落到矿井。

结果是「矿井数量 ≈ 结构格 × 平原占比 × 20%」。无头实测（24×24 格 × 5 个种子 = 2880 格）：结构格 1156、**矿井 115 条（4.0% 的格子、9.9% 的结构格）**，且 5 个种子的矿井群系全都是 `0`（平原）。

## 做法

只改 `src/game/dims.js` 的 `structAt`，用三个具名旋钮表达密度，不动 `collectMine` / `structBlockAt` / `structShapeCache` / `worldCensus` 任何一行：

```js
export const STRUCT_FILL = 0.66;      // 原 0.58
export const MINE_EXTRA = 0.10;       // 新增：独立 hash 划出的矿井份额
export const MINE_PLAIN_TAIL = 0.76;  // 原 0.80
```

- **独立 hash 分支**：在群系分支之前、`hash2(gx, gz, SEED + 9013) < MINE_EXTRA` 直接返回矿井。用独立 hash 是关键 —— 复用 `pick` 的话，每提高一分矿井率就等量吃掉一分村庄 / 遗迹；独立 hash 则只影响「这一格放不放地面结构」的抽样，配合下面的补偿可让其它结构不降。放在平整度抽查之前提前返回，还省掉 9 次 `colHeight`。
- **结构率补偿**：`STRUCT_FILL` 从 0.58 提到 0.66，把独立分支划走的份额补回其它结构。扣掉「泡在水里不建」之后，结构格占比实测从 40.1% 升到 46.5%。
- **平原残余**：`MINE_PLAIN_TAIL` 从 0.80 降到 0.76，平原里遗迹 / 矿井的分界从 20% 放宽到 24%。

`worldCensus()` 与开始面板的「N 条废弃矿井」提示走的是同一个 `structAt`，无需改动即自动反映新数量。

## 验证

`.scratch/mine-density/probe.mjs`：纯 Node，stub 掉 DOM / WebGL / 音频，地形与结构全用真实模块；扫 24×24 格 × 5 个种子。

| 项 | 旧版（红） | 新版（绿） |
| --- | --- | --- |
| 结构格 | 1156 | 1338 |
| **矿井** | **115** | **269（2.3 倍）** |
| 矿井占结构格 | 9.9% | 20.1% |
| 其它结构 | 1041 | 1069（不降） |
| 每种子的矿井数 | 19 / 27 / 24 / 26 / 19 | 47 / 50 / 60 / 54 / 58 |
| 矿井群系 | 仅平原 `0` | `0,1,2,3` 全覆盖 |

10 条断言全过：密度与占比、其它结构不低于旧基线 95%、跨群系、纯函数性、3×3 邻格反查命中矿井形状（区块接缝）、超平坦世界地下确能查到矿井挖出的空气与支架方块。

红阶段 4 条失败正是需求未达成的部分；另有 1 条是探针自身把随机采样点落在了没有结构的高度上，改为用已知矿井锚点在超平坦下确定性采样后通过。

## 取舍

- **仍是一格一结构**。矿井在几何上完全在地下、与地面建筑不冲突，让它与村庄共存需要改 `structAnchor` / `structShapeCache` 的 key / `inStructFootprint` / `worldCensus`，改动面明显更大。本次按「更多一些」取最小改动：靠独立 hash + 结构率补偿把数量提上来，代价是那 10% 被划走的格子不再有地面结构（已由结构率提升补足总量）。
- 地形是纯函数、不入档，本次改动对既有存档没有兼容问题；老档重新进游戏会按新分布看到更多矿井。
- 未改 `collectMine` 的 `len = 26`、支架间距、矿脉与箱子逻辑，矿井规模不变。

## 部署与线上验收

- 提交 `fc09aa6`（仅 `src/game/dims.js` 与本目录 probe / spec；并行会话的箱子系统改动未纳入）。
- 干净 worktree `voxel-craft-deploy-fc09aa6` 检出 HEAD、junction 主仓库 `node_modules` 后 `npx vite build`：`111 modules`，入口 `main-Dvb8pQ_l.js` 100.40 kB / gzip 39.52 kB，游戏 chunk `index-Dl5uXyaa.js` 247.70 kB / gzip 94.55 kB。
- `npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main` → `https://3d9cde5c.voxel-craft-516.pages.dev`；生产别名 `https://voxel-craft-516.pages.dev/` 已指向新入口 `/assets/main-Dvb8pQ_l.js`。
- `.scratch/mine-density/online-probe.mjs`（纯 DOM 真点击，系统 Chrome）**6/6 全过、零控制台报错**：HTTP 200 / 标题「方块世界」/ WebGL 正常 / 能进入游戏 / 开始面板仍有「N 条废弃矿井」统计项 / 线上产物含新标记 `9013`。

### 线上探针首版 3 条失败的坑

1. **等待文案误匹配**：未就绪提示是「等这一行变成「地形就绪」再点 🙂」，`/地形就绪/` 会立即命中，脚本在引擎没加载完就点开始按钮，连带「能进入游戏」也失败。改成 `/地形就绪（/`，用紧跟的全角左括号认真正的就绪文案「地形就绪（N 棵树 · …）」。
2. **动态 chunk 不在初始 resource 列表里**：`9013` 只出现在异步加载的游戏 chunk `index-Dl5uXyaa.js`，入口 `main-Dvb8pQ_l.js` 里只是一个引用名；只扫 `performance.getEntriesByType('resource')` 会漏掉。改成从入口 JS 文本正则解析 chunk 名，构造 `/assets/<name>` 显式 fetch 后一起找标记（本次命中第 2 个 JS，HTTP 200）。
3. **进游戏别用固定 sleep**：`StartVeil.vue` 是 `:class="{ hide: !ui.veilVisible }"` + `.veil.hide { display:none }`，改成 `waitForFunction` 等 `.veil` 挂上 `hide` 类 / `display:none`，超时 30s。

另：线上开始面板显示「**0 条废弃矿井**」不是回归 —— `worldCensus()` 的 `SAMPLE_N = 96`、`CELL = 96`，只枚举 `gx,gz ∈ {-1,0}` 共 4 个结构格；按 20.1% 占比期望 0.8 条，出 0 完全正常。密度证据以纯 Node 探针的 2880 格统计为准。
