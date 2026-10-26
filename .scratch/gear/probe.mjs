/* 无头冒烟：更强的武器 / 盔甲 / 盾牌 / 存档
 *
 * 用法：node .scratch/gear/probe.mjs
 *
 * 只 stub 掉 DOM / WebGL / 音频 / localStorage，游戏逻辑全部走真实代码。
 * 沿用 .scratch/bots/probe.mjs 的挡板写法（同一套 Proxy 桩）。
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

/* ---------------- 真实的游戏模块 ---------------- */
const {
  I, ITEMS, ARMOR_OF, SHIELD_OF, STAFF_OF, TILE_NAMES, ATLAS_COLS,
  TIER_DMG, KIND_DMG, attackDamage, isArmorItem, itemTip,
} = await import('../../src/game/config.js');
const {
  armorSlots, armorPoints, armorReduction, setArmorPiece, clearArmor, armorSnapshot,
} = await import('../../src/game/armor.js');
const { MODE, setModeState, setSelected, setColCache, dimEdits } = await import('../../src/game/state.js');
const { getEffective, setBlock } = await import('../../src/game/generate.js');
const { player } = await import('../../src/game/player.js');
const {
  hurt, inv, invAdd, invCount, invSlots, SLOT_N,
} = await import('../../src/game/survival.js');
const { matchRecipe, recipeMatrix } = await import('../../src/game/crafting.js');
const { MOB_TYPES, mobDeathDrop, setWorldTime } = await import('../../src/game/mobs.js');
const {
  snapshot, applySave, saveGame, loadGame, hasSave, deleteSave, readSave, countEdits,
} = await import('../../src/game/save.js');

/* ---------------- 断言工具 ---------------- */
let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); } else console.log('  ok    ' + msg);
  return cond;
};
const eq = (a, b, msg) => ok(a === b, `${msg}（实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);

/* 把生存状态重置成「满血、无甲、没举盾」的干净起点 */
function resetPlayer() {
  player.hp = player.maxHp;
  player.dead = false;
  player.blocking = false;
  clearArmor();
  setSelected(0);
  inv.clear();
  for (let i = 0; i < SLOT_N; i++) invSlots[i] = 0;
}
setModeState(MODE.SURVIVAL);
setColCache(new Map());
resetPlayer();

console.log('\n== 1. 贴图集容量 ==');
ok(TILE_NAMES.length <= ATLAS_COLS * ATLAS_COLS,
  `贴图格 ${TILE_NAMES.length} / ${ATLAS_COLS * ATLAS_COLS}（新增 25 件物品仍在预算内）`);

console.log('\n== 2. 新物品登记 ==');
eq(Object.keys(ARMOR_OF).length, 16, '16 件盔甲登记进 ARMOR_OF');
eq(Object.keys(SHIELD_OF).length, 2, '2 面盾牌登记进 SHIELD_OF');
eq(Object.keys(STAFF_OF).length, 1, '1 支法杖登记进 STAFF_OF');
ok(isArmorItem(I.HELM_STARFALL) && !isArmorItem(I.SWORD_STARFALL), 'isArmorItem 只认盔甲');
ok(ITEMS[I.SWORD_STARFALL].tool.tier === 5, '星陨剑是 tier 5');
ok(!!itemTip(I.CHEST_IRON).includes('护甲 +6'), 'itemTip 给出护甲点数');

console.log('\n== 3. 更强的武器 ==');
{
  const dmg = (id) => { invSlots[0] = id; inv.set(id, 1); return attackDamage(); };
  const wood = dmg(I.SWORD_WOOD);
  const iron = dmg(I.SWORD_IRON);
  const diamond = dmg(I.SWORD_DIAMOND);
  const star = dmg(I.SWORD_STARFALL);
  ok(wood < iron && iron < diamond && diamond < star,
    `伤害递进 木${wood} < 铁${iron} < 钻石${diamond} < 星陨${star}`);
  eq(star, TIER_DMG[5] + KIND_DMG.sword, '星陨剑伤害 = TIER_DMG[5] + 剑系数');
  ok(dmg(I.AXE_STARFALL) > dmg(I.SWORD_DIAMOND) - 1, '星陨战斧也是终局档伤害');
}

console.log('\n== 4. 护甲点数与减伤 ==');
resetPlayer();
eq(armorPoints(), 0, '裸装护甲 0 点');
eq(armorReduction(), 0, '裸装减伤 0');
setArmorPiece('head', I.HELM_CLOTH);
setArmorPiece('chest', I.CHEST_CLOTH);
setArmorPiece('legs', I.LEGS_CLOTH);
setArmorPiece('feet', I.BOOTS_CLOTH);
eq(armorPoints(), 7, '布甲整套 7 点');
ok(Math.abs(armorReduction() - 0.224) < 1e-9, '布甲整套减伤 22.4%');

resetPlayer();
setArmorPiece('head', I.HELM_STARFALL);
setArmorPiece('chest', I.CHEST_STARFALL);
setArmorPiece('legs', I.LEGS_STARFALL);
setArmorPiece('feet', I.BOOTS_STARFALL);
eq(armorPoints(), 24, '星陨整套 24 点');
eq(armorReduction(), 0.72, '星陨整套减伤封顶 72%');
eq(armorSnapshot().length, 4, '盔甲快照是 4 个槽');

console.log('\n== 5. hurt() 应用护甲减伤 ==');
resetPlayer();
hurt(10, '测试');
eq(player.hp, 10, '裸装受 10 点 → 剩 10');

resetPlayer();
setArmorPiece('chest', I.CHEST_STARFALL);   // 9 点 → 28.8% 减伤
hurt(10, '测试');
/* 10 * (1 - 9*0.032) = 7.12 → round 7 */
eq(player.hp, 13, '只穿星陨甲（9 点）受 10 点 → 7，剩 13');

resetPlayer();
for (const p of ['head', 'chest', 'legs', 'feet']) {
  const map = { head: I.HELM_STARFALL, chest: I.CHEST_STARFALL, legs: I.LEGS_STARFALL, feet: I.BOOTS_STARFALL };
  setArmorPiece(p, map[p]);
}
hurt(10, '测试');
/* 10 * 0.28 = 2.8 → round 3 */
eq(player.hp, 17, '星陨整套受 10 点 → 3，剩 17');

/* 环境伤害无视护甲 */
resetPlayer();
for (const p of ['head', 'chest', 'legs', 'feet']) {
  const map = { head: I.HELM_STARFALL, chest: I.CHEST_STARFALL, legs: I.LEGS_STARFALL, feet: I.BOOTS_STARFALL };
  setArmorPiece(p, map[p]);
}
hurt(4, '你被岩浆吞没了', { pierce: true });
eq(player.hp, 16, '岩浆伤害 pierce → 吃满 4 点，护甲不生效');

console.log('\n== 6. 盾牌格挡 ==');
resetPlayer();
invSlots[0] = I.SHIELD_WOOD; inv.set(I.SHIELD_WOOD, 1);
player.blocking = true;
hurt(10, '测试');
eq(player.hp, 15, '木盾格挡 50% → 受 5 点，剩 15');

resetPlayer();
invSlots[0] = I.SHIELD_IRON; inv.set(I.SHIELD_IRON, 1);
player.blocking = true;
hurt(10, '测试');
/* 10 * 0.32 = 3.2 → 3 */
eq(player.hp, 17, '铁盾格挡 68% → 受 3 点，剩 17');

resetPlayer();
invSlots[0] = I.SHIELD_WOOD; inv.set(I.SHIELD_WOOD, 1);
player.blocking = false;                    // 没举盾
hurt(10, '测试');
eq(player.hp, 10, '拿着盾但不格挡 → 照常受 10 点');

resetPlayer();
for (const p of ['head', 'chest', 'legs', 'feet']) {
  const map = { head: I.HELM_STARFALL, chest: I.CHEST_STARFALL, legs: I.LEGS_STARFALL, feet: I.BOOTS_STARFALL };
  setArmorPiece(p, map[p]);
}
invSlots[0] = I.SHIELD_IRON; inv.set(I.SHIELD_IRON, 1);
player.blocking = true;
hurt(10, '测试');
/* 10 * 0.28 * 0.32 = 0.896 → 下限 1 */
eq(player.hp, 19, '星陨套 + 铁盾 → 只受 1 点（下限保护）');

console.log('\n== 7. 配方 ==');
{
  const match = (grid) => { const r = matchRecipe(recipeMatrix(grid)); return r ? r.out : 0; };
  eq(match(['d', 'd', 'J']), I.SWORD_STARFALL, '龙鳞 + 木棍 → 星陨剑');
  eq(match(['ddd', ' J ', ' J ']), I.PICK_STARFALL, '3 龙鳞 → 星陨镐');
  eq(match(['ttt', ' J ', ' J ']), I.STAFF_WITHER, '3 凋灵骨 → 凋灵法杖');
  eq(match(['uuu', 'u u']), I.HELM_STARFALL, '5 守卫核心 → 星陨盔');
  eq(match(['PJP', 'PPP', ' P ']), I.SHIELD_WOOD, '木板 + 木棍 → 木盾');
  eq(match(['RJR', 'RRR', ' R ']), I.SHIELD_IRON, '铁矿 + 木棍 → 铁盾');
  eq(match(['RRR', 'R R']), I.HELM_IRON, '5 铁矿 → 铁盔');
  eq(match(['Y Y', 'Y Y']), I.BOOTS_DIAMOND, '4 钻石 → 钻石靴');
  /* 反向：不能串味 */
  eq(match(['ddd', 'ddd', 'ddd']), 0, '9 龙鳞没有配方（不会误命中）');
  eq(match(['WW', 'WW']), 0, '2×2 满羊毛没有配方（布甲都要留出中间空位）');
  /* 布靴是 2×3「两段 + 中间空」，必须和 2×2 满羊毛区分得开 */
  eq(match(['W W', 'W W']), I.BOOTS_CLOTH, '4 羊毛（中间空）→ 布靴');
}

console.log('\n== 8. boss 掉落星陨材料 ==');
{
  resetPlayer();
  mobDeathDrop({ type: 'dragon', dead: true });
  eq(invCount(I.DRAGON_SCALE), 4, '末影龙掉 4 龙鳞');
  ok(invCount(I.DIAMOND) === 3, '末影龙照旧掉 3 钻石');

  resetPlayer();
  mobDeathDrop({ type: 'wither', dead: true });
  eq(invCount(I.WITHER_BONE), 4, '凋灵掉 4 凋灵骨');

  resetPlayer();
  mobDeathDrop({ type: 'guardian', dead: true });
  eq(invCount(I.GUARDIAN_CORE), 8, '远古守卫掉 8 守卫核心');

  resetPlayer();
  mobDeathDrop({ type: 'zombie', dead: true });
  eq(invCount(I.DRAGON_SCALE) + invCount(I.WITHER_BONE) + invCount(I.GUARDIAN_CORE), 0,
    '普通生物不掉 boss 材料');
}

console.log('\n== 9. 存档往返 ==');
{
  resetPlayer();
  setModeState(MODE.SURVIVAL);
  /* 造一份「有辨识度」的状态 */
  setBlock(7, 30, 7, I.BRICK);
  setBlock(-3, 31, 4, I.GLASS);
  invAdd(I.SWORD_STARFALL, 1);
  invAdd(I.DRAGON_SCALE, 5);
  invSlots[0] = I.SWORD_STARFALL;
  invSlots[3] = I.DRAGON_SCALE;
  setArmorPiece('head', I.HELM_IRON);
  setArmorPiece('chest', I.CHEST_DIAMOND);
  player.x = 12.5; player.y = 33; player.z = -7.5;
  player.yaw = 1.25; player.pitch = -0.4;
  player.hp = 14; player.food = 11; player.air = 7;
  setWorldTime(123.5);
  setSelected(3);

  const snap = snapshot();
  const roundTrip = JSON.parse(JSON.stringify(snap));   // 真正走一遍 JSON
  ok(roundTrip.edits.length === 8, '存档里 8 个维度各一张覆盖层');

  /* 破坏现场 */
  setBlock(7, 30, 7, 0);
  setBlock(-3, 31, 4, 0);
  inv.clear();
  for (let i = 0; i < SLOT_N; i++) invSlots[i] = 0;
  clearArmor();
  player.x = 0; player.y = 20; player.z = 0; player.hp = 20;
  setWorldTime(0);

  const r = applySave(roundTrip);
  ok(r.ok, 'applySave 成功');
  eq(getEffective(7, 30, 7), I.BRICK, '方块改动 1 已恢复');
  eq(getEffective(-3, 31, 4), I.GLASS, '方块改动 2 已恢复');
  eq(invCount(I.SWORD_STARFALL), 1, '背包里的星陨剑已恢复');
  eq(invCount(I.DRAGON_SCALE), 5, '背包里的龙鳞数量已恢复');
  eq(invSlots[0], I.SWORD_STARFALL, '快捷格 0 已恢复');
  eq(invSlots[3], I.DRAGON_SCALE, '快捷格 3 已恢复');
  eq(armorSlots.head, I.HELM_IRON, '头盔槽已恢复');
  eq(armorSlots.chest, I.CHEST_DIAMOND, '胸甲槽已恢复');
  ok(Math.abs(player.x - 12.5) < 1e-9 && Math.abs(player.z + 7.5) < 1e-9, '玩家坐标已恢复');
  ok(Math.abs(player.yaw - 1.25) < 1e-9, '视角朝向已恢复');
  eq(player.hp, 14, '生命值已恢复');
  eq(player.food, 11, '饥饿值已恢复');
  eq(player.dead, false, '读档不会把玩家留在死亡状态');
  eq(player.blocking, false, '读档后不会举着盾');
  ok(countEdits() >= 2, `世界改动计数 ≥ 2（实际 ${countEdits()}）`);
}

console.log('\n== 10. localStorage 存 / 读 / 删 ==');
{
  deleteSave();
  eq(hasSave(), false, '初始没有存档');
  eq(loadGame().ok, false, '没存档时 loadGame 失败但不抛错');

  const w = saveGame();
  ok(w.ok && w.bytes > 0, `saveGame 写入成功（${w.bytes} 字节）`);
  eq(hasSave(), true, 'hasSave 为真');
  ok(!!readSave(), 'readSave 能解析回来');

  const before = player.x;
  player.x = before + 100;
  const l = loadGame();
  ok(l.ok, 'loadGame 成功');
  ok(Math.abs(player.x - before) < 1e-9, 'loadGame 把玩家坐标拨回存档点');

  deleteSave();
  eq(hasSave(), false, 'deleteSave 之后没有存档');
}

console.log(`\n${fails === 0 ? '✅ 全部通过' : '❌ 失败 ' + fails + ' 项'}\n`);
process.exit(fails === 0 ? 0 : 1);
