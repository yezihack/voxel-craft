/* 无头冒烟：AI 玩家「合成更强物品 / 建房子 / 更好的掉落」
 *
 * 用法：node .scratch/bots/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频，游戏逻辑全部走真实代码。
 * 沿用 boss/probe.mjs 的挡板写法。 */

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
const { getEffective, setBlock, isSolid } = await import('../../src/game/generate.js');
const { setColCache } = await import('../../src/game/state.js');
const { player } = await import('../../src/game/player.js');
const {
  BOT_WANT, BOT_BUILD_BLOCKS, BOT_CRAFT_RECIPES,
  spawnBot, botBagAdd, botBagCount, botTryCraftOnce, botPickBuildBlock,
  botStartHouse, botBuild, killBot, botDrops, bots,
} = await import('../../src/game/bots.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};

setColCache(new Map());
/* 铺一块足够大的平地（y=30）给盖房测试用 */
for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) setBlock(x, 30, z, I.STONE);
player.x = 0; player.y = 31; player.z = 0; player.dead = false;

/* ---- 1. 不再采集泥土（乱摆泥土块的根因） ---- */
ok(!BOT_WANT[I.DIRT], '采集白名单不再含泥土 DIRT');
ok(!!BOT_WANT[I.LOG] && !!BOT_WANT[I.COBBLE] && !!BOT_WANT[I.IRON], '仍采木材/圆石/铁矿');

/* ---- 2. 合成：木头→木板 ---- */
{
  const b = spawnBot(0.5, 31, 0.5, '工匠');
  botBagAdd(b, I.LOG, 1);
  const before = botBagCount(b, I.PLANK);
  const did = botTryCraftOnce(b);
  ok(did && botBagCount(b, I.PLANK) === before + 4 && botBagCount(b, I.LOG) === 0, '1 原木 → 4 木板');
}

/* ---- 3. 合成：木板+木棍 → 木镐（顺带造木棍） ---- */
{
  const b = spawnBot(0.5, 31, 0.5, '铁匠');
  botBagAdd(b, I.PLANK, 5); botBagAdd(b, I.STICK, 0);
  // 第一次：缺木棍 → 先用 2 木板搓 4 木棍；再跑几次凑出木镐
  let made = false;
  for (let i = 0; i < 6 && !made; i++) if (botTryCraftOnce(b)) { if (botBagCount(b, I.PICK_WOOD) > 0) made = true; } else break;
  ok(made && botBagCount(b, I.PICK_WOOD) === 1, '木板+木棍 → 木镐（自动补木棍）');
}

/* ---- 4. 合成：铁矿 → 铁镐（更强） ----
 * 只给铁矿和木棍，不给木板；否则 bot 会优先做木镐。 */
{
  const b = spawnBot(0.5, 31, 0.5, '铸剑');
  botBagAdd(b, I.IRON, 3); botBagAdd(b, I.STICK, 2);
  let made = false;
  for (let i = 0; i < 6 && !made; i++) if (botTryCraftOnce(b)) { if (botBagCount(b, I.PICK_IRON) > 0) made = true; } else break;
  ok(made && botBagCount(b, I.PICK_IRON) === 1, '铁矿+木棍 → 铁镐（更强物品）');
}

/* ---- 5. 建造白名单排除泥土/沙子 ---- */
{
  const b = spawnBot(0.5, 31, 0.5, '泥瓦');
  botBagAdd(b, I.DIRT, 10);
  ok(botPickBuildBlock(b) === 0, '包里只有泥土 → 选不出建材（不摆泥土）');
  botBagAdd(b, I.PLANK, 10);
  ok(botPickBuildBlock(b) === I.PLANK, '有木板 → 优先选木板盖房');
  ok(BOT_BUILD_BLOCKS.every(id => id !== I.DIRT && id !== I.SAND), '建材白名单不含泥土/沙子');
}

/* ---- 6. 蓝图：4×4 墙(3高,带门) + 平顶环，且逐格有支撑 ---- */
{
  const b = spawnBot(0.5, 31, 0.5, '建筑师');
  b.home = [0, 31, 0];
  const okStart = botStartHouse(b);
  ok(okStart && Array.isArray(b.buildPlan), 'botStartHouse 生成蓝图');
  if (b.buildPlan) {
    const [ox, oy, oz] = b.buildOrigin;
    // 墙周长 4×4 周长=12，×3 高 = 36，减门洞 3 格（通高） = 33；平顶环 12-1（门顶无支撑跳过）= 11 → 共 44
    ok(b.buildPlan.length === 44, `蓝图格数=${b.buildPlan.length}（期望 44）`);
    // 按 y 升序
    let asc = true; for (let i = 1; i < b.buildPlan.length; i++) if (b.buildPlan[i].y < b.buildPlan[i - 1].y) asc = false;
    ok(asc, '蓝图按 y 升序（从下往上盖）');
    // 每格下方有支撑（在蓝图内或贴地）
    const key = (c) => c.x + ',' + c.y + ',' + c.z;
    const set = new Set(b.buildPlan.map(key));
    let supported = true;
    for (const c of b.buildPlan) {
      if (c.y > oy + 1) {
        const below = key({ x: c.x, y: c.y - 1, z: c.z });
        if (!set.has(below) && !isSolid(getEffective(c.x, c.y - 1, c.z))) { supported = false; break; }
      }
    }
    ok(supported, '每一格（非底层）下方都有支撑，不会悬空');
    ok(b.buildPlan.every(c => c.x >= ox && c.x < ox + 4 && c.z >= oz && c.z < oz + 4), '蓝图都在 4×4 占地内');
  }
}

/* ---- 7. 端到端：真把一间屋盖出来 ---- */
{
  botDrops.length = 0;
  const b = spawnBot(2.5, 31, 2.5, '实干家');
  b.home = [2, 31, 2];
  botBagAdd(b, I.PLANK, 60);          // 够盖一整间
  for (let guard = 0; guard < 400; guard++) {
    botBuild(b, 1 / 60);
    if (!b.buildPlan) break;             // 要么盖完了，要么没法起新屋
    const c = b.buildPlan[b.buildIdx];
    if (!c) break;
    b.x = c.x + 0.5; b.z = c.z + 0.5; b.y = b.buildOrigin ? b.buildOrigin[1] + 0.1 : 31;
  }
  const built = b.buildPlan === null;  // 盖完会清空蓝图
  ok(built, '盖完整间屋后蓝图清空');
  // 抽查：用实际 buildOrigin 读取墙角底层（oy+1 是第一层墙）
  const ox = b.buildOrigin ? b.buildOrigin[0] : 2;
  const oy = b.buildOrigin ? b.buildOrigin[1] : 30;
  const oz = b.buildOrigin ? b.buildOrigin[2] : 2;
  ok(getEffective(ox, oy + 1, oz) === I.PLANK, '墙角底层被放上木板');
  ok(botBagCount(b, I.PLANK) < 60, '盖房消耗了背包木板');
}

/* ---- 8. 死亡掉落更多更好（空手也给木板，偶尔火把/奖励木剑） ---- */
{
  botDrops.length = 0;
  for (let t = 0; t < 100; t++) {
    const b = spawnBot(0.5, 31, 0.5, '苦力' + t);
    if (!b) continue;
    b.silent = false;
    killBot(b);
  }
  const all = botDrops.flatMap(d => [{ id: d.id, n: d.n }]);
  const hasPlank = all.some(d => d.id === I.PLANK);
  const hasTorch = all.some(d => d.id === I.TORCH);
  const hasSword = all.some(d => d.id === I.SWORD_WOOD);
  ok(hasPlank, '空手死亡掉落木板（比原 cobble 更好）');
  ok(hasTorch, '空手死亡偶尔掉落火把');
  ok(hasSword, '空手死亡偶尔掉落奖励木剑');
}

/* ---- 9. 带成品的死亡掉落：包里有铁镐就掉铁镐 ---- */
{
  bots.length = 0; botDrops.length = 0;
  const b = spawnBot(0.5, 31, 0.5, '富豪');
  botBagAdd(b, I.PICK_IRON, 1); botBagAdd(b, I.PLANK, 5);
  killBot(b);
  ok(botDrops.some(d => d.id === I.PICK_IRON), '死亡掉落包里的铁镐（更强掉落）');
  ok(botDrops.some(d => d.id === I.PLANK), '死亡掉落包里的木板');
}

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
