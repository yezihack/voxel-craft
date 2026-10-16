/* 维度档案：8 个维度的地形参数、方块读写、装饰与结构格 —— 迁移自 voxel-craft.html 第 1353-1861 行 */

import { SEED, structShapeCache } from './state.js'
import { D, DIM_N, H, I, PORTAL_BLOCK, SEA } from './config.js'
import { collectDesertTemple, collectIgloo, collectJungleTemple, collectMine, collectRuin, collectSnowVillage, collectVillage, lavaAt, oreVein } from './fluid.js'
import { EKEY, isSolid } from './generate.js'
import { clamp, fbm, hash2 } from './math.js'
import { BEDROCK_Y, BIOME, TERRAIN_MAX, TERRAIN_MIN, colHeight, colInfo } from './world.js'

/* ============================== 维度档案 ==============================
 * 一个维度 = 一整套参数：地形形态、方块配色、天空、雾、环境光、重力、
 * 刷怪池、致死高度。世界本身没有存档（地形是纯函数、改动记在 edits 覆盖层），
 * 所以「换维度」= 换一组参数 + 换一张 edits 表 + 让所有区块重建，
 * 不需要搬动任何体素数据。
 *
 * 为什么主世界那一项几乎全是 null：null 一律解释成「不覆盖，走既有逻辑」，
 * 于是 dim === 0 时的代码路径与「没有维度系统」时逐字一致 ——
 * 375 项回归能原样跑通，靠的就是这条。
 *
 * gen 决定列函数（见 dimColInfo）：
 *   'over'    主世界（走 overColInfo，本表不参与）
 *   'hills'   起伏地形（熔火/霜寂/腐化/炙沙共用，只差参数）
 *   'island'  浮空岛（虚空/花园共用）：height < 0 表示这一列整列是空的
 *   'crystal' 实心晶簇岩 + 球状洞窟（晶簇洞天）
 *
 * 天空三种模式，由两个字段的组合唯一决定：
 *   skyNight === null        → 永远白天（炙沙之境 / 天空花园）
 *   fixedNight === true      → 永远夜/常暗（熔火 / 虚空 / 霜寂 / 晶簇）
 *   其余                      → 跟随昼夜插值（主世界 / 腐化沼泽）
 */


export const DIMS = [
  /* ---------------- 0 主世界（基准，全 null = 不覆盖） ---------------- */
  { name: '主世界', icon: '🌿', gen: 'over',
    gravity: 1, voidY: null, fog: [40, 100, SEA + 4],
    skyDay: null, skyNight: null, fixedNight: false, ambient: null,
    alwaysNight: false, alwaysDay: false,
    pool: null, passive: null, deco: null,
    surface: 0, subsoil: 0, stone: 0, seaBlock: null },

  /* ---------------- 1 熔火深渊 ----------------
   * 起伏剧烈的玄武岩台地，海平面以下全是岩浆。天空常年暗红、太阳不落不升，
   * 所以敌对生物常驻。踩进岩浆照旧被烧 —— 走的是原有的 hot 机制，没新增规则。 */
  { name: '熔火深渊', icon: '🔥', gen: 'hills',
    hBase: SEA + 4, hAmp: 27, hFreq: 0.020,
    gravity: 1, voidY: null, fog: [26, 76, SEA + 12],
    skyDay:   { top: [0.30, 0.07, 0.05], hor: [0.88, 0.30, 0.10], gnd: [0.26, 0.06, 0.05] },
    skyNight: { top: [0.16, 0.04, 0.03], hor: [0.50, 0.15, 0.06], gnd: [0.14, 0.03, 0.04] },
    fixedNight: true, ambient: 0.84,
    alwaysNight: true, alwaysDay: false,
    pool: ['zombie', 'creeper', 'spider', 'skeleton'], passive: [], deco: 'pillar',
    surface: I.BASALT, subsoil: I.BASALT, stone: I.BASALT, seaBlock: I.LAVA },

  /* ---------------- 2 虚空群岛 ----------------
   * 末地石浮空岛 + 紫黑星空 + 低重力（0.55 倍，跳得高、落得慢）。
   * 脚下踩空就是坠落：voidY 一生效，y < 0 就不再是主世界那样的实心底，
   * 而是空气，掉到 -24 直接死。 */
  { name: '虚空群岛', icon: '🌌', gen: 'island',
    hBase: 26, hThick: 15, hFreq: 0.017, hMask: 0.548,
    gravity: 0.55, voidY: -24, fog: [34, 96, SEA + 8],
    skyDay:   { top: [0.03, 0.02, 0.09], hor: [0.16, 0.08, 0.26], gnd: [0.05, 0.03, 0.11] },
    skyNight: { top: [0.02, 0.01, 0.06], hor: [0.11, 0.05, 0.19], gnd: [0.03, 0.02, 0.08] },
    fixedNight: true, ambient: 0.68,
    alwaysNight: true, alwaysDay: false,
    pool: ['skeleton', 'spider', 'zombie'], passive: [], deco: null,
    surface: I.ENDSTONE, subsoil: I.ENDSTONE, stone: I.ENDSTONE, seaBlock: null },

  /* ---------------- 3 霜寂永夜 ----------------
   * 永远的黑夜 + 冰封雪原。海平面整个结冰（seaBlock = ICE），湖面可以直接走 ——
   * 比「水面结一层冰、底下还是水」简单，但走在冰原上的效果是一样的。 */
  { name: '霜寂永夜', icon: '❄️', gen: 'hills',
    hBase: SEA + 5, hAmp: 12, hFreq: 0.018,
    gravity: 1, voidY: null, fog: [46, 132, SEA + 8],
    skyDay:   { top: [0.05, 0.07, 0.16], hor: [0.16, 0.20, 0.34], gnd: [0.06, 0.08, 0.14] },
    skyNight: { top: [0.03, 0.04, 0.11], hor: [0.10, 0.13, 0.24], gnd: [0.04, 0.05, 0.11] },
    fixedNight: true, ambient: 0.62,
    alwaysNight: true, alwaysDay: false,
    pool: ['zombie', 'skeleton', 'spider'], passive: [], deco: 'spike',
    surface: I.SNOW, subsoil: I.DIRT, stone: I.STONE, seaBlock: I.ICE },

  /* ---------------- 4 晶簇洞天 ----------------
   * 一整块发光的晶簇岩被挖出成片的球状洞窟。没有天空可用（雾极近 + 全黑），
   * 照明全靠晶簇岩自身发光。落点找的是天花板**下方**的洞窟内部。 */
  { name: '晶簇洞天', icon: '💎', gen: 'crystal',
    hCeil: 46, caveTh: 0.545,
    gravity: 1, voidY: null, fog: [9, 46, 0],
    skyDay:   { top: [0.05, 0.04, 0.10], hor: [0.09, 0.07, 0.16], gnd: [0.03, 0.02, 0.06] },
    skyNight: { top: [0.03, 0.03, 0.07], hor: [0.06, 0.05, 0.12], gnd: [0.02, 0.02, 0.05] },
    fixedNight: true, ambient: 0.74,
    alwaysNight: true, alwaysDay: false,
    pool: ['zombie', 'spider', 'creeper'], passive: [], deco: null,
    surface: I.CRYSTAL, subsoil: I.CRYSTAL, stone: I.CRYSTAL, seaBlock: null },

  /* ---------------- 5 腐化沼泽 ----------------
   * 低平洼地，大片毒沼（液体 + 接触伤害），巨型红蘑菇。天光浑浊黄绿。
   * 唯一一个昼夜照常的异界：白天安全、入夜才出怪。 */
  { name: '腐化沼泽', icon: '🍄', gen: 'hills',
    hBase: SEA + 1, hAmp: 9, hFreq: 0.024,
    gravity: 1, voidY: null, fog: [30, 86, SEA + 6],
    skyDay:   { top: [0.22, 0.26, 0.18], hor: [0.44, 0.50, 0.30], gnd: [0.16, 0.18, 0.13] },
    skyNight: { top: [0.05, 0.07, 0.05], hor: [0.12, 0.16, 0.10], gnd: [0.04, 0.05, 0.04] },
    fixedNight: false, ambient: null,
    alwaysNight: false, alwaysDay: false,
    pool: ['zombie', 'slime_large', 'spider', 'creeper'],
    passive: ['pig', 'sheep', 'chicken'], deco: 'mushroom',
    surface: I.MOSS, subsoil: I.DIRT, stone: I.STONE, seaBlock: I.TOXIC },

  /* ---------------- 6 炙沙之境 ----------------
   * 高沙丘 + 永不落山的烈日。因为永昼，敌对生物**永不刷新** ——
   * 唯一一个可以放心裸奔的维度，代价是除了沙和仙人掌什么也没有。 */
  { name: '炙沙之境', icon: '🏜️', gen: 'hills',
    hBase: SEA + 10, hAmp: 20, hFreq: 0.026,
    gravity: 1, voidY: null, fog: [60, 190, SEA + 14],
    skyDay:   { top: [0.36, 0.52, 0.86], hor: [0.94, 0.86, 0.62], gnd: [0.50, 0.44, 0.32] },
    skyNight: null, fixedNight: false, ambient: 1.06,
    alwaysNight: false, alwaysDay: true,
    pool: [], passive: ['pig', 'sheep', 'chicken'], deco: 'cactus',
    surface: I.SAND, subsoil: I.SANDSTONE, stone: I.SANDSTONE, seaBlock: null },

  /* ---------------- 7 天空花园 ----------------
   * 悬在半空的花园岛：草皮、乔木、0.72 倍重力。踩空同样坠入虚空。 */
  { name: '天空花园', icon: '🌤️', gen: 'island',
    hBase: 34, hThick: 13, hFreq: 0.019, hMask: 0.512,
    gravity: 0.72, voidY: -24, fog: [56, 176, SEA + 26],
    skyDay:   { top: [0.30, 0.58, 0.95], hor: [0.72, 0.86, 0.99], gnd: [0.44, 0.52, 0.60] },
    skyNight: null, fixedNight: false, ambient: 1.02,
    alwaysNight: false, alwaysDay: true,
    pool: ['zombie', 'spider'], passive: ['pig', 'sheep', 'chicken'], deco: 'tree',
    surface: I.GRASS, subsoil: I.DIRT, stone: I.STONE, seaBlock: null },
];
for (let i = 0; i < DIMS.length; i++) DIMS[i].id = i;
if (DIMS.length !== DIM_N) throw new Error('DIMS 数量与 DIM_N 不一致');
/* 每个维度都有门吗 —— 没有就永远进不去，早失败早发现 */
for (let i = 0; i < DIM_N; i++) if (!PORTAL_BLOCK[i]) throw new Error('维度 ' + i + ' 没有传送门方块');

/* ---- 异界的列信息 ----
 * 与主世界 overColInfo 同构，额外多一个 bottom：浮空岛的下边界。
 * height < 0 是「这一列整列是空的」（浮空群岛的岛间空隙）。 */
export function dimColInfo(d, x, z) {
  const D = DIMS[d];
  if (D.gen === 'hills') {
    const f = fbm(x * D.hFreq, z * D.hFreq, SEED + 1201 + d * 331, 4);
    const det = fbm(x * 0.085, z * 0.085, SEED + 1301 + d * 337, 3);
    const h = D.hBase + (f - 0.5) * D.hAmp + (det - 0.5) * 4;
    return { height: clamp(Math.round(h), TERRAIN_MIN, TERRAIN_MAX), bio: BIOME.PLAIN, bottom: BEDROCK_Y };
  }
  if (D.gen === 'island') {
    const m = fbm(x * D.hFreq, z * D.hFreq, SEED + 2201 + d * 401, 3);
    if (m < D.hMask) return { height: -1, bio: BIOME.PLAIN, bottom: 0 };   // 岛外：整列空气
    const k = (m - D.hMask) / (1 - D.hMask);            // 0 岛缘 → 1 岛心
    const det = fbm(x * 0.11, z * 0.11, SEED + 2301 + d * 407, 2);
    const top = Math.round(D.hBase + k * D.hThick + (det - 0.5) * 5);
    const thick = 3 + k * 9 + det * 2;                  // 岛心更厚，岛缘薄到一两格
    return { height: clamp(top, TERRAIN_MIN, TERRAIN_MAX), bio: BIOME.PLAIN,
             bottom: Math.max(1, Math.round(top - thick)) };
  }
  if (D.gen === 'crystal') {
    const f = fbm(x * 0.05, z * 0.05, SEED + 3201 + d * 409, 2);
    return { height: clamp(Math.round(D.hCeil + (f - 0.5) * 6), TERRAIN_MIN, TERRAIN_MAX),
             bio: BIOME.PLAIN, bottom: BEDROCK_Y };
  }
  return { height: 0, bio: BIOME.PLAIN, bottom: BEDROCK_Y };
}

/* 晶簇洞天的洞窟判据。**纯噪声、不递归** —— 它会被相邻格查询（判断某格是不是
 * 洞窟地板），一旦写成「调用 dimBlockAt 再 isSolid」就会在整列被挖空的柱子里
 * 一路递归到 y=5，每查一格都是几十层调用。 */
export function dimCarved(d, x, y, z) {
  const D = DIMS[d];
  if (y < 5 || y > D.hCeil - 2) return false;           // 上下各留一层壳，别挖穿世界
  return fbm(x * 0.042 + y * 0.035, z * 0.042 - y * 0.029, SEED + 3301 + d * 409, 3) > D.caveTh;
}

/* ---- 异界方块读写（**维度显式传入**，不读全局 dim）----
 * 这一点很关键：找落点、建返回门都要在「还没切过去」的时候读目标维度的地形，
 * 如果内部读全局 dim，算出来的就是当前维度的地貌。 */
export function dimBlockAt(d, x, y, z) {
  if (y < 0) return DIMS[d].voidY !== null ? 0 : I.OBSIDIAN;   // 虚空维度：下面是空的
  if (y >= H) return 0;
  const D = DIMS[d];
  const info = dimColInfo(d, x, z);
  const h = info.height, bot = info.bottom;
  if (h < 0) return 0;                                  // 浮空群岛的岛间空隙
  if (y > h) {
    const dec = dimDecoAt(d, x, y, z);
    if (dec) return dec;
    if (D.seaBlock && h < SEA && y <= SEA) return D.seaBlock;
    return 0;
  }
  if (y < bot) return 0;                                // 岛体之下：虚空
  if (D.gen === 'crystal') {
    if (dimCarved(d, x, y, z)) {
      /* 洞窟地板上长出晶簇：下方那格没被挖空（= 是地板）+ 哈希命中。
       * 用 dimCarved 直接判，不回头查 dimBlockAt（见上面那段递归警告）。 */
      if (!dimCarved(d, x, y - 1, z) && hash2(x * 31 + y, z * 17 + y, SEED + d * 613) < 0.10)
        return I.CRYSTAL;
      return 0;
    }
    return y === BEDROCK_Y ? I.OBSIDIAN : I.CRYSTAL;
  }
  if (y === h) return D.surface;
  if (y > h - 4) return D.subsoil;
  if (y === BEDROCK_Y) return I.OBSIDIAN;
  return D.stone;
}

/* ---- 异界装饰（柱 / 冰刺 / 仙人掌 / 巨蘑菇 / 树）----
 * 分格生成 + 锚点「反查」：只有落在锚点列（及其冠幅）上的格才长东西。
 * ⚠ 锚点被限制在格子的内圈，冠幅（≤2）就**永远越不出自己这一格** ——
 * 于是查询 (x,z) 只需要看它所属的那一个格，不用扫 3×3 邻格。
 * 见过「冠幅跨格 → 查询必须扫邻格 → 每个空气格 ×9 次哈希」的写法，
 * 在区块重建里是纯浪费。 */
export const DECO_CELL = 9;
export function dimDecoAt(d, x, y, z) {
  const D = DIMS[d];
  if (!D.deco) return 0;
  const gx = Math.floor(x / DECO_CELL), gz = Math.floor(z / DECO_CELL);
  const rs = SEED + d * 977;
  if (hash2(gx, gz, rs) > 0.36) return 0;
  const ax = gx * DECO_CELL + 3 + Math.floor(hash2(gx, gz, rs + 1) * 3);
  const az = gz * DECO_CELL + 3 + Math.floor(hash2(gx, gz, rs + 2) * 3);
  const dx = x - ax, dz = z - az;
  const info = dimColInfo(d, ax, az);
  if (info.height < 0) return 0;
  if (D.seaBlock && info.height < SEA) return 0;         // 别长在水里
  const local = y - (info.height + 1);
  if (local < 0) return 0;
  const pick = hash2(gx, gz, rs + 3);
  switch (D.deco) {
    case 'pillar':                                        // 熔火：玄武岩柱
      return local < 2 + Math.floor(pick * 4) && dx === 0 && dz === 0 ? I.BASALT : 0;
    case 'spike':                                         // 霜寂：冰刺
      return local < 2 + Math.floor(pick * 4) && dx === 0 && dz === 0 ? I.ICE : 0;
    case 'cactus':                                        // 炙沙：仙人掌
      return local < 2 + Math.floor(pick * 2) && dx === 0 && dz === 0 ? I.CACTUS : 0;
    case 'mushroom': {                                    // 腐化：巨型红蘑菇
      if (dx !== 0 || dz !== 0) {
        const dy = local - 3;                             // 菌盖只出现在锚点周围
        if (dy < 0 || dy > 1) return 0;
        const rad = dy === 0 ? 2 : 1;
        return Math.abs(dx) <= rad && Math.abs(dz) <= rad ? I.WOOL_RED : 0;
      }
      return local < 3 ? I.MUSHROOM : (local <= 4 ? I.WOOL_RED : 0);
    }
    case 'tree': {                                        // 花园：乔木
      if (dx !== 0 || dz !== 0) {
        const dy = local - 4;
        if (dy < 0 || dy > 2) return 0;
        const rad = dy === 2 ? 1 : 2;
        return Math.abs(dx) <= rad && Math.abs(dz) <= rad ? I.LEAF : 0;
      }
      return local <= 3 ? I.LOG : (local <= 5 ? I.LEAF : 0);
    }
  }
  return 0;
}

/* 异界里「脚下一格实心、上面两格空气」的最高位置。
 * 晶簇洞天要的是洞窟**内部**，所以从天花板往下扫而不是从世界顶往下扫 ——
 * 否则会被放到晶洞的岩壳顶上，一睁眼是漆黑的虚空。 */
export function dimSurfaceY(d, x, z) {
  const crys = DIMS[d].gen === 'crystal';
  const sol = (yy) => isSolid(dimBlockAt(d, x | 0, yy, z | 0));
  for (let y = crys ? 40 : H - 2; y >= 2; y--) {
    if (!sol(y)) continue;
    if (sol(y + 1) || sol(y + 2)) continue;
    return y;
  }
  return null;
}

/* 首次进入某维度时的落点：从原点向外一圈圈找。找不到就放弃（返回 null） */
export function findDimEntry(d) {
  for (let r = 0; r <= 88; r += 2) {
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
      const y = dimSurfaceY(d, x, z);
      if (y === null) continue;
      return [x + 0.5, y + 1.2, z + 0.5];
    }
  }
  return null;
}

/* 石头层内容。与旧模板一致，只是坐标直接就是世界坐标。
 *
 * 阈值一律「实测分位数反解」，不能凭直觉设 —— 而且必须按**判定顺序**逐层实测，
 * 因为前一层的命中会把后一层的候选吃掉（钻石层整段嵌在金层的 y 区间里）。
 *
 * 旧参数的问题：`钻石 > 0.8515` 看着比 `金 > 0.8991` 松，但钻石层只有 6 层、
 * 金有 10 层还叠加在钻石之上，实测出来「钻石 456 > 金 98」，稀有度顺序整个反掉。
 * 另一头煤的旧阈值 `> 0.8398` 配 58 层厚的窗口，实测煤 2017 直接反超铁 821。
 *
 * 现在按下面这张实测表校准（96×96 地下样方内的真实命中数）：
 *   钻石 22 · 金 48 · 红石 186 · 铁 448 · 煤 ~590
 * 单调递增，符合「越贵重越稀有」。注意煤的阈值比铁**松**（0.8730 < 0.8950）——
 * 反直觉但正确：煤的判定不带 y 上限，58 层全参与，每层命中率必须更低才能
 * 让总量落在铁之上。 */
export function stoneAt(x, y, z) {
  const lava = lavaAt(x, y, z);
  if (lava) return lava;
  if (y <  8 && oreVein(x, y, z, 8801) > 0.9455) return I.DIAMOND;
  if (y < 12 && oreVein(x, y, z, 8807) > 0.9200) return I.GOLD;
  if (y < 18 && oreVein(x, y, z, 8819) > 0.9050) return I.REDSTONE;
  if (y < 26 && oreVein(x, y, z, 8821) > 0.8950) return I.IRON;
  if (oreVein(x, y, z, 8837) > 0.8730) return I.COAL;
  if (oreVein(x, y, z, 8849) > 0.8461) return I.MOSS;
  return fbm(x * 0.14, (z + y * 7) * 0.14, SEED + 4242, 2) > 0.62 ? I.COBBLE : I.STONE;
}

/* ------------------------------ 结构格 ------------------------------
 * 结构不能再用「开局扫全图摆一遍」的做法了 —— 无限世界没有「全图」。
 * 改成按格（CELL×CELL 的世界方格）划分：每个格子用 hash 决定自己有没有结构、
 * 结构锚点在哪，且锚点**吸附在格心**。
 *
 * 于是「某个方块 (x,y,z) 属不属于某个结构」可以这样判：
 * 反查它所在的格 + 周围 3×3 格（因为结构半径都小于一格宽），
 * 对每个候选结构把它的方块铺出来比对。每个结构的形状都只依赖它自己的锚点，
 * 跟查询顺序无关 —— 纯函数性因此保住，区块接缝不会裂。 */
export const CELL = 96;                      // 结构格边长

/* 结构类型判定。所有约束（群系、高度、平整度）都写在里面，
 * 保证「同一个格子在任何时刻问都给出同一个答案」。 */
export function structAt(gx, gz) {
  const r = hash2(gx, gz, SEED + 9001);
  if (r > 0.58) return 0;                                       // 大多数格子没有结构
  const cx = gx * CELL + CELL / 2, cz = gz * CELL + CELL / 2;   // 锚点吸附格心
  const info = colInfo(cx, cz);
  const bio = info.bio, h = info.height;
  if (h <= SEA + 1) return 0;                                   // 泡在水里不建

  // 平整度：抽查锚点周围 9 个点的高度极差
  let mn = 1e9, mx = -1e9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const hh = colHeight(cx + dx * 6, cz + dz * 6);
      if (hh < mn) mn = hh;
      if (hh > mx) mx = hh;
    }
  const flat = mx - mn;

  const pick = hash2(gx, gz, SEED + 9007);
  if (bio === BIOME.SNOW)   return pick < 0.72 ? 6 : 7;          // 雪屋 / 冰屋小村
  if (bio === BIOME.JUNGLE) return pick < 0.60 ? 5 : 3;          // 丛林神庙 / 村庄
  if (bio === BIOME.DESERT) return pick < 0.55 ? 4 : 2;          // 沙漠神殿 / 遗迹
  // 平原：村庄优先，其次遗迹 / 矿井
  if (flat <= 4 && pick < 0.62) return 3;                        // 村庄
  if (pick < 0.80) return 2;                                     // 遗迹
  return 1;                                                      // 废弃矿井
}
export const STRUCT_NAME = { 1: '废弃矿井', 2: '遗迹', 3: '村庄', 4: '沙漠神殿',
                      5: '丛林神庙', 6: '雪屋', 7: '雪原聚落' };

/* 结构锚点（世界坐标）。返回 null 表示这个格子不放结构。 */
export function structAnchor(gx, gz) {
  if (!structAt(gx, gz)) return null;
  const cx = gx * CELL + CELL / 2, cz = gz * CELL + CELL / 2;
  return { gx, gz, type: structAt(gx, gz), x: cx, z: cz, info: colInfo(cx, cz) };
}

/* 一栋建筑覆盖的方块，收集到 out.push([x, y, z, id])。
 * 用「收集」而不是「直接写」—— 因为这里可能在为「别处的区块」生成结构，
 * 不能假设目标区块就是当前正在构建的那一个。 */
export function collectStruct(a, out) {
  switch (a.type) {
    case 1: collectMine(a, out); break;
    case 2: collectRuin(a, out); break;
    case 3: collectVillage(a, out); break;
    case 4: collectDesertTemple(a, out); break;
    case 5: collectJungleTemple(a, out); break;
    case 6: collectIgloo(a, out); break;
    case 7: collectSnowVillage(a, out); break;
  }
}

/* 某坐标是否被某个结构覆盖，覆盖的话返回形状函数。
 * 只查周围 3×3 格 —— 结构半径都远小于 CELL(96)，这个范围绝对够。 */
export function structBlockAt(x, y, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const a = structAnchor(gx + dx, gz + dz);
      if (!a) continue;
      // 先做一个便宜的包围盒粗筛，避开「每个方块都跑一遍全形状」的开销
      if (x < a.x - 26 || x > a.x + 26 || z < a.z - 26 || z > a.z + 26) continue;
      const id = structShapeAt(a, x, y, z);
      if (id !== null) return id;
    }
  return null;
}
/* 结构形状函数：默认实现是「把整个结构铺出来再查表」。
 * 结构体量都不大（最大也就 30×30×20 量级），配合上面的包围盒粗筛，
 * 每次查询最多铺一两个结构，代价可以接受；换来的是形状代码完全不用改写。 */

export function structShapeAt(a, x, y, z) {
  const key = a.gx + ',' + a.gz;
  let cells = structShapeCache.get(key);
  if (cells === undefined) {
    cells = new Map();
    const out = [];
    collectStruct(a, out);
    for (const [bx, by, bz, id] of out) cells.set(EKEY(bx, by, bz), id);
    if (structShapeCache.size > 600) structShapeCache.clear();
    structShapeCache.set(key, cells);
  }
  return cells.has(EKEY(x, y, z)) ? cells.get(EKEY(x, y, z)) : null;
}
/* 某列是否落在结构占地内（用来禁止树/装饰长进房子里）。
 * 结构占地用一个略大的矩形近似 —— 精确到每列要遍历结构形状，太贵。 */
export function inStructFootprint(x, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const a = structAnchor(gx + dx, gz + dz);
      if (!a) continue;
      if (x >= a.x - 17 && x <= a.x + 17 && z >= a.z - 17 && z <= a.z + 17) return true;
    }
  return false;
}

/* ------------------------------ 树木 ------------------------------
 * 「某坐标是不是树」只由它自己的 hash 决定，树的形状只由这个坐标决定 ——
 * 于是同一棵树被相邻两个区块分别查询时，画出来的东西逐格相同。 */
export function treeAt(tx, tz) {
  const info = colInfo(tx, tz);
  if (info.height <= SEA + 1) return null;                       // 水里不长
  if (info.bio === BIOME.DESERT) return null;                    // 沙漠不长普通树
  if (hash2(tx, tz, SEED + 1234) > 0.0130) return null;
  if (inStructFootprint(tx, tz)) return null;
  // 间距检查：只在 ±2 范围内留一棵，避免树挤成一坨
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dz) continue;
      if (hash2(tx + dx, tz + dz, SEED + 1234) > 0.0130) continue;
      const nb = colInfo(tx + dx, tz + dz);
      if (nb.bio === BIOME.DESERT || nb.height <= SEA + 1) continue;
      if (inStructFootprint(tx + dx, tz + dz)) continue;
      // 同一半径上比大小，只有 hash 最小的那棵留下
      if (hash2(tx + dx, tz + dz, SEED + 4243) < hash2(tx, tz, SEED + 4243)) return null;
    }
  const jungle = info.bio === BIOME.JUNGLE;
  const h = info.height;
  const th = (jungle ? 7 : 4) + Math.floor(hash2(tx + 9, tz + 9, SEED) * (jungle ? 4 : 3));
  return {
    x: tx, z: tz, y: h, trunk: th,
    species: jungle ? 'jungle' : info.bio === BIOME.SNOW ? 'snow' : 'oak',
  };
}
/* 树覆盖的方块。返回 null 表示该坐标不在任何树上。 */
export function treeBlockAt(x, y, z) {
  const tx = x | 0, tz = z | 0;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const t = treeAt(tx + dx, tz + dz);
      if (!t) continue;
      // 树干
      if (dx === 0 && dz === 0) {
        if (x === t.x && z === t.z && y > t.y && y <= t.y + t.trunk)
          return t.species === 'jungle' ? I.LOG : I.LOG;
      }
      // 树冠：球形半径 2（丛林树更宽，半径 3）
      const top = t.y + t.trunk;
      const R = t.species === 'jungle' ? 3 : 2;
      const r = Math.abs(dx) + Math.abs(dz) + Math.abs(y - top);
      if (r <= R + 1 && y >= top - 1) {
        if (r > R + 1) continue;
        // 边缘随机收口，让树冠自然
        if (r === R + 1 && hash2(x, z, SEED + (y - top)) > 0.5) continue;
        if (y <= t.y + t.trunk && dx === 0 && dz === 0) continue;   // 别把树干盖成叶子
        return t.species === 'snow' ? I.LEAF : I.LEAF;
      }
    }
  return null;
}

/* ------------------------------ 地表装饰 ------------------------------ */
export function decoAt(x, y, z) {
  const xi = x | 0, zi = z | 0;
  const info = colInfo(xi, zi);
  if (info.height <= SEA) return 0;
  if (y !== info.height + 1) return 0;
  if (inStructFootprint(xi, zi)) return 0;
  const r = hash2(xi, zi, SEED + 5150);
  const surface = surfaceBlockOf(xi, zi, info);
  if (info.bio === BIOME.DESERT && surface === I.SAND) {
    if (r > 0.970) {
      const ht = 1 + Math.floor(hash2(xi + 3, zi + 3, SEED) * 3);
      // 仙人掌是柱子：只有 y ∈ [h+1, h+ht] 的那几格才画
      for (let i = 1; i <= ht; i++) if (y === info.height + i) return I.CACTUS;
    }
  } else if (info.bio === BIOME.JUNGLE && surface === I.GRASS) {
    if (r > 0.990) return I.PUMPKIN;
    else if (r > 0.978) return I.CARROT;
  } else if (surface === I.GRASS) {
    if (r > 0.9955) return I.PUMPKIN;
    else if (r > 0.9885) return I.CARROT;
  }
  return 0;
}

/* 一列的地表方块（不含结构 / 树 / 装饰）。 */
export function surfaceBlockOf(x, z, info) {
  const h = info.height, bio = info.bio;
  if (h <= SEA) return I.SAND;
  if (bio === BIOME.SNOW) return h <= SEA + 6 ? I.ICE : I.SNOW;
  if (bio === BIOME.DESERT) return I.SAND;
  return I.GRASS;
}
/* 一列地表以下的过渡层（表土）。y 必须 <= h。 */
export function subsoilOf(y, h, bio) {
  if (bio === BIOME.DESERT) return y >= h - 1 ? I.SAND : I.SANDSTONE;
  if (h <= SEA && y > h - 2) return I.CLAY;
  return I.DIRT;
}
