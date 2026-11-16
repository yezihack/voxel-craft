/* buildChunk 的 CPU 采样剖析。
 *
 * 用法：
 *   node --cpu-prof --cpu-prof-dir=.scratch/perf/prof .scratch/perf/prof.mjs
 *
 * 目的：把「一个 chunk 的网格构建 114ms」拆开，看时间到底花在
 * 方块查询（getEffective）上，还是在网格循环本身（AO 采样 / 顶点写入）。
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

S.setSEED(20260918);
S.setDim(0);
S.setFlatWorld(false);
S.setStructShapeCache(new Map());
M.initChunks(0, 0);

/* 预热：让 JIT 先编译一轮，避免把编译时间算进去 */
for (const c of M.chunks) M.buildChunk(c);

console.log('构建 64 个 chunk …');
const t0 = process.hrtime.bigint();
for (const c of M.chunks) M.buildChunk(c);
const t1 = process.hrtime.bigint();
console.log(`  总计 ${(Number(t1 - t0) / 1e6).toFixed(0)}ms，` +
  `单 chunk ${(Number(t1 - t0) / 1e6 / M.chunks.length).toFixed(1)}ms`);
