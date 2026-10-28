/* 无头验证：僵尸 / 骷髅白天见光烧不烧
 *
 * 用法：node .scratch/sunburn/probe.mjs
 *
 * 只 stub DOM / WebGL / 音频，其余走真实代码。
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
const S = await import('../../src/game/state.js');
const { setBlock } = await import('../../src/game/generate.js');
const { player } = await import('../../src/game/player.js');
const M = await import('../../src/game/mobs.js');
const { DAY_LEN, setWorldTime, spawnMob, updateMobs, mobs, isNight, dayPhase } = M;

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};

/* 一片平地（y=30 石头），玩家站上面。头顶一路到世界顶（64）都是空气 → 露天 */
for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) setBlock(x, 30, z, I.STONE);
player.x = 0; player.y = 31; player.z = 0; player.dead = false;
S.setRunning(true);

const DAY = DAY_LEN * 0.25;      // 正午
const NIGHT = DAY_LEN * 0.75;    // 深夜
ok(!(() => { setWorldTime(DAY); return isNight(); })(), 'setWorldTime(正午) → 判定为白天');
ok((() => { setWorldTime(NIGHT); return isNight(); })(), 'setWorldTime(深夜) → 判定为夜晚');

/* 跑一段 updateMobs，返回这只怪还剩多少血 */
function run(m, seconds, step = 0.1) {
  for (let t = 0; t < seconds; t += step) {
    if (m.dead) break;
    updateMobs(step, false);          // doSpawn=false：别让自动刷怪混进来
  }
  return m;
}
function clear() { mobs.length = 0; }

/* ---------- 1. 白天露天：烧 ---------- */
{
  setWorldTime(DAY);
  clear();
  const z = spawnMob('zombie', 3, 31, 0);
  z.hp = 20;
  run(z, 5);
  console.log(`\n白天露天 5 秒：僵尸 hp ${z.hp.toFixed(1)}`);
  ok(z.hp < 20 - 5 * M.SUNBURN_DPS * 0.6, '白天露天的僵尸在掉血',
    `掉了 ${(20 - z.hp).toFixed(1)}（期望≈${(5 * M.SUNBURN_DPS).toFixed(1)}）`);
  ok(z.burnFx > 0.5, '燃烧视觉强度已拉起来', `burnFx ${z.burnFx.toFixed(2)}`);
}

/* ---------- 2. 白天有顶：不烧 ---------- */
/* 天花板必须盖一整片：僵尸会追玩家，只盖一格的话它走两步就晒到了。 */
const roof = (on) => {
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) setBlock(x, 34, z, on ? I.STONE : 0);
};
{
  setWorldTime(DAY);
  clear();
  roof(true);
  const z = spawnMob('zombie', 5, 31, 0);
  z.hp = 20;
  run(z, 5);
  console.log(`\n白天有遮挡 5 秒：僵尸 hp ${z.hp.toFixed(1)}（僵尸会走动，所以天花板要盖整片）`);
  ok(z.hp === 20, '头顶有方块挡住太阳 → 不烧', `hp ${z.hp}`);
  ok(!z.burning, 'burning 判定为 false');
  roof(false);
}

/* ---------- 3. 夜里露天：不烧 ---------- */
{
  setWorldTime(NIGHT);
  clear();
  const z = spawnMob('zombie', 3, 31, 0);
  z.hp = 20;
  run(z, 5);
  console.log(`\n夜里露天 5 秒：僵尸 hp ${z.hp.toFixed(1)}`);
  ok(z.hp === 20, '夜里露天不烧', `hp ${z.hp}`);
}

/* ---------- 4. 骷髅也烧 ---------- */
{
  setWorldTime(DAY);
  clear();
  const s = spawnMob('skeleton', 3, 31, 0);
  s.hp = 20;
  run(s, 4);
  console.log(`\n白天露天 4 秒：骷髅 hp ${s.hp.toFixed(1)}`);
  ok(s.hp < 20, '骷髅白天也烧', `hp ${s.hp.toFixed(1)}`);
}

/* ---------- 5. 其它生物不烧 ---------- */
/* 分开测：苦力怕会凑到猪身边引爆，一起跑的话猪掉的血是炸的，不是烧的。 */
{
  setWorldTime(DAY);
  clear();
  const pig = spawnMob('pig', 3, 31, 0);
  pig.hp = 10;
  run(pig, 4);
  console.log(`\n白天露天 4 秒：猪 hp ${pig.hp}`);
  ok(pig.hp === 10, '猪不烧', `hp ${pig.hp}`);

  clear();
  const creep = spawnMob('creeper', 3, 31, 0);
  creep.hp = 20;
  run(creep, 3);
  console.log(`白天露天 3 秒：苦力怕 hp ${creep.hp}`);
  ok(creep.hp === 20, '苦力怕不烧', `hp ${creep.hp}`);
}

/* ---------- 6. 烧到死：会从场上消失 ---------- */
{
  setWorldTime(DAY);
  clear();
  const z = spawnMob('zombie', 3, 31, 0);
  z.hp = 5;
  const before = mobs.length;
  run(z, 6);
  console.log(`\n残血 5 点烧 6 秒：dead=${z.dead}，场上 ${before} → ${mobs.length}`);
  ok(z.dead, '血烧光后 dead=true');
  ok(mobs.length === 0, '尸体从 mobs 里被清掉');
}

/* ---------- 7. 进阴影后火会灭 ---------- */
{
  setWorldTime(DAY);
  clear();
  const z = spawnMob('zombie', 3, 31, 0);
  z.hp = 20;
  run(z, 1.5);
  const lit = z.burnFx;
  roof(true);                          // 整片盖上
  run(z, 2);
  console.log(`\n盖顶后：burnFx ${lit.toFixed(2)} → ${z.burnFx.toFixed(2)}，burning=${z.burning}`);
  ok(lit > 0.3, '盖顶前已经在烧', `burnFx ${lit.toFixed(2)}`);
  ok(z.burnFx < lit, '盖顶后火苗渐熄');
  ok(!z.burning, '盖顶后 burning=false');
  roof(false);
}

/* ---------- 8. 夜晚推进到白天会自动开烧 ---------- */
{
  setWorldTime(NIGHT);
  clear();
  const z = spawnMob('zombie', 3, 31, 0);
  z.hp = 20;
  run(z, 2);
  const atNight = z.hp;
  ok(atNight === 20, '夜里不掉血');
  /* 把时间直接拨到白天（模拟天亮），世界时间在 updateMobs 里还会自增，
   * 所以拨到正午附近，跑 2 秒不会滑出白天 */
  setWorldTime(DAY);
  run(z, 2);
  console.log(`\n拨到白天再跑 2 秒：hp ${z.hp.toFixed(1)}`);
  ok(z.hp < atNight, '天亮后同一个僵尸开始掉血', `hp ${z.hp.toFixed(1)}`);
}

await import('node:fs').then((fs) => {
  fs.mkdirSync('.scratch/sunburn', { recursive: true });
});

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
