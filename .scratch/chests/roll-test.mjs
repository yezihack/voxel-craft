import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT + '/x.js')
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu'] })
const page = await browser.newPage()
await page.goto('http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 90000 })
const out = await page.evaluate(async () => {
  const CH = await import('/src/game/chests.js')
  const M = await import('/src/game/math.js')
  const a = CH.rollLoot('wood', 0, 1, 1, 1, 5)
  const b = CH.rollLoot('wood', 0, 9, 9, 9, 5)
  const c = CH.rollLoot('wood', 0, 1, 1, 1, 5)
  // 直接看 hash2 在大 base 上的行为
  const hs = [190, 1670].map(v => M.hash2(v, 1, 7919))
  return { a, b, c, sameAB: JSON.stringify(a) === JSON.stringify(b), sameAC: JSON.stringify(a) === JSON.stringify(c), hs }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
