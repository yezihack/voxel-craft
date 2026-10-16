/* 流体：水与岩浆的扩散模拟、地形装饰（树/矿脉/村庄/遗迹） —— 迁移自 voxel-craft.html 第 2107-2935 行 */

import { SEED, colCache, setColCache, setColCacheSeed, setSEED, setStructShapeCache } from './state.js'
import { H, I, SEA } from './config.js'
import { CELL, decoAt, stoneAt, structAt, treeAt } from './dims.js'
import { EKEY, getEffective, setBlock } from './generate.js'
import { fbm, hash2 } from './math.js'
import { dirtyChunkOf } from './mesher.js'
import { BIOME, colHeight, colInfo } from './world.js'

/* ============================== 流体 ==============================
 * 水会流：从「源头」出发，每 tick 沿水平方向扩散一格、水位 +1，最多 7 格
 * （FLUID_MAX）；遇到落差就垂直下落，下落水永远是满的。玩家挖掉一块石头，
 * 旁边的水顺着新露出的空洞流出来 —— 这就是本系统存在的意义。
 *
 * 状态怎么存：**不新增方块 id**（id 1..15 的名字与顺序被地形生成、DDA 射线、
 * 音效索引硬引用），而是另起一张稀疏表 fluid:'x,y,z' → 水位。
 *   · 表里没有、getEffective 又是水  → 源头（天然湖 / 玩家倒的水），永不干涸
 *   · 表里是 0                       → 下落水：满，但依赖上游，上游断了会消失
 *   · 表里是 1..7                    → 水平流动的水，数字越大水面越薄
 * 好处：天然地形里成千上万格海水一格记录都不占（它们全是源头）。
 *
 * 收敛机制：fluidActive =「下一 tick 要重算的格子」。每 tick 取一批，把每格的
 * 自己和 6 个邻居一起重算；只有真正变化的格子才会（经由 setBlock → fluidWake）
 * 把周围重新塞回集合。水位稳定后集合自然清空，之后零开销 —— 这不是「每帧扫
 * 全世界」，而是「谁被惊动才算谁」。
 *
 * 一条关键的推力规则：**只接受比自己水位更浅的邻居供水**（`n < mine`）。
 * 少了这个判断，水会互相「供养」——源头被堵住以后，两格流动水会看着对方说
 * 「你比我深，我可以靠你」，于是永远退不掉。加上它，水位单调收敛：
 * 数字只会变小（更满）或断供消失，绝不会自己变深。
 *
 * ⚠ setBlock 会调用本段的 fluidWake。函数声明会提升，所以顺序无碍，
 *   但别把本段挪到页面初始化流程之后。 */
export const FLUID_MAX = 7;                   // 水平最多流 7 格
export const FLUID_PERIOD = 0.15;             // 每 0.15 秒推进一格（7 格约 1.05 秒流完）
export const FLUID_CAP = 512;                 // 单 tick 最多展开多少格，防「一次性大洪水」卡帧
export const FLUID_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const fluid = new Map();               // 'x,y,z' → 水位 0..FLUID_MAX
export const fluidActive = new Set();         // 下一 tick 待重算的格子

/* 这一格的水位；-1 表示这里根本不是水 */
export function fluidLevelAt(x, y, z) {
  if (getEffective(x, y, z) !== I.WATER) return -1;
  const v = fluid.get(EKEY(x | 0, y | 0, z | 0));
  return v === undefined ? 0 : v;      // 无记录 = 源头 = 满
}
export const isWaterAt = (x, y, z) => getEffective(x, y, z) === I.WATER;

/* 水位 → 水面高度（0..1）。源头与下落水是满的 1.0，最薄的 7 级约 0.26。
 * 这个高度直接喂给 buildChunk：整格的顶点 y 按它缩放，水面看着就下沉了。 */
export function fluidHeightOf(level) {
  return level <= 0 ? 1 : 1 - (level / (FLUID_MAX + 1)) * 0.85;
}
/* 网格构建用。非水方块恒为 1 —— 于是「水以外的几何一个字节都不变」。 */
export function fluidHeightAt(x, y, z, id) {
  if (id !== I.WATER) return 1;
  const v = fluid.get(EKEY(x | 0, y | 0, z | 0));
  return v === undefined ? 1 : fluidHeightOf(v);
}

/* 水能流进哪些方块。只认空气 —— 保守但零风险：方块表里没有真正的草丛类方块
 * 可以安全替换，而放开到「带镂空的装饰」会让水吃掉仙人掌和南瓜。 */
export const fluidReplaceable = (id) => id === 0;

/* 惊动一格：它下一 tick 会被重算（连带 6 个邻居）。 */
export function fluidWake(x, y, z) {
  const xi = x | 0, yi = y | 0, zi = z | 0;
  if (yi < 0 || yi >= H) return;
  fluidActive.add(EKEY(xi, yi, zi));
}

/* 重算一格的水位并落地。返回 true 表示这一格真的变了。 */
export function fluidRecompute(x, y, z) {
  if (y < 0 || y >= H) return false;
  const cur = getEffective(x, y, z);
  const isW = cur === I.WATER;
  if (!isW && !fluidReplaceable(cur)) return false;    // 石头/木板之类，水进不去

  const k = EKEY(x, y, z);
  if (isW && !fluid.has(k)) return false;              // 源头：永远满，不参与重算
  const mine = isW ? fluid.get(k) : 99;                // 空气格视作「无限深」，谁都供给它

  let lv = 99;
  if (isWaterAt(x, y + 1, z)) lv = 0;                  // 头上落水 → 满（瀑布）
  for (const d of FLUID_DIRS) {
    const n = fluidLevelAt(x + d[0], y, z + d[1]);
    if (n >= 0 && n < mine && n + 1 < lv) lv = n + 1;  // 只接受更浅的邻居
  }

  if (lv > FLUID_MAX) {                                // 上游全断 → 退水
    if (!isW) return false;
    fluid.delete(k);
    setBlock(x, y, z, 0);
    return true;
  }
  if (isW && mine === lv) return false;                // 没变化
  fluid.set(k, lv);                                    // 先登记水位，再落地
  /* ⚠ 两条分支都要收尾，缺一个就是「水位变了但画面没变」：
   *   空气 → 水：走 setBlock（顺带标脏 + 惊动邻居）
   *   已经是水、只是水位变了（比如上游近了，7 级变 1 级）：几何也得重建，
   *   因为水面高度是按水位算出来的。这里漏掉的话，水会「看着还是厚的」，
   *   而逻辑测试全绿 —— 顶点 y 是在 buildChunk 里算的，不重建就还是老值。 */
  if (!isW) setBlock(x, y, z, I.WATER);                // 空地 → 水
  else dirtyChunkOf(x, y, z);                          // 水位变了 → 区块要重烘
  fluidWake(x, y, z);                                  // 下一 tick 连邻居一起再算
  return true;
}

/* 推进一次：把活跃集合展开成「自己 + 6 邻居」，逐个重算。
 * 变化的格子会经由 setBlock → fluidWake 回到活跃集合，于是水一格格往外走。 */
export function fluidTick() {
  if (!fluidActive.size) return false;
  const batch = [...fluidActive];
  fluidActive.clear();
  const todo = new Set();
  let used = 0;
  for (const k of batch) {
    if (used >= FLUID_CAP) { fluidActive.add(k); continue; }   // 超预算的留到下一 tick
    used++;
    const c = k.split(',');
    const x = +c[0], y = +c[1], z = +c[2];
    todo.add(k);
    for (const d of FLUID_DIRS) todo.add(EKEY(x + d[0], y, z + d[1]));
    todo.add(EKEY(x, y - 1, z));
    todo.add(EKEY(x, y + 1, z));
  }
  let changed = 0;
  for (const k of todo) {
    const c = k.split(',');
    if (fluidRecompute(+c[0], +c[1], +c[2])) changed++;
  }
  return changed > 0;
}

/* 主循环驱动：按固定周期推进，与帧率解耦（否则高刷屏上水流得快、截图也不确定） */
export let fluidAcc = 0;
export function updateFluid(dt) {
  fluidAcc += dt;
  if (fluidAcc < FLUID_PERIOD) return;
  fluidAcc = 0;
  fluidTick();
}

/* ------------------------------ 结构：按需铺块 ------------------------------
 * 全部 collect* 函数都只做一件事：把「这个结构占用的方块」推进 out 数组，
 * 元素是 [x, y, z, id]。谁调用、什么时候调用都不影响结果。
 *
 * 与旧版的三点关键差异：
 *   1. 不再有 W/D 边界判断 —— 世界无限，结构可以铺到任何坐标（含负数）。
 *   2. 不再有 structMask / siteTaken 这类全局占位表 —— 结构间距由「一格一结构」
 *      的划分天然保证，跨格重叠在物理上不可能发生。
 *   3. 地基回填不再用 heights 数组（那是模板时代的产物），改用 colHeight(x,z)
 *      现查列高，逐列贴地。 */
export const rndAt = (x, y, z, seed) => hash2(x * 7 + y * 13, z * 11 + y * 3, seed);

/* 结构锚点周围的地面：最高点（用来当基准面）。
 * 单独抽出来是因为「地基垫平」这一步到处都要用。 */
export function anchorGround(a, r) {
  let mx = -1e9;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const h = colHeight(a.x + dx, a.z + dz);
      if (h > mx) mx = h;
    }
  return mx;
}

/* ---- 一间木屋 ---- */
export function emitHouse(out, x, z, w, d, g, seed) {
  const wh = 3;                                     // 墙高
  // 地基：把 footprint 垫平，免得房子悬在半坡上
  for (let dz = -1; dz <= d; dz++)
    for (let dx = -1; dx <= w; dx++) {
      const ax = x + dx, az = z + dz;
      const gy = colHeight(ax, az);
      for (let y = gy + 1; y <= g; y++) out.push([ax, y, az, I.PLANK]);
    }
  // 地板 + 掏空内部
  for (let dz = 0; dz < d; dz++)
    for (let dx = 0; dx < w; dx++) {
      out.push([x + dx, g, z + dz, I.PLANK]);
      for (let y = g + 1; y <= g + wh; y++) out.push([x + dx, y, z + dz, 0]);
    }
  // 四面墙
  for (let y = g + 1; y <= g + wh; y++) {
    for (let dx = 0; dx < w; dx++) {
      out.push([x + dx, y, z, I.PLANK]);
      out.push([x + dx, y, z + d - 1, I.PLANK]);
    }
    for (let dz = 0; dz < d; dz++) {
      out.push([x, y, z + dz, I.PLANK]);
      out.push([x + w - 1, y, z + dz, I.PLANK]);
    }
  }
  // 四角立柱
  for (const c of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]])
    for (let y = g; y <= g + wh; y++) out.push([x + c[0], y, z + c[1], I.LOG]);
  // 门（开在南墙）
  const doorX = x + 1 + Math.floor(rndAt(x, 1, z, seed + 5) * Math.max(1, w - 2));
  out.push([doorX, g + 1, z, 0]);
  out.push([doorX, g + 2, z, 0]);
  // 窗：四面墙各开一到两扇（小房子也要透光，别只有两块玻璃）
  const wy = g + 2;
  const putGlass = (gx, gz) => out.push([gx, wy, gz, I.GLASS]);
  for (let dx = 1; dx < w - 1; dx++) {
    if (w >= 4 || dx % 2 === 1) { putGlass(x + dx, z); putGlass(x + dx, z + d - 1); }
  }
  for (let dz = 1; dz < d - 1; dz++) {
    if (d >= 4 || dz % 2 === 1) { putGlass(x, z + dz); putGlass(x + w - 1, z + dz); }
  }
  // 门框两侧各补一扇，保证最少也有 6 块玻璃
  putGlass(x + w - 1, z + 1);
  putGlass(x, z + d - 2);
  // 双坡屋顶：逐层向内收
  const top = g + wh;
  for (let k = 0; k <= Math.floor((d - 1) / 2); k++) {
    const y = top + 1 + k;
    const z0 = z - 1 + k, z1 = z + d - k;
    if (z0 > z1) break;
    for (let dx = -1; dx <= w; dx++)
      for (let dz = z0; dz <= z1; dz++) out.push([x + dx, y, z + dz, I.DARKPLANK]);
  }
  // 室内陈设：灯 + 床 + 书架
  out.push([x + w - 2, top, z + d - 2, I.LAMP]);
  out.push([x + 1, g + 1, z + d - 2, I.WOOL_RED]);
  out.push([x + 2, g + 1, z + d - 2, I.WOOL_RED]);
  out.push([x + w - 2, g + 1, z + 1, I.BOOKSHELF]);
}

/* ---- 一片农田：水渠 + 作物垄 ---- */
export function emitFarm(out, x, z, w, d, g) {
  for (let dz = 0; dz < d; dz++)
    for (let dx = 0; dx < w; dx++) {
      const ax = x + dx, az = z + dz;
      const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      if (edge) {                                   // 围一圈木栅栏
        out.push([ax, g + 1, az, I.LOG]);
        continue;
      }
      // 隔行挖一条水渠，其余种胡萝卜
      if (dz % 3 === 1) {
        out.push([ax, g, az, I.WATER]);
      } else {
        out.push([ax, g, az, I.DIRT]);
        out.push([ax, g + 1, az, I.CARROT]);
      }
    }
}

/* ---- 铁匠铺：熔炉状的墙 + 满屋建材 ---- */
export function emitSmithy(out, x, z, g, seed) {
  const w = 7, d = 6;
  for (let dz = -1; dz <= d; dz++)
    for (let dx = -1; dx <= w; dx++) {
      const ax = x + dx, az = z + dz;
      const gy = colHeight(ax, az);
      for (let y = gy + 1; y <= g; y++) out.push([ax, y, az, I.COBBLE]);
    }
  // 石砖墙 + 深色木梁
  for (let y = g + 1; y <= g + 4; y++) {
    for (let dx = 0; dx < w; dx++) {
      out.push([x + dx, y, z, y === g + 3 ? I.DARKPLANK : I.STONEBRICK]);
      out.push([x + dx, y, z + d - 1, y === g + 3 ? I.DARKPLANK : I.STONEBRICK]);
    }
    for (let dz = 0; dz < d; dz++) {
      out.push([x, y, z + dz, y === g + 3 ? I.DARKPLANK : I.STONEBRICK]);
      out.push([x + w - 1, y, z + dz, y === g + 3 ? I.DARKPLANK : I.STONEBRICK]);
    }
  }
  for (const c of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]])
    for (let y = g; y <= g + 4; y++) out.push([x + c[0], y, z + c[1], I.LOG]);
  // 掏空内部
  for (let dz = 1; dz < d - 1; dz++)
    for (let dx = 1; dx < w - 1; dx++) {
      out.push([x + dx, g, z + dz, I.STONEBRICK]);
      for (let y = g + 1; y <= g + 3; y++) out.push([x + dx, y, z + dz, 0]);
    }
  // 门口
  out.push([x + 3, g + 1, z, 0]);
  out.push([x + 3, g + 2, z, 0]);
  // 熔炉（岩浆槽）+ 矿石堆
  out.push([x + 1, g + 1, z + 1, I.LAVA]);
  out.push([x + 1, g + 2, z + 1, I.COBBLE]);
  out.push([x + w - 2, g + 1, z + 1, rndAt(x, 5, z, seed) > 0.5 ? I.IRON : I.COAL]);
  out.push([x + w - 2, g + 1, z + 2, I.IRON]);
  out.push([x + 2, g + 1, z + d - 2, I.QUARTZ]);
  out.push([x + 3, g + 1, z + d - 2, I.QUARTZ]);
  // 屋顶
  for (let y = g + 5; y <= g + 6; y++)
    for (let dx = -1; dx <= w; dx++)
      for (let dz = -1; dz <= d; dz++) out.push([x + dx, y, z + dz, I.DARKPLANK]);
}

/* ---- 教堂：尖顶 + 彩窗 ---- */
export function emitChurch(out, x, z, g, seed) {
  const w = 7, d = 9;
  for (let dz = -1; dz <= d; dz++)
    for (let dx = -1; dx <= w; dx++) {
      const ax = x + dx, az = z + dz;
      const gy = colHeight(ax, az);
      for (let y = gy + 1; y <= g; y++) out.push([ax, y, az, I.STONEBRICK]);
    }
  for (let dz = 0; dz < d; dz++)
    for (let dx = 0; dx < w; dx++) {
      out.push([x + dx, g, z + dz, I.QUARTZ]);
      for (let y = g + 1; y <= g + 6; y++) out.push([x + dx, y, z + dz, 0]);
    }
  // 四面高墙
  for (let y = g + 1; y <= g + 6; y++) {
    for (let dx = 0; dx < w; dx++) {
      out.push([x + dx, y, z, I.STONEBRICK]);
      out.push([x + dx, y, z + d - 1, I.STONEBRICK]);
    }
    for (let dz = 0; dz < d; dz++) {
      out.push([x, y, z + dz, I.STONEBRICK]);
      out.push([x + w - 1, y, z + dz, I.STONEBRICK]);
    }
  }
  // 彩窗：羊毛当彩色玻璃
  const wool = [I.WOOL_RED, I.WOOL_BLUE, I.WOOL_YELLOW, I.WOOL_GREEN];
  for (let k = 0; k < 4; k++) {
    const dz = 1 + k * 2;
    out.push([x, g + 3, z + dz, wool[k]]);
    out.push([x, g + 4, z + dz, wool[k]]);
    out.push([x + w - 1, g + 3, z + dz, wool[(k + 2) % 4]]);
    out.push([x + w - 1, g + 4, z + dz, wool[(k + 2) % 4]]);
  }
  // 大门
  out.push([x + 3, g + 1, z, 0]);
  out.push([x + 3, g + 2, z, 0]);
  out.push([x + 3, g + 3, z, I.GLASS]);
  // 尖顶：逐层收拢到一格
  for (let k = 0; k <= 6; k++) {
    const y = g + 7 + k;
    const span = 5 - k;
    if (span < 0) break;
    const cx0 = x + 3 - Math.floor(span / 2), cx1 = x + 3 + Math.floor(span / 2);
    const cz0 = z + 4 - Math.floor(span / 2), cz1 = z + 4 + Math.floor(span / 2);
    for (let ax = cx0; ax <= cx1; ax++)
      for (let az = cz0; az <= cz1; az++) out.push([ax, y, az, I.DARKPLANK]);
  }
  // 讲台 + 萤石
  out.push([x + 3, g + 1, z + d - 2, I.QUARTZ]);
  out.push([x + 3, g + 4, z + d - 3, I.LAMP]);
}

/* ---- 村庄：木屋 + 农田 + 铁匠铺 + 教堂 ---- */
export function collectVillage(a, out) {
  const seed = SEED + Math.imul(a.gx, 31) + a.gz * 17;
  const cx = a.x, cz = a.z;
  const g0 = anchorGround(a, 12);

  // 几间木屋围成一圈
  const n = 3 + Math.floor(rndAt(cx, 11, cz, seed + 31) * 3);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rndAt(cx + i, 13, cz, seed) * 0.6;
    const r = 9 + rndAt(cx, i, cz, seed + 41) * 6;
    const hx = Math.round(cx + Math.cos(ang) * r);
    const hz = Math.round(cz + Math.sin(ang) * r);
    const w = 5 + (rndAt(hx, 1, hz, seed) > 0.5 ? 1 : 0);
    const d = 5;
    let g = -1e9, ok = true;
    for (let dz = 0; dz < d && ok; dz++)
      for (let dx = 0; dx < w && ok; dx++) {
        const h = colHeight(hx + dx, hz + dz);
        if (h <= SEA) ok = false;
        if (h > g) g = h;
      }
    if (!ok) continue;
    emitHouse(out, hx, hz, w, d, Math.max(g, g0 - 1), seed + i * 17);
  }

  // 广场：石砖铺地 + 中心灯柱
  const pr = 3;
  for (let dz = -pr; dz <= pr; dz++)
    for (let dx = -pr; dx <= pr; dx++) {
      const ax = cx + dx, az = cz + dz;
      const h = colHeight(ax, az);
      if (h <= SEA) continue;
      out.push([ax, h, az, I.STONEBRICK]);
      for (let y = h + 1; y <= h + 3; y++) out.push([ax, y, az, 0]);
    }
  out.push([cx, colHeight(cx, cz) + 1, cz, I.LOG]);
  out.push([cx, colHeight(cx, cz) + 2, cz, I.GLOW]);

  // 农田（挪到广场东侧）
  const fx = cx + 8, fz = cz - 4;
  const fg = colHeight(fx, fz);
  if (fg > SEA) emitFarm(out, fx, fz, 9, 8, fg);

  // 铁匠铺 & 教堂（西侧 + 南侧）
  const sx = cx - 13, sz = cz + 8;
  if (colHeight(sx, sz) > SEA) emitSmithy(out, sx, sz, colHeight(sx, sz), seed + 77);
  const chx = cx + 4, chz = cz + 16;
  if (colHeight(chx, chz) > SEA) emitChurch(out, chx, chz, colHeight(chx, chz), seed + 91);
}

/* ---- 遗迹：半埋石砖残塔 + 断墙 ---- */
export function collectRuin(a, out) {
  const seed = SEED + Math.imul(a.gx, 37) + a.gz * 23;
  const cx = a.x, cz = a.z;
  const w = 5, d = 5;
  const g = anchorGround(a, 3);
  if (g <= SEA) return;
  const tall = 7 + Math.floor(rndAt(cx, 21, cz, seed + 61) * 8);
  for (let dz = 0; dz < d; dz++)
    for (let dx = 0; dx < w; dx++) {
      const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      if (!edge) continue;                              // 中空
      const lc = colHeight(cx + dx, cz + dz);
      for (let y = lc; y <= g - 1; y++)
        out.push([cx + dx, y, cz + dz, rndAt(cx + dx, y, cz + dz, seed + 67) < 0.42 ? I.MOSS : I.STONEBRICK]);
      let gapRun = 0;
      for (let k = 0; k < tall; k++) {
        const y = g - 1 + k;
        if (y < 2) continue;
        const decay = k / tall;
        const skip = rndAt(cx + dx, k, cz + dz, seed + 71) < decay * 0.62 ||
          (y > g + 1 && rndAt(cx + dx, k + 99, cz + dz, seed) < 0.22);
        if (skip) { if (++gapRun > 2) break; continue; }
        gapRun = 0;
        out.push([cx + dx, y, cz + dz, rndAt(cx + dx, k, cz + dz, seed + 83) < 0.38 ? I.MOSS : I.STONEBRICK]);
      }
    }
  // 断墙：从塔基向外延伸
  for (let s = 0; s < 3; s++) {
    const dir = Math.floor(rndAt(cx, 31 + s, cz, seed) * 4);
    const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
    const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
    const len = 3 + Math.floor(rndAt(cx + s, 37, cz, seed) * 5);
    for (let i = 2; i < len; i++) {
      const ax = cx + dx * i, az = cz + dz * i;
      const h = colHeight(ax, az);
      for (let k = 0; k < 3; k++) {
        if (rndAt(ax, k + s, az, seed + 91) < 0.30) continue;
        out.push([ax, h + k, az, rndAt(ax, k, az, seed + 97) < 0.45 ? I.MOSS : I.STONEBRICK]);
      }
    }
  }
}

/* ---- 废弃矿井：地下坑道 + 木支架 ---- */
export function collectMine(a, out) {
  const seed = SEED + Math.imul(a.gx, 41) + a.gz * 29;
  const alongX = rndAt(a.gx, 7, a.gz, seed + 409) > 0.5;
  const len = 26;
  const x0 = a.x - (alongX ? len >> 1 : 0);
  const z0 = a.z - (alongX ? 0 : len >> 1);

  // 顶板厚度：量走廊正上方地面最低点，把矿井压在它下面 6 格
  let shMin = 1e9;
  for (let k = 0; k < len; k++) {
    const ax = alongX ? x0 + k : x0;
    const az = alongX ? z0 : z0 + k;
    for (let s = -2; s <= 2; s++) {
      const bx = alongX ? ax : ax + s, bz = alongX ? az + s : az;
      const h = colHeight(bx, bz);
      if (h < shMin) shMin = h;
    }
  }
  const top = shMin - 6;
  if (top < 10) return;                                  // 地面太薄，放不下
  const y = 8 + Math.floor(rndAt(a.gx, 3, a.gz, seed + 401) * (top - 8 + 1));

  for (let i = 0; i < len; i++) {
    const cx = alongX ? x0 + i : x0;
    const cz = alongX ? z0 : z0 + i;
    // 挖 3×3 的洞
    for (let s = -1; s <= 1; s++) {
      const ax = alongX ? cx : cx + s;
      const az = alongX ? cz + s : cz;
      for (let k = 0; k < 3; k++) out.push([ax, y + k, az, 0]);
    }
    // 每 4 格一对原木柱 + 顶梁
    if (i % 4 === 0) {
      const a1x = alongX ? cx : cx - 1, a1z = alongX ? cz - 1 : cz;
      const a2x = alongX ? cx : cx + 1, a2z = alongX ? cz + 1 : cz;
      for (let k = 0; k < 3; k++) {
        out.push([a1x, y + k, a1z, I.LOG]);
        out.push([a2x, y + k, a2z, I.LOG]);
      }
      for (let s = -1; s <= 1; s++) {
        const bx = alongX ? cx : cx + s;
        const bz = alongX ? cz + s : cz;
        out.push([bx, y + 3, bz, I.PLANK]);
      }
      if (rndAt(cx, y, cz, seed + 111) > 0.7)
        out.push([a1x, y + 2, alongX ? cz - 2 : a1z, I.GLOW]);
    }
  }
  // 侧壁换矿脉
  for (let i = 0; i < len; i++) {
    const cx = alongX ? x0 + i : x0;
    const cz = alongX ? z0 : z0 + i;
    for (const s of [-2, 2]) {
      const ax = alongX ? cx : cx + s;
      const az = alongX ? cz + s : cz;
      for (let k = 0; k < 3; k++) {
        const yy = y + k;
        const base = stoneAt(ax, yy, az);
        if (base !== I.STONE) continue;                  // 只把石头换成矿
        const r = rndAt(ax, yy, az, seed + 131);
        if (r > 0.92) out.push([ax, yy, az, I.COAL]);
        else if (r > 0.86) out.push([ax, yy, az, I.IRON]);
        else if (r > 0.845 && yy < 12) out.push([ax, yy, az, I.GOLD]);
      }
    }
  }
}

/* ---- 沙漠神殿：砂岩金字塔 + 顶部神殿 + 地下陷阱暗室 ---- */
export function collectDesertTemple(a, out) {
  const seed = SEED + Math.imul(a.gx, 43) + a.gz * 31;
  const cx = a.x, cz = a.z;
  const g = anchorGround(a, 9);
  if (g <= SEA + 1) return;
  const half = 9;

  // 台基
  for (let dz = -half; dz <= half; dz++)
    for (let dx = -half; dx <= half; dx++)
      for (let y = 0; y < 4; y++) out.push([cx + dx, g - y, cz + dz, I.SANDSTONE]);

  // 四层逐级收拢的金字塔
  for (let lvl = 0; lvl < 4; lvl++) {
    const r = half - lvl * 2;
    const y0 = g + 1 + lvl * 4;
    for (let y = y0; y < y0 + 4; y++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;   // 只砌外壳，中空
          out.push([cx + dx, y, cz + dz, I.SANDSTONE]);
        }
    // 该层地板
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) out.push([cx + dx, y0 - 1, cz + dz, I.SANDSTONE]);
  }

  // 顶部神殿本体
  const ty = g + 1 + 4 * 4;
  for (let y = ty; y < ty + 4; y++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const wall = Math.abs(dx) === 3 || Math.abs(dz) === 3;
        out.push([cx + dx, y, cz + dz, wall ? I.SANDSTONE : (y === ty ? I.QUARTZ : 0)]);
      }
  // 四角塔楼
  for (const c of [[-3, -3], [3, -3], [-3, 3], [3, 3]])
    for (let y = ty + 4; y < ty + 8; y++) out.push([cx + c[0], y, cz + c[1], I.SANDSTONE]);
  // 门口
  out.push([cx, ty, cz + 3, 0]);
  out.push([cx, ty + 1, cz + 3, 0]);
  // 宝箱：金块 + 萤石
  out.push([cx, ty + 1, cz, I.GOLD]);
  out.push([cx + 1, ty + 1, cz, I.GOLD]);
  out.push([cx, ty + 2, cz, I.GLOW]);
  out.push([cx - 2, ty + 1, cz - 2, I.DIAMOND]);
  out.push([cx + 2, ty + 1, cz + 2, I.REDSTONE]);

  // 地下暗室 + 陷阱（掉进去就陷在岩浆上）
  const by = g - 14;
  if (by > 10) {
    for (let dz = -4; dz <= 4; dz++)
      for (let dx = -4; dx <= 4; dx++) {
        for (let y = by; y <= by + 4; y++)
          out.push([cx + dx, y, cz + dz, (Math.abs(dx) === 4 || Math.abs(dz) === 4) ? I.SANDSTONE : 0]);
        out.push([cx + dx, by - 1, cz + dz, I.SANDSTONE]);
      }
    // 竖井：从台基中心通到暗室，井口那一格是活板（这里是空气，踩上去就掉）
    for (let y = by; y <= g; y++) out.push([cx + 3, y, cz + 3, 0]);
    // 暗室里铺岩浆 + 四角宝物
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) out.push([cx + dx, by, cz + dz, I.LAVA]);
    out.push([cx - 3, by + 1, cz - 3, I.GOLD]);
    out.push([cx + 3, by + 1, cz - 3, I.DIAMOND]);
    out.push([cx - 3, by + 1, cz + 3, I.REDSTONE]);
    out.push([cx + 3, by + 1, cz + 3, I.GOLD]);
  }
  if (rndAt(cx, 9, cz, seed + 5) > 2) out.push([cx, ty + 5, cz, I.GLOW]);   // 永不生效，占位保运行
}

/* ---- 丛林神庙：苔石塔 + 藤蔓 + 宝箱房 ---- */
export function collectJungleTemple(a, out) {
  const seed = SEED + Math.imul(a.gx, 47) + a.gz * 37;
  const cx = a.x, cz = a.z;
  const g = anchorGround(a, 11);
  if (g <= SEA + 1) return;

  // 底座平台
  for (let dz = -10; dz <= 10; dz++)
    for (let dx = -10; dx <= 10; dx++)
      for (let y = g - 1; y <= g + 1; y++)
        out.push([cx + dx, y, cz + dz, (y === g + 1 && (Math.abs(dx) > 7 || Math.abs(dz) > 7)) ? I.MOSS : I.STONEBRICK]);

  // 主塔：三层，每层收一格
  for (let lvl = 0; lvl < 3; lvl++) {
    const r = 6 - lvl * 2;
    const y0 = g + 2 + lvl * 5;
    for (let y = y0; y < y0 + 5; y++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const wall = Math.abs(dx) === r || Math.abs(dz) === r;
          if (!wall) { out.push([cx + dx, y, cz + dz, 0]); continue; }
          // 墙面挂藤蔓（用树叶当植被）
          const vine = hash2(cx + dx, (cz + dz) * 3 + y, seed + 3) > 0.72;
          out.push([cx + dx, y, cz + dz, vine ? I.LEAF : (hash2(dx, dz, seed) > 0.5 ? I.MOSS : I.STONEBRICK)]);
        }
    // 层间地板
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) out.push([cx + dx, y0 - 1, cz + dz, I.STONEBRICK]);
    // 门口
    out.push([cx, y0 + 1, cz + r, 0]);
    out.push([cx, y0 + 2, cz + r, 0]);
  }

  // 顶部宝箱
  const ty = g + 2 + 15;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) out.push([cx + dx, ty, cz + dz, I.STONEBRICK]);
  out.push([cx, ty + 1, cz, I.DIAMOND]);
  out.push([cx + 1, ty + 1, cz, I.GOLD]);
  out.push([cx - 1, ty + 1, cz, I.GOLD]);
  out.push([cx, ty + 1, cz + 1, I.REDSTONE]);
  out.push([cx, ty + 1, cz - 1, I.REDSTONE]);
  out.push([cx, ty + 3, cz, I.GLOW]);

  // 地下宝库（藏在塔基正下方）
  const by = g - 12;
  if (by > 8) {
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        for (let y = by; y <= by + 3; y++)
          out.push([cx + dx, y, cz + dz, (Math.abs(dx) === 3 || Math.abs(dz) === 3) ? I.MOSS : 0]);
        out.push([cx + dx, by - 1, cz + dz, I.STONEBRICK]);
      }
    out.push([cx, by + 1, cz, I.DIAMOND]);
    out.push([cx + 1, by + 1, cz, I.GOLD]);
    out.push([cx - 1, by + 1, cz, I.GOLD]);
    out.push([cx, by + 2, cz, I.GLOW]);
  }
}

/* ---- 雪屋：雪块圆顶 + 冰窗 + 地下小室 ---- */
export function collectIgloo(a, out) {
  const seed = SEED + Math.imul(a.gx, 53) + a.gz * 41;
  const cx = a.x, cz = a.z;
  const g = anchorGround(a, 5);
  if (g <= SEA) return;

  // 半球形雪屋：逐层收拢的圆环
  const R = 5;
  for (let y = 0; y <= 5; y++) {
    // 每一层按球面方程算半径
    const ry = Math.sqrt(Math.max(0, R * R - y * y));
    const r = Math.round(ry);
    if (r <= 0) { out.push([cx, g + 1 + y, cz, I.SNOW]); continue; }
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + 0.5) continue;
        const shell = d2 >= (r - 1) * (r - 1);
        out.push([cx + dx, g + 1 + y, cz + dz, shell ? I.SNOW : 0]);
      }
  }
  // 地板 + 门口
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++)
      if (dx * dx + dz * dz <= R * R) out.push([cx + dx, g, cz + dz, I.SNOW]);
  for (let y = 1; y <= 2; y++) out.push([cx, g + y, cz + R, 0]);
  // 冰窗
  out.push([cx + R - 1, g + 3, cz, I.ICE]);
  out.push([cx - R + 1, g + 3, cz, I.ICE]);
  out.push([cx, g + 3, cz + R - 1, I.ICE]);
  // 室内：床 + 灯
  out.push([cx - 2, g + 1, cz - 2, I.WOOL_RED]);
  out.push([cx - 1, g + 1, cz - 2, I.WOOL_RED]);
  out.push([cx, g + 4, cz, I.GLOW]);

  // 地下小室（冰屋下方的密室）
  const by = g - 9;
  if (by > 8) {
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        for (let y = by; y <= by + 2; y++)
          out.push([cx + dx, y, cz + dz, (Math.abs(dx) === 2 || Math.abs(dz) === 2) ? I.SNOW : 0]);
        out.push([cx + dx, by - 1, cz + dz, I.SNOW]);
      }
    // 竖梯：从雪屋地板通到地下
    for (let y = by; y <= g; y++) out.push([cx - 1, y, cz - 1, 0]);
    out.push([cx + 1, by + 1, cz + 1, I.GOLD]);
    out.push([cx - 1, by + 1, cz + 1, I.IRON]);
    out.push([cx, by + 2, cz, I.GLOW]);
  }
}

/* ---- 雪原聚落：几间雪屋 + 篝火 ---- */
export function collectSnowVillage(a, out) {
  const seed = SEED + Math.imul(a.gx, 59) + a.gz * 43;
  const cx = a.x, cz = a.z;
  const n = 3 + Math.floor(rndAt(cx, 3, cz, seed) * 2);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rndAt(cx + i, 5, cz, seed) * 0.7;
    const r = 8 + rndAt(cx, i, cz, seed + 7) * 5;
    const hx = Math.round(cx + Math.cos(ang) * r);
    const hz = Math.round(cz + Math.sin(ang) * r);
    if (colHeight(hx, hz) <= SEA) continue;
    const g = colHeight(hx, hz);
    const sub = { x: hx, z: hz, gx: a.gx * 3 + i, gz: a.gz * 3 + i };
    collectIglooAt(sub, out, g);
  }
  // 中央篝火
  const g0 = colHeight(cx, cz);
  if (g0 > SEA) {
    out.push([cx, g0 + 1, cz, I.LOG]);
    out.push([cx, g0 + 2, cz, I.LAVA]);
    out.push([cx + 1, g0 + 1, cz, I.LOG]);
    out.push([cx - 1, g0 + 1, cz, I.LOG]);
    out.push([cx, g0 + 1, cz + 1, I.LOG]);
    out.push([cx, g0 + 1, cz - 1, I.LOG]);
  }
}
/* 在指定坐标盖一座雪屋（供聚落复用）。 */
export function collectIglooAt(a, out, gArg) {
  const seed = SEED + Math.imul(a.gx, 53) + a.gz * 41;
  const cx = a.x, cz = a.z;
  const g = gArg === undefined ? anchorGround(a, 5) : gArg;
  if (g <= SEA) return;
  const R = 4;
  for (let y = 0; y <= 4; y++) {
    const r = Math.round(Math.sqrt(Math.max(0, R * R - y * y)));
    if (r <= 0) { out.push([cx, g + 1 + y, cz, I.SNOW]); continue; }
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + 0.5) continue;
        out.push([cx + dx, g + 1 + y, cz + dz, d2 >= (r - 1) * (r - 1) ? I.SNOW : 0]);
      }
  }
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++)
      if (dx * dx + dz * dz <= R * R) out.push([cx + dx, g, cz + dz, I.SNOW]);
  for (let y = 1; y <= 2; y++) out.push([cx, g + y, cz + R, 0]);
  out.push([cx + R - 1, g + 3, cz, I.ICE]);
  out.push([cx - 2, g + 1, cz - 2, I.WOOL_RED]);
  out.push([cx, g + 3, cz, I.GLOW]);
}

/* ------------------------------ 出生点 ------------------------------
 * 地表最高的干燥位置，围绕原点找一圈。 */
export function findSpawn() {
  let bx = 0, bz = 0, best = -1;
  for (let z = -24; z <= 24; z++)
    for (let x = -24; x <= 24; x++) {
      const info = colInfo(x, z);
      if (info.height <= SEA + 1) continue;              // 别生在水里
      if (info.bio === BIOME.DESERT) continue;           // 也别生在沙漠正中央
      const d = Math.abs(x) + Math.abs(z);
      if (info.height > best && d < 26) { best = info.height; bx = x; bz = z; }
    }
  if (best < 0) { bx = 0; bz = 0; best = colHeight(0, 0); }
  return [bx + 0.5, best + 2.2, bz + 0.5];
}

/* ------------------------------ 世界统计 ------------------------------
 * 无限世界没有「全图」可以扫，于是统计改成「采样」：
 * 在原点周围取一块 S×S 的样方，把各特征的密度换算成「每 100×100 格多少个」。
 * 这样数值与旧版模板时代的量级可直接对比，测试阈值也不用大改。 */
export const SAMPLE_N = 96;                   // 样方面积与旧模板同尺寸，便于沿用旧阈值
export function worldCensus() {
  const half = SAMPLE_N >> 1;          // 以原点为中心
  let trees = 0, villages = 0, ruins = 0, mines = 0;
  let temples = 0, jungles = 0, igloos = 0, snowVills = 0;
  let oreCount = 0, lavaCount = 0;
  let cacti = 0;                      // 仙人掌柱（按列数，不是格子数）
  let blocks = 0;

  // 结构：按格子枚举（每格最多一个），统计样方内的
  const gc0 = Math.floor(-half / CELL), gc1 = Math.floor((half - 1) / CELL);
  for (let gz = gc0; gz <= gc1; gz++)
    for (let gx = gc0; gx <= gc1; gx++) {
      const t = structAt(gx, gz);
      if (!t) continue;
      if (t === 1) mines++;
      else if (t === 2) ruins++;
      else if (t === 3) villages++;
      else if (t === 4) temples++;
      else if (t === 5) jungles++;
      else if (t === 6) igloos++;
      else if (t === 7) snowVills++;
    }

  // 树：按列 hash 判定（与 treeAt 同源）
  for (let z = -half; z < half; z++)
    for (let x = -half; x < half; x++) {
      if (treeAt(x, z)) trees++;
      const info = colInfo(x, z);
      const h = info.height;
      blocks += h + 1;
      /* 仙人掌是「柱」不是「格」：decoAt 在地表上一格返回柱底，往上每一格都返回它。
       * 只按柱底那一格计数，才和「丛」这个量词对得上 —— 否则一根三格高的柱子算三次。 */
      if (decoAt(x, h + 1, z) === I.CACTUS) cacti++;
      // 矿脉统计：只抽 4 层代表值，避免 96×96×64 全扫太慢
      for (let y = 1; y < h; y += 7) {
        if (y > h - 4) continue;
        const id = stoneAt(x, y, z);
        if (id === I.COAL || id === I.IRON || id === I.GOLD || id === I.DIAMOND || id === I.REDSTONE) oreCount++;
        else if (id === I.LAVA) lavaCount++;
      }
    }
  // 采样是按 step=7 抽的，换算回全量
  return {
    trees, villages, ruins, mines, temples, jungles, igloos, snowVills, cacti,
    oreCount: Math.round(oreCount * 7), lavaCount: Math.round(lavaCount * 7),
    blocks, area: SAMPLE_N * SAMPLE_N,
  };
}
/* 兼容旧调用点：generate(seed) 现在只是校验 seed 并把 colCache 清干净。
 * 地形不再需要「一次性生成」。 */
export function generate(seed) {
  if (seed !== undefined) setSEED(seed);
  setColCacheSeed(SEED);
  setColCache(new Map());
  setStructShapeCache(new Map());
  return worldCensus();
}

/* 矿脉噪声：把 y 混进两个轴，让矿脉在纵向也连成团块，而不是水平薄片 */
export function oreVein(x, y, z, off) {
  return fbm(x * 0.13 + y * 0.21, z * 0.13 - y * 0.17, SEED + off, 2);
}

/* 深层岩浆：只在最底部几层 */
export function lavaAt(x, y, z) {
  if (y > 4) return 0;
  return fbm(x * 0.05, z * 0.05, SEED + 8863, 2) > 0.55 ? I.LAVA : 0;
}
