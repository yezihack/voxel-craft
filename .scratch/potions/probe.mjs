/* 药水 / 贴图验收探针：在真实 dev server 页面里 import 真模块。
 *
 * 为什么不 node 直跑：textures.js 顶层要 document，survival → input → loop →
 * renderer 要 WebGL。浏览器里跑顺带验证「模块图没有循环引用炸掉」。
 *
 * ⚠ 模块实例：必须从 performance 资源表里取页面真正加载过的 URL 再 import，
 *   否则 HMR 的 ?t= 会让我们拿到另一个实例（改了状态那边看不见）。
 *
 * 用法：PW_ROOT=<playwright 包根> node .scratch/potions/probe.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.GAME_URL || 'http://localhost:5188/'
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
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const modUrl = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((u) => re.test(u))
    return hit[hit.length - 1]
  }
  const load = (name) => import(modUrl(name))

  const C = await load('config.js')
  const PO = await load('potions.js')
  const CR = await load('crafting.js')
  const SV = await load('survival.js')
  const AC = await load('actions.js')
  const ST = await load('state.js')
  const UA = await load('uiActions.js')
  const US = await load('uiSync.js')
  const SAVE = await load('save.js')

  const A = []   // [名称, 通过?, 详情]
  const ok = (name, cond, detail) => A.push([name, !!cond, detail])

  /* ---------------- A. 贴图与物品 ---------------- */
  ok('贴图格数 <= 256', C.TILE_NAMES.length <= 256, C.TILE_NAMES.length + ' 格')
  ok('贴图格数 >= 200', C.TILE_NAMES.length >= 200, C.TILE_NAMES.length + ' 格')

  const potionIds = Object.keys(C.ITEMS).map(Number).filter((id) => C.ITEMS[id].potion)
  ok('药水物品 12 种', potionIds.length === 12, potionIds.length + ' 种')
  let allTex = true, miss = []
  for (const id of [C.I.BOTTLE, ...potionIds]) {
    const tex = 'item_' + C.ITEMS[id].tex
    if (C.TILE_INDEX[tex] === undefined) { allTex = false; miss.push(tex) }
  }
  ok('空瓶 + 药水贴图全部登记', allTex, miss.join(',') || '全部命中')
  ok('药水键都能对上效果表', potionIds.every((id) => !!PO.POTION_DEFS[C.ITEMS[id].potion]),
    potionIds.map((id) => C.ITEMS[id].potion).join(','))

  /* ---------------- B. 配方 ---------------- */
  const G = C.I.GLASS
  CR.craftSlots.fill(0)
  CR.craftSlots[0] = G; CR.craftSlots[2] = G; CR.craftSlots[4] = G
  const bottleR = CR.craftResult()
  ok('3 玻璃 → 空瓶', bottleR && bottleR.out === C.I.BOTTLE, JSON.stringify(bottleR))

  const recipeOk = []
  for (const id of potionIds) {
    const pat = CR.RECIPES.find((r) => r.out === id)
    const m = CR.recipeMatrix(pat.grid)
    CR.craftSlots.fill(0)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) CR.craftSlots[r * 3 + c] = m[r][c]
    const got = CR.craftResult()
    recipeOk.push([C.ITEMS[id].name, got && got.out === id])
  }
  ok('12 种药水配方各自命中', recipeOk.every((r) => r[1]),
    recipeOk.filter((r) => !r[1]).map((r) => r[0]).join(',') || '全部命中')
  CR.craftSlots.fill(0)

  /* ---------------- C. 药水状态机 ---------------- */
  PO.clearPotions()
  const healR = PO.applyPotion('heal')
  ok('治疗是即时型', healR.ok && healR.instantHeal === 6 && PO.potionActive().length === 0,
    JSON.stringify(healR))

  PO.applyPotion('speed')
  ok('迅捷倍率 1.45', Math.abs(PO.potionSpeedMul() - 1.45) < 1e-9, String(PO.potionSpeedMul()))
  PO.applyPotion('slow')
  ok('迅捷 × 缓慢 = 0.87', Math.abs(PO.potionSpeedMul() - 1.45 * 0.6) < 1e-9, String(PO.potionSpeedMul()))
  PO.tickPotions(46)
  ok('46 秒后迅捷过期', !PO.hasPotion('speed'), JSON.stringify(PO.potionActive()))

  PO.clearPotions()
  PO.potionRestore([['speed', 999], ['heal', 10], ['nope', 5]])
  const restored = PO.potionActive()
  ok('存档恢复夹到时长上限', restored.length === 1 && restored[0].t <= 45 && restored[0].key === 'speed',
    JSON.stringify(restored))
  PO.clearPotions()

  /* ---------------- D. 生存系统接入 ---------------- */
  UA.setMode(ST.MODE.SURVIVAL, false)
  const p = (await load('player.js')).player
  p.hp = 20; p.dead = false; p.food = 20; p.air = p.maxAir

  PO.clearPotions()
  PO.applyPotion('resist')
  SV.hurt(10, '测试', {})
  ok('抗性把 10 点打成 7 点', p.hp === 13, 'hp=' + p.hp)

  PO.clearPotions()
  p.hp = 20; p.inLava = true
  PO.applyPotion('fire')
  SV.updateSurvival(0.6, {})
  ok('抗火免疫岩浆', p.hp === 20, 'hp=' + p.hp)
  p.inLava = false

  PO.clearPotions()
  p.hp = 20; p.inLava = false; p.food = 20
  PO.applyPotion('poison')
  SV.updateSurvival(1.05, {})
  ok('剧毒每秒 1 点', p.hp === 19, 'hp=' + p.hp)

  PO.clearPotions()
  p.hp = 10
  PO.applyPotion('regen')
  SV.updateSurvival(1.05, {})
  ok('再生每秒回 1 点', p.hp === 11, 'hp=' + p.hp)

  PO.clearPotions()
  p.hp = 20
  ok('水肺 / 夜视 / 急迫查询', PO.potionWaterBreath() === false)
  PO.applyPotion('water'); PO.applyPotion('night'); PO.applyPotion('haste')
  ok('水肺生效', PO.potionWaterBreath() === true, '')
  ok('夜视生效', PO.potionNightVision() === true, '')
  ok('急迫挖掘 ×2', Math.abs(C.toolSpeedOn(C.I.STONE) - 2) < 1e-9, 'x=' + C.toolSpeedOn(C.I.STONE))
  PO.clearPotions()

  /* ---------------- E. 右键饮用 ---------------- */
  SV.inv.clear()
  SV.invAdd(C.I.POTION_SPEED, 2)
  p.hp = 20
  const drank = AC.tryDrinkPotion(C.I.POTION_SPEED)
  ok('饮用扣一瓶', drank && SV.invCount(C.I.POTION_SPEED) === 1, '剩 ' + SV.invCount(C.I.POTION_SPEED))
  ok('饮用后迅捷生效', PO.hasPotion('speed'), JSON.stringify(PO.potionActive()))

  /* 治疗药水：血不满时才回血 */
  p.hp = 10
  SV.invAdd(C.I.POTION_HEAL, 1)
  const drankHeal = AC.tryDrinkPotion(C.I.POTION_HEAL)
  ok('治疗药水回 6 点', drankHeal && p.hp === 16, 'hp=' + p.hp)

  /* ---------------- F. 存档字段 ---------------- */
  const snap = SAVE.snapshot()
  ok('存档包含 potions 字段', Array.isArray(snap.potions), JSON.stringify(snap.potions))

  /* ---------------- G. HUD DOM ---------------- */
  US.syncPotions()
  await new Promise((r) => setTimeout(r, 120))
  const chips = document.querySelectorAll('.potion-hud .chip').length
  ok('药水 HUD 渲染出圆环', chips >= 1, chips + ' 个')

  PO.clearPotions()
  US.syncPotions()
  await new Promise((r) => setTimeout(r, 120))
  ok('药水清空后 HUD 消失', document.querySelectorAll('.potion-hud .chip').length === 0, '')

  return { A, tiles: C.TILE_NAMES.length }
})

let fail = 0
for (const [name, pass, detail] of out.A) {
  if (!pass) fail++
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  · ' + detail : ''))
}
console.log('\n贴图格数:', out.tiles)
console.log('控制台错误:', errs.length ? errs.slice(0, 6) : '无')
await browser.close()
process.exit(fail || errs.length ? 1 : 0)
