/* 走路卡顿量化：区块窗口平移 → 脏区块数量 → 每帧重建预算的帧时间。
 *
 * 用法：node .scratch/perf/walk.mjs
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
const M = await import('../../src/game/mesher.js');
const CFG = await import('../../src/game/config.js');

S.setSEED(20260918);
S.setDim(0);
S.setFlatWorld(false);
S.setStructShapeCache(new Map());

console.log(`区块窗口 ${M.VIEW_CX}×${M.VIEW_CZ}×${CFG.CY} = ${M.VIEW_CX * M.VIEW_CZ * CFG.CY} 个 chunk`);
console.log(`单 chunk ${CFG.CW}×${CFG.CH}×${CFG.CD} 格\n`);

M.initChunks(0, 0);
/* 全部构建一遍，模拟启动完成 */
for (const c of M.chunks) M.buildChunk(c);

/* 模拟走一格：区块窗口平移 */
console.log('=== 走一格（区块窗口平移）触发多少重建？===');
/* ⚠ 每次 shiftChunks 本身也会把新进入视野的那一圈标脏，
 *   所以「平移 + 平移回去」并不等于回到干净状态。
 *   每一项都要在**全干净**的前提下测：先把所有 chunk 重建一遍清掉 dirty。
 * ⚠ buildChunk 自己**不清** dirty —— 清 dirty 的是 uploadChunk（post.js）。
 *   这里手动清，等价于「已经传上 GPU 了」。 */
function cleanAll() {
  for (const c of M.chunks) { M.buildChunk(c); c.dirty = false; }
}
let totalDirty = 0;
for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [-1, 0]]) {
  cleanAll();
  M.shiftChunks(dx, dz);
  const dirty = M.chunks.filter((c) => c.dirty).length;
  totalDirty += dirty;
  console.log(`  shiftChunks(${dx},${dz}) → ${dirty} 个脏区块`);
  M.shiftChunks(-dx, -dz);
}
cleanAll();
console.log(`  每次平移平均 ${(totalDirty / 4).toFixed(0)} 个脏区块`);
console.log(`  主循环每帧预算 4 个 → 需要 ${Math.ceil((totalDirty / 4) / 4)} 帧才能补完`);

/* 实测：走一格要补完所有脏区块的总时间 */
console.log('\n=== 走一格的总代价（按基线 72.6ms/chunk）===');
cleanAll();
M.shiftChunks(1, 0);
const dirtyList = M.chunks.filter((c) => c.dirty);
const t0 = process.hrtime.bigint();
for (const c of dirtyList) M.buildChunk(c);
const t1 = process.hrtime.bigint();
const total = Number(t1 - t0) / 1e6;
const frames = Math.ceil(dirtyList.length / 4);
console.log(`  脏区块 ${dirtyList.length} 个，总耗时 ${total.toFixed(0)}ms`);
console.log(`  分摊到每帧 4 个：每帧 ${(total / frames).toFixed(0)}ms → ` +
  `${(1000 / (total / frames)).toFixed(1)} fps，共 ${frames} 帧`);
console.log(`  → 走路时每 24 格（一个区块宽）就撞上一次这种卡顿`);

/* 挖一个方块 */
console.log('\n=== 挖一个方块 ===');
cleanAll();
/* 挖一个确实落在窗口内的方块 */
const cx = M.chunks[0].min[0] + 5, cz = M.chunks[0].min[2] + 5;
const cy = 20;
G.setBlock(cx, cy, cz, 0);
const d2 = M.chunks.filter((c) => c.dirty).length;
const t2 = process.hrtime.bigint();
for (const c of M.chunks.filter((c) => c.dirty)) M.buildChunk(c);
const t3 = process.hrtime.bigint();
console.log(`  在 (${cx},${cy},${cz}) 挖一块 → 脏区块 ${d2} 个，` +
  `单帧重建 ${(Number(t3 - t2) / 1e6).toFixed(0)}ms → ` +
  `该帧掉到 ${(1000 / Math.max(0.001, Number(t3 - t2) / 1e6)).toFixed(1)} fps`);
console.log('  → 每次挖/放方块都有一次同量级的顿挫');
