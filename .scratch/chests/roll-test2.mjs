import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT + '/x.js')
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu'] })
const page = await browser.newPage()
await page.goto('http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 90000 })
const out = await page.evaluate(async () => {
  const CH = await import('/src/game/chests.js')
  const C = await import('/src/game/config.js')
  const t = CH.CHEST_TYPES.wood
  const total = t.loot.reduce((s, e) => s + e[1], 0)
  // 看 pickLoot 的选择过程
  const base1 = (0*7919 + 1*131 + 1*17 + 1*37 + 5) | 0
  const base2 = (0*7919 + 9*131 + 9*17 + 9*37 + 5) | 0
  // fills
  const M = await import('/src/game/math.js')
  const fills = Math.max(1, Math.round(t.slots * (0.4 + M.hash2(base1, 3, 104729) * 0.45)))
  return {
    total, base1, base2, fills,
    lootWithIds: t.loot.map(e => ({ id: e[0], w: e[1], name: C.ITEMS[e[0]] ? C.ITEMS[e[0]].name : 'BLOCK' + e[0] })),
    // 检查 id 232 是什么
    id232: C.ITEMS[232] ? C.ITEMS[232].name : 'block:' + (C.BLOCKS[232] ? C.BLOCKS[232].name : '?'),
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
