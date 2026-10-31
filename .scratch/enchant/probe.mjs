/* 附魔台无头验收：真模块、真数值、真存档往返、真按钮点击。
 *
 * 为什么在**浏览器里**跑而不是 node：survival.js 一路 import 到 input.js → loop.js
 * → renderer.js，后者在模块顶层就要建 WebGL 上下文；textures.js 还要 document。
 * 与其在 node 里伪造一堆全局，不如直接在 dev server 的真实页面里 import ——
 * 这也顺带验证了「模块图没有循环引用炸掉」。
 *
 * ⚠ 两个必踩的坑（都记在 MEMORY.md 里，这里再钉一遍）：
 *   1. 改完代码必须**重启 dev server**，否则 HMR 让 import 拿到另一个模块实例。
 *   2. **不要用 import('/src/engine.js') 来驱动游戏** —— 探针拿到的 engine 是
 *      NOT_READY_KEYS 那层占位 noop，调 pickMode/startGame 全部静默无效。
 *      驱动一律直接 import uiActions.js / state.js。
 *
 * 断言分五组：
 *   A 词条表自洽          B 铭刻状态机与存档
 *   C 八条词条逐条接进系统  D 方块与配方
 *   E 面板 DOM 与真点击
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.GAME_URL || 'http://localhost:5174/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(600)

const out = await page.evaluate(async () => {
  /* ---- 模块实例解析 ----
   * ⚠ 不能直接 import('/src/game/xxx.js')：只要本次会话里改过文件，Vite 就会把
   * 相关模块的 URL 改写成 `xxx.js?t=<时间戳>`，而页面里跑的正是带 `?t` 的那份。
   * 于是探针拿到的是**另一个模块实例**：改 invSlots 那边看不见、动 player 也动不到
   * 真正的玩家（表现为「词条都刻上了，数值一点没变」）。
   * 正确做法是从 performance 资源表里捞出页面真正加载过的 URL（取最后一条 = 最新的），
   * 再 import 那个 URL。 */
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const mod = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((n) => re.test(n)).pop()
    return import(hit || '/src/game/' + name)
  }

  const C = await mod('config.js')
  const E = await mod('enchant.js')
  const A = await mod('armor.js')
  const S = await mod('survival.js')
  const K = await mod('crafting.js')
  const ST = await mod('state.js')
  const U = await mod('uiActions.js')
  const P = await mod('player.js')
  const M = await mod('mobs.js')
  const UIS = await mod('uiState.js')
  const { I, defOf, defName } = C
  const ui = UIS.ui
  const R = []
  const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })

  /* ---------------- A 词条表自洽 ---------------- */
  ok('词条 8 条', E.ENCH_KEYS.length === 8, E.ENCH_KEYS.join(','))
  let metaOk = true, metaWhy = ''
  for (const k of E.ENCH_KEYS) {
    const e = E.ENCH[k]
    if (!e.name || !e.tag || !(e.max >= 1) || !e.cost.length || typeof e.fits !== 'function' || typeof e.desc !== 'function') {
      metaOk = false; metaWhy = k
    }
    for (const c of e.cost) if (!defOf(c.id)) { metaOk = false; metaWhy = k + '.cost=' + c.id }
    const anyItem = Object.keys(C.ITEMS).map(Number).some((id) => e.fits(id))
    if (!anyItem) { metaOk = false; metaWhy = k + ' 无适用装备' }
  }
  ok('词条元数据完整', metaOk, metaWhy)

  const kinds = {
    剑: I.SWORD_DIAMOND, 斧: I.AXE_DIAMOND, 镐: I.PICK_DIAMOND, 锹: I.SHOVEL_DIAMOND,
    弓: I.BOW, 盾: I.SHIELD_IRON, 胸甲: I.CHEST_DIAMOND, 靴: I.BOOTS_DIAMOND,
  }
  const uncovered = Object.keys(kinds).filter((n) => !E.isEnchantable(kinds[n]))
  ok('八类装备全可铭刻', uncovered.length === 0, uncovered.join(','))

  const bad = [I.DIRT, I.STONE, I.ARROW, I.STICK, 200].filter((id) => E.isEnchantable(id))
  ok('建材/弹药/材料不可铭刻', bad.length === 0, bad.join(','))

  const keysOf = (id) => E.enchantOffers(id).map((o) => o.key).sort().join(',')
  ok('钻石剑 → 锋利+吸血', keysOf(I.SWORD_DIAMOND) === 'leech,sharp', keysOf(I.SWORD_DIAMOND))
  ok('钻石镐 → 效率+幸运', keysOf(I.PICK_DIAMOND) === 'eff,fortune', keysOf(I.PICK_DIAMOND))
  ok('钻石靴 → 守护+轻羽', keysOf(I.BOOTS_DIAMOND) === 'feather,ward', keysOf(I.BOOTS_DIAMOND))
  ok('钻石斧 → 锋利+效率', keysOf(I.AXE_DIAMOND) === 'eff,sharp', keysOf(I.AXE_DIAMOND))

  const c1 = E.costOf('sharp', 1).find((c) => c.id === I.REDSTONE).n
  const c3 = E.costOf('sharp', 3).find((c) => c.id === I.REDSTONE).n
  ok('成本按等级递增', c1 === 2 && c3 === 6, `L1=${c1} L3=${c3}`)

  /* ---------------- B 铭刻状态机 ---------------- */
  E.clearEnch()
  const seq = [1, 2, 3].map(() => E.inscribe(I.SWORD_DIAMOND, 'sharp'))
  const over = E.inscribe(I.SWORD_DIAMOND, 'sharp')
  ok('锋利可升到 III', seq.every((r) => r.ok) && E.enchantLevel(I.SWORD_DIAMOND, 'sharp') === 3,
    seq.map((r) => r.level).join('/'))
  ok('到顶后再刻被拒', over.ok === false && over.reason === 'max', over.reason)
  const wrongFit = E.inscribe(I.DIRT, 'sharp')
  ok('不适用装备被拒', wrongFit.ok === false && wrongFit.reason === 'fit', wrongFit.reason)

  const json = JSON.stringify(E.enchantSnapshot())
  E.clearEnch()
  ok('clearEnch 清干净', E.enchantCount(I.SWORD_DIAMOND) === 0)
  E.enchantRestore(JSON.parse(json))
  ok('快照往返一致', E.enchantLevel(I.SWORD_DIAMOND, 'sharp') === 3, json)

  /* 手改存档：越级 / 不适用词条 / 不可附魔的物品，都要被剔掉 */
  E.enchantRestore({
    [I.SWORD_DIAMOND]: { sharp: 999, eff: 2 },
    [I.DIRT]: { sharp: 3 },
    [I.BOW]: { power: 5 },
  })
  ok('越级被夹到上限', E.enchantLevel(I.SWORD_DIAMOND, 'sharp') === 3, E.enchantLevel(I.SWORD_DIAMOND, 'sharp'))
  ok('不适用词条被剔', E.enchantLevel(I.SWORD_DIAMOND, 'eff') === 0)
  ok('不可附魔物品被剔', E.enchantLevel(I.DIRT, 'sharp') === 0)
  ok('弓的词条保留且夹到 2', E.enchantLevel(I.BOW, 'power') === 2, E.enchantLevel(I.BOW, 'power'))

  E.clearEnch()
  E.inscribe(I.SWORD_DIAMOND, 'sharp'); E.inscribe(I.SWORD_DIAMOND, 'leech')
  ok('摘要文案', E.enchantSummary(I.SWORD_DIAMOND) === '锋利 I · 吸血 I', E.enchantSummary(I.SWORD_DIAMOND))

  /* 老档没有 ench 字段 = 一件都没刻（而不是「保留上一次读档留下的」） */
  E.enchantRestore(undefined)
  ok('无 ench 字段时全清', E.enchantCount(I.SWORD_DIAMOND) === 0 && E.enchantCount(I.BOW) === 0)

  /* 真走一次存档 / 读档：applySave 里的调用顺序错了这里就会露馅 */
  E.clearEnch()
  E.inscribe(I.SWORD_DIAMOND, 'sharp'); E.inscribe(I.SWORD_DIAMOND, 'sharp')
  E.inscribe(I.PICK_DIAMOND, 'eff')
  U.saveNow(false)
  E.clearEnch()
  E.inscribe(I.BOW, 'power')          // 读档前先刻点「不该活下来」的东西
  const lr = U.loadNow()
  ok('存档带上了铭刻', !!lr.ok && E.enchantLevel(I.SWORD_DIAMOND, 'sharp') === 2,
    `ok=${lr.ok} lv=${E.enchantLevel(I.SWORD_DIAMOND, 'sharp')}`)
  ok('读档覆盖掉多余的铭刻', E.enchantLevel(I.BOW, 'power') === 0, E.enchantLevel(I.BOW, 'power'))

  /* ---------------- C 八条词条接进系统 ----------------
   * 驱动一律走 uiActions（不是 engine —— 那是占位 noop）。 */
  U.pickMode(ST.MODE.SURVIVAL)
  U.startGame(false)
  const p = P.player
  ok('已切到生存模式', ST.mode === ST.MODE.SURVIVAL, ST.mode)

  /* heldId() 读 invSlots[selected]，所以东西必须真进格子 */
  const give = (i, id) => { S.invSlots[i] = id; S.invAdd(id, 1) }
  const clearArmorAll = () => { for (const part of ['head', 'chest', 'legs', 'feet']) A.setArmorPiece(part, 0) }

  give(0, I.SWORD_DIAMOND); U.selectSlot(0)
  E.clearEnch()
  const baseAtk = C.attackDamage()
  for (let i = 0; i < 3; i++) E.inscribe(I.SWORD_DIAMOND, 'sharp')
  const buffAtk = C.attackDamage()
  ok('锋利 III → 伤害 +3', buffAtk - baseAtk === 3, `${baseAtk} → ${buffAtk}`)

  give(1, I.PICK_DIAMOND); U.selectSlot(1)
  const baseSpd = C.toolSpeedOn(I.STONE)
  for (let i = 0; i < 3; i++) E.inscribe(I.PICK_DIAMOND, 'eff')
  const buffSpd = C.toolSpeedOn(I.STONE)
  ok('效率 III → 挖掘 ×2.5', Math.abs(buffSpd / baseSpd - 2.5) < 1e-6, `${baseSpd} → ${buffSpd}`)

  /* 守护：穿一件钻石胸甲 */
  clearArmorAll()
  A.setArmorPiece('chest', I.CHEST_DIAMOND)
  const basePts = A.armorPoints()
  E.inscribe(I.CHEST_DIAMOND, 'ward'); E.inscribe(I.CHEST_DIAMOND, 'ward')
  const buffPts = A.armorPoints()
  ok('守护 II → 护甲 +4', buffPts - basePts === 4, `${basePts} → ${buffPts}`)

  /* 轻羽：把 fallPeak 架高再落地 */
  clearArmorAll()
  A.setArmorPiece('feet', I.BOOTS_DIAMOND)
  const dropTest = () => {
    p.dead = false; p.hp = 20; p.food = 20; p.air = 10
    p.x = 8; p.y = 20; p.z = 8
    p.onGround = true; p.fly = false; p.inWater = false; p.inLava = false
    p.fallPeak = 28            // 掉 8 格
    p.hurtFlash = 0
    S.updateSurvival(0.016, {})
    return 20 - p.hp
  }
  E.clearEnch()
  const dmgPlain = dropTest()
  E.inscribe(I.BOOTS_DIAMOND, 'feather'); E.inscribe(I.BOOTS_DIAMOND, 'feather')
  const dmgFeather = dropTest()
  ok('轻羽 II → 摔伤变轻', dmgFeather < dmgPlain && dmgFeather > 0, `${dmgPlain} → ${dmgFeather}`)
  clearArmorAll()

  /* 幸运：挖石头额外掉一份（roll 恒 0 让概率分支必中） */
  U.selectSlot(1)              // 手持钻石镐
  E.clearEnch(); E.inscribe(I.PICK_DIAMOND, 'fortune'); E.inscribe(I.PICK_DIAMOND, 'fortune')
  const before = S.invCount(I.COBBLE)
  S.collectDrop(I.STONE, () => 0)
  const gained = S.invCount(I.COBBLE) - before
  ok('幸运 II → 额外掉一份', gained === 2, `+${gained}`)

  /* 坚守：格挡比例从 68% 抬到 84% */
  give(2, I.SHIELD_IRON); U.selectSlot(2)
  E.clearEnch()
  p.dead = false; p.hp = 20; p.blocking = true
  S.hurt(10, '测试')
  const plainBlock = 20 - p.hp
  E.inscribe(I.SHIELD_IRON, 'bulwark'); E.inscribe(I.SHIELD_IRON, 'bulwark')
  p.dead = false; p.hp = 20; p.blocking = true
  S.hurt(10, '测试')
  const upBlock = 20 - p.hp
  p.blocking = false
  ok('坚守 II → 格挡更多', upBlock < plainBlock, `10 点伤害实扣 ${plainBlock} → ${upBlock}`)

  /* 弓术：箭伤 +2 */
  give(3, I.BOW); U.selectSlot(3)
  E.clearEnch()
  M.arrows.length = 0; M.fireArrow(0)
  const a0 = M.arrows[0].dmg
  E.inscribe(I.BOW, 'power'); E.inscribe(I.BOW, 'power')
  M.arrows.length = 0; M.fireArrow(0)
  const a1 = M.arrows[0].dmg
  M.arrows.length = 0
  ok('弓术 II → 箭伤 +2', a1 - a0 === 2, `${a0} → ${a1}`)

  /* 吸血：击杀回 4 血。真走一次玩家挥击（tryAttackMob 里才有吸血分支）。 */
  U.selectSlot(0)
  E.clearEnch(); E.inscribe(I.SWORD_DIAMOND, 'leech'); E.inscribe(I.SWORD_DIAMOND, 'leech')
  const gy = M.surfaceY(40, 40)
  p.x = 40.5; p.z = 40.5; p.y = gy + 1; p.vy = 0
  const mob = M.spawnMob('pig', 40.5, p.y, 42.0, 0)
  let leechOk = false, leechWhy = '没生成猪'
  if (mob) {
    mob.hp = 1
    mob.vx = mob.vy = mob.vz = 0
    p.hp = 10
    p.yaw = Math.PI                       // 面向 -z... 猪在 +z，所以朝向要反过来
    p.yaw = Math.atan2(-(mob.x - p.x), -(mob.z - p.z))
    p.pitch = Math.atan2((mob.y + 0.45) - (p.y + C.EYE), 1.5)
    const hit = M.tryAttackMob(1, Infinity)
    leechOk = !!hit && p.hp === 14
    leechWhy = `命中=${hit} 血量=${p.hp}`
  }
  ok('吸血 II → 击杀回 4 血', leechOk, leechWhy)
  M.despawnAllMobs()

  /* ---------------- D 方块与配方 ---------------- */
  const B = C.BLOCKS[I.ENCHANT]
  ok('附魔台方块存在', !!B && B.name === '附魔台', B && B.name)
  ok('附魔台是实体', C.SOLID[I.ENCHANT] === true)
  ok('附魔台贴图已登记',
    C.TILE_INDEX['enchant_top'] !== undefined && C.TILE_INDEX['enchant_side'] !== undefined,
    `${C.TILE_INDEX['enchant_top']}/${C.TILE_INDEX['enchant_side']}`)
  ok('贴图格有余量', C.TILE_NAMES.length <= C.ATLAS_COLS * C.ATLAS_COLS, `${C.TILE_NAMES.length}/256`)

  const rec = K.matchRecipe(K.recipeMatrix([' E ', 'YEY', 'PPP']))
  ok('附魔台配方可合成', rec && rec.out === I.ENCHANT, rec && defName(rec.out))
  ok('附魔台配方唯一', K.RECIPE_CACHE.filter((r) => r.out === I.ENCHANT).length === 1)

  /* 新配方不能「抢」既有配方的形状：逐条把自己的图案喂回去，
   * 命中的产物必须是它自己。唯一允许的例外是玻璃 / 沙岩这一对 ——
   * 它们本来就用同一个 4 沙图案，玻璃写在前面，所以沙岩会命中玻璃。 */
  const stolen = K.RECIPE_CACHE.filter((r) => {
    const hit = K.matchRecipe(r.pat)
    return !hit || hit.out !== r.out
  }).map((r) => defName(r.out))
  ok('新配方没有抢走旧配方的形状', stolen.length === 1 && stolen[0] === '沙岩', stolen.join(',') || '无')

  E.clearEnch(); E.inscribe(I.SWORD_DIAMOND, 'sharp')
  const tip = C.itemTip(I.SWORD_DIAMOND)
  ok('物品提示显示铭刻', /✦ 锋利 I/.test(tip), tip)

  /* ---------------- E 面板 DOM 与真点击 ---------------- */
  const shown = () => {
    const el = document.querySelector('.ench')
    if (!el) return false
    /* ⚠ 不能用 offsetParent 判：面板是 position:fixed，fixed 元素的
     * offsetParent 恒为 null，会把「开着」判成「关着」。v-show 写的是内联
     * display，所以直接读计算后的 display 最准。 */
    return getComputedStyle(el).display !== 'none'
  }
  ok('面板初始是关的', shown() === false)

  U.selectSlot(0)
  E.clearEnch()
  U.openEnchant()
  await new Promise((r) => setTimeout(r, 80))
  ok('openEnchant 打开面板', shown() === true)
  ok('台面默认摆上手持装备', (ui.enchantTarget | 0) === I.SWORD_DIAMOND, ui.enchantTarget)

  const rows = [...document.querySelectorAll('.ench .row')]
  ok('面板列出词条行', rows.length === 2, rows.length)
  const labels = [...document.querySelectorAll('.ench .row .go')].map((b) => b.textContent.trim())
  ok('按钮文案（未刻 → 铭刻）', labels.every((t) => t === '铭刻'), labels.join('/'))
  const disabledAll = [...document.querySelectorAll('.ench .row .go')].every((b) => b.disabled)
  ok('材料不够时按钮禁用', disabledAll)

  /* 补材料后按钮该亮起来 */
  S.invAdd(I.REDSTONE, 8); S.invAdd(I.IRON, 4)
  await new Promise((r) => setTimeout(r, 80))
  const firstGo = document.querySelector('.ench .row .go')
  ok('补料后按钮可用', firstGo && !firstGo.disabled)
  const rsBefore = S.invCount(I.REDSTONE)
  if (firstGo) firstGo.click()
  await new Promise((r) => setTimeout(r, 80))
  ok('点「铭刻」真的刻上了', E.enchantLevel(I.SWORD_DIAMOND, 'sharp') === 1,
    E.enchantLevel(I.SWORD_DIAMOND, 'sharp'))
  ok('扣了材料（红石 -2）', rsBefore - S.invCount(I.REDSTONE) === 2,
    `${rsBefore} → ${S.invCount(I.REDSTONE)}`)

  /* 台面换成镐，词条行要跟着变 */
  U.enchantPickItem(I.PICK_DIAMOND)
  await new Promise((r) => setTimeout(r, 80))
  const names = [...document.querySelectorAll('.ench .row .l1 b')].map((b) => b.textContent.trim())
  ok('换装备后词条跟着换', names.join('/') === '效率/幸运', names.join('/'))

  /* 关台面 */
  U.closeEnchant(true)
  await new Promise((r) => setTimeout(r, 80))
  ok('closeEnchant 关掉面板', shown() === false)

  /* ---------------- F 右键分派 ----------------
   * 对着附魔台右键必须是「开台」，不能变成「往台面上贴一块方块」。
   * 这条同时验证 installEnchantHook 真的被 boot() 调过 —— 忘了装的话
   * tryOpenEnchant 永远返回 false，右键会照旧贴方块。 */
  const AC = await mod('actions.js')
  const G = await mod('generate.js')
  U.pickMode(ST.MODE.CREATIVE)
  U.startGame(false)
  await new Promise((r) => setTimeout(r, 900))
  const gx = Math.floor(p.x), gz = Math.floor(p.z)
  const ttx = gx + 2, ttz = gz
  const tty = M.surfaceY(ttx, ttz) + 1
  G.setBlock(ttx, tty, ttz, I.ENCHANT)
  p.x = ttx + 0.5; p.z = ttz + 3.2; p.y = tty + 1
  p.fly = true; p.vy = 0
  p.yaw = Math.atan2(-(ttx + 0.5 - p.x), -(ttz + 0.5 - p.z))
  p.pitch = Math.atan2((tty + 0.5) - (p.y + C.EYE), Math.hypot(ttx + 0.5 - p.x, ttz + 0.5 - p.z))
  U.selectSlot(0)                     // 创造模式手持草方块
  const aboveBefore = G.getEffective(ttx, tty + 1, ttz)
  AC.doPlace()
  await new Promise((r) => setTimeout(r, 60))
  ok('右键附魔台 → 开台', ui.enchantOpen === true)
  ok('右键没有被当成贴方块', G.getEffective(ttx, tty + 1, ttz) === aboveBefore,
    `${aboveBefore} → ${G.getEffective(ttx, tty + 1, ttz)}`)
  U.closeEnchant(true)

  return { R }
})

await browser.close()

const bad = out.R.filter((r) => !r.pass)
for (const r of out.R) console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.extra ? '  · ' + r.extra : ''}`)
console.log('\n页面报错:', errs.length ? errs.join('\n  ') : '无')
console.log(`\n结果: ${bad.length === 0 ? '全部通过' : bad.length + ' 项失败'} （共 ${out.R.length} 项）`)
process.exit(bad.length === 0 ? 0 : 1)
