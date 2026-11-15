import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 90000 })
const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\/src\//.test(u)))
console.log(urls.join('\n'))
await browser.close()
