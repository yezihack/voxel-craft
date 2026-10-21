/* 网格构建：区块面剔除与顶点生成 —— 迁移自 voxel-craft.html 第 2936-3114 行 */

import { BLOCKS, CD, CH, CW, CY, UV_QUAD, matFlagOf, tileIndexOf, tileUV } from './config.js'
import { fluidHeightAt } from './fluid.js'
import { getEffective, isClearLike, isOpaque } from './generate.js'
import { clamp, hash2 } from './math.js'
import { shade } from './textures.js'

/* ============================== 网格构建 ============================== */
/* 每个区块一份 VAO 数据；存放 position/normal/color/ao 交错缓冲
 * 区块不再固定在世界原点，而是记录「世界坐标的区块索引」(gx,gz)。
 * 玩家走远后整个窗口平移，只为新进入视野的一圈重建几何。 */
export const chunks = [];
export const VIEW_CX = 4;                   // 视野半径（区块数）
export const VIEW_CZ = 4;
export let anchorGX = 0, anchorGZ = 0;      // 当前窗口左上角对应的世界区块索引

export function makeChunk(gx, gy, gz) {
  return {
    gx, gy, gz,
    cx: gx - anchorGX, cy: gy, cz: gz - anchorGZ,
    vbo: null, ibo: null, count: 0, dirty: true,
    min: [gx * CW, gy * CH, gz * CD],
    max: [(gx + 1) * CW, (gy + 1) * CH, (gz + 1) * CD],
  };
}
export function initChunks(centerGX = 0, centerGZ = 0) {
  chunks.length = 0;
  anchorGX = centerGX - (VIEW_CX >> 1);
  anchorGZ = centerGZ - (VIEW_CZ >> 1);
  for (let cy = 0; cy < CY; cy++)
    for (let gz = anchorGZ; gz < anchorGZ + VIEW_CZ; gz++)
      for (let gx = anchorGX; gx < anchorGX + VIEW_CX; gx++)
        chunks.push(makeChunk(gx, cy, gz));
}

/* 窗口平移：把移出视野的区块对象回收，改坐标后标记为待重建。
 * 关键在于「复用」—— 只有真正新进入视野的那一圈才需要重建几何。
 *
 * 做法：以世界坐标 (gx,gz) 为键，把仍然留在新窗口内的区块登记进 map；
 * 然后顺序遍历新窗口的每个 (gx,gz)，能在 map 里找到就直接复用原对象
 * （几何不动），找不到就从「已被淘汰的对象池」里取一个改写坐标并标脏。
 * 对象总数恒定 = VIEW_CX*VIEW_CZ*CY，既不新建也不销毁。 */
export function shiftChunks(dGX, dGZ) {
  anchorGX += dGX; anchorGZ += dGZ;

  const map = new Map();                 // 'gx,gz,cy' → chunk
  const pool = [];                       // 被淘汰、可改写的区块对象
  for (const c of chunks) {
    const inWindow = c.gx >= anchorGX && c.gx < anchorGX + VIEW_CX &&
                     c.gz >= anchorGZ && c.gz < anchorGZ + VIEW_CZ;
    if (inWindow) map.set(c.gx + ',' + c.gz + ',' + c.cy, c);
    else pool.push(c);
  }

  const out = new Array(chunks.length);
  let pi = 0;
  for (let cy = 0; cy < CY; cy++)
    for (let gz = anchorGZ; gz < anchorGZ + VIEW_CZ; gz++)
      for (let gx = anchorGX; gx < anchorGX + VIEW_CX; gx++) {
        const i = (cy * VIEW_CZ + (gz - anchorGZ)) * VIEW_CX + (gx - anchorGX);
        const hit = map.get(gx + ',' + gz + ',' + cy);
        if (hit) { out[i] = hit; continue; }          // 复用：几何完全不用重建

        // 取一个淘汰对象，改写它的世界坐标并标脏
        let c = null;
        for (let k = pi; k < pool.length; k++) {
          if (pool[k] && pool[k].cy === cy) { c = pool[k]; pool[k] = null; pi = k; break; }
        }
        if (!c) {                                     // 兜底：理论上不会走到
          c = makeChunk(gx, cy, gz);
        } else {
          c.gx = gx; c.gz = gz; c.cy = cy;
          c.min = [gx * CW, cy * CH, gz * CD];
          c.max = [(gx + 1) * CW, (cy + 1) * CH, (gz + 1) * CD];
          c.dirty = true;
        }
        c.cx = gx - anchorGX; c.cz = gz - anchorGZ;
        out[i] = c;
      }
  for (let i = 0; i < out.length; i++) if (out[i]) chunks[i] = out[i];
}

/* 找出世界坐标 (x,y,z) 落在哪个区块，并标脏 */
export function dirtyChunkOf(x, y, z) {
  const gx = Math.floor(x / CW), gy = Math.floor(y / CH), gz = Math.floor(z / CD);
  for (const c of chunks) {
    if (c.gx === gx && c.cy === gy && c.gz === gz) { c.dirty = true; return; }
  }
  /* 落在窗口外（例如在视野边缘外挖方块）—— 遍历所有可能命中的邻接格子 */
  for (const c of chunks) {
    if (c.cy !== gy) continue;
    if (x + 1 > c.min[0] && x < c.max[0] && z + 1 > c.min[2] && z < c.max[2]) {
      c.dirty = true;
    }
  }
}

/* 六个面：法线 + 四角偏移（逆时针，从外部看） */
export const FACES = [
  { n: [ 1, 0, 0], v: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], shade: 0.80 }, // +X
  { n: [-1, 0, 0], v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], shade: 0.80 }, // -X
  { n: [ 0, 1, 0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], shade: 1.00 }, // +Y 顶面最亮
  { n: [ 0,-1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], shade: 0.55 }, // -Y 底面最暗
  { n: [ 0, 0, 1], v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], shade: 0.88 }, // +Z
  { n: [ 0, 0,-1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], shade: 0.72 }, // -Z
];

/* 顶点环境光遮蔽：查 3 个邻居的占据情况 */
export function vertexAO(side1, side2, corner) {
  if (side1 && side2) return 0.45;
  return 1 - (side1 + side2 + corner) * 0.16;
}

/* ---------------- 非立方方块：十字薄片 / 贴地薄板 ----------------
 * 火把、铁轨、传送板不是整立方，整立方那 6 面画法会把它们渲染成一块实心方板。
 * 所以给这两类形状各写一份「格内四边形」，直接跳过下面的立方分支。
 *
 * ⚠ 一律**正反各画一遍**（索引顺序反过来）。主循环里 CULL_FACE 是开着的，
 *   薄片从背面看就整个消失 —— 铁轨走到下面看不见、火把转个身就没了。
 * ⚠ 顶点顺序要和 UV_QUAD 对齐（角 0 在贴图底边），否则贴图会上下颠倒。
 * ⚠ alpha 恒为 1：这些方块走**不透明趟 + uCutout**，让 shader 的 discard
 *   按纹素 alpha 裁掉透明部分；走透明趟的话它们会被排序问题搅成一团。 */
export const SHEET_CROSS = { inset: 0.20, top: 0.86 };
export const SHEET_PLATE = { inset: 0.04, y: 0.12 };

/* 某一形状在**一个格内**的四边形列表（每个是 4 个 [x,y,z] 角） */
export function sheetCorners(shape) {
  if (shape === 'cross') {
    const i = SHEET_CROSS.inset, h = SHEET_CROSS.top;
    return [
      [[i, 0, i], [1 - i, 0, 1 - i], [1 - i, h, 1 - i], [i, h, i]],         // 对角面 A
      [[1 - i, 0, i], [i, 0, 1 - i], [i, h, 1 - i], [1 - i, h, i]],         // 对角面 B
    ];
  }
  const i = SHEET_PLATE.inset, y = SHEET_PLATE.y;
  return [[[i, y, 1 - i], [1 - i, y, 1 - i], [1 - i, y, i], [i, y, i]]];     // 贴地薄板
}

/* 构建一个区块的几何：面剔除 + AO 烘焙 + 贴图 UV，一次性写入 VBO */
export function buildChunk(c) {
  const pos = [], uv = [], lit = [], alp = [], flag = [];
  const idxOpa = [], idxBlend = [];         // 不透明面 / 半透明面分开收索引
  const x0 = c.min[0], y0 = c.min[1], z0 = c.min[2];

  for (let y = y0; y < c.max[1]; y++)
    for (let z = z0; z < c.max[2]; z++)
      for (let x = x0; x < c.max[0]; x++) {
        const id = getEffective(x, y, z);
        if (!id) continue;
        const B = BLOCKS[id];
        // 整块共享一个微小亮度抖动：让同种方块成片时不至于像复制粘贴，
        // 又不像逐顶点抖动那样在面上拉出渐变（贴图会把渐变照得很假）
        const bj = (hash2(x * 3 + 7, z * 3 + 11, y * 5 + 3) - 0.5) * 0.10;
        const matFlag = matFlagOf(B);         // 整块一个材质标志，同一方块 24 个顶点都一样

        /* 非立方（火把 / 铁轨 / 传送板）：画格内薄片，不走下面那 6 面分支 */
        if (B.shape) {
          const tile = tileIndexOf(id, 'side');
          /* 薄片不吃面朝向明暗（它没有「朝哪」这回事），也没有邻面可遮 ——
           * AO 恒为 1，只留整块那一点抖动。自发光方块（火把 / 传送板）抬下限。 */
          let lv = clamp(1 + bj * 0.5, 0.62, 1.15);
          if (B.light) lv = Math.max(lv, 0.92);
          for (const corners of sheetCorners(B.shape)) {
            const base = pos.length / 3;
            for (let k = 0; k < 4; k++) {
              const v = corners[k], q = UV_QUAD[k], t = tileUV(tile, q[0], q[1]);
              pos.push(x + v[0], y + v[1], z + v[2]);
              uv.push(t[0], t[1]);
              lit.push(lv); alp.push(1); flag.push(matFlag);
            }
            idxOpa.push(base, base + 1, base + 2, base, base + 2, base + 3);   // 正面
            idxOpa.push(base, base + 2, base + 1, base, base + 3, base + 2);   // 背面
          }
          continue;
        }
        /* 水面高度按水位下沉：满水 1.0，最薄的 7 级约 0.26。
         * 非水方块恒为 1，下面那句 `v[1] * hTop` 就退化成 `v[1]`，老几何一字不变。 */
        const hTop = fluidHeightAt(x, y, z, id);
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          const nb = getEffective(nx, ny, nz);
          if (isOpaque(nb)) continue;              // 被邻居挡住 → 剔面
          if (nb === id && isClearLike(id)) continue; // 同类的玻璃/水/冰不画内部面

          const faceKind = F.n[1] > 0 ? 'top' : F.n[1] < 0 ? 'bot' : 'side';
          const tile = tileIndexOf(id, faceKind);
          const s = F.shade;

          // AO：沿面切线方向取 3 个邻居
          const ax = F.n[0] !== 0 ? 1 : 0, ay = F.n[1] !== 0 ? 1 : 0, az = F.n[2] !== 0 ? 1 : 0;
          const t1 = [ay ? 1 : 0, az ? 1 : 0, ax ? 1 : 0];   // 第一条切线
          const t2 = [az ? 1 : 0, ax ? 1 : 0, ay ? 1 : 0];   // 第二条切线

          const vBase = pos.length / 3;
          const blend = B.alpha !== undefined;      // 走透明趟
          for (let k = 0; k < 4; k++) {
            const v = F.v[k];
            // 顶点局部坐标 → 判断它在这一面上的两个切向偏移
            const o1 = (v[0] * t1[0] + v[1] * t1[1] + v[2] * t1[2]) * 2 - 1;
            const o2 = (v[0] * t2[0] + v[1] * t2[1] + v[2] * t2[2]) * 2 - 1;
            const sd = (d1, d2) => isOpaque(getEffective(nx + t1[0] * d1 + t2[0] * d2,
                                                         ny + t1[1] * d1 + t2[1] * d2,
                                                         nz + t1[2] * d1 + t2[2] * d2));
            const s1 = sd(o1, 0), s2 = sd(0, o2), co = sd(o1, o2);
            let a = vertexAO(s1 ? 1 : 0, s2 ? 1 : 0, co ? 1 : 0);
            if (B.light) a = Math.max(a, 0.85);      // 萤石自发光

            const q = UV_QUAD[k];
            const t = tileUV(tile, q[0], q[1]);
            pos.push(x + v[0], y + v[1] * hTop, z + v[2]);
            uv.push(t[0], t[1]);
            // 面朝向明暗 × AO，烘焙到同一个系数里（贴图负责颜色）
            lit.push(s * clamp(a + bj, 0.30, 1.15));
            alp.push(blend ? B.alpha : 1);
            flag.push(matFlag);
          }
          const dst = blend ? idxBlend : idxOpa;
          dst.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
        }
      }

  c.count = 0;
  return {
    pos: new Float32Array(pos), uv: new Float32Array(uv),
    lit: new Float32Array(lit), alp: new Float32Array(alp),
    flag: new Float32Array(flag),
    idx: new Uint32Array(idxOpa.concat(idxBlend)),
    opaCount: idxOpa.length,
  };
}
