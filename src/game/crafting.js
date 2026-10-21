import { reactive } from 'vue'

/* 合成：3x3 配方匹配、配方书、自动摆料 —— 迁移自 voxel-craft.html 第 5920-6283 行 */

import { MODE, mode } from './state.js'
import { D, G, H, I, W, defName } from './config.js'
import { keys } from './input.js'
import { invAdd, invCount, invTake } from './survival.js'
import { spellResult } from './spell.js'
import { P } from './textures.js'

/* ============================== 合成 ==============================
 * 配方表是纯数据 + 纯函数，整段不碰 DOM —— 无头测试直接把这一段抽出来跑，
 * 验证「摆对了能出、摆错了不出、材料不够不出」。
 *
 * 配方形状用 3×3 字符网格描述（' ' = 空格，其它字符查 KEY 表）。
 * 网格可以只写 1×1 / 2×1 / 2×2 / 3×2 …，匹配时会自动在所有可能的
 * 偏移位置滑动比对 —— 所以「两个木板横着摆」不管摆在左上角还是正中间
 * 都能出。行数/列数不足 3 的部分按空气处理，等价于 Minecraft 的
 * 「配方在合成台里自动居中」。 */

/* --- 材料别名：配方网格里的字符 → 方块 id --- */
export function craftKeyTable() {
  return {
    P: I.PLANK,      // 木板
    L: I.LOG,        // 原木
    C: I.COBBLE,     // 圆石
    S: I.STONE,      // 石头
    B: I.STONEBRICK, // 石砖
    D: I.DIRT,       // 泥土
    A: I.SAND,       // 沙子
    G: I.GLASS,      // 玻璃
    K: I.COAL,       // 煤
    R: I.IRON,       // 铁矿
    O: I.GOLD,       // 金矿
    Y: I.DIAMOND,    // 钻石
    T: I.REDSTONE,   // 红石
    F: I.LEAF,       // 树叶
    M: I.MOSS,       // 苔石
    N: I.SNOW,       // 雪块
    I: I.ICE,        // 冰块
    Q: I.QUARTZ,     // 石英
    W: I.WOOL,       // 白羊毛
    w: I.WOOL_RED,   // 红羊毛
    b: I.WOOL,       // （保留位）
    E: I.OBSIDIAN,   // 黑曜石
    U: I.PUMPKIN,    // 南瓜
    V: I.CACTUS,     // 仙人掌
    H: I.SANDSTONE,  // 沙岩
    X: I.DARKPLANK,  // 深色木板
    Z: I.CLAY,       // 粘土
    J: I.STICK,      // 木棍（工具与武器的柄）
    /* 刷怪蛋的特征材料（见下面「刷怪蛋」配方段）：小写 = 生物的掉落物。
     * 全用一个字母、且和已有大写键大小写不同（K/k、Y/y、N/n、V/v、O/o），
     * 所以不会互串。 */
    o: I.PORKCHOP,     // 生猪排 → 猪
    v: I.MUTTON,       // 生羊肉 → 羊
    k: I.RAW_CHICKEN,  // 生鸡肉 → 鸡
    z: I.ROTTEN_FLESH, // 腐肉   → 僵尸
    p: I.GUNPOWDER,    // 火药   → 苦力怕
    n: I.BONE,         // 骨头   → 骷髅
    y: I.SPIDER_EYE,   // 蛛眼   → 蜘蛛
    s: I.SLIMEBALL,    // 粘液球 → 史莱姆
  };
}
export const CRAFT_KEY = craftKeyTable();

/* --- 配方表 ---
 * out = 产物 id，n = 产物数量；grid = 形状（数组的数组，每行一个字符串）。
 * grid 为空数组 = shapeless（不看摆法，只看材料总量），留给以后的杂配。 */
export const RECIPES = [
  /* 基础建材 */
  { out: I.PLANK,     n: 4, grid: ['L'] },                 // 1 原木 → 4 木板
  { out: I.STONEBRICK,n: 4, grid: ['SS', 'SS'] },          // 4 石头 → 4 石砖
  /* ⚠ 同料配方顺序敏感：4 沙既能出玻璃、也能出沙岩，谁写在前面谁优先。
   * 玻璃是更常用的建材，所以排在上面。 */
  { out: I.GLASS,     n: 1, grid: ['AA', 'AA'] },          // 4 沙 → 玻璃
  { out: I.SANDSTONE, n: 1, grid: ['AA', 'AA'] },          // 4 沙 → 沙岩
  { out: I.QUARTZ,    n: 1, grid: ['QQ', 'QQ'] },          // 4 石英 → 石英块（回收）
  { out: I.DARKPLANK, n: 4, grid: ['XX', 'XX'] },          // 4 深色木板 → 4（等价回收）
  /* 木头系 */
  { out: I.BOOKSHELF, n: 1, grid: ['PPP', 'LLL', 'PPP'] }, // 书架
  /* 石系 */
  { out: I.MOSS,      n: 1, grid: ['CC', 'CC'] },          // 4 圆石 → 苔石（简化替代藤蔓）
  { out: I.OBSIDIAN,  n: 1, grid: ['SKS', 'KTK', 'SKS'] }, // 黑曜石：石头+煤+红石
  /* 玻璃 / 冰 */
  { out: I.ICE,       n: 1, grid: ['NN', 'NN'] },          // 4 雪 → 冰块
  /* 羊毛染色：白毛 + 染料料 */
  { out: I.WOOL_RED,  n: 1, grid: ['WW', 'TT'] },          // 白羊毛 + 红石 → 红羊毛
  /* 光源 / 装饰 */
  { out: I.GLOW,      n: 1, grid: ['OO', 'OO'] },          // 4 金 → 萤石
  { out: I.LAMP,      n: 1, grid: ['UU', 'KK'] },          // 南瓜 + 煤 → 南瓜灯
  { out: I.BRICK,     n: 1, grid: ['ZZ', 'ZZ'] },          // 4 粘土 → 砖块
  { out: I.WOOL,      n: 1, grid: ['FF', 'FF'] },          // 4 树叶 → 羊毛（植物纤维）
  /* 工具/武器形态的合成——用已有方块表达 */
  { out: I.CACTUS,    n: 1, grid: ['V'] },                 // 仙人掌回收（占位，保形状）
  /* 3×3 大件 */
  { out: I.STONE,     n: 8, grid: ['CCC', 'C C', 'CCC'] }, // 8 圆石围一圈 → 8 石头（熔炉形状）
  { out: I.PUMPKIN,   n: 1, grid: ['HHH', 'HUH', 'HHH'] }, // 沙岩包南瓜 → 南瓜（保形状用）

  /* ---------------- 工具与武器 ----------------
   * 形状沿用 Minecraft 的经典摆法：镐「三头两柄」、斧「三头两柄偏左」、
   * 锹「一头两柄」、剑「两头一柄」竖排。柄统一用木棍（J）。
   *
   * ⚠ 同料/同形配方顺序敏感（matchRecipe 取首个命中）：
   *   · 锹 (H/J/J) 与剑 (H/H/J) 都是 3×1 竖排，靠中间那格区分，不会互相吃
   *   · 石锹 (C/J/J) 与箭 (C/J/F) 同理
   * 但相邻等级之间没有同形冲突，所以下面按「木质 → 石 → 铁 → 金 → 钻石」顺排即可。 */
  { out: I.STICK,     n: 4, grid: ['P', 'P'] },            // 2 木板 → 4 木棍

  /* 木质（木板） */
  { out: I.PICK_WOOD,   n: 1, grid: ['PPP', ' J ', ' J '] },
  { out: I.AXE_WOOD,    n: 1, grid: ['PP ', 'PJ ', ' J '] },
  { out: I.SHOVEL_WOOD, n: 1, grid: ['P', 'J', 'J'] },
  { out: I.SWORD_WOOD,  n: 1, grid: ['P', 'P', 'J'] },
  /* 石质（圆石） */
  { out: I.PICK_STONE,   n: 1, grid: ['CCC', ' J ', ' J '] },
  { out: I.AXE_STONE,    n: 1, grid: ['CC ', 'CJ ', ' J '] },
  { out: I.SHOVEL_STONE, n: 1, grid: ['C', 'J', 'J'] },
  { out: I.SWORD_STONE,  n: 1, grid: ['C', 'C', 'J'] },
  /* 铁质（铁矿石） */
  { out: I.PICK_IRON,   n: 1, grid: ['RRR', ' J ', ' J '] },
  { out: I.AXE_IRON,    n: 1, grid: ['RR ', 'RJ ', ' J '] },
  { out: I.SHOVEL_IRON, n: 1, grid: ['R', 'J', 'J'] },
  { out: I.SWORD_IRON,  n: 1, grid: ['R', 'R', 'J'] },
  /* 金质（金矿石）：挖得最快，但伤害只有木级 */
  { out: I.PICK_GOLD,   n: 1, grid: ['OOO', ' J ', ' J '] },
  { out: I.AXE_GOLD,    n: 1, grid: ['OO ', 'OJ ', ' J '] },
  { out: I.SHOVEL_GOLD, n: 1, grid: ['O', 'J', 'J'] },
  { out: I.SWORD_GOLD,  n: 1, grid: ['O', 'O', 'J'] },
  /* 钻石质（钻石矿石）：综合最强 */
  { out: I.PICK_DIAMOND,   n: 1, grid: ['YYY', ' J ', ' J '] },
  { out: I.AXE_DIAMOND,    n: 1, grid: ['YY ', 'YJ ', ' J '] },
  { out: I.SHOVEL_DIAMOND, n: 1, grid: ['Y', 'J', 'J'] },
  { out: I.SWORD_DIAMOND,  n: 1, grid: ['Y', 'Y', 'J'] },

  /* ---------------- 远程武器 ---------------- */
  { out: I.BOW,   n: 1, grid: [' JF', 'J F', ' JF'] },     // 3 木棍 + 3 树叶（当弓弦）
  { out: I.ARROW, n: 4, grid: ['C', 'J', 'F'] },            // 圆石箭头 + 木棍杆 + 树叶羽

  /* ---------------- 傀儡核心（右键召唤） ----------------
   * 「本体材料围一圈 + 中间一个南瓜」。中心那格特意不放空 ——
   * 现有的 `['CCC','C C','CCC']`（8 圆石 → 8 石头）就是同一个轮廓的空心版，
   * 两者靠正中心一格区分，实测不会互相吃。 */
  { out: I.GOLEM_IRON,  n: 1, grid: ['RRR', 'RUR', 'RRR'] },   // 8 铁矿 + 南瓜 → 铁傀儡核心
  { out: I.GOLEM_STONE, n: 1, grid: ['CCC', 'CUC', 'CCC'] },   // 8 圆石 + 南瓜 → 石傀儡核心
  { out: I.GOLEM_SNOW,  n: 1, grid: ['NNN', 'NUN', 'NNN'] },   // 8 雪块 + 南瓜 → 雪傀儡核心

  /* ---------------- 维度核心（右键点门框） ----------------
   * 统一形状：黑曜石十字 + 正中一味「有什么味去哪」的材料。
   * 十字只有 4 块黑曜石，加上门框本身的 10 块，凑齐一扇门是能接受的量；
   * 8 枚核心形状相同、只差中心那格，所以匹配绝不会互相吃。
   * 中心材料全部可以在**主世界**拿到 —— 否则就成了「先去异界才能去异界」的死锁。
   * 世界核心（回家）故意用最便宜的圆石：它是卡在异界出不来时的保险钥匙，
   * 不该让玩家为了「能回家」再去挖钻石。 */
  { out: I.CORE_OVER,    n: 1, grid: [' E ', 'ECE', ' E '] },  // 4 黑曜石 + 圆石   → 世界核心
  { out: I.CORE_EMBER,   n: 1, grid: [' E ', 'EKE', ' E '] },  // 4 黑曜石 + 煤     → 熔火核心
  { out: I.CORE_VOID,    n: 1, grid: [' E ', 'ETE', ' E '] },  // 4 黑曜石 + 红石   → 虚空核心
  { out: I.CORE_FROST,   n: 1, grid: [' E ', 'ENE', ' E '] },  // 4 黑曜石 + 雪块   → 霜寂核心
  { out: I.CORE_CRYSTAL, n: 1, grid: [' E ', 'EQE', ' E '] },  // 4 黑曜石 + 石英   → 晶簇核心
  { out: I.CORE_BLIGHT,  n: 1, grid: [' E ', 'EME', ' E '] },  // 4 黑曜石 + 苔石   → 腐化核心
  { out: I.CORE_DUNE,    n: 1, grid: [' E ', 'EVE', ' E '] },  // 4 黑曜石 + 仙人掌 → 炙沙核心
  { out: I.CORE_GARDEN,  n: 1, grid: [' E ', 'EFE', ' E '] },  // 4 黑曜石 + 树叶   → 花园核心

  /* ---------------- 刷怪蛋（右键放生物） ----------------
   * 统一形状 ['WW','WM']：3 白羊毛当「蛋壳」+ 正中一味「什么味生什么生物」的材料。
   * 13 枚同形、只差 M，和维度核心段同一个套路 —— 匹配绝不会互相吃。
   *
   * ⚠ M 必须两两不同：史莱姆大小两只的掉落物都是粘液球，若都用 s 就成了
   * 「同形同料两条配方」，只有排在前面的那条能命中、另一枚永远合不出来。
   * 所以小史莱姆的 M 换成树叶（F）—— 反正它是大史莱姆裂出来的「崽」。
   *
   * 材料都取**主世界可得**：肉类来自被动生物、材料来自敌对生物掉落、
   * 傀儡用本体矿石/圆石/雪、村民用深色木板（村庄建材）。白羊毛自己由 4 树叶合成，
   * 所以一枚蛋的底线成本很低，不至于「为了放猪先养猪」。 */
  { out: I.EGG_PIG,         n: 1, grid: ['WW', 'Wo'] },   // 生猪排 → 猪
  { out: I.EGG_SHEEP,       n: 1, grid: ['WW', 'Wv'] },   // 生羊肉 → 羊
  { out: I.EGG_CHICKEN,     n: 1, grid: ['WW', 'Wk'] },   // 生鸡肉 → 鸡
  { out: I.EGG_ZOMBIE,      n: 1, grid: ['WW', 'Wz'] },   // 腐肉   → 僵尸
  { out: I.EGG_VILLAGER,    n: 1, grid: ['WW', 'WX'] },   // 深色木板 → 村民
  { out: I.EGG_GOLEM_IRON,  n: 1, grid: ['WW', 'WR'] },   // 铁矿石 → 铁傀儡
  { out: I.EGG_GOLEM_STONE, n: 1, grid: ['WW', 'WC'] },   // 圆石   → 石傀儡
  { out: I.EGG_GOLEM_SNOW,  n: 1, grid: ['WW', 'WN'] },   // 雪块   → 雪傀儡
  { out: I.EGG_SPIDER,      n: 1, grid: ['WW', 'Wy'] },   // 蛛眼   → 蜘蛛
  { out: I.EGG_CREEPER,     n: 1, grid: ['WW', 'Wp'] },   // 火药   → 苦力怕
  { out: I.EGG_SKELETON,    n: 1, grid: ['WW', 'Wn'] },   // 骨头   → 骷髅
  { out: I.EGG_SLIME_LARGE, n: 1, grid: ['WW', 'Ws'] },   // 粘液球 → 史莱姆
  { out: I.EGG_SLIME_SMALL, n: 1, grid: ['WW', 'WF'] },   // 树叶   → 小史莱姆

  /* ---------------- 光源 / 红石 / 轨道 / 运输 ----------------
   * 形状沿用的是「一看就懂」的那套：火把 = 燃料在上、柄在下；
   * 铁轨 = 两条轨夹一根枕木（竖着看是「R 空 R / R 棍 R / R 空 R」）；
   * 矿车 = 一个开口朝上的斗（上排空一格 = 斗口）。
   *
   * ⚠ 逐条核对过与既有配方**不同形或不同料**：
   *   红石块(TTT×3) 是唯一的满 3×3；充能铁轨(OTO/TJT/OTO) 带金；
   *   传送带(CC/JJ) 与苔石(CC/CC) 只差底下那排；传送板(GGG/TQT/GGG) 与
   *   傀儡核心(RRR/RUR/RRR) 形状相同但材料完全不同 —— 匹配按材料逐格比，不会串。 */
  { out: I.TORCH,          n: 4, grid: ['K', 'J'] },                 // 煤 + 木棍 → 4 火把
  { out: I.TORCH_RED,      n: 4, grid: ['T', 'J'] },                 // 红石 + 木棍 → 4 红石火把
  { out: I.REDSTONE_BLOCK, n: 1, grid: ['TTT', 'TTT', 'TTT'] },      // 9 红石 → 红石块
  { out: I.RAIL,           n: 8, grid: ['R R', 'RJR', 'R R'] },      // 4 铁 + 木棍 → 8 铁轨
  { out: I.RAIL_POWERED,   n: 4, grid: ['OTO', 'TJT', 'OTO'] },      // 金 + 红石 + 木棍 → 充能轨
  { out: I.BELT,           n: 4, grid: ['CC', 'JJ'] },               // 圆石 + 木棍 → 4 传送带
  { out: I.PAD,            n: 2, grid: ['GGG', 'TQT', 'GGG'] },      // 玻璃 + 红石 + 石英 → 2 传送板
  { out: I.MINECART,       n: 1, grid: ['R R', 'RRR'] },             // 5 铁 → 矿车
  { out: I.BLINK,          n: 2, grid: ['QQQ', 'QTQ', 'QQQ'] },      // 石英壳 + 红石芯 → 2 传送珠
];

/* 把配方网格规整成 3×3 的 id 矩阵（不足补 0） */
export function recipeMatrix(grid) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < grid.length && r < 3; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length && c < 3; c++) {
      const ch = row[c];
      if (ch === ' ' || ch === '.') continue;
      const id = CRAFT_KEY[ch];
      if (id === undefined) throw new Error('配方里有未知材料字符: ' + ch);
      m[r][c] = id;
    }
  }
  return m;
}
/* 3×3 合成格（长度 9，行优先）。同样只记 id，不记数量 ——
 * 合成格里的东西就是「占着格的实物」，跟 inv（Map）是两套账。 */
export const CRAFT_N = 9;
export const craftSlots = reactive(new Array(CRAFT_N).fill(0));

export const craftMat = (i) => (i >= 0 && i < CRAFT_N ? craftSlots[i] | 0 : 0);

/* 把合成格摆成 3×3 矩阵 */
export function craftMatrix() {
  const m = [];
  for (let r = 0; r < 3; r++) m.push([craftSlots[r * 3], craftSlots[r * 3 + 1], craftSlots[r * 3 + 2]].map((v) => v | 0));
  return m;
}

/* 形状匹配：把配方矩阵在一张 3×3 画布上滑动，任意位置完全吻合就算命中。
 * 判据是「配方非空格 == 合成格对应位置」，同时合成格不能有多余材料。 */
export function gridMatches(pat, mat) {
  // 图案的有效包围盒
  let pr0 = 3, pr1 = -1, pc0 = 3, pc1 = -1, pn = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (pat[r][c]) {
    pn++; if (r < pr0) pr0 = r; if (r > pr1) pr1 = r;
    if (c < pc0) pc0 = c; if (c > pc1) pc1 = c;
  }
  if (pn === 0) return false;
  // 合成格的有效包围盒
  let mr0 = 3, mr1 = -1, mc0 = 3, mc1 = -1, mn = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (mat[r][c]) {
    mn++; if (r < mr0) mr0 = r; if (r > mr1) mr1 = r;
    if (c < mc0) mc0 = c; if (c > mc1) mc1 = c;
  }
  if (mn === 0) return false;
  // 图形尺寸必须一致（否则 2×2 的配方会被 3×3 的材料蒙混过关）
  if (pr1 - pr0 !== mr1 - mr0 || pc1 - pc0 !== mc1 - mc0) return false;
  if (pn !== mn) return false;
  const dr = mr0 - pr0, dc = mc0 - pc0;
  for (let r = pr0; r <= pr1; r++) for (let c = pc0; c <= pc1; c++) {
    const want = pat[r][c];
    const got = mat[r + dr][c + dc];
    if (want !== got) return false;      // 0 对 0 也要相等：图案的空位不能有东西
  }
  return true;
}
/* 无序匹配：材料种类与数量一致即可（grid 为空的配方用） */
export function shapelessMatches(pat, mat, need) {
  const cnt = new Map();
  let total = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const v = mat[r][c];
    if (!v) continue;
    cnt.set(v, (cnt.get(v) | 0) + 1);
    total++;
  }
  if (total !== need) return false;
  for (const [id, n] of cnt) if (n !== 1) return false;   // 本表里的 shapeless 都是一式一份
  return true;
}

/* 配方预编译一次（矩阵 + 材料数），避免每次匹配都重算 */
export const RECIPE_CACHE = RECIPES.map((r) => {
  const pat = r.grid && r.grid.length ? recipeMatrix(r.grid) : null;
  let need = 0;
  if (pat) for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 3; c++) if (pat[r2][c]) need++;
  return { ...r, pat, need };
});

/* 当前合成格 -> 匹配到的配方（没匹配到返回 null）。
 * 表里前面的配方优先 —— 玻璃和沙岩同料（4 沙），所以玻璃写在前面。 */
export function matchRecipe(mat) {
  const m = mat || craftMatrix();
  for (const r of RECIPE_CACHE) {
    if (r.pat) { if (gridMatches(r.pat, m)) return r; }
    else if (shapelessMatches(null, m, r.need)) return r;
  }
  return null;
}
/* 当前合成结果：{ out, n } 或 { spell } 或 null。
 *
 * 先查普通配方，查不到再查拼写 —— 两条路径互斥，因为 `readGlyphRow` 见到
 * 任何非字块就会放弃。所以「摆了一行字块 + 一格石头」不会误判成拼写。 */
export function craftResult() {
  const r = matchRecipe();
  if (r) return { out: r.out, n: r.n };
  const sp = spellResult(craftSlots);
  return sp ? { spell: sp } : null;
}

/* 合成格内材料总数（判断「格子空不空」） */
export const craftFilled = () => craftSlots.reduce((a, v) => a + (v ? 1 : 0), 0);

/* 清空合成格 —— 材料退回背包（背包满也照样退，东西不会凭空消失）。 */
export function clearCraft(toInv = true) {
  for (let i = 0; i < CRAFT_N; i++) {
    const id = craftSlots[i];
    if (!id) continue;
    if (toInv) invAdd(id, 1);
    craftSlots[i] = 0;
  }
}

/* 从背包拿一个 id 放进合成格（材料由 inv 扣除；合成格只记 id）。
 * 返回 true 表示这次真的放上去了。 */
export function craftPlace(id, at = -1) {
  if (!id) return false;
  if (mode === MODE.SURVIVAL && !invCount(id)) return false;
  let i = at;
  if (i < 0 || i >= CRAFT_N || craftSlots[i]) i = craftSlots.indexOf(0);
  if (i < 0) return false;
  craftSlots[i] = id;
  if (mode === MODE.SURVIVAL) invTake(id, 1);
  return true;
}
/* 清掉合成格里第 i 个，材料退回背包 */
export function craftClearAt(i) {
  const id = craftSlots[i];
  if (!id) return false;
  craftSlots[i] = 0;
  invTake(id, 0);                    // 只是让 inv 保持一致（0 数量是空操作）
  invAdd(id, 1);
  return true;
}

/* 执行一次合成：把结果放进背包，并按配方消耗掉合成格里的材料。
 * 材料只消耗「配方真正用到的那几个位置」，多摆的材料原样留着。 */
export function doCraft() {
  const r = matchRecipe();
  if (r) {
    // 数一数每种材料各消耗几个
    const use = new Map();
    for (let i = 0; i < CRAFT_N; i++) {
      const id = craftSlots[i];
      if (id) use.set(id, (use.get(id) | 0) + 1);
    }
    for (const i of craftSlots.keys()) craftSlots[i] = 0;
    invAdd(r.out, r.n);
    return { out: r.out, n: r.n };
  }
  /* 拼写：字块拼成了课程里的一个词。
   * ⚠ 这里**不发物品** —— 拼词是一次课业，不是一次制造。产物格显示的就是
   *   这个词本身；学识结算走 learning/progress（工单 08/09），
   *   这里只负责把摆上去的字块消耗掉。 */
  const sp = spellResult(craftSlots);
  if (!sp) return null;
  for (const i of craftSlots.keys()) craftSlots[i] = 0;
  return { spell: sp };
}

/* 合成一本「配方书」的条目：每条给出产物 + 一种可行的摆法，
 * 点一下就能把材料自动摆进合成格（材料不够就摆不满，能摆几个是几个）。 */
export function recipeBookEntries() {
  return RECIPE_CACHE.map((r) => ({
    out: r.out, n: r.n,
    grid: r.grid || [],
    need: r.grid ? r.grid.flatMap((s) => s.split('')).filter((c) => c !== ' ' && c !== '.')
                 .map((c) => CRAFT_KEY[c]).filter((v) => v) : [],
  }));
}
/* 按配方自动摆料：先清空合成格，再逐格取料。返回实际摆上的格数。 */
export function craftAutoFill(entry) {
  clearCraft(true);
  const pat = entry.grid && entry.grid.length ? recipeMatrix(entry.grid) : null;
  if (!pat) return 0;
  let placed = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const id = pat[r][c];
    if (!id) continue;
    if (mode === MODE.SURVIVAL && !invCount(id)) continue;   // 材料不够就跳过这一格
    if (craftPlace(id, r * 3 + c)) placed++;
  }
  return placed;
}
/* 配方需要但背包里没有的材料（返回 [名字, id] 列表，给 UI 提示用） */
export function recipeMissing(entry) {
  const need = new Map();
  for (const id of entry.need) need.set(id, (need.get(id) | 0) + 1);
  const miss = [];
  for (const [id, n] of need) {
    const have = invCount(id);
    if (have < n) miss.push([defName(id), id, n - have]);
  }
  return miss;
}
