/* 无头冒烟：boss 生物 + 火把/铁轨透视修复
 *
 * 用法：node .scratch/boss/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，游戏逻辑全部走真实代码。
 * 沿用 transport/probe.mjs 的挡板写法。 */
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

const { I, BLOCKS, ITEMS, EGG_OF, MOB_TILE_COLORS } = await import('../../src/game/config.js');
const { isOpaque, isSolid, setBlock, getEffective } = await import('../../src/game/generate.js');
const { player } = await import('../../src/game/player.js');
const { setColCache } = await import('../../src/game/state.js');
const { MOB_TYPES, mobs, spawnMob, updateMobs, buildMobMesh, damageMob, mobAI, mobPhysics, surfaceY } = await import('../../src/game/mobs.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};
const DT = 1 / 60;
setColCache(new Map());

/* ---- 1. 透视修复 ---- */
ok(isOpaque(I.TORCH) === false && isOpaque(I.TORCH_RED) === false, '火把不算不透明 → 不遮挡邻面');
ok(isOpaque(I.RAIL) === false && isOpaque(I.RAIL_POWERED) === false, '铁轨不算不透明 → 不遮挡邻面');
ok(isOpaque(I.PAD) === false, '传送板不算不透明');
ok(isOpaque(I.STONE) === true && isOpaque(I.REDSTONE_BLOCK) === true, '石头/红石块仍不透明');

/* ---- 2. boss 类型注册 ---- */
ok(!!MOB_TYPES.dragon, '末影龙已注册');
ok(!!MOB_TYPES.wither, '凋灵已注册');
ok(!!MOB_TYPES.guardian, '远古守卫已注册');
ok(MOB_TYPES.dragon.boss === true && MOB_TYPES.wither.boss === true && MOB_TYPES.guardian.boss === true,
  '三种 boss 都带 boss 标记');
ok(MOB_TYPES.dragon.fly && MOB_TYPES.wither.fly && !MOB_TYPES.guardian.fly,
  '末影龙/凋灵飞行，守卫地面');
ok(MOB_TYPES.dragon.hp === 200 && MOB_TYPES.wither.hp === 160 && MOB_TYPES.guardian.hp === 240,
  'hp 分别 200/160/240');

/* ---- 3. boss 蛋进了 EGG_OF ---- */
ok(EGG_OF[I.EGG_DRAGON] === 'dragon', '末影龙蛋 spawn=dragon');
ok(EGG_OF[I.EGG_WITHER] === 'wither', '凋灵蛋 spawn=wither');
ok(EGG_OF[I.EGG_GUARDIAN] === 'guardian', '守卫蛋 spawn=guardian');

/* ---- 4. boss 网格能构建（buildMobMesh 不崩） ---- */
for (const t of ['dragon', 'wither', 'guardian']) {
  const d = buildMobMesh(t);
  ok(!!d && d.idx.length > 0 && d.parts.length > 0, `buildMobMesh(${t}) 产出 ${d ? d.parts.length : 0} 部件 ${d ? d.idx.length : 0} 索引`);
}

/* ---- 5. boss 能被 spawnMob 创建 ---- */
mobs.length = 0;
/* 铺一块地面让地面 boss 能站 */
for (let x = 0; x <= 3; x++) for (let z = 0; z <= 3; z++) setBlock(x, 30, z, I.STONE);
const dr = spawnMob('dragon', 1.5, 31, 1.5, 0);
ok(!!dr && dr.hp === 200, '末影龙 spawn 成功 hp=200');
const wi = spawnMob('wither', 1.5, 31, 1.5, 0);
ok(!!wi && wi.hp === 160, '凋灵 spawn 成功 hp=160');
const gu = spawnMob('guardian', 1.5, 31, 1.5, 0);
ok(!!gu && gu.hp === 240, '远古守卫 spawn 成功 hp=240');

/* ---- 6. mobPhysics + mobAI 跑 60 帧不崩（boss 分支全覆盖） ----
 * 把远古守卫的 summonT 初始设高，防止 60 帧里召出小史莱姆干扰计数。
 * 手动递增 animT：updateMobs 负责那一句，这里只调 mobPhysics+mobAI */
gu.summonT = 99;
for (let i = 0; i < 60; i++) {
  for (const m of mobs) { m.animT += DT; mobPhysics(m, DT); if (!m.dead) mobAI(m, DT); }
}
const bossCount = mobs.filter(m => MOB_TYPES[m.type].boss).length;
ok(bossCount === 3, `三种 boss 都活着（${bossCount}/3）`);
ok(!dr.dead && !wi.dead && !gu.dead, '没人因为 AI/物理崩掉');

/* ---- 7. 飞行 boss 真的飞了（y 偏离地面 31） ----
 * 飞行 boss 的 vy 由 mobAI 用正弦设，mobPhysics 跳过重力 → y 会浮动 */
ok(Math.abs(dr.y - 31) > 0.01 || Math.abs(wi.y - 31) > 0.01,
  `飞行 boss 离地了（龙 y=${dr.y.toFixed(2)} 凋灵 y=${wi.y.toFixed(2)}）`);

/* ---- 8. boss 不参与距离回收 ---- */
player.x = 1000; player.z = 1000;
updateMobs(0, false);       // doSpawn=false，只跑更新不刷怪
const bossAfter = mobs.filter(m => MOB_TYPES[m.type].boss).length;
ok(bossAfter === 3, `boss 不被距离回收（${bossAfter}/3）`);
player.x = 1.5; player.z = 1.5;

/* ---- 9. boss 受伤 + 死亡掉落 ---- */
mobs.length = 0;
const gu2 = spawnMob('guardian', 1.5, 31, 1.5, 0);
damageMob(gu2, 999, 0, 0);     // 一刀秒
ok(gu2.dead === true, '远古守卫被一刀秒（dead=true）');

/* ---- 10. 远古守卫能召唤援军 ---- */
mobs.length = 0;
for (let x = 0; x <= 5; x++) for (let z = 0; z <= 5; z++) setBlock(x, 30, z, I.STONE);
const gu3 = spawnMob('guardian', 3.5, 31, 3.5, 0);
gu3.summonT = 0;                // 触发召唤
player.x = 3.5; player.y = 31; player.z = 3.5; player.dead = false;
mobAI(gu3, DT);
const slimes = mobs.filter(m => m.type === 'slime_small');
ok(slimes.length > 0, `守卫召出 ${slimes.length} 只小史莱姆`);

/* ---- 11. 凋灵爆破能破坏方块 ---- */
mobs.length = 0;
for (let x = 0; x <= 5; x++) for (let z = 0; z <= 5; z++) setBlock(x, 30, z, I.STONE);
const wi2 = spawnMob('wither', 3.5, 35, 3.5, 0);
wi2.bombT = 0;
player.x = 3.5; player.y = 31; player.z = 3.5; player.dead = false;
mobAI(wi2, DT);
const broken = getEffective(3, 30, 3) === 0;
ok(broken, '凋灵爆破把目标脚下方块炸掉了');

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
