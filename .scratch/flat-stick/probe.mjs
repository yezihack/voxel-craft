/* 无头冒烟：① 手机摇杆松手后必须真的停下 ② 超平坦只留建筑、不留树和花草
 *
 * 用法：node .scratch/flat-stick/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，地形与输入换算全部走真实代码。
 * 沿用 bots/probe.mjs 的挡板写法。 */

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

const { I, H, SEA, SEED } = await import('../../src/game/config.js');
const ST = await import('../../src/game/state.js');
const { getBlock } = await import('../../src/game/generate.js');
const { FLAT_H } = await import('../../src/game/world.js');
const { CELL, structAnchor, structAt } = await import('../../src/game/dims.js');
const { applyStickInput, releaseStick, stickInput, STICK_DEAD } =
  await import('../../src/game/stick.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};
const eq = (a, b, msg) => ok(a === b, `${msg}（期望 ${b}，实际 ${a}）`);

/* 换世界类型 / 换种子时必须做的三件套：清列缓存、清结构形状、清摇杆状态 */
function resetWorld(flat) {
  ST.setFlatWorld(flat);
  ST.setColCache(new Map());
  ST.setColCacheSeed(SEED);
  ST.structShapeCache.clear();
}

/* 某一列是否落在某个建筑的占地附近。
 * 半径取 30：比 structBlockAt 内部 26 格的包围盒粗筛还宽一点，
 * 于是「结构外」的判定是保守的 —— 宁可少判几列，也不会把房子当成野树。 */
function nearStruct(x, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const a = structAnchor(gx + dx, gz + dz);
      if (a && Math.abs(x - a.x) <= 30 && Math.abs(z - a.z) <= 30) return true;
    }
  return false;
}

/* ====================== 1. 摇杆：松手必须停下 ====================== */
console.log('\n[1] 触屏摇杆 → 方向键');
{
  const input = { f: false, b: false, l: false, r: false, jump: false, shift: false };
  const stick = { x: 0, y: 0 };
  stickInput.active = false;

  // 手指推到最前
  stick.y = -1; applyStickInput(stick, input);
  ok(input.f && !input.b && !input.l && !input.r, '推到底 → 只前进');

  // 松手：向量归零，方向键必须一起归零（这就是「一直往前走」的根因）
  stick.y = 0; applyStickInput(stick, input);
  ok(!input.f && !input.b && !input.l && !input.r, '松手归零 → 四个方向全部松开');

  // 松手后继续空转若干帧，仍必须保持松开
  for (let i = 0; i < 5; i++) applyStickInput(stick, input);
  ok(!input.f, '松手后连续多帧仍然静止');

  // 死区：小幅抖动不该让角色动
  stick.y = -(STICK_DEAD * 0.5); applyStickInput(stick, input);
  ok(!input.f, `死区内（${(STICK_DEAD * 0.5).toFixed(2)}）不触发移动`);

  // 斜向
  stick.x = 0.9; stick.y = -0.9; applyStickInput(stick, input);
  ok(input.f && input.r && !input.l && !input.b, '右上斜推 → 前进 + 右移');
  stick.x = 0; stick.y = 0; applyStickInput(stick, input);

  // 桌面键盘不受影响：没碰过摇杆时不能把 WASD 的按下状态抹掉
  input.f = true;
  for (let i = 0; i < 3; i++) applyStickInput(stick, input);
  ok(input.f === true, '没碰摇杆时不动键盘状态（W 按住仍然前进）');

  // 面板 / 遮罩抢焦点：强制松手
  input.f = true; stick.y = -1; applyStickInput(stick, input);
  releaseStick(stick, input);
  ok(!input.f && stick.x === 0 && stick.y === 0, 'releaseStick 强制松手并清向量');
}

/* ====================== 2. 超平坦：干净地面 + 建筑 ====================== */
console.log('\n[2] 超平坦世界的地表');
resetWorld(true);

{
  // 2.1 层结构：草 / 土 / 石 / 基岩
  const x = 1234, z = -987;                      // 随便挑一个远离原点的列
  eq(getBlock(x, FLAT_H, z), I.GRASS, '地表是草方块');
  eq(getBlock(x, FLAT_H + 1, z), 0, '地表上一格是空气');
  eq(getBlock(x, FLAT_H - 1, z), I.DIRT, '地表下第一层是土');
  eq(getBlock(x, FLAT_H - 4, z) === I.DIRT, false, '四层以下不再是土');
  ok(getBlock(x, FLAT_H - 5, z) !== 0, '四层以下是实心石层');
}

{
  /* 2.2 结构之外：没有树叶、没有花草南瓜仙人掌、也没有树干。
   * 只查结构外 —— 村庄的农田本来就会种胡萝卜、栅栏本来就用木料。 */
  const bad = { leaf: 0, deco: 0, log: 0 };
  const NATURAL = new Set([I.PUMPKIN, I.CARROT, I.CACTUS]);
  let inside = 0;
  for (let x = -220; x <= 220; x += 3)
    for (let z = -220; z <= 220; z += 3) {
      const inS = nearStruct(x, z);
      for (let y = FLAT_H + 1; y <= FLAT_H + 20; y++) {
        const id = getBlock(x, y, z);
        if (!id) continue;
        if (inS) { inside++; continue; }
        if (id === I.LEAF) bad.leaf++;
        else if (NATURAL.has(id)) bad.deco++;
        else if (id === I.LOG) bad.log++;
      }
    }
  eq(bad.leaf, 0, '超平坦不生成树叶');
  eq(bad.deco, 0, '超平坦不生成南瓜 / 胡萝卜 / 仙人掌');
  eq(bad.log, 0, '超平坦不生成树干');
  ok(inside > 0, `建筑内部确实有方块（${inside} 格）`);
}

{
  // 2.3 结构确实存在，且是「村庄」这一类
  const found = [];
  for (let gx = -5; gx <= 5; gx++)
    for (let gz = -5; gz <= 5; gz++) {
      const t = structAt(gx, gz);
      if (t) found.push({ gx, gz, t });
    }
  ok(found.length > 0, `超平坦下结构格仍然成立（11×11 格内找到 ${found.length} 处）`);
  const types = new Set(found.map((f) => f.t));
  ok(types.has(3), '村庄（type 3）出现在超平坦世界里');
  ok(types.size >= 2, `不止一种建筑（实际 ${[...types].join('/')}）`);

  const village = found.find((f) => f.t === 3);
  const a = structAnchor(village.gx, village.gz);
  ok(!!a, '村庄锚点可解出');
  eq(getBlock(a.x, FLAT_H, a.z), I.STONEBRICK, '村庄广场中心铺的是石砖（建筑压在地表上）');
  const pole = getBlock(a.x, FLAT_H + 1, a.z);
  ok(pole === I.LOG || pole === I.GLOW, '广场中心有灯柱');
}

{
  // 2.4 结构之外的地表必须是干净的空气（房子不能满地漏方块）
  let dirty = 0, checked = 0;
  for (let x = -200; x <= 200; x += 5)
    for (let z = -200; z <= 200; z += 5) {
      if (nearStruct(x, z)) continue;
      checked++;
      for (let y = FLAT_H + 1; y <= FLAT_H + 18; y++)
        if (getBlock(x, y, z) !== 0) { dirty++; break; }
    }
  ok(checked > 500, `采样列足够多（${checked} 列）`);
  eq(dirty, 0, '结构之外的地表上方一律空气');
}

/* ====================== 3. 经典地形没有被改坏 ====================== */
console.log('\n[3] 切回经典地形');
resetWorld(false);
{
  const hs = new Set();
  for (let x = -300; x <= 300; x += 17) for (let z = -300; z <= 300; z += 17) {
    let top = -1;
    for (let y = H - 1; y >= 1; y--) if (getBlock(x, y, z) !== 0) { top = y; break; }
    hs.add(top);
  }
  ok(hs.size > 20, `地形仍然起伏（采样到 ${hs.size} 种地表高度）`);

  let leaves = 0;
  for (let x = -300; x <= 300; x += 3)
    for (let z = -300; z <= 300; z += 3)
      for (let y = SEA + 1; y < H - 1; y += 1)
        if (getBlock(x, y, z) === I.LEAF) { leaves++; break; }
  ok(leaves > 0, '经典地形仍然长树');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
