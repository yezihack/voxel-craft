/* 世界数据：地形列缓存、生物群系、地表高度 —— 迁移自 voxel-craft.html 第 1258-1352 行 */

import { SEED, colCache, colCacheSeed, dim, setColCache, setColCacheSeed } from './state.js'
import { H, SEA } from './config.js'
import { dimColInfo } from './dims.js'
import { clamp, fbm } from './math.js'

/* ============================== 世界数据 ============================== */
/* 地形是**真无限**的：没有任何固定模板，getBlock(x,y,z) 对任意世界坐标
 * 现算一个方块 —— 而且必须是纯函数（同坐标同结果，与调用顺序、缓存状态无关），
 * 否则相邻区块各自算出的接缝会裂开。
 *
 * 分层结构（由粗到细）：
 *   1. 列信息 colInfo(x,z) —— 高度 + 生物群系。纯噪声函数，直接按世界坐标算。
 *   2. 石层   stoneAt(x,y,z) —— 矿脉 / 岩浆 / 苔石 / 圆石。
 *   3. 地表与水体 —— 按列高度与群系铺草/沙/雪、灌水结冰。
 *   4. 小装饰    —— 南瓜 / 胡萝卜 / 仙人掌，按列 hash 决定。
 *   5. 树木      —— 由「树格」决定：某个坐标是不是树、树的形状，
 *                   都只依赖树格自身 → 邻区块查询同一棵树会得到同样结果。
 *   6. 结构      —— 村庄 / 遗迹 / 矿井 / 神殿 / 神庙 / 雪屋，同样按「结构格」划分，
 *                   查询某方块时反查它周围 3×3 个结构格有没有覆盖它。
 *
 * 这样 getBlock 不需要任何全局缓存就能自洽 —— 区块放到哪、先构哪个，结果都一样。
 * `edits` 仍是玩家的覆盖层，优先级最高。 */

/* 列信息缓存：纯函数 + 记忆化。缓存只影响速度不影响结果，
 * 所以即便在区块预热阶段被清掉，重新算出来也完全一致。
 *
 * ⚠ 缓存必须跟着 SEED 一起换桶。SEED 是 `let`（generate(seed) 会重设它），
 * 而 colInfo 的全部分支都依赖 SEED —— 如果沿用一个 Map，换种子后旧坐标会
 * 直接命中上一轮 seed 算出来的 height/bio，出现「同一个坐标 surfaceBlockOf
 * 报沙漠、decoAt 却按平原算」这种自相矛盾。这里用 ensureColCache() 惰性换桶，
 * 比在每个调用点手动 clear 更省心。 */


export const COL_CACHE_MAX = 260000;
export function ensureColCache() {
  if (colCacheSeed !== SEED) { setColCache(new Map()); setColCacheSeed(SEED); }
}

/* 值域常量：地形的绝对上下界。与旧的 96×64×96 模板高度分布保持一致。 */
export const BEDROCK_Y = 0;                  // 基岩层
export const TERRAIN_MIN = 4;                // 最低地表
export const TERRAIN_MAX = H - 8;            // 最高地表

/* 某一列的高度与生物群系。**纯噪声函数**，不依赖任何全局状态（除了 SEED）。
 *
 * 现在多了一层：colInfo 是「当前维度」的入口，内部按 dim 分派到
 * overColInfo（主世界）或 dimColInfo（异界）。缓存键把 dim 混进低位 ——
 * 否则在主世界查过的坐标，切到异界再查会直接命中缓存，读到主世界的高度。 */
export function colInfo(x, z) {
  ensureColCache();
  const key = (x * 46349 + z) * 8 + dim;         // 整数坐标 + 维度 → 稳定键
  const hit = colCache.get(key);
  if (hit !== undefined) return hit;
  const info = dim === 0 ? overColInfo(x, z) : dimColInfo(dim, x, z);
  if (colCache.size >= COL_CACHE_MAX) colCache.clear();
  colCache.set(key, info);
  return info;
}

/* 主世界的列信息（原 colInfo 本体，逐字未动） */
export function overColInfo(x, z) {
  // 大陆起伏 + 细节 + 山脊（与旧模板同一套参数，保证地形手感不变）
  const base = fbm(x * 0.018, z * 0.018, SEED, 4);
  const detail = fbm(x * 0.075, z * 0.075, SEED + 501, 3);
  const ridge = 1 - Math.abs(fbm(x * 0.030, z * 0.030, SEED + 911, 3) * 2 - 1);
  const h = SEA + 2
    + (base - 0.5) * 22
    + (detail - 0.5) * 4
    + Math.pow(ridge, 3) * 11 * (base > 0.52 ? 1 : 0.25);
  const height = clamp(Math.round(h), TERRAIN_MIN, TERRAIN_MAX);

  /* 生物群系：温度 + 湿度，两个独立的低频噪声。
   * 这里最初写成 `1 - z / D * 0.75`（纬度条带），可 D 是模板边长 ——
   * 在无限世界里 z 会一路涨到几万，温度直接钳死成一个常数，全图只剩一个群系。
   * 改成低频噪声，让温度本身在空间上连续变化，才能走出「沙漠 → 平原 → 雪原」。
   *
   * 阈值必须按噪声实测分位数反解，不能凭直觉设。实测（±3000 范围、步长 7）：
   *   temp: p5=0.248  p20=0.367  p40=0.467  p50=0.510  p60=0.555  p80=0.660  p95=0.771
   *   wet : p5=0.237  p20=0.355  p44=0.472  p50=0.499  p80=0.643  p95=0.760
   * 旧口径 `tempN < 0.40 ? 雪 : (wet<0.44 && tempN>0.52 ? 沙漠 : 平原)` 实际只会产出
   * 「40% 雪 + 60% 平原」，沙漠与丛林恒为 0 —— 于是沙漠神殿、仙人掌、砂岩层
   * 这些东西在世界上根本不存在。改成按下表切分，四种群系都有可观面积：
   *   丛林 temp ≥ 0.60 且 wet ≥ 0.56   （高温高湿，约 12%）
   *   沙漠 temp ≥ 0.565 且 wet < 0.44  （高温干燥，约 8%）
   *   雪原 temp < 0.40                 （低温，约 22%） */
  const tempN = fbm(x * 0.006, z * 0.006, SEED + 77, 2);
  const wet = fbm(x * 0.025, z * 0.025, SEED + 313, 2);
  let bio;
  if (tempN < 0.40) bio = BIOME.SNOW;
  else if (tempN >= 0.60 && wet >= 0.56) bio = BIOME.JUNGLE;
  else if (tempN >= 0.565 && wet < 0.44) bio = BIOME.DESERT;
  else bio = BIOME.PLAIN;

  // 缓存在 colInfo 那一层统一做（键里含 dim），这里只负责算
  return { height, bio };
}
export const colHeight = (x, z) => colInfo(x, z).height;
/* 生物群系常量：0 平原 / 1 沙漠 / 2 雪原 / 3 丛林（潮湿高温） */
export const BIOME = { PLAIN: 0, DESERT: 1, SNOW: 2, JUNGLE: 3 };
