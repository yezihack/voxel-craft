/* 无头验证：场上生物数量上限（MOB_CAP）已彻底删除。
 *
 * 用法：node .scratch/mob-cap/probe.mjs
 *
 * 复用 .scratch/boss/probe.mjs 的 DOM/WebGL/音频 stub：textures.js 模块顶层
 * 就要 document.createElement，node 直跑会炸，所以只 stub 掉宿主 API，
 * 游戏逻辑全部走真实模块。
 *
 * 关键判据：旧代码有 4 道数量闸，任意一道留下都会让 mobs.length 卡在 64。
 * 这里逐个入口跑到 200 只以上，并用「RNG 是否被消费」精确判断
 * updateMobSpawn 有没有因数量提前 return（不依赖地形是否真刷得出怪）。 */
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

/* mobRng 在模块求值时会把 Math.random 存进 export let（没有 setter，
 * 外部改不动）。所以必须在 import 任何游戏模块之前替换它：
 * 保留真随机（贴图噪声照常），只额外计一次调用数。 */
const realRandom = Math.random;
let rngCalls = 0;
Math.random = () => { rngCalls++; return realRandom(); };

const CH = await import('../../src/game/canvasHost.js');
CH.setCanvas(CTX_CANVAS);

const { I } = await import('../../src/game/config.js');
const { setBlock } = await import('../../src/game/generate.js');
const { player } = await import('../../src/game/player.js');
const M = await import('../../src/game/mobs.js');
const {
  mobs, spawnMob, summonGolem, canSummonAt, updateMobSpawn,
  setWorldTime, DAY_LEN, GUARD_CAP,
} = M;

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? ' — ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? ' — ' + extra : ''));
  return cond;
};

/* ---- 1. 常量本身已移除 ---- */
ok(M.MOB_CAP === undefined, 'MOB_CAP 不再导出');

/* ---- 2. spawnMob：旧上限 64，这里直接顶到 200 ---- */
mobs.length = 0;
let rejected = 0;
for (let i = 0; i < 200; i++) {
  const m = spawnMob('pig', i % 16, 40, Math.floor(i / 16));
  if (!m) rejected++;
}
ok(rejected === 0 && mobs.length === 200,
  'spawnMob 连放 200 只全部成功', `len=${mobs.length}, rejected=${rejected}`);
ok(mobs.length > 64, '场上数量已超过旧的 64 上限', `len=${mobs.length}`);

/* ---- 3. summonGolem：旧的 `mobs.length >= MOB_CAP` 就在这里 ----
 * 造一块合规平台：脚下实心、头顶若干格为空。 */
const gx = 0, gz = 0, gy = 31;
setBlock(gx, gy - 1, gz, I.STONE);
for (let i = 0; i < 6; i++) setBlock(gx, gy + i, gz, 0);
ok(canSummonAt('golem_iron', gx, gy, gz), '测试平台满足召唤条件');
const before = mobs.length;
const golem = summonGolem('golem_iron', gx, gy, gz, 0);
ok(!!golem && mobs.length === before + 1,
  'summonGolem 在 200+ 只之后仍能召唤', `len=${mobs.length}`);

/* ---- 4. updateMobSpawn：旧总闸在 `if (mobs.length >= MOB_CAP || player.dead)` ----
 * 数量闸若还在，会在消费任何 RNG 之前 return；放行了则白天块第一步
 * `if (mobRng() < 0.45)` 至少消费一次。用 RNG 计数判定，与地形能否刷出怪无关。 */
player.dead = false;
setWorldTime(DAY_LEN * 0.25);                 // 正午，走白天分支
rngCalls = 0;
updateMobSpawn(2);                            // mobSpawnT 初值 2，dt=2 让计时归零
ok(rngCalls > 0, 'updateMobSpawn 在 200+ 只时仍进入刷怪逻辑', `rngCalls=${rngCalls}`);

/* ---- 5. 对照：player.dead 门控必须还在（别把整行删掉） ---- */
player.dead = true;
rngCalls = 0;
updateMobSpawn(2);                            // 上次调用后 mobSpawnT=1.0，dt=2 足够
ok(rngCalls === 0, 'player.dead 时仍不刷怪（原有门控保留）', `rngCalls=${rngCalls}`);
player.dead = false;

/* ---- 6. 本次只删「同屏总数」上限，两类生成节奏配额仍在 ---- */
ok(GUARD_CAP === 3, 'GUARD_CAP（村庄傀儡配额）保留');
ok(M.MOB_TYPES.guardian.summonAdds.cap === 4,
  'summonAdds.cap（boss 援军配额）保留');

/* ---- 7. 源码兜底：任何文件都不该再引用 MOB_CAP 或旧提示 ---- */
const { readFileSync } = await import('node:fs');
const src = ['mobs.js', 'actions.js']
  .map((f) => readFileSync(new URL('../../src/game/' + f, import.meta.url), 'utf8'))
  .join('\n');
ok(!/\bMOB_CAP\b/.test(src.replace(/^.*MOB_CAP 已按玩家要求删除.*$/m, ''))
  && !/场上生物太多了/.test(src), '源码里已无 MOB_CAP 引用与「场上生物太多」提示');

console.log(fails ? `\nFAIL  ${fails} 条断言未通过` : '\nALL PASS');
if (fails) process.exit(1);
