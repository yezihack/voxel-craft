/* 无头验证：挖掉的方块能不能活过存档往返
 *
 * 用法：node .scratch/savehole/probe.mjs
 *
 * 背景（bug）：玩家挖出来的沟，导出再导入之后长回去了；放上去的方块却还在。
 * 根因是 setBlock 把「挖成空气」记成 `edits.set(key, 0)`（值是 0，不是删掉这条），
 * 而 applySave 恢复时写的是 `if (id > 0)` —— 把 0 全过滤掉了。
 *
 * 验证点：
 *   ① 挖掘真的会在覆盖层留下一条值为 0 的记录（这是前提，不是巧合）
 *   ② 存档 / 导出里带着这条 0 记录
 *   ③ 读档后这一格仍然是空气（沟还在），且放上去的方块也还在
 *   ④ 非法 id（超界 / 负数 / NaN / 非字符串键）仍然被挡掉 —— 修 bug 不能顺手把护栏拆了
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
    default: return noop;
  }
} });
globalThis.HTMLCanvasElement = class { getContext() { return GLC; } };

const C2D = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? undefined : noop) });
const CTX_CANVAS = {
  width: 512, height: 512, style: {}, addEventListener: noop, removeEventListener: noop,
  getContext: (type) => (String(type).startsWith('webgl') ? GLC : C2D),
};
const CH = await import('../../src/game/canvasHost.js');
CH.setCanvas(CTX_CANVAS);

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}${extra ? `  · ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? `  · ${extra}` : ''}`); }
};

const S = await import('../../src/game/save.js');
const G = await import('../../src/game/generate.js');
const { setSEED, setFlatWorld } = await import('../../src/game/state.js');

setSEED(20261031);
setFlatWorld(true);

/* ---------- 找一格确定的实心地形 ---------- */
let X = 5, Y = 0, Z = 5;
for (let y = 40; y >= 1; y--) {
  if (G.getBlock(X, y, Z) > 0) { Y = y; break; }
}
ok(Y > 0, '找到一格实心地形', `${X},${Y},${Z} = ${G.getBlock(X, Y, Z)}`);

/* ---------- ① 挖掘会在覆盖层留下 0 ---------- */
const KEY = G.EKEY(X, Y, Z);
G.setBlock(X, Y, Z, 0);
ok(G.getEffective(X, Y, Z) === 0, '挖掉之后这格是空气');
ok(G.dimEdits[0].get(KEY) === 0, '覆盖层记下一条值为 0 的记录', `${KEY} → ${G.dimEdits[0].get(KEY)}`);
ok(G.dimEdits[0].has(KEY), '这条记录是「留着」而不是「删掉」');

/* 再往上放一格，用来对照「放的能活、挖的不能活」 */
const PY = Y + 3;
const PKEY = G.EKEY(X, PY, Z);
G.setBlock(X, PY, Z, 5);
ok(G.dimEdits[0].get(PKEY) === 5, '放上去的方块记成 5');

/* ---------- ② 存档与导出都带着这条 0 ---------- */
S.saveGame();
const json = S.exportSaveJson();
const parsed = JSON.parse(json);
const list = parsed.edits[0] || [];
const holePair = list.find((p) => p[0] === KEY);
const putPair = list.find((p) => p[0] === PKEY);
ok(!!holePair, '导出文件里有挖掉那格', JSON.stringify(holePair));
ok(holePair && holePair[1] === 0, '导出文件里它的值是 0', holePair ? String(holePair[1]) : '');
ok(!!putPair && putPair[1] === 5, '导出文件里有放上去那格', JSON.stringify(putPair));

/* ---------- ③ 导入 + 读档，沟必须还在 ---------- */
S.deleteSave();
const ir = S.importSaveJson(json);
ok(ir.ok, '导入成功', JSON.stringify(ir));
const lr = S.loadGame();
ok(lr.ok, '读档成功');

ok(G.getEffective(X, Y, Z) === 0, '读档后挖掉那格仍是空气（沟还在）',
  `getEffective=${G.getEffective(X, Y, Z)}`);
ok(G.dimEdits[0].has(KEY), '读档后覆盖层仍保留这条记录');
ok(G.dimEdits[0].get(KEY) === 0, '读档后它的值仍是 0');
ok(G.getEffective(X, PY, Z) === 5, '读档后放上去的方块还在');

/* 顺带确认没有被「长回原样」：原始地形在这一格本来是有方块的 */
ok(G.getBlock(X, Y, Z) > 0, '该格原始地形本来非空（所以「长回去」确实是 bug）',
  `getBlock=${G.getBlock(X, Y, Z)}`);

/* ---------- ④ 护栏还在：非法 id 一律挡掉 ---------- */
const bad = JSON.parse(json);
bad.edits[0] = [
  ['1,1,1', 99999],      // 超出方块 id 上界
  ['2,2,2', -7],         // 负数
  ['3,3,3', 'abc'],      // NaN
  [4, 5],                // 非字符串键
  ['6,6,6', 0],          // 合法：空气
  ['7,7,7', 3],          // 合法：泥土
];
S.importSaveJson(JSON.stringify(bad));
S.loadGame();
ok(!G.dimEdits[0].has('1,1,1'), '超界 id 被挡掉');
ok(!G.dimEdits[0].has('2,2,2'), '负数 id 被挡掉');
ok(!G.dimEdits[0].has('3,3,3'), 'NaN 被挡掉');
ok(!G.dimEdits[0].has(4), '非字符串键被挡掉');
ok(G.dimEdits[0].get('6,6,6') === 0, '值为 0 的合法记录保留');
ok(G.dimEdits[0].get('7,7,7') === 3, '值为 3 的合法记录保留');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
