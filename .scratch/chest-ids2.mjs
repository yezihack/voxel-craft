import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT + '/x.js')
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 60000 })
const out = await page.evaluate(async () => {
  const res = performance.getEntriesByType('resource').map((e) => e.name)
  const hits = res.filter(x => /src\/game\/(config|chests)\.js/.test(x))
  let C = null, ch = null, err = null
  try {
    // 用相对路径 import（dev 下 vite 会解析成带 ?t= 的真实 URL）
    C = await import('/src/game/config.js')
    ch = await import('/src/game/chests.js')
  } catch (e) { err = String(e && e.message || e) }
  return {
    hits, err,
    total: C && C.TILE_NAMES ? C.TILE_NAMES.length : -1,
    chestIds: ch ? Object.entries(ch.CHEST_BLOCK) : null,
    chestOfBlock: ch ? ch.CHEST_OF_BLOCK : null,
    slots: ch ? Object.fromEntries(Object.entries(ch.CHEST_TYPES).map(([k, v]) => [k, v.slots])) : null,
    tiles: C && C.TILE_NAMES ? C.TILE_NAMES.filter(n => /chest_/.test(n)) : null,
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
