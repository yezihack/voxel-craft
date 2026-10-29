/* 无头验证：存档导出 / 导入（save.js 存储层）
 *
 * 用法：node .scratch/saveio/probe.mjs
 *
 * 只 stub DOM / WebGL / 音频，其余走真实代码。
 * 验证点：导出的是浏览器里那份原始 JSON；导入校验三连（坏 JSON / 错版本 /
 * 非对象）；导入后 loadGame 真的把世界换成文件里那份；meta 同步重建。 */

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

/* 引擎模块顶层就要拿 canvas 建 GL 上下文 —— 先喂一个假画布再 import */
const C2D = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? undefined : noop) });
const CTX_CANVAS = {
  width: 512, height: 512, style: {}, addEventListener: noop, removeEventListener: noop,
  getContext: (type) => (String(type).startsWith('webgl') ? GLC : C2D),
};
const CH = await import('../../src/game/canvasHost.js');
CH.setCanvas(CTX_CANVAS);

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` —— ${extra}` : ''}`); }
};

const S = await import('../../src/game/save.js');
const { player } = await import('../../src/game/player.js');
const { setSEED, setFlatWorld } = await import('../../src/game/state.js');
const { dimEdits } = await import('../../src/game/generate.js');
const { inv } = await import('../../src/game/survival.js');

/* ---------- 造一份有内容的存档 ---------- */
setSEED(20261029);
setFlatWorld(true);
player.x = 12.5; player.y = 40; player.z = -7.25;
player.hp = 13;
inv.set(1, 64); inv.set(2, 3);
dimEdits[0].set('3,40,3', 5);
dimEdits[0].set('4,40,4', 0);
const sr = S.saveGame();
ok(sr.ok, 'saveGame 写盘成功', JSON.stringify(sr));

/* ---------- 1. 导出 ---------- */
const json = S.exportSaveJson();
ok(typeof json === 'string' && json.length > 0, 'exportSaveJson 返回非空字符串');
const parsed = JSON.parse(json);
ok(parsed.v === S.SAVE_VERSION, '导出内容带正确版本号', `v=${parsed.v}`);
ok(parsed.seed === 20261029 && parsed.flat === true, '种子 / 世界类型随档导出');
ok(parsed.player.x === 12.5 && parsed.player.hp === 13, '玩家状态随档导出');
ok(Array.isArray(parsed.edits) && parsed.edits[0].length === 2, '改动方块表随档导出');

/* 没档时也能导出（内存快照兜底） */
S.deleteSave();
ok(S.exportSaveJson() !== null, '无档时导出走内存快照兜底');
S.saveGame();

/* ---------- 2. 导入校验三连 ---------- */
let r = S.importSaveJson('{这不是JSON');
ok(!r.ok && r.reason === 'parse', '坏 JSON → parse 拒绝', JSON.stringify(r));
r = S.importSaveJson('[]');
ok(!r.ok && r.reason === 'parse', '数组 → parse 拒绝');
r = S.importSaveJson(JSON.stringify({ v: 999, seed: 1 }));
ok(!r.ok && r.reason === 'version', '版本号不认识 → version 拒绝');

/* ---------- 3. 导入即生效 ---------- */
const hacked = JSON.parse(json);
hacked.seed = 777;
hacked.player.x = -55.5;
hacked.player.hp = 7;
hacked.edits[0] = [['9,41,9', 3]];
r = S.importSaveJson(JSON.stringify(hacked));
ok(r.ok, '合法档导入成功', JSON.stringify(r));
ok(S.hasSave(), '导入后浏览器里已有存档（可直接「继续」）');
const meta = S.saveMeta();
ok(meta && meta.seed === undefined && typeof meta.dim === 'number', 'meta 已同步重建');
const lr = S.loadGame();
ok(lr.ok, '导入后 loadGame 成功');
ok(player.x === -55.5 && player.hp === 7, '玩家状态来自导入档', `x=${player.x} hp=${player.hp}`);
ok(JSON.parse(S.exportSaveJson()).seed === 777, '浏览器存档已被导入档覆盖（seed=777）');
ok(dimEdits[0].get('9,41,9') === 3 && dimEdits[0].size === 1, '改动表整体替换，不与旧世界叠加');

/* ---------- 4. 往返完整性：再导出 → 再导入，内容一致 ---------- */
const again = S.exportSaveJson();
ok(S.importSaveJson(again).ok, '二次导入成功');
const j1 = JSON.parse(json), j2 = JSON.parse(S.exportSaveJson());
ok(JSON.stringify({ s: j2.seed, p: j2.player, e: j2.edits })
  === JSON.stringify({ s: hacked.seed, p: hacked.player, e: hacked.edits }),
  '导出 → 导入 → 再导出内容一致（往返无损）');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
