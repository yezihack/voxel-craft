/* 世界生成入口：generate() / getEffective / setBlock / isSolid —— 迁移自 voxel-craft.html 第 1862-1951 行 */

import { dim, edits, flatWorld, setEdits } from './state.js'
import { BLOCKS, DIM_N, H, I, SEA, SOLID } from './config.js'
import { decoAt, dimBlockAt, stoneAt, structBlockAt, subsoilOf, surfaceBlockOf, treeBlockAt } from './dims.js'
import { fluid, fluidWake } from './fluid.js'
import { dirtyChunkOf } from './mesher.js'
import { BEDROCK_Y, BIOME, colInfo, FLAT_H } from './world.js'

/* ============================== 生成入口 ==============================
 * getBlock 就是「世界长什么样」的唯一真相。 */
export function getBlock(x, y, z) {
  const xi = x | 0, yi = y | 0, zi = z | 0;
  /* 异界整条走自己的生成器（含 y<0 / y>=H 的边界判断）——
   * 主世界那一支逐字未动，这是「加维度不破坏既有地形」的保证。 */
  if (dim !== 0) return dimBlockAt(dim, xi, yi, zi);
  if (yi < 0) return 3;                 // 世界底部视为实心，防止从下方掉出
  if (yi >= H) return 0;                // 上方是天空

  /* 超平坦：地表以上一律空气，地表以下只按深度分层。
   * 树、花草、南瓜、仙人掌、水——一律不生成，这是「超平坦」这个名字的承诺。
   * 但**村庄 / 遗迹 / 矿井照样生成**：结构格按 FLAT_H 选址，平地上照样能盖出
   * 房子和坑道。结构要放在最前面判（所有 y），因为村庄有地基、矿井整条在地下，
   * 只查地表那一层会只剩屋顶。 */
  if (flatWorld) {
    const s = structBlockAt(xi, yi, zi);
    if (s !== null) return s;
    if (yi > FLAT_H) return 0;
    if (yi === FLAT_H) return I.GRASS;
    if (yi > FLAT_H - 4) return I.DIRT;
    if (yi === BEDROCK_Y) return I.OBSIDIAN;
    return stoneAt(xi, yi, zi);
  }

  const info = colInfo(xi, zi);
  const h = info.height;

  if (yi > h) {
    // 地表以上：结构 → 树 → 装饰 → 水/空气
    const s = structBlockAt(xi, yi, zi);
    if (s !== null) return s;
    const t = treeBlockAt(xi, yi, zi);
    if (t !== null) return t;
    if (h < SEA && yi <= SEA) return (info.bio === BIOME.SNOW && yi === SEA) ? I.ICE : I.WATER;
    return decoAt(xi, yi, zi) | 0;
  }
  if (yi === h) {
    const s = structBlockAt(xi, yi, zi);
    if (s !== null) return s;
    return surfaceBlockOf(xi, zi, info);
  }
  // 地表以下：结构（地基/地下室）→ 基岩 → 表土 → 石层
  const s = structBlockAt(xi, yi, zi);
  if (s !== null) return s;
  if (yi === BEDROCK_Y) return I.OBSIDIAN;
  if (yi > h - 4) return subsoilOf(yi, h, info.bio);
  return stoneAt(xi, yi, zi);
}

/* 写出方块：记录到「覆盖层」，不改动程序化地形（保证地形可重建） */
/* 每个维度一张覆盖层 —— 否则在异界拆掉的方块会「长」回主世界同一个坐标。
 * `edits` 始终指向当前维度那一张（切维度时重新指向，见 switchDim）。 */
export const dimEdits = [];
for (let i = 0; i < DIM_N; i++) dimEdits.push(new Map());
setEdits(dimEdits[0]);

export const EKEY = (x, y, z) => x + ',' + y + ',' + z;

export function setBlock(x, y, z, id) {
  if (y < 0 || y >= H) return;
  const xi = x | 0, yi = y | 0, zi = z | 0;
  const k = EKEY(xi, yi, zi);
  const base = getBlock(xi, yi, zi);
  if (id === base) edits.delete(k);
  else edits.set(k, id);
  /* 这一格不再是水 → 水位记录必须一起清掉。
   * 漏了这句，玩家拿方块盖住一格流动水之后，那条 'x,y,z' → 水位 的记录会留在
   * 表里；等哪天盖子被挖掉，它会凭空「复活」成水。 */
  if (id !== I.WATER) fluid.delete(k);
  dirtyChunkOf(x, y, z);
  fluidWake(xi, yi, zi);      // 自己 + 6 邻居下一 tick 重新算水位
}
/* 兼容旧接口：地形生成阶段曾用 setBase 写模板。
 * 现在地形是纯函数、没有模板可写，于是退化为「相对地表写」——
 * 只对地表以上、且原本是空气的位置生效，避免把石头层挖穿。
 * 结构生成已全部改走 collect* 系列，这里只服务于少量遗留调用点。 */
export function setBase(x, y, z, id) {
  const xi = x | 0, yi = y | 0, zi = z | 0;
  if (!id) return;
  if (yi <= colInfo(xi, zi).height) return;
  setBlock(xi, yi, zi, id);
}

/* 合并读：覆盖层优先。烘焙进区块几何时用这个 */
export function getEffective(x, y, z) {
  /* y<0 交给 getBlock 定夺：主世界是实心底（防掉出世界），
   * 虚空维度必须是空气（不然踩空之后会掉在 y=0 的隐形地板上）。 */
  if (y < 0) return getBlock(x | 0, y | 0, z | 0);
  if (y >= H) return 0;
  const e = edits.get(EKEY(x | 0, y | 0, z | 0));
  if (e !== undefined) return e;
  return getBlock(x | 0, y | 0, z | 0);
}
export const isSolid = (id) => id > 0 && SOLID[id] === true;
/* 不透明 = 实体且不带半透明标记（玻璃/冰/水/岩浆都会让邻面保留，
 * 否则会从外面看到「贴在玻璃背面的石头」这种穿帮）。
 *
 * 带 shape 的方块（火把 / 铁轨 / 传送板）一律不算不透明：它们是格内薄片，
 * 只占一格里的薄层，不该遮挡任何邻面。否则会把相邻实心方块朝向它那一面
 * 当成「被挡住」而面剔除 —— 薄片背后没有几何遮挡，于是玩家透过火把就能
 * 看到那块被剔掉面的方块内部，即「火把透视」穿帮。 */
export const isOpaque = (id) => {
  if (!(id > 0)) return false;
  const B = BLOCKS[id];
  return !!B && !B.alpha && !B.liquid && !B.shape;
};
/* 同类半透明方块之间不画内部面（两块并排的玻璃只留外壳） */
export const isClearLike = (id) => { const B = BLOCKS[id]; return !!B && (!!B.alpha || !!B.liquid); };
export const isLiquid = (id) => { const B = BLOCKS[id]; return !!B && !!B.liquid; };
