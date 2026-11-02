/* 把 atlas 里的 mob_* 格子拼成一张预览图（生物贴图肉眼检查用）。
 * 用法：PW_ROOT=<playwright 包根> CHROME_PATH=<chrome> node .scratch/potions/mobs.mjs
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(process.env.GAME_URL || 'http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(600)

const out = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const u = loaded.filter((x) => /\/src\/game\/textures\.js(\?|$)/.test(x)).pop()
  const cu = loaded.filter((x) => /\/src\/game\/config\.js(\?|$)/.test(x)).pop()
  const T = await import(u)
  const C = await import(cu)
  const COLS = 16, TILE = 32, PX = 3, PAD = 4
  const names = C.TILE_NAMES.filter((n) => /^mob_/.test(n))
  const rows = Math.ceil(names.length / COLS)
  const cw = COLS * (TILE * PX + PAD) + PAD
  const ch = rows * (TILE * PX + PAD) + PAD
  const cv = document.createElement('canvas')
  cv.width = cw; cv.height = ch
  const g = cv.getContext('2d')
  g.imageSmoothingEnabled = false
  g.fillStyle = '#1b1e24'; g.fillRect(0, 0, cw, ch)
  names.forEach((n, i) => {
    const idx = C.TILE_INDEX[n]
    const sx = (idx % 16) * TILE, sy = Math.floor(idx / 16) * TILE
    const cx = PAD + (i % COLS) * (TILE * PX + PAD)
    const cy = PAD + Math.floor(i / COLS) * (TILE * PX + PAD)
    g.drawImage(T.atlasCanvas, sx, sy, TILE, TILE, cx, cy, TILE * PX, TILE * PX)
  })
  return { url: cv.toDataURL('image/png'), n: names.length, names }
})
writeFileSync('.scratch/potions/mobs.png', Buffer.from(out.url.split(',')[1], 'base64'))
console.log('mobs.png ·', out.n, '格')
console.log(out.names.join(' '))
await browser.close()
