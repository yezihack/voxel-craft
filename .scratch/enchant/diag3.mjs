import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--enable-gpu','--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5174/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 60000 })
await page.waitForTimeout(400)
const out = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const mod = (n) => { const re = new RegExp('/src/game/' + n.replace('.', '\\.') + '(\\?|$)'); const hit = loaded.filter((x) => re.test(x)).pop(); return import(hit || '/src/game/' + n) }
  const C = await mod('config.js'); const G = await mod('generate.js'); const M = await mod('mobs.js')
  const P = await mod('player.js'); const ST = await mod('state.js'); const U = await mod('uiActions.js')
  U.pickMode(ST.MODE.CREATIVE); U.startGame(false)
  await new Promise((r) => setTimeout(r, 1500))
  const p = P.player
  const log = { feet: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], onGround: p.onGround, yaw: +p.yaw.toFixed(2) }
  const bx = Math.floor(p.x), bz = Math.floor(p.z)
  log.surfaceHere = M.surfaceY(bx, bz)
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw)
  log.forward = [+fx.toFixed(2), +fz.toFixed(2)]
  const tx = Math.floor(p.x + fx * 3), tz = Math.floor(p.z + fz * 3)
  log.target = [tx, tz, M.surfaceY(tx, tz)]
  const ty = M.surfaceY(tx, tz) + 1
  G.setBlock(tx, ty, tz, C.I.ENCHANT)
  log.placedAt = [tx, ty, tz]
  log.readBack = G.getEffective(tx, ty, tz)
  log.wantId = C.I.ENCHANT
  return log
})
console.log(JSON.stringify(out, null, 2))
await page.waitForTimeout(2500)
await page.screenshot({ path: '.scratch/enchant/diag3.png' })
await browser.close()
