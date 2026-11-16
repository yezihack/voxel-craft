/* 优化方案原型：验证「结构查询记忆化」+「区块本地方块缓存」的真实收益。
 *
 * 用法：node .scratch/perf/proto.mjs
 *
 * 方法：不改 src/，在探针里复刻两个变体（getBlock / buildChunk 的等价实现），
 * 与真实实现逐项对拍（同样的输入必须得到同样的方块 id），
 * 然后在同一批 chunk 上对比耗时。数字用来支撑优化方案的优先级排序。
 */
const noop = () => {};
const mk = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' || k === Symbol.toPrimitive ? undefined : mk()),
  set: () => true,
});
const el = mk();
globalThis.document = new Proxy({
  createElement: () => el, createElementNS: () => el, getElementById: () => el,
  querySelector: () => el, querySelectorAll: () => [], addEventListener: noop,
  body: el, documentElement: el,
}, { get: (t, k) => (k in t ? t[k] : el) });
globalThis.window = globalThis;
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator',
  { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
globalThis.addEventListener = noop;
globalThis.requestAnimationFrame = () => 0;
globalThis.AudioContext = class {
  sampleRate = 44100; state = 'running'; resume() {}
  createOscillator() { return mk(); }
  createGain() { return mk(); }
  createBufferSource() { return mk(); }
  createBiquadFilter() { return mk(); }
  createBuffer(ch, n, rate) { return { getChannelData: () => new Float32Array(n), sampleRate: rate || 44100 }; }
  get destination() { return mk(); }
  get currentTime() { return 0; }
};
const GLC = new Proxy({}, { get: (t, k) => {
  switch (k) {
    case 'getAttribLocation': return () => 0;
    case 'getUniformLocation': return () => ({});
    case 'getShaderParameter': case 'getProgramParameter': return () => true;
    case 'getShaderInfoLog': case 'getProgramInfoLog': return () => '';
    case 'getParameter': return () => 4096;
    case 'getExtension': return () => null;
    case 'createShader': case 'createProgram': case 'createBuffer':
    case 'createTexture': case 'createFramebuffer': case 'createRenderbuffer':
    case 'createVertexArray': return () => ({});
    case Symbol.toPrimitive: return undefined;
  }
  return () => GLC;
} });
const C2D = new Proxy({}, { get: (t, k) => {
  if (k === 'createImageData' || k === 'getImageData')
    return (w, h) => ({ data: new Uint8ClampedArray((w | 0) * (h | 0) * 4 || 4), width: w, height: h });
  if (k === Symbol.toPrimitive) return undefined;
  return () => C2D;
} });
const CTX_CANVAS = {
  width: 512, height: 512, style: {}, addEventListener: noop, removeEventListener: noop,
  getContext: (type) => (String(type).startsWith('webgl') ? GLC : C2D),
};
const CH = await import('../../src/game/canvasHost.js');
CH.setCanvas(CTX_CANVAS);

const S = await import('../../src/game/state.js');
const G = await import('../../src/game/generate.js');
const D = await import('../../src/game/dims.js');
const M = await import('../../src/game/mesher.js');
const W = await import('../../src/game/world.js');
const F = await import('../../src/game/fluid.js');
const CFG = await import('../../src/game/config.js');
const MT = await import('../../src/game/math.js');

const { SEED } = S;
const { I, H, SEA, CW, CH: CHH, CD, UV_QUAD, matFlagOf, tileIndexOf, tileUV, BLOCKS } = CFG;
const { BIOME, BEDROCK_Y, FLAT_H, colInfo } = W;
const { CELL, structAt, structShapeAt, treeBlockAt, decoAt, stoneAt, dimBlockAt,
        surfaceBlockOf, subsoilOf } = D;
const { hash2, clamp } = MT;
const { fluidHeightAt } = F;

S.setSEED(20260918);
S.setDim(0);
S.setFlatWorld(false);
S.setStructShapeCache(new Map());

/* ================================================================
 * 变体 P0：structAt / structAnchor 记忆化
 * 关键事实：structAt(gx,gz) 只依赖 (gx,gz,SEED,flatWorld)，是纯函数。
 * 现状：structAnchor 每次调用 structAt 两遍，且完全无缓存。
 * ================================================================ */
const typeCache = new Map();
let cacheSeed = null, cacheFlat = null;
function ensureStructCache() {
  if (cacheSeed !== SEED || cacheFlat !== S.flatWorld) {
    typeCache.clear();
    cacheSeed = SEED; cacheFlat = S.flatWorld;
  }
}
function structAtM(gx, gz) {
  ensureStructCache();
  const k = gx + ',' + gz;
  const hit = typeCache.get(k);
  if (hit !== undefined) return hit;
  const v = structAt(gx, gz);
  typeCache.set(k, v);
  return v;
}
function structAnchorM(gx, gz) {
  const t = structAtM(gx, gz);          // 一次即可（原来是两遍）
  if (!t) return null;
  const cx = gx * CELL + CELL / 2, cz = gz * CELL + CELL / 2;
  return { gx, gz, type: t, x: cx, z: cz, info: colInfo(cx, cz) };
}
function structBlockAtM(x, y, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const a = structAnchorM(gx + dx, gz + dz);
      if (!a) continue;
      if (x < a.x - 26 || x > a.x + 26 || z < a.z - 26 || z > a.z + 26) continue;
      const id = structShapeAt(a, x, y, z);
      if (id !== null) return id;
    }
  return null;
}

/* ---- 变体 P0 的 getBlock / getEffective 等价实现 ---- */
function getBlockM(x, y, z) {
  const xi = x | 0, yi = y | 0, zi = z | 0;
  if (S.dim !== 0) return dimBlockAt(S.dim, xi, yi, zi);
  if (yi < 0) return 3;
  if (yi >= H) return 0;
  if (S.flatWorld) {
    const s = structBlockAtM(xi, yi, zi);
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
    const s = structBlockAtM(xi, yi, zi);
    if (s !== null) return s;
    const t = treeBlockAt(xi, yi, zi);
    if (t !== null) return t;
    if (h < SEA && yi <= SEA) return (info.bio === BIOME.SNOW && yi === SEA) ? I.ICE : I.WATER;
    return decoAt(xi, yi, zi) | 0;
  }
  if (yi === h) {
    const s = structBlockAtM(xi, yi, zi);
    if (s !== null) return s;
    return surfaceBlockOf(xi, zi, info);
  }
  const s = structBlockAtM(xi, yi, zi);
  if (s !== null) return s;
  if (yi === BEDROCK_Y) return I.OBSIDIAN;
  if (yi > h - 4) return subsoilOf(yi, h, info.bio);
  return stoneAt(xi, yi, zi);
}
function getEffectiveM(x, y, z) {
  if (y < 0) return getBlockM(x | 0, y | 0, z | 0);
  if (y >= H) return 0;
  const e = S.edits.get(G.EKEY(x | 0, y | 0, z | 0));
  if (e !== undefined) return e;
  return getBlockM(x | 0, y | 0, z | 0);
}

/* ================================================================
 * 变体 P1：区块本地方块缓存
 * 现状：buildChunk 对每个面 / 每个 AO 角都调 getEffective，
 *       单 chunk 约 70 万次方块查询。
 * 做法：先把 (chunk + 1 格边) 的方块 id 全部采样进一个平铺数组，
 *       之后面剔除与 AO 全部走数组下标，不再碰世界生成。
 * ================================================================ */
function buildChunkCached(c, getFn) {
  const pos = [], uv = [], lit = [], alp = [], flag = [];
  const idxOpa = [], idxBlend = [];
  const x0 = c.min[0], y0 = c.min[1], z0 = c.min[2];
  const NX = CW + 2, NY = CHH + 2, NZ = CD + 2;
  const cache = new Int16Array(NX * NY * NZ);
  for (let ly = 0; ly < NY; ly++)
    for (let lz = 0; lz < NZ; lz++)
      for (let lx = 0; lx < NX; lx++)
        cache[(ly * NZ + lz) * NX + lx] = getFn(x0 + lx - 1, y0 + ly - 1, z0 + lz - 1);
  const at = (x, y, z) => cache[((y - y0 + 1) * NZ + (z - z0 + 1)) * NX + (x - x0 + 1)];

  for (let y = y0; y < c.max[1]; y++)
    for (let z = z0; z < c.max[2]; z++)
      for (let x = x0; x < c.max[0]; x++) {
        const id = at(x, y, z);
        if (!id) continue;
        const B = BLOCKS[id];
        const bj = (hash2(x * 3 + 7, z * 3 + 11, y * 5 + 3) - 0.5) * 0.10;
        const matFlag = matFlagOf(B);
        if (B.shape) {
          const tile = tileIndexOf(id, 'side');
          let lv = clamp(1 + bj * 0.5, 0.62, 1.15);
          if (B.light) lv = Math.max(lv, 0.92);
          for (const corners of M.sheetCorners(B.shape)) {
            const base = pos.length / 3;
            for (let k = 0; k < 4; k++) {
              const v = corners[k], q = UV_QUAD[k], t = tileUV(tile, q[0], q[1]);
              pos.push(x + v[0], y + v[1], z + v[2]);
              uv.push(t[0], t[1]); lit.push(lv); alp.push(1); flag.push(matFlag);
            }
            idxOpa.push(base, base + 1, base + 2, base, base + 2, base + 3);
            idxOpa.push(base, base + 2, base + 1, base, base + 3, base + 2);
          }
          continue;
        }
        const hTop = fluidHeightAt(x, y, z, id);
        for (let f = 0; f < 6; f++) {
          const F = M.FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          const nb = at(nx, ny, nz);
          if (G.isOpaque(nb)) continue;
          if (nb === id && G.isClearLike(id)) continue;
          const faceKind = F.n[1] > 0 ? 'top' : F.n[1] < 0 ? 'bot' : 'side';
          const tile = tileIndexOf(id, faceKind);
          const s = F.shade;
          const ax = F.n[0] !== 0 ? 1 : 0, ay = F.n[1] !== 0 ? 1 : 0, az = F.n[2] !== 0 ? 1 : 0;
          const t1 = [ay ? 1 : 0, az ? 1 : 0, ax ? 1 : 0];
          const t2 = [az ? 1 : 0, ax ? 1 : 0, ay ? 1 : 0];
          const vBase = pos.length / 3;
          const blend = B.alpha !== undefined;
          for (let k = 0; k < 4; k++) {
            const v = F.v[k];
            const o1 = (v[0] * t1[0] + v[1] * t1[1] + v[2] * t1[2]) * 2 - 1;
            const o2 = (v[0] * t2[0] + v[1] * t2[1] + v[2] * t2[2]) * 2 - 1;
            const sd = (d1, d2) => G.isOpaque(at(nx + t1[0] * d1 + t2[0] * d2,
                                                    ny + t1[1] * d1 + t2[1] * d2,
                                                    nz + t1[2] * d1 + t2[2] * d2));
            const s1 = sd(o1, 0), s2 = sd(0, o2), co = sd(o1, o2);
            let a = M.vertexAO(s1 ? 1 : 0, s2 ? 1 : 0, co ? 1 : 0);
            if (B.light) a = Math.max(a, 0.85);
            const q = UV_QUAD[k];
            const t = tileUV(tile, q[0], q[1]);
            pos.push(x + v[0], y + v[1] * hTop, z + v[2]);
            uv.push(t[0], t[1]);
            lit.push(s * clamp(a + bj, 0.30, 1.15));
            alp.push(blend ? B.alpha : 1);
            flag.push(matFlag);
          }
          const dst = blend ? idxBlend : idxOpa;
          dst.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
        }
      }
  return {
    pos: new Float32Array(pos), uv: new Float32Array(uv),
    lit: new Float32Array(lit), alp: new Float32Array(alp),
    flag: new Float32Array(flag),
    idx: new Uint32Array(idxOpa.concat(idxBlend)),
    opaCount: idxOpa.length,
  };
}

/* ================================================================
 * 对拍：变体必须与真实实现给出完全相同的结果
 * ================================================================ */
console.log('=== 对拍（变体 vs 真实实现）===');
let mismatch = 0, checked = 0;
for (let i = 0; i < 30000; i++) {
  const x = (i * 61) % 220 - 110, z = (i * 137) % 220 - 110;
  const y = (i * 29) % 64;
  const a = G.getEffective(x, y, z), b = getEffectiveM(x, y, z);
  checked++;
  if (a !== b) { mismatch++; if (mismatch <= 3) console.log(`  不一致 @ ${x},${y},${z}: ${a} vs ${b}`); }
}
console.log(`  方块查询对拍 ${checked} 个坐标，不一致 ${mismatch} 个`);

/* 网格对拍 */
M.initChunks(0, 0);
let meshMismatch = 0;
for (const c of M.chunks) {
  const a = M.buildChunk(c);
  const b = buildChunkCached(c, G.getEffective);
  if (a.pos.length !== b.pos.length || a.idx.length !== b.idx.length) { meshMismatch++; continue; }
  for (let i = 0; i < a.pos.length; i++) if (a.pos[i] !== b.pos[i]) { meshMismatch++; break; }
  for (let i = 0; i < a.idx.length; i++) if (a.idx[i] !== b.idx[i]) { meshMismatch++; break; }
}
console.log(`  64 个 chunk 网格对拍，不一致 ${meshMismatch} 个`);
const base0 = M.chunks[0];
const a0 = M.buildChunk(base0), b0 = buildChunkCached(base0, G.getEffective);
console.log(`  顶点 ${a0.pos.length / 3} vs ${b0.pos.length / 3}，索引 ${a0.idx.length} vs ${b0.idx.length}`);

/* ================================================================
 * 性能对比
 * ================================================================ */
function timeChunks(fn) {
  const t0 = process.hrtime.bigint();
  for (const c of M.chunks) fn(c);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
console.log('\n=== 性能：64 个 chunk 的网格构建总耗时 ===');
/* 预热 */
timeChunks(c => M.buildChunk(c));
timeChunks(c => buildChunkCached(c, G.getEffective));
timeChunks(c => buildChunkCached(c, getEffectiveM));

const base = timeChunks(c => M.buildChunk(c));
const p1 = timeChunks(c => buildChunkCached(c, G.getEffective));
const p01 = timeChunks(c => buildChunkCached(c, getEffectiveM));
console.log(`  现状（基线）            ${base.toFixed(0)}ms   单 chunk ${(base / 64).toFixed(1)}ms`);
console.log(`  P1 区块本地方块缓存     ${p1.toFixed(0)}ms   单 chunk ${(p1 / 64).toFixed(1)}ms   ` +
  `提速 ${(base / p1).toFixed(1)}×`);
console.log(`  P1 + P0 结构查询记忆化  ${p01.toFixed(0)}ms   单 chunk ${(p01 / 64).toFixed(1)}ms   ` +
  `提速 ${(base / p01).toFixed(1)}×`);

console.log('\n=== 帧内影响：主循环每帧最多重建 4 个 chunk ===');
console.log(`  基线      最坏 ${(base / 64 * 4).toFixed(0)}ms/帧  →  ${(1000 / (base / 64 * 4)).toFixed(1)} fps 上限`);
console.log(`  P1+P0     最坏 ${(p01 / 64 * 4).toFixed(0)}ms/帧  →  ${(1000 / (p01 / 64 * 4)).toFixed(1)} fps 上限`);

console.log('\n=== 启动预构建（64 个 chunk 分帧做）===');
console.log(`  基线 ${base.toFixed(0)}ms，P1+P0 ${p01.toFixed(0)}ms`);
