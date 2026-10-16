/* 无头冒烟：验证「进传送门后落在门侧边、不会无限回传」
 * 只 stub 掉 DOM / WebGL / 音频，游戏逻辑（portal/dims/generate）全部走真实代码。 */
const noop = () => {};
/* 万能挡板：既可以被当函数调用（getContext()），也可以继续取属性（.data[i]）。 */
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
  createOscillator() { return mk(); }
  createGain() { return mk(); }
  get destination() { return mk(); }
  get currentTime() { return 0; }
};

/* ---- WebGL / 2D 上下文挡板 ----
 * 只兜住引擎顶层会真的去读返回值的那几个调用，其余一律空转。 */
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
/* 引擎模块顶层就要 canvas 建 GL 上下文 —— 动态 import 之前先把画布塞进去 */
const CH_ = await import('../../src/game/canvasHost.js');
CH_.setCanvas(CTX_CANVAS);

const P = await import('../../src/game/portal.js');
const { getEffective, setBlock, dimEdits } = await import('../../src/game/generate.js');
const { PORTAL_BLOCK, PORTAL_DIM, I, PW } = await import('../../src/game/config.js');
const S = await import('../../src/game/state.js');
const { player } = await import('../../src/game/player.js');

/* ---- 场景：在一块掏空的大厅里搭门（否则异界 y=10 本身就是实心岩石）---- */
const GY = 9;                                   // 地板层
function hall(d, half = 6) {
  S.setDim(d); S.setEdits(dimEdits[d]);
  for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) {
    setBlock(x, GY, z, I.STONE);                // 地板
    for (let y = GY + 1; y <= GY + 6; y++) setBlock(x, y, z, 0);   // 掏空
  }
}
function buildPortal(toDim, ox, oy, oz, ux, uz) {
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++)
    setBlock(ox + i * ux, oy + j, oz + i * uz, PORTAL_BLOCK[toDim]);
}
/* 玩家 AABB 里还有没有门方块 */
function inPortal(x, y, z) {
  const x0 = Math.floor(x - PW), x1 = Math.floor(x + PW - 1e-6);
  const y0 = Math.floor(y),      y1 = Math.floor(y + 1.8 - 1e-6);
  const z0 = Math.floor(z - PW), z1 = Math.floor(z + PW - 1e-6);
  for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++)
    if (PORTAL_DIM[getEffective(xx, yy, zz)] !== undefined) return true;
  return false;
}

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fails++; };

console.log('— 用例 1：站在门里 → 落点必须挪到门外侧，且站得住 —');
{
  hall(0);
  buildPortal(5, 0, GY + 1, 0, 1, 0);           // u = x：门洞占 (0..1, 10..12, 0)
  const side = P.portalSidePos(0.5, GY + 1, 0.5);
  ok(side !== null, '返回了挪动后的落点');
  ok(!inPortal(...side), '挪完的落点不再覆盖门方块（不会立刻再被传走）');
  ok(side[1] === GY + 1 && getEffective(Math.floor(side[0]), GY, Math.floor(side[2])) === I.STONE,
     '落点在地板上，不是悬空 / 卡在石头里');
  console.log('    门中心 [0.5,10,0.5] → 落点', side.map(v => +v.toFixed(2)));
}

console.log('— 用例 2：门正/背面被墙堵死 → 沿门宽方向越过立柱挪到侧边 —');
{
  hall(1);
  buildPortal(0, 0, GY + 1, 0, 1, 0);
  for (const dz of [-2, -1, 1, 2])               // 法线（z）两侧全砌墙
    for (let y = GY + 1; y <= GY + 5; y++) for (let x = -6; x <= 6; x++) setBlock(x, y, dz, I.STONE);
  const side = P.portalSidePos(0.5, GY + 1, 0.5);
  ok(side !== null, '仍找到了落点');
  ok(!inPortal(...side), '落点不在门里');
  ok(Math.abs(side[0] - 0.5) > 1 && Math.abs(side[2] - 0.5) < 0.01,
     '沿门宽（x）方向越过了立柱: ' + JSON.stringify(side.map(v => +v.toFixed(2))));
}

console.log('— 用例 3：本来就不在门里 → 原样不动 —');
{
  hall(2);
  ok(P.portalSidePos(3.5, GY + 1, 3.5) === null, '空地上返回 null（不改动落点）');
}

console.log('— 用例 4：来回切两次，返程点永远不在门里（无限回传的根因）—');
{
  hall(0);
  buildPortal(3, 0, GY + 1, 0, 1, 0);            // 主世界 → 霜寂
  player.x = 0.5; player.y = GY + 1; player.z = 0.5; player.dead = false;
  ok(P.portalIdInPlayer() !== 0, '玩家确实站在门里');
  ok(P.switchDim(3), '切到维度 3');
  ok(P.portalIdInPlayer() === 0, '落地瞬间不踩门（否则冷却一过立刻回传）');
  const p1 = [player.x, player.y, player.z];
  S.setEdits(dimEdits[3]);
  const back = P.buildReturnPortal(0);           // 在 3 号维度脚边补一扇回程门
  ok(back !== null, '生成了回程门 @ ' + (back ? back.map(v => +v.toFixed(2)) : null));
  player.x = back[0]; player.y = back[1]; player.z = back[2];
  ok(P.portalIdInPlayer() !== 0, '站进回程门');
  ok(P.switchDim(0), '切回主世界');
  ok(P.portalIdInPlayer() === 0, '回主世界后也不踩门 —— 无限回传被切断');
  console.log('    维度3落点', p1.map(v => +v.toFixed(2)),
              '→ 回主世界落点', [player.x, player.y, player.z].map(v => +v.toFixed(2)));
}

console.log(fails ? '\n✗ ' + fails + ' 项失败' : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
