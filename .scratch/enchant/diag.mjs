/* 定位 probe 里三处失败的中间值：player 实例是否共享、heldId 是否读得到、
 * onGround 字段名是否正确。 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5174/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(500)

const out = await page.evaluate(async () => {
  const C = await import('/src/game/config.js')
  const E = await import('/src/game/enchant.js')
  const S = await import('/src/game/survival.js')
  const ST = await import('/src/game/state.js')
  const U = await import('/src/game/uiActions.js')
  const P = await import('/src/game/player.js')
  const M = await import('/src/game/mobs.js')
  const { I } = C
  const p = P.player
  const log = {}

  U.pickMode(ST.MODE.SURVIVAL)
  U.startGame(false)
  log.mode = ST.mode
  log.playerKeys = Object.keys(p).filter((k) => /ground|onG|fall/i.test(k))
  log.onGround = p.onGround
  log.playerAt = [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)]

  /* 1) player 是否共享：改 hp 再看 hurt 有没有扣到「我手上这个」 */
  p.dead = false; p.hp = 5
  S.hurt(2, 'diag')
  log.hpAfterHurt = p.hp

  /* 2) heldId 是否读得到 */
  S.invSlots[3] = I.BOW; S.invAdd(I.BOW, 1)
  U.selectSlot(3)
  log.selected = ST.selected
  log.invSlot3 = S.invSlots[3]
  log.heldId = S.heldId()

  /* 3) 弓术 */
  E.clearEnch()
  M.arrows.length = 0; M.fireArrow(0)
  log.dmg0 = M.arrows[0] && M.arrows[0].dmg
  const r1 = E.inscribe(I.BOW, 'power')
  const r2 = E.inscribe(I.BOW, 'power')
  log.inscribe = [r1, r2]
  log.lvPower = E.enchantLevel(I.BOW, 'power')
  log.enchRaw = JSON.stringify(E.enchantSnapshot())
  M.arrows.length = 0; M.fireArrow(0)
  log.dmg1 = M.arrows[0] && M.arrows[0].dmg
  M.arrows.length = 0

  /* 4) 轻羽：直接看 updateSurvival 有没有走落地分支 */
  p.dead = false; p.hp = 20; p.food = 20; p.air = 10
  p.x = 8; p.y = 20; p.z = 8
  p.onGround = true; p.fly = false; p.inWater = false; p.inLava = false
  p.fallPeak = 28
  log.beforeDrop = { hp: p.hp, fallPeak: p.fallPeak, onGround: p.onGround }
  S.updateSurvival(0.016, {})
  log.afterDrop = { hp: p.hp, fallPeak: p.fallPeak }

  return log
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
