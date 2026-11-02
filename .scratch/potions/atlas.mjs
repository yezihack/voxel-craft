/* 导出贴图集 PNG，用于肉眼检查生物 / 方块 / 药水贴图。 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.GAME_URL || 'http://localhost:5188/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(400)

const data = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const u = loaded.filter((x) => /\/src\/game\/textures\.js(\?|$)/.test(x)).pop()
  const T = await import(u)
  return { url: T.atlasCanvas.toDataURL('image/png'), n: T.atlasCanvas.width }
})
writeFileSync('.scratch/potions/atlas.png', Buffer.from(data.url.split(',')[1], 'base64'))
console.log('atlas.png 已保存 ·', data.n, '格')
await browser.close()
