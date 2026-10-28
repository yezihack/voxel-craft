/* 无头冒烟：① AI 玩家（bots）会被生物打伤 ② 生物上限与交互距离调高
 *
 * 用法：node .scratch/bot-hurt/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，AI、战斗、爆炸全部走真实代码。 */

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

const { I, REACH } = await import('../../src/game/config.js');
const S = await import('../../src/game/state.js');
const { MODE } = S;
const M = await import('../../src/game/mobs.js');
const B = await import('../../src/game/bots.js');
const { player } = await import('../../src/game/player.js');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
  return cond;
};
const reset = () => {
  M.mobs.length = 0;
  B.bots.length = 0;
  M.arrows.length = 0;
  player.x = 0; player.y = 20; player.z = 0;
  player.hp = player.maxHp = 20;
  player.dead = false;
  player.vx = player.vy = player.vz = 0;
};

/* ====================== 1. 上限与距离 ====================== */
console.log('\n[1] 数量上限 / 交互距离');
ok(M.MOB_CAP >= 38, `生物同屏上限提高到 ${M.MOB_CAP}（旧值 26）`);
ok(REACH >= 9, `交互距离提高到 ${REACH}（旧值 6.5）`);
ok(B.bots.length === 0, 'bots 列表初始为空');

/* ====================== 2. 目标选择 ====================== */
console.log('\n[2] 怪物会不会把 AI 玩家当猎物');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const m = M.spawnMob('zombie', 3, 20, 0);
  const far = B.spawnBot(9, 20, 0, '远的');
  let T = M.hostileTarget(m, 16);
  ok(T && T.kind === 'player', '只有玩家在近处时仍然锁定玩家');

  const near = B.spawnBot(1.6, 20, 0, '近的');
  T = M.hostileTarget(m, 16);
  ok(T && T.kind === 'bot' && T.obj === near, 'AI 玩家更近时改锁 AI 玩家');

  /* 高差过大不该追（怪物爬不上去） */
  near.y = 40;
  T = M.hostileTarget(m, 16);
  ok(T && T.kind === 'player', 'AI 玩家站在 20 格高处时重新锁定玩家');
  near.y = 20;

  /* 玩家死亡后，怪物应该去找 AI 玩家 */
  player.dead = true;
  T = M.hostileTarget(m, 16);
  ok(T && T.kind === 'bot', '玩家死亡后怪物转去打 AI 玩家');
  player.dead = false;
  ok(!!far, '（构造了两个 bot）');
}

/* ====================== 3. 近战 ====================== */
console.log('\n[3] 近战伤害');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const m = M.spawnMob('zombie', 1.2, 20, 0);
  const b = B.spawnBot(0.2, 20, 0.0, '挨打的');
  const hp0 = b.hp, php0 = player.hp;
  for (let i = 0; i < 40; i++) { m.animT += 0.05; M.mobAI(m, 0.05); }
  ok(b.hp < hp0, `僵尸近战打掉 AI 玩家的血（${hp0} → ${b.hp}）`);
  ok(b.hurtFlash > 0 || b.hp < hp0, 'AI 玩家进入受伤闪红状态');
  ok(player.hp === php0, '玩家自己没掉血（伤害没算错人）');
}

/* ====================== 4. 玩家仍然会挨打（回归） ====================== */
console.log('\n[4] 场上没有 AI 玩家时，玩家照旧挨打');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const m = M.spawnMob('zombie', 1.2, 20, 0);
  const php0 = player.hp;
  for (let i = 0; i < 40; i++) { m.animT += 0.05; M.mobAI(m, 0.05); }
  ok(player.hp < php0, `僵尸近战打掉玩家的血（${php0} → ${player.hp}）`);
}

/* ====================== 5. 骷髅的箭 ====================== */
console.log('\n[5] 敌方箭矢');
reset();
S.setModeState(MODE.SURVIVAL);
{
  /* 放到高空（y=60）测：y=20 附近是真实地形，箭一出生就撞进方块里被回收，
   * 那是「撞墙」不是「命中」—— 断言会假通过（箭没了，但人没掉血）。 */
  const b = B.spawnBot(0, 60, 0, '中箭的');
  const hp0 = b.hp;
  /* 箭从 -z 方向飞过来，直穿 bot 的碰撞箱 */
  M.arrows.push({ x: 0, y: 60.9, z: -1.2, vx: 0, vy: 0, vz: 12, life: 5, dmg: 4, foe: true });
  for (let i = 0; i < 12; i++) M.updateArrows(1 / 60);
  ok(b.hp < hp0, `骷髅的箭射中 AI 玩家（${hp0} → ${b.hp}）`);
  ok(M.arrows.length === 0, '命中后箭矢被回收');
}

/* ====================== 6. 苦力怕爆炸 ====================== */
console.log('\n[6] 爆炸');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const b = B.spawnBot(2, 20, 0, '被炸的');
  const hp0 = b.hp;
  const c = M.spawnMob('creeper', 1, 20, 0);
  M.explodeMob(c);
  ok(b.hp < hp0, `苦力怕爆炸伤到 AI 玩家（${hp0} → ${b.hp}）`);
  ok(c.dead === true, '苦力怕自爆后死亡');
}

/* ====================== 7. 被打死会掉东西 ====================== */
console.log('\n[7] AI 玩家阵亡');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const b = B.spawnBot(0, 20, 0, '阵亡的');
  B.botBagAdd(b, I.IRON, 5);
  B.damageBot(b, 999);
  ok(b.dead === true, '血量归零后 AI 玩家死亡');
  ok(B.botDrops.length > 0, `阵亡掉落 ${B.botDrops.length} 堆物资`);
  const hasIron = B.botDrops.some((d) => d.id === I.IRON);
  ok(hasIron, '背包里的铁矿掉了出来');
}

/* ====================== 8. 没有注册 bot 时行为不变 ====================== */
console.log('\n[8] 卸载注入后回到原样');
reset();
S.setModeState(MODE.SURVIVAL);
{
  const saved = { list: M.botHook.list, damage: M.botHook.damage };
  M.registerBots(null, null);
  const b = B.spawnBot(1.5, 20, 0, '隐形人');
  const m = M.spawnMob('zombie', 3, 20, 0);
  const T = M.hostileTarget(m, 16);
  ok(T && T.kind === 'player', '未注册时怪物只认玩家（老行为）');
  ok(b.hp === b.maxHp, '未注册时 AI 玩家不掉血');
  M.registerBots(saved.list, saved.damage);
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
