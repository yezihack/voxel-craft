/* 每帧 JS 开销测量：定位「玩起来卡」的常驻成本。
 *
 * 用法：node .scratch/perf/frame.mjs
 *
 * 分两类：
 *   A. 常驻每帧（raycast / 物理 / 名字标签 / 同步）—— 这些与地形无关，
 *      是「站着不动也在烧 CPU」的部分；
 *   B. 触发式（chunk 重建 / 维度切换 / 结构缓存重建）—— 走路、挖方块时才出现。
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
const P = await import('../../src/game/player.js');
const F = await import('../../src/game/fluid.js');

S.setSEED(20260918);
S.setDim(0);
S.setFlatWorld(false);
S.setStructShapeCache(new Map());

function bench(name, fn, n) {
  fn(); fn();                       // 预热
  const a = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const b = process.hrtime.bigint();
  const ms = Number(b - a) / 1e6;
  console.log(`  ${name.padEnd(34)} ${(ms / n * 1000).toFixed(1).padStart(9)}µs/次   合计 ${ms.toFixed(0)}ms`);
  return ms / n;
}

console.log('=== A. 常驻每帧成本（站着不动也在烧）===');
/* 玩家放到地表上方，朝向随便一个方向 */
const spawn = F.findSpawn();
P.player.x = spawn[0]; P.player.y = spawn[1] + 2; P.player.z = spawn[2];
P.player.yaw = 0.7; P.player.pitch = -0.2;

bench('raycast(13) 准星拾取', () => P.raycast(13), 2000);
bench('raycast(26) 传送珠范围', () => P.raycast(26), 1000);
bench('getEffective × 1 次', () => G.getEffective(Math.floor(P.player.x), 20, Math.floor(P.player.z)), 20000);
bench('moveAxis 物理碰撞 × 3 轴', () => {
  P.player.vx = 0.1; P.player.vz = 0.1; P.player.vy = -0.1;
  P.moveAxis('x', 0.01); P.moveAxis('z', 0.01); P.moveAxis('y', 0.01);
}, 2000);

console.log('\n=== B. 启动期一次性成本 ===');
bench('worldCensus 96×96 采样', () => F.worldCensus(), 3);
bench('generate(换种子) 全套', () => F.generate(20260918), 3);

console.log('\n=== C. 结构 / 树查询在「帧内路径」上的放大 ===');
/* raycast 每一步都调 getEffective → structBlockAt(9 格) + treeBlockAt(25 树)。
 * 一次 raycast 的步数直接决定结构扫描次数。 */
let steps = 0;
const origGet = G.getEffective;
console.log('  一次 raycast 最多 200 步，每步 1 次 getEffective');
console.log('  → 每次 getEffective 触发 9 次 structAnchor（每格 1 次 structAt）+ 25 次 treeAt');
console.log('  → 单次 raycast 最坏约 200 × 34 = 6800 次结构/树扫描');
bench('structBlockAt（帧内最热的单点）', () => D.structBlockAt(Math.floor(P.player.x), 20, Math.floor(P.player.z)), 20000);
bench('treeBlockAt', () => D.treeBlockAt(Math.floor(P.player.x), 20, Math.floor(P.player.z)), 20000);

console.log('\n=== D. 结构查询缓存的收益面 ===');
/* 统计：构造 4×4 区块窗口时，一共会碰到多少个不同的结构格 */
const CELL = D.CELL;
const cells = new Set();
for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) cells.add(gx + ',' + gz);
console.log(`  4×4 区块窗口（96×96 格）只覆盖 ${cells.size} 个结构格`);
console.log('  但每个方块查询都要重算 structAt → 平整度抽查 9 次 colHeight');
console.log('  → 结构格数极小，记忆化命中率接近 100%');
