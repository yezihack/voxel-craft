/* 无头冒烟：一格宽的沟能不能把史莱姆 / 蜘蛛吞下去
 *
 * 用法：node .scratch/gap-fall/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，游戏逻辑全部走真实代码。
 * 沿用 boss/probe.mjs 的挡板写法。
 *
 * 场景：y=30 铺一整块石头地板（顶面 y=31），x=0 那一列从 y=26..30 挖空，
 * y=25 留石头当沟底 —— 一条 1 格宽、5 格深的沟。玩家站在沟对面 x=4.5，
 * 让怪从 x=-2.5 一路追过来。
 *
 * 「掉进去」的判据：出现 y < 30.4 的那一帧，且当时中心 x 落在沟列 [0,1)。
 * 「跨过去」的判据：在 y > 30.5（还站在地面高度）时出现 x > 1.6。
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

const { I } = await import('../../src/game/config.js');
const { setBlock, getEffective, isSolid } = await import('../../src/game/generate.js');
const { setColCache } = await import('../../src/game/state.js');
const { player } = await import('../../src/game/player.js');
const { MOB_TYPES, mobs, spawnMob, mobAI, mobPhysics } = await import('../../src/game/mobs.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};
const DT = 1 / 60;
const FLOOR = 30;          // 地板方块所在层，顶面 y=31
const GAP_X = 0;           // 沟所在列（x ∈ [0,1)）
const START_X = -2.5, START_Y = FLOOR + 1, START_Z = 0.5;

function buildWorld(withGap, depth = 5) {
  setColCache(new Map());
  for (let x = -8; x <= 8; x++)
    for (let z = -5; z <= 5; z++) {
      for (let y = FLOOR - 5; y <= FLOOR; y++) setBlock(x, y, z, I.STONE);
      for (let y = FLOOR + 1; y <= FLOOR + 4; y++) setBlock(x, y, z, 0);
    }
  if (withGap) {
    for (let z = -5; z <= 5; z++)
      for (let y = FLOOR - depth + 1; y <= FLOOR; y++) setBlock(GAP_X, y, z, 0);
  }
}

/* 跑一段追击，返回这段时间内是否掉进沟、是否在地面高度跨过对岸。 */
function runChase(type, withGap, frames = 300, depth = 5) {
  buildWorld(withGap, depth);
  mobs.length = 0;
  player.x = 4.5; player.y = START_Y; player.z = START_Z; player.dead = false;
  const m = spawnMob(type, START_X, START_Y, START_Z, Math.PI / 2);
  let fell = null, crossed = false, minY = Infinity;
  for (let f = 0; f < frames; f++) {
    m.animT += DT;
    mobPhysics(m, DT);
    if (m.dead) break;
    mobAI(m, DT);
    minY = Math.min(minY, m.y);
    if (!fell && m.y < START_Y - 0.6) fell = { x: m.x, y: m.y, f };
    if (m.x > GAP_X + 1.6 && m.y > FLOOR + 0.5) crossed = true;
    if (fell) break;                 // 掉进去那一帧就收工，别让爬墙把结论搅浑
  }
  return { fell, crossed, minY, x: m.x, y: m.y, dead: m.dead };
}

/* ---- 0. 场景自检 ---- */
buildWorld(true);
ok(!isSolid(getEffective(GAP_X, FLOOR, 0)), '沟口那格是空气');
ok(isSolid(getEffective(GAP_X - 1, FLOOR, 0)) && isSolid(getEffective(GAP_X + 1, FLOOR, 0)),
  '沟两岸都是实心（宽度恰好 1 格）');
ok(isSolid(getEffective(GAP_X, FLOOR - 5, 0)), '沟底是实心（掉进去不会掉出世界）');

/* ---- 1. 对照组：窄身位的僵尸本来就会掉进去（浅沟 / 深沟） ---- */
for (const depth of [1, 5]) {
  const z = runChase('zombie', true, 300, depth);
  ok(!!z.fell, `僵尸（对照）掉进 ${depth} 格深的沟：${JSON.stringify(z.fell)}`);
  ok(!z.crossed, `僵尸没有在地面高度跨过 ${depth} 格深沟的对岸`);
}

/* ---- 2. 目标：三种「该掉进去」的生物 ---- */
const TARGETS = ['spider', 'slime_large', 'slime_small'];
for (const depth of [1, 5]) {
  for (const type of TARGETS) {
    const r = runChase(type, true, 300, depth);
    const name = MOB_TYPES[type].name;
    ok(!!r.fell, `${name} 掉进 ${depth} 格深的一格宽沟（minY=${r.minY.toFixed(2)}, x=${r.x.toFixed(2)}, y=${r.y.toFixed(2)}）`);
    ok(!r.crossed, `${name} 没有在地面高度跨过 ${depth} 格深沟`);
    if (r.fell) ok(r.fell.x >= GAP_X && r.fell.x < GAP_X + 1,
      `${name} 是在沟列里往下掉（${depth} 格深，x=${r.fell.x.toFixed(2)}）`);
  }
}

/* ---- 3. 回归：没沟的平地照样走，不能因为收窄碰撞箱而卡住 ---- */
for (const type of ['spider', 'slime_large', 'slime_small']) {
  const r = runChase(type, false, 180);
  const name = MOB_TYPES[type].name;
  ok(!r.dead && r.y > FLOOR + 0.5,
    `${name} 在平地上仍站在地表（y=${r.y.toFixed(2)}）`);
  ok(r.x > START_X + 0.5, `${name} 在平地上仍能朝玩家推进（x=${r.x.toFixed(2)}）`);
}

/* ---- 4. 回归：沟内禁爬 / 禁止上拽不能误伤正常地形行为 ---- */
function runCustom(builder, type, frames = 240, startX = START_X, targetX = 4.5) {
  builder();
  mobs.length = 0;
  player.x = targetX; player.y = START_Y; player.z = START_Z; player.dead = false;
  const m = spawnMob(type, startX, START_Y, START_Z, Math.PI / 2);
  let maxY = -Infinity, maxX = -Infinity;
  for (let f = 0; f < frames; f++) {
    m.animT += DT;
    mobPhysics(m, DT);
    if (m.dead) break;
    mobAI(m, DT);
    maxY = Math.max(maxY, m.y); maxX = Math.max(maxX, m.x);
  }
  return { maxY, maxX, y: m.y, x: m.x, dead: m.dead };
}

/* 3 格高墙：只能靠爬，不能靠跳。inShaft 只该在「两侧都是墙」时拦下。 */
const wallWorld = () => {
  buildWorld(false, 5);
  for (let z = -5; z <= 5; z++)
    for (let y = FLOOR + 1; y <= FLOOR + 3; y++) setBlock(2, y, z, I.STONE);
};
const climb = runCustom(wallWorld, 'spider', 300);
ok(!climb.dead && climb.maxY > FLOOR + 2.0,
  `蜘蛛仍能爬 3 格高墙（maxY=${climb.maxY.toFixed(2)}）`);
ok(climb.maxX > 2.2, `蜘蛛爬过墙头继续追人（maxX=${climb.maxX.toFixed(2)}）`);

/* 1 格台阶：起跳 + 落地贴附照旧工作（禁止上拽不能把上台阶也禁掉）。 */
const stepWorld = () => {
  buildWorld(false, 5);
  for (let z = -5; z <= 5; z++) setBlock(1, FLOOR + 1, z, I.STONE);
};
for (const type of ['zombie', 'spider', 'slime_large']) {
  const s = runCustom(stepWorld, type, 300);
  ok(!s.dead && s.maxY > FLOOR + 1.8,
    `${MOB_TYPES[type].name} 仍能上 1 格台阶（maxY=${s.maxY.toFixed(2)}）`);
}

/* ---- 5. 「不额外削弱既有起跳」：掉进去之后逐帧继续跑，看还会不会跳 ----
 * 用户口径是「掉进去即算达成」，但明确不要顺手砍掉原有的起跳 / 爬墙能力。
 * 所以这里不要求一定能爬出来，只验证掉落后身体仍有向上的位移（hop 没被禁），
 * 以及没有出现「掉进去当场被系统判定死亡 / 消失」这类额外惩罚。 */
function runAfterFall(type, depth = 1, frames = 900) {
  buildWorld(true, depth);
  mobs.length = 0;
  player.x = 4.5; player.y = START_Y; player.z = START_Z; player.dead = false;
  const m = spawnMob(type, START_X, START_Y, START_Z, Math.PI / 2);
  let fellAt = -1, minAfterFall = Infinity, maxAfterFall = -Infinity, maxX = -Infinity;
  for (let f = 0; f < frames; f++) {
    m.animT += DT;
    mobPhysics(m, DT);
    if (m.dead) break;
    mobAI(m, DT);
    if (fellAt < 0 && m.y < START_Y - 0.6) fellAt = f;
    if (fellAt >= 0) {
      minAfterFall = Math.min(minAfterFall, m.y);
      maxAfterFall = Math.max(maxAfterFall, m.y);
    }
    maxX = Math.max(maxX, m.x);
  }
  return { fellAt, minAfterFall, maxAfterFall, maxX, dead: m.dead, y: m.y };
}

for (const type of ['spider', 'slime_large', 'slime_small']) {
  const r = runAfterFall(type);
  const name = MOB_TYPES[type].name;
  ok(r.fellAt >= 0, `${name} 掉进去仍被探针捕获（f=${r.fellAt}）`);
  ok(!r.dead, `${name} 掉进 1 格深沟后没有额外死亡惩罚`);
  ok(r.maxAfterFall - r.minAfterFall > 0.3,
    `${name} 掉进去后仍有向上位移（起伏 ${(r.maxAfterFall - r.minAfterFall).toFixed(2)} 格，` +
    `y ${r.minAfterFall.toFixed(2)}~${r.maxAfterFall.toFixed(2)}, maxX=${r.maxX.toFixed(2)}）`);
}

/* 蜘蛛被 inShaft 禁掉了「沟内爬墙」，但仍能靠 1 格台阶起跳走出来 ——
 * 这条最能说明沟不是绝对陷阱。大史莱姆会留在沟里反复弹跳，按确认口径
 * 「掉进去即算达成」，不强求出得来。 */
const spiderAfter = runAfterFall('spider');
ok(spiderAfter.maxX > GAP_X + 1.6,
  `蜘蛛掉进去后仍能自己出来，沟不是绝对陷阱（maxX=${spiderAfter.maxX.toFixed(2)}）`);

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
