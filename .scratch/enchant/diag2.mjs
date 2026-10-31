/* 定位「模块实例不共享」：把页面真正加载过的 player.js / state.js / survival.js URL 打出来，
 * 再比较 import 各自 URL 拿到的 player 是不是同一个对象。 */
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
  const urls = performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => /\/src\/(game\/)?(player|state|survival|uiState|uiActions)\.js/.test(n))
  const plain = await import('/src/game/player.js')
  const hits = []
  for (const u of [...new Set(urls)]) {
    try {
      const m = await import(u)
      if (m.player) hits.push({ u, same: m.player === plain.player, at: [m.player.x, m.player.y, m.player.z] })
    } catch (e) { hits.push({ u, err: String(e).slice(0, 60) }) }
  }
  return { urls: [...new Set(urls)], plainAt: [plain.player.x, plain.player.y, plain.player.z], hits }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
