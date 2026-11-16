/* 性能探针：量化「方块查询」这条总路径的成本。
 *
 * 用法：node .scratch/perf/probe.mjs
 *
 * 背景：线上性能面板显示主线程 94% 耗在脚本执行（10.57s / 11.25s），
 * GPU 侧只有 312ms。本探针直接测「一个 chunk 的网格构建要多少次方块查询、
 * 每次查询里有多少次结构 / 树扫描」，用来定位真正的热点。
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
const CFG = await import('../../src/game/config.js');

S.setSEED(20260918);
S.setDim(0);
S.setFlatWorld(false);
S.setStructShapeCache(new Map());

console.log('=== 1. getEffective 单次成本 ===');
/* 采样一批地表附近的坐标（那里结构 / 树 / 装饰判定全都要走，是最坏情况） */
const pts = [];
for (let i = 0; i < 4000; i++) {
  const x = (i * 37) % 160 - 80, z = (i * 91) % 160 - 80;
  const h = D.structAt(0, 0) ? 20 : 20;
  pts.push([x, h, z]);
}
let t0 = process.hrtime.bigint();
for (const [x, y, z] of pts) G.getEffective(x, y, z);
let t1 = process.hrtime.bigint();
const perCall = Number(t1 - t0) / 1e6 / pts.length;
console.log(`  getEffective × ${pts.length}：${(Number(t1 - t0) / 1e6).toFixed(1)}ms，单次 ${perCall.toFixed(3)}µs`);

console.log('\n=== 2. 结构 / 树 / 装饰 各自单次成本 ===');
function bench(name, fn, n) {
  const a = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const b = process.hrtime.bigint();
  console.log(`  ${name} × ${n}：${(Number(b - a) / 1e6).toFixed(1)}ms，单次 ${(Number(b - a) / 1e6 / n * 1000).toFixed(2)}µs`);
}
bench('structBlockAt', (i) => D.structBlockAt((i % 200) - 100, 20, ((i * 3) % 200) - 100), 20000);
bench('treeBlockAt', (i) => D.treeBlockAt((i % 200) - 100, 20, ((i * 3) % 200) - 100), 20000);
bench('structAt', (i) => D.structAt(i % 50, (i * 7) % 50), 20000);
bench('colInfo', (i) => D.structAt(i % 50, (i * 7) % 50) && 0, 1);   // 占位，避免误报
bench('decoAt', (i) => D.decoAt((i % 200) - 100, 21, ((i * 3) % 200) - 100), 20000);

console.log('\n=== 3. 一个 chunk 的网格构建成本 ===');
const { CW, CH: CHH, CD, CY } = CFG;
console.log(`  区块尺寸 ${CW}×${CHH}×${CD} = ${CW * CHH * CD} 格`);
const chunks = M.chunks;
M.initChunks(0, 0);
const target = M.chunks[0];
const a = process.hrtime.bigint();
const data = M.buildChunk(target);
const b = process.hrtime.bigint();
console.log(`  buildChunk：${(Number(b - a) / 1e6).toFixed(1)}ms，顶点 ${data.pos.length / 3}，索引 ${data.idx.length}`);
console.log(`  → 64 个 chunk（4×4×4）约 ${(Number(b - a) / 1e6 * 64).toFixed(0)}ms`);

console.log('\n=== 4. buildChunk 内部查询次数估算 ===');
/* 手工复刻 mesher 的查询结构（不改被测代码，只统计次数）：
 *   每个非空方块：6 个面 × (1 次邻居判定 + 4 顶点 × 3 次 AO 采样) = 6×13 = 78 次 */
let solid = 0, empty = 0;
for (let y = target.min[1]; y < target.max[1]; y++)
  for (let z = target.min[2]; z < target.max[2]; z++)
    for (let x = target.min[0]; x < target.max[0]; x++) {
      if (G.getEffective(x, y, z)) solid++; else empty++;
    }
console.log(`  实心方块 ${solid}，空气 ${empty}`);
console.log(`  每次 getEffective 内部：structBlockAt(9×structAnchor) + treeBlockAt(25×treeAt)`);
console.log(`  → 单 chunk 的方块查询次数约 ${(solid * 78).toLocaleString()} 次` +
  `（${(solid * 78 * perCall / 1000).toFixed(0)}ms 量级）`);
console.log(`  → 每次查询再叠加 9 次 structAnchor + 25 次 treeAt，` +
  `即 ${(solid * 78 * 34).toLocaleString()} 次结构 / 树扫描`);

console.log('\n=== 5. 每帧脏区块预算 4 的代价 ===');
console.log(`  主循环每帧最多构建 4 个 chunk → 最坏 ${(Number(b - a) / 1e6 * 4).toFixed(0)}ms/帧`);
console.log(`  16.7ms 预算下，只要连续两帧有脏区块就会掉帧`);
