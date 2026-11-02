import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT + '/x.js')
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 60000 })
const out = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const u = loaded.filter((x) => /\/src\/game\/textures\.js(\?|$)/.test(x)).pop()
  const T = await import(u)
  const keys = Object.keys(T.TILE_INDEX || {})
  const pick = keys.filter((k) => /potion|bottle/.test(k)).map((k) => [k, T.TILE_INDEX[k]])
  return { total: keys.length, pick }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
