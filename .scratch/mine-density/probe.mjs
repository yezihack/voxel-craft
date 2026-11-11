/* 废弃矿井密度探针（纯 Node，stub 掉 DOM / WebGL / 音频，地形与结构全走真实代码）
 *
 * 用法：node .scratch/mine-density/probe.mjs
 *
 * 扫 N×N 个结构格（每格 CELL×CELL）统计 structAt 的类型分布。断言的期望值
 * 来自独立事实：结构格率、矿井目标占比、群系覆盖、以及红阶段实测的「其它结构
 * 基线数量」—— 不照抄被测代码里的表达式。
 *
 * 覆盖：矿井数量显著提升、不挤压其它结构、跨群系生成、纯函数性、
 * 区块接缝一致、超平坦世界下矿井仍真的出现在方块里。
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

const D = await import('../../src/game/dims.js');
const S = await import('../../src/game/state.js');
const W = await import('../../src/game/world.js');
const G = await import('../../src/game/generate.js');

let fails = 0;
const ok = (name, cond, extra) => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra === undefined ? '' : '  · ' + extra}`);
};

const N = 24;                    // 24×24 = 576 个结构格，覆盖 2304×2304 世界
const SEEDS = [20260918, 12345, 777, 424242, 987654321];
/* 红阶段实测（旧分布）的其它结构基线：5 个种子合计。用来保证「矿井变多」
 * 不是靠吃掉村庄 / 遗迹换来的。数值由独立复刻的旧公式给出，不读被测代码。 */
const OTHERS_BASELINE = 1041;

function census(seed) {
  S.setSEED(seed);
  S.setDim(0);
  S.setFlatWorld(false);
  S.setStructShapeCache(new Map());
  const cnt = new Array(8).fill(0);
  const mineBiomes = new Set();
  const mineCells = [];
  for (let gz = -N / 2; gz < N / 2; gz++)
    for (let gx = -N / 2; gx < N / 2; gx++) {
      const t = D.structAt(gx, gz);
      cnt[t]++;
      if (t === 1) {
        const cx = gx * D.CELL + D.CELL / 2, cz = gz * D.CELL + D.CELL / 2;
        mineBiomes.add(W.colInfo(cx, cz).bio);
        mineCells.push([gx, gz]);
      }
    }
  const structures = cnt.reduce((a, b) => a + b, 0) - cnt[0];
  const others = structures - cnt[1];
  return { cnt, structures, mines: cnt[1], others, mineBiomes, mineCells };
}

const runs = SEEDS.map(census);
const sum = (f) => runs.reduce((a, r) => a + f(r), 0);
const totalMines = sum((r) => r.mines);
const totalOthers = sum((r) => r.others);
const totalStruct = sum((r) => r.structures);
console.log(`样方: ${N}×${N} 格 × ${SEEDS.length} 个种子 = ${N * N * SEEDS.length} 格`);
console.log(`结构格 ${totalStruct} · 矿井 ${totalMines} · 其它 ${totalOthers}`);
for (const [i, r] of runs.entries())
  console.log(`  seed ${SEEDS[i]}: 矿井 ${r.mines} / 结构 ${r.structures}，矿井群系 [${[...r.mineBiomes].join(',')}]`);

/* ---- 1. 矿井显著变多 ---- */
ok('每个种子矿井数都 ≥ 45（576 格中 ≥7.8%）',
  runs.every((r) => r.mines >= 45), runs.map((r) => r.mines).join(','));
ok('矿井占结构格比例 ≥ 18%（旧版 9.9%）', totalMines / totalStruct >= 0.18,
  (totalMines / totalStruct * 100).toFixed(1) + '%');
ok('矿井总数 ≥ 240（旧版 115，5 种子合计）', totalMines >= 240, totalMines);

/* ---- 2. 不挤压其它结构 ---- */
ok('其它结构总数不低于旧分布基线的 95%', totalOthers >= OTHERS_BASELINE * 0.95,
  `${totalOthers} vs 基线 ${OTHERS_BASELINE}`);
ok('每个种子都还有村庄 / 遗迹 / 神殿',
  runs.every((r) => r.cnt[3] + r.cnt[2] + r.cnt[4] + r.cnt[5] + r.cnt[6] + r.cnt[7] > 0));

/* ---- 3. 跨群系：旧分布只有平原出矿井 ---- */
const allBiomes = new Set(runs.flatMap((r) => [...r.mineBiomes]));
ok('矿井覆盖 ≥3 种群系（旧版仅平原）', allBiomes.size >= 3, [...allBiomes].join(','));

/* ---- 4. 纯函数性（结构格换算必须可重放，否则区块接缝会裂） ---- */
let stable = true;
for (const seed of SEEDS.slice(0, 2)) {
  S.setSEED(seed);
  for (let gz = -3; gz <= 3; gz++)
    for (let gx = -3; gx <= 3; gx++) {
      const a = D.structAt(gx, gz), b = D.structAt(gx, gz), c = D.structAt(gx, gz);
      if (a !== b || b !== c) stable = false;
    }
}
ok('同一结构格重复查询结果一致', stable);

/* ---- 5. 区块接缝：已知矿井锚点的形状必须能被 3×3 邻格反查命中 ----
 * 用超平坦采样是因为那里矿井 y 固定在 8..15，可确定性取点；
 * 经典世界的矿井深度随地面起伏，随机 y 采样会假阴性。 */
S.setSEED(SEEDS[0]);
S.setFlatWorld(true);
S.setStructShapeCache(new Map());
const [mgx, mgz] = runs[0].mineCells[0];
const mcx = mgx * D.CELL + D.CELL / 2, mcz = mgz * D.CELL + D.CELL / 2;
let seamHit = 0;
for (let y = 6; y <= 18; y++)
  for (let dx = -14; dx <= 14; dx++)
    for (let dz = -3; dz <= 3; dz++)
      if (D.structBlockAt(mcx + dx, y, mcz + dz) !== null) seamHit++;
ok('矿井形状可被 3×3 邻格反查命中（区块接缝不裂）', seamHit > 0, seamHit);
S.setFlatWorld(false);

/* ---- 6. 超平坦世界：矿井真的写进方块（不只是 structAt 报数） ---- */
S.setSEED(SEEDS[0]);
S.setFlatWorld(true);
S.setStructShapeCache(new Map());
let flatAir = 0, flatWood = 0;
for (const [gx, gz] of runs[0].mineCells.slice(0, 12)) {
  const cx = gx * D.CELL + D.CELL / 2, cz = gz * D.CELL + D.CELL / 2;
  for (let y = 6; y <= 17; y++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const id = G.getBlock(cx + dx, y, cz + dz);
        if (id === 0) flatAir++;
        else if (id > 0 && id !== 1) flatWood++;
      }
}
ok('超平坦地下能查到矿井挖出的空气', flatAir > 0, flatAir);
ok('超平坦地下能查到矿井支架 / 侧壁方块', flatWood > 0, flatWood);
S.setFlatWorld(false);

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
