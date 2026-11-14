/* 无头验收：创造模式下玩家不会被怪物攻击
 *
 * 用法：node .scratch/creative-immunity/probe.mjs
 *
 * Seam（已确认）：纯 Node，只 stub 掉 DOM / WebGL / 音频，游戏逻辑全部走真实模块，
 * 直接驱动 mobs.js / survival.js 的公共接口：
 *   hostileTarget / mobAI / updateArrows / explodeMob / hurt
 * 不触达内部私有状态，断言的是「玩家可观察到的结果与怪物的公共选择」。
 *
 * 场景：y=30 铺石地板（顶面 y=31），玩家站 (0.5, 31, 0.5)，怪贴在 1~4 格外。
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

const S = await import('../../src/game/state.js');
const { MODE, setModeState, setColCache } = S;
const { player } = await import('../../src/game/player.js');
const M = await import('../../src/game/mobs.js');
const V = await import('../../src/game/survival.js');
const { I } = await import('../../src/game/config.js');
const { setBlock, getEffective } = await import('../../src/game/generate.js');

let fails = 0;
const ok = (cond, msg, extra) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  · ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  · ' + extra : ''));
  return cond;
};
const DT = 1 / 60, FLOOR = 30;

function reset(mode) {
  setColCache(new Map());
  for (let x = -8; x <= 8; x++)
    for (let z = -5; z <= 5; z++) {
      for (let y = FLOOR - 2; y <= FLOOR; y++) setBlock(x, y, z, I.STONE);
      for (let y = FLOOR + 1; y <= FLOOR + 4; y++) setBlock(x, y, z, 0);
    }
  M.mobs.length = 0;
  M.arrows.length = 0;
  setModeState(mode);
  player.x = 0.5; player.y = FLOOR + 1; player.z = 0.5;
  player.vx = player.vy = player.vz = 0;
  player.dead = false; player.hp = player.maxHp; player.hurtFlash = 0;
  player.blocking = false;
}

/* ---------- 基线：hurt() 的既有免伤语义不能被改坏 ---------- */
reset(MODE.CREATIVE);
ok(V.hurt(5, '测试') === -1 && player.hp === player.maxHp, '基线：创造模式 hurt 不扣血');
reset(MODE.SURVIVAL);
const hp0 = player.hp;
ok(V.hurt(5, '测试') < hp0, '基线：生存模式 hurt 照常扣血');

/* ---------- 切片 1：目标选择 ---------- */
reset(MODE.CREATIVE);
const eye = { x: 0.5, y: FLOOR + 1, z: 4.5 };      // 4 格外，在视野内
ok(M.hostileTarget(eye, 20) === null, '创造模式：怪物不把玩家当目标');
reset(MODE.SURVIVAL);
const ts = M.hostileTarget(eye, 20);
ok(!!ts && ts.kind === 'player', '生存模式：怪物仍锁定玩家');
reset(MODE.SPECTATOR);
ok(M.hostileTarget(eye, 20) === null, '旁观模式：仍不锁定玩家（回归）');

/* ---------- 切片 2：贴脸近战 ---------- */
function melee(mode, frames = 120) {
  reset(mode);
  const z = M.spawnMob('zombie', player.x - 1.0, player.y, player.z, Math.PI / 2);
  let maxAtkT = 0;
  for (let f = 0; f < frames; f++) {
    z.animT += DT;
    M.mobAI(z, DT);
    maxAtkT = Math.max(maxAtkT, z.atkT);
  }
  return { hp: player.hp, vx: player.vx, vy: player.vy, vz: player.vz, maxAtkT };
}
const cre = melee(MODE.CREATIVE);
ok(cre.vx === 0 && cre.vy === 0 && cre.vz === 0, '创造模式：近战不击退玩家',
  `vx=${cre.vx.toFixed(2)} vy=${cre.vy.toFixed(2)}`);
ok(cre.hp === player.maxHp, '创造模式：近战不掉血');
ok(cre.maxAtkT === 0, '创造模式：僵尸不进入挥击冷却', `atkT=${cre.maxAtkT.toFixed(2)}`);
const sur = melee(MODE.SURVIVAL);
ok(sur.vx !== 0 || sur.hp < player.maxHp, '生存模式对照：近战照常生效',
  `vx=${sur.vx.toFixed(2)} hp=${sur.hp}`);

/* ---------- 切片 3：已在飞的敌方箭矢（目标选择断开后仍可能命中） ---------- */
function foeArrow(mode) {
  reset(mode);
  M.arrows.push({
    x: player.x, y: player.y + 0.9, z: player.z,
    vx: 0, vy: 0, vz: 0, life: 6, dmg: 3, foe: true,
  });
  M.updateArrows(DT);
  return { left: M.arrows.length, hp: player.hp };
}
const faC = foeArrow(MODE.CREATIVE);
ok(faC.left === 1, '创造模式：敌方箭穿过玩家（不产生命中特效、不吞箭）', `剩余 ${faC.left}`);
ok(faC.hp === player.maxHp, '创造模式：箭矢不掉血');
const faS = foeArrow(MODE.SURVIVAL);
ok(faS.left === 0 && faS.hp < player.maxHp, '生存模式对照：敌方箭照常命中',
  `剩余 ${faS.left} hp=${faS.hp}`);

/* ---------- 切片 4：苦力怕爆炸（击退不经过 hurt） ---------- */
function blast(mode) {
  reset(mode);
  const stoneBefore = getEffective(0, FLOOR, 0);
  const c = M.spawnMob('creeper', player.x + 0.6, player.y, player.z, 0);
  M.explodeMob(c);
  return {
    vx: player.vx, vy: player.vy, vz: player.vz, hp: player.hp,
    dug: stoneBefore !== 0 && getEffective(0, FLOOR, 0) === 0,
  };
}
const blC = blast(MODE.CREATIVE);
ok(blC.vx === 0 && blC.vy === 0 && blC.vz === 0, '创造模式：爆炸不击退玩家',
  `vx=${blC.vx.toFixed(2)} vy=${blC.vy.toFixed(2)}`);
ok(blC.hp === player.maxHp, '创造模式：爆炸不掉血');
ok(blC.dug, '创造模式：爆炸仍照常破坏方块（世界行为不变）');
const blS = blast(MODE.SURVIVAL);
ok(blS.vx !== 0 || blS.vy !== 0, '生存模式对照：爆炸照常击退', `vx=${blS.vx.toFixed(2)}`);
ok(blS.hp < player.maxHp, '生存模式对照：爆炸照常扣血', `hp=${blS.hp}`);

/* ---------- 切片 5：远程射击 / 引信 ---------- */
function siege(mode, type, dz, frames) {
  reset(mode);
  const m = M.spawnMob(type, player.x, player.y, player.z + dz, 0);
  for (let f = 0; f < frames; f++) { m.animT += DT; M.mobAI(m, DT); }
  return { arrows: M.arrows.length, fuseT: m.fuseT };
}
const skC = siege(MODE.CREATIVE, 'skeleton', 7, 150);
ok(skC.arrows === 0, '创造模式：骷髅不对玩家放箭', `${skC.arrows} 支`);
const skS = siege(MODE.SURVIVAL, 'skeleton', 7, 150);
ok(skS.arrows > 0, '生存模式对照：骷髅照常放箭', `${skS.arrows} 支`);
const crC = siege(MODE.CREATIVE, 'creeper', 1.5, 60);
ok(crC.fuseT === 0, '创造模式：苦力怕不点燃引信', `fuseT=${crC.fuseT.toFixed(2)}`);
const crS = siege(MODE.SURVIVAL, 'creeper', 1.5, 60);
ok(crS.fuseT > 0, '生存模式对照：苦力怕照常点燃引信', `fuseT=${crS.fuseT.toFixed(2)}`);

/* ---------- 切片 6：boss 与傀儡 ---------- */
function witherSiege(mode) {
  reset(mode);
  const w = M.spawnMob('wither', player.x, player.y + 2, player.z + 8, 0);
  for (let f = 0; f < 120; f++) { w.animT += DT; M.mobAI(w, DT); }
  return { arrows: M.arrows.length, floor: getEffective(0, FLOOR, 0) };
}
const wiC = witherSiege(MODE.CREATIVE);
ok(wiC.arrows === 0, '创造模式：凋灵不对玩家喷弹', `${wiC.arrows} 发`);
ok(wiC.floor !== 0, '创造模式：凋灵不在玩家脚下爆破方块');
const wiS = witherSiege(MODE.SURVIVAL);
ok(wiS.arrows > 0, '生存模式对照：凋灵照常喷弹', `${wiS.arrows} 发`);

reset(MODE.CREATIVE);
M.spawnMob('golem_iron', eye.x, eye.y, eye.z, 0);
const tg = M.hostileTarget(eye, 20);
ok(!!tg && tg.kind === 'guard', '创造模式：怪物仍会锁定傀儡（没有整体哑火）');

/* ---------- 切片 7：审查补强 ---------- */
/* 上面「凋灵不在玩家脚下爆破方块」原本是空断言：reset 后地板恒非 0，
 * 无法区分「没炸」和「炸了没炸到」。先用生存模式证明同一场景确实炸得动，
 * 创造模式那条才有对照意义。 */
ok(wiS.floor === 0, '生存模式对照：凋灵爆破确实能挖掉玩家脚下方块');

reset(MODE.CREATIVE);
M.botHook.list = [{ x: eye.x, y: eye.y, z: eye.z - 3, dead: false }];
const tb = M.hostileTarget(eye, 20);
ok(!!tb && tb.kind === 'bot', '创造模式：怪物仍会锁定 AI 玩家');
M.botHook.list = null;

reset(MODE.CREATIVE);
const golem = M.spawnMob('golem_iron', player.x + 1.2, player.y, player.z, 0);
const attacker = M.spawnMob('zombie', player.x + 2.2, player.y, player.z, 0);
const golemHp = golem.hp;
for (let f = 0; f < 60; f++) { attacker.animT += DT; M.mobAI(attacker, DT); }
ok(golem.hp < golemHp, '创造模式：僵尸仍会实打傀儡（不只是锁定）',
  `hp ${golemHp} → ${golem.hp}`);

reset(MODE.CREATIVE);
const wanderer = M.spawnMob('zombie', player.x + 3, player.y, player.z, 0);
wanderer.moveX = 1; wanderer.wanderT = 999;      // 定死闲逛方向，去掉随机性
for (let f = 0; f < 30; f++) { wanderer.animT += DT; M.mobAI(wanderer, DT); }
ok(wanderer.vx > 0 && !wanderer.dead, '创造模式：怪物仍游荡（未被冻结或清掉）',
  `vx=${wanderer.vx.toFixed(2)}`);

const faSp = foeArrow(MODE.SPECTATOR);
ok(faSp.left === 1 && faSp.hp === player.maxHp, '旁观模式回归：敌方箭仍穿过玩家');
const blSp = blast(MODE.SPECTATOR);
ok(blSp.vx === 0 && blSp.vy === 0, '旁观模式回归：爆炸仍不击退玩家');

reset(MODE.SURVIVAL);
player.dead = true;
const deadCreeper = M.spawnMob('creeper', player.x + 0.6, player.y, player.z, 0);
M.explodeMob(deadCreeper);
ok(player.vx === 0 && player.vy === 0, '死亡玩家不再被爆炸击飞（统一判定的顺带修正）');

console.log(`\n结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'}`);
process.exit(fails === 0 ? 0 : 1);
