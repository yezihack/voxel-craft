/* 无头验证：生物打 AI 玩家，AI 玩家到底掉不掉血
 *
 * 用法：node .scratch/crash/botdamage.mjs
 *
 * 只 stub DOM / WebGL / 音频，其余走真实代码。 */

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
const B = await import('../../src/game/bots.js');
const { bots, spawnBot, installBotHook, botBagAdd, killBot } = B;
const M = await import('../../src/game/mobs.js');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};

/* 一片平地 */
for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) setBlock(x, 30, z, I.STONE);
player.x = 0; player.y = 31; player.z = 0; player.dead = false;
S.setRunning(true);

installBotHook();
ok(M.botHook.list === bots, 'botHook 已注入（mobs 能把 bot 当猎物）');
ok(typeof M.botHook.damage === 'function', 'botHook.damage 是函数');

/* 一只僵尸，贴着 bot */
function freshZombie(x, z) {
  const m = M.spawnMob('zombie', x, 31, z);
  if (m) { m.y = 31; m.atkT = 0; m.onGround = true; }
  return m;
}

/* ---- 1. 近战：僵尸从 3 格外走过来，应该打到 bot ----
 * 注意必须同时跑 mobPhysics：只跑 mobAI 的话僵尸只是「设了速度」，
 * 位置永远不变，永远停在 atkRange 之外 —— 那样测出来的是假阴性。 */
{
  const b = spawnBot(2.5, 31, 0.5, '沙包');
  b.hp = 20; b.state = 'idle';
  const m = freshZombie(2.5, 3.5);
  ok(!!m, '僵尸生成成功');
  const before = b.hp;
  let reached = 1e9;
  for (let i = 0; i < 240; i++) {
    m.animT += 0.016;
    M.mobPhysics(m, 0.016);
    M.mobAI(m, 0.016);
    reached = Math.min(reached, Math.hypot(m.x - b.x, m.z - b.z));
  }
  ok(reached < 1.4, '僵尸确实走到了攻击距离内', `最近 ${reached.toFixed(2)} 格`);
  ok(b.hp < before, '僵尸近战打掉了 AI 玩家的血', `hp ${before} → ${b.hp}`);
  killBot(b);
}

/* ---- 2. 骷髅：远程箭应该能命中 bot ---- */
{
  const b = spawnBot(-2.5, 31, 0.5, '靶子');
  b.hp = 20;
  const m = M.spawnMob('skeleton', -2.5, 31, 6.0);
  ok(!!m, '骷髅生成成功');
  m.atkT = 0;
  const before = b.hp;
  for (let i = 0; i < 400; i++) {
    m.animT += 0.016;
    M.mobAI(m, 0.016);
    M.updateArrows(0.016);
  }
  ok(b.hp < before, '骷髅的箭打掉了 AI 玩家的血', `hp ${before} → ${b.hp}`);
  killBot(b);
}

/* ---- 3. 苦力怕：爆炸应该波及 bot ---- */
{
  const b = spawnBot(0.5, 31, 4.5, '近爆');
  b.hp = 20;
  const m = M.spawnMob('creeper', 0.5, 31, 6.0);
  ok(!!m, '苦力怕生成成功');
  const before = b.hp;
  for (let i = 0; i < 400 && !m.dead; i++) { m.animT += 0.016; M.mobAI(m, 0.016); }
  ok(b.hp < before, '苦力怕爆炸波及 AI 玩家', `hp ${before} → ${b.hp}`);
  killBot(b);
}

/* ---- 4. 回血不能盖过挨打（这才是「AI 玩家好像不掉血」的真凶） ---- */
{
  const b = spawnBot(0.5, 31, -2.5, '抗揍');
  b.hp = 20; b.state = 'idle';
  const m = freshZombie(0.5, -5.0);
  const dt = 1 / 60;
  let hits = 0, last = b.hp, minHp = b.hp;
  for (let i = 0; i < 60 * 12; i++) {          // 模拟 12 秒
    m.animT += dt;
    M.mobPhysics(m, dt);
    M.mobAI(m, dt);
    /* 把状态锁在 idle：不然 bot 会跑去打架或者回家，测的就不是「站桩挨打」了。
     * botStep 仍然要跑 —— healT 那一路回血写在它里面，跳过它就测不出回血。 */
    b.state = 'idle';
    B.botStep(b, dt);
    if (b.hp < last) { hits++; last = b.hp; }
    if (b.hp < minHp) minHp = b.hp;
  }
  ok(hits >= 3, '12 秒内被结结实实打中多次', `${hits} 次`);
  ok(minHp < 10, '血量真的掉下去了（回血没把它顶回来）', `最低 ${minHp.toFixed(1)}/20`);
}

/* ---- 5. 禁疗窗口：挨打后 6 秒内吃东西也回不了血 ---- */
{
  const b = spawnBot(4.5, 31, 0.5, '伤员');
  b.hp = 20; b.food = 20;
  M.botHook.damage(b, 6);                       // 20 → 14
  ok(b.hp === 14, '一次 6 点伤害生效', `hp=${b.hp}`);
  ok(b.regenBlockT === 6, '受伤后进入 6 秒禁疗');
  b.state = 'eat';
  for (let i = 0; i < 60; i++) B.botEat(b, 1 / 60);   // 吃 1 秒
  ok(b.hp === 14, '禁疗期内吃东西不回血', `hp=${b.hp}`);
  b.regenBlockT = 0;
  b.state = 'eat';
  for (let i = 0; i < 60; i++) B.botEat(b, 1 / 60);   // 再吃 1 秒
  ok(b.hp > 14, '禁疗结束后正常回血', `hp=${b.hp.toFixed(1)}`);
  killBot(b);
}

/* ---- 6. 上限与距离 ---- */
{
  const C = await import('../../src/game/config.js');
  ok(M.MOB_CAP >= 60, '场上生物上限调高了', `MOB_CAP=${M.MOB_CAP}`);
  ok(C.REACH >= 12, '挖掘 / 放置距离调远了', `REACH=${C.REACH}`);
  ok(C.REACH_ATTACK < C.REACH, '攻击距离单独一个值，且比挖放近',
    `REACH_ATTACK=${C.REACH_ATTACK}`);

  /* 上限不是写在注释里的数字，得真能塞进去。
   * 注意 spawnMob 本身**不做**上限检查 —— 挡板在自然刷怪（updateMobSpawn）
   * 和刷怪蛋（trySpawnEgg）两个入口上，内部调用方（boss 召唤小怪）自己判。
   * 所以这里直接塞满，然后验证自然刷怪不会再往上堆。 */
  M.despawnAllMobs();
  for (let i = 0; i < M.MOB_CAP; i++) {
    M.spawnMob('pig', 20 + (i % 9), 31, 20 + Math.floor(i / 9));
  }
  ok(M.mobs.length === M.MOB_CAP, '同屏真的能放下 MOB_CAP 只生物', `实际 ${M.mobs.length} 只`);
  for (let i = 0; i < 20; i++) M.updateMobSpawn(0.2);
  ok(M.mobs.length === M.MOB_CAP, '到顶后自然刷怪不再往上堆', `实际 ${M.mobs.length}`);
  M.despawnAllMobs();
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
