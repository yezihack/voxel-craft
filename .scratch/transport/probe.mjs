/* 无头冒烟：矿车 / 铁轨 / 传送带 / 传送板 / 超平坦 / AI 玩家过门
 *
 * 用法：node .scratch/transport/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，游戏逻辑（carts / transport / bots / world）
 * 全部走真实代码 —— 这些模块是纯逻辑，能在没有浏览器的沙箱里直接跑。
 * 沿用 .scratch/portal-nudge/probe.mjs 的挡板写法。 */
const noop = () => {};
const mk = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' || k === Symbol.toPrimitive ? undefined : mk()),
  apply: () => mk(),
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
  sampleRate = 44100;
  state = 'running';
  resume() {}
  createOscillator() { return mk(); }
  createGain() { return mk(); }
  createBufferSource() { return mk(); }
  createBiquadFilter() { return mk(); }
  createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; }
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

const { I, PORTAL_BLOCK, BLOCKS, SOLID } = await import('../../src/game/config.js');
const { getEffective, setBlock } = await import('../../src/game/generate.js');
const { player } = await import('../../src/game/player.js');
const { setColCache, setFlatWorld } = await import('../../src/game/state.js');
const { carts, spawnCart, updateCarts, despawnAllCarts, isRail, railPowered } = await import('../../src/game/carts.js');
const { applyBelts, setBeltDir, registerPad, updatePads, padAt } = await import('../../src/game/transport.js');
const { bots, spawnBot, botPortalId, updateBots } = await import('../../src/game/bots.js');
const { colInfo, FLAT_H } = await import('../../src/game/world.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};
const DT = 1 / 60;
const RAIL_Y = 30;

/* ---- 1. 方块属性 ---- */
ok(SOLID[I.TORCH] === false && SOLID[I.RAIL] === false && SOLID[I.PAD] === false,
  '火把 / 铁轨 / 传送板不参与碰撞');
ok(SOLID[I.BELT] === true && SOLID[I.REDSTONE_BLOCK] === true,
  '传送带 / 红石块是实体');
ok(BLOCKS[I.TORCH].shape === 'cross' && BLOCKS[I.RAIL].shape === 'plate',
  '火把是十字薄片、铁轨是贴地薄板');
ok(BLOCKS[I.REDSTONE_BLOCK].power > 0 && BLOCKS[I.TORCH_RED].power > 0,
  '红石块与红石火把是电源');

/* ---- 2. 矿车沿铁轨跑 ---- */
despawnAllCarts();
for (let i = 0; i <= 5; i++) setBlock(10 + i, RAIL_Y, 10, I.RAIL);
const c = spawnCart(10, RAIL_Y, 10);
ok(!!c && Math.abs(c.x - 10.5) < 1e-6 && Math.abs(c.y - (RAIL_Y + 0.14)) < 1e-6, '矿车落在轨上（格心 + 薄板上方）');
ok(isRail(getEffective(12, RAIL_Y, 10)), '铁轨写进世界');
c.sp = 4;
for (let k = 0; k < 30; k++) updateCarts(DT);
ok(c.x > 11, `矿车沿轨道前进（x=${c.x.toFixed(2)}）`);
for (let k = 0; k < 300; k++) updateCarts(DT);
ok(Math.floor(c.x) === 15 && c.dir[0] === -1, `走到尽头掉头（x=${c.x.toFixed(2)} dir=${c.dir}）`);
ok(c.sp === 0, '死路停下（速度为 0）');

/* ---- 3. 充能铁轨靠红石块供电加速 ---- */
despawnAllCarts();
setBlock(20, RAIL_Y, 20, I.RAIL_POWERED);
for (let i = 1; i <= 6; i++) setBlock(20 + i, RAIL_Y, 20, I.RAIL);
ok(railPowered(20, RAIL_Y, 20) === false, '没接电源时不算通电');
const c2 = spawnCart(20, RAIL_Y, 20);
for (let k = 0; k < 60; k++) updateCarts(DT);
const spFree = c2.sp;
setBlock(20, RAIL_Y - 1, 20, I.REDSTONE_BLOCK);      // 轨下塞一块红石块
ok(railPowered(20, RAIL_Y, 20) === true, '红石块给充能铁轨供电');
const c3 = spawnCart(20, RAIL_Y, 20);
for (let k = 0; k < 60; k++) updateCarts(DT);
ok(c3.sp > spFree + 1, `供电后明显加速（${spFree.toFixed(2)} → ${c3.sp.toFixed(2)}）`);
setBlock(20, RAIL_Y - 1, 20, 0);

/* ---- 4. 传送带按朝向推人 ----
 * 先把周围掏空：传送带所在高度是半空，两侧若撞上天然地形，
 * 人被 AABB 挡住就停下了（那是正确行为，但会让这条断言变成在测地形）。 */
const BY = 40;
for (let x = -1; x <= 4; x++) for (let y = BY + 1; y <= BY + 2; y++) setBlock(x, y, 0, 0);
/* 铺一段而不是一格：人一旦走出那一格，脚下就不再是传送带，推力自然停止
 * （这是正确行为 —— 传送带不该隔着一格空气继续推人）。 */
for (let x = 0; x <= 3; x++) { setBlock(x, BY, 0, I.BELT); setBeltDir(x, BY, 0, [1, 0]); }
player.x = 0.5; player.y = BY + 1; player.z = 0.5; player.dead = false;
const px0 = player.x;
for (let k = 0; k < 30; k++) applyBelts(DT);
ok(player.x > px0 + 1, `传送带把人往前推（${px0.toFixed(2)} → ${player.x.toFixed(2)}）`);
ok(Math.abs(player.z - 0.5) < 1e-6, '传送带只沿一个轴推，不会把人挤歪');

/* ---- 5. 传送板两两配对 ---- */
for (const [px, pz] of [[5, 5], [-7, -7]])
  for (let y = BY + 1; y <= BY + 3; y++) setBlock(px, y, pz, 0);
setBlock(5, BY + 1, 5, I.PAD);
const r1 = registerPad(5, BY + 1, 5);
ok(r1 === 'wait', '第一块传送板进入等待');
setBlock(-7, BY + 1, -7, I.PAD);
const r2 = registerPad(-7, BY + 1, -7);
ok(r2 === 'linked', '第二块传送板与之配对');
ok(String(padAt(5, BY + 1, 5).link) === '-7,' + (BY + 1) + ',-7', '链接指向对面');
player.x = 5.5; player.y = BY + 1; player.z = 5.5; player.padCd = 0;
updatePads(DT);
ok(Math.abs(player.x - (-6.5)) < 1e-6 && Math.abs(player.z - (-6.5)) < 1e-6,
  `踩上板子传到对面（${player.x.toFixed(1)}, ${player.z.toFixed(1)}）`);
ok(player.padCd > 0, '落点有冷却，不会来回弹');

/* ---- 6. AI 玩家走进传送门 → 从当前维度消失 ---- */
for (let j = 0; j < 3; j++) setBlock(60, RAIL_Y + j, 60, PORTAL_BLOCK[1]);
const b = spawnBot(60.5, RAIL_Y + 0.2, 60.5, '探针');
ok(!!b, '造出一个 AI 玩家');
ok(botPortalId(b) === PORTAL_BLOCK[1], '站在门里能被认出来');
const before = bots.length;
updateBots(DT);
ok(bots.indexOf(b) < 0, '走进门的 AI 玩家当场消失（过了门）');
ok(bots.length <= before, '不会凭空多出人');

/* ---- 7. 超平坦 ---- */
setFlatWorld(true);
setColCache(new Map());
const info = colInfo(123, -456);
ok(info.height === FLAT_H, `超平坦地表恒高（h=${info.height}）`);
ok(getEffective(123, FLAT_H, -456) === I.GRASS, '地表是草方块');
ok(getEffective(123, FLAT_H + 1, -456) === 0, '地表以上是空气（不长树、不建村庄）');
ok(getEffective(123, FLAT_H - 1, -456) === I.DIRT, '地表以下是泥土');
ok(FLAT_H > 16, '平坦地表高于海平面，不会被水淹');
setFlatWorld(false);
setColCache(new Map());

/* ---- 8. 玩家过门时，站在同一扇门里的 AI 玩家跟着过去 ----
 * 这是「AI 玩家进传送门不传送」那条问题的正面验证：
 * 过去的版本里 bots 一律被清场、且没有任何门判定，所以人站在门里毫无反应。 */
const { switchDim } = await import('../../src/game/portal.js');
/* ⚠ 必须拿命名空间对象再取属性：`const { dim } = await import(...)` 解出来的是
 * **快照**（值拷贝），setDim 之后它还是 0；只有 `S.dim` 才是活绑定。 */
const S = await import('../../src/game/state.js');
const GY = 30;
for (let j = 0; j < 2; j++) setBlock(80, GY + j, 80, PORTAL_BLOCK[1]);
player.x = 80.5; player.y = GY; player.z = 80.5; player.dead = false;
player.spawn = [80.5, GY, 80.5];
despawnAllCarts();
setBlock(80, GY - 1, 80, I.RAIL);            // 铺一节轨，车才有地方落
const cart = spawnCart(80, GY - 1, 80);
ok(!!cart, '门边停了一辆矿车');
const mate = spawnBot(80.5, GY + 0.2, 80.5, '同行');
ok(botPortalId(mate) === PORTAL_BLOCK[1], 'AI 玩家站在门里');
const went = switchDim(1);          // 0 = 主世界 → 1 = 熔火深渊
ok(went === true && S.dim === 1, `玩家过门成功（dim=${S.dim}）`);
ok(carts.length === 0, '矿车跟着清场（它的坐标属于旧维度）');
ok(bots.some((b) => b.name === '同行'), '跟着过门的 AI 玩家在新维度出现了');
const m2 = bots.find((b) => b.name === '同行');
ok(!m2 || Math.hypot(m2.x - player.x, m2.z - player.z) < 20, '他落在玩家附近');
ok(!m2 || botPortalId(m2) === 0, '他没有落在门里（否则下一帧又会消失）');

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
