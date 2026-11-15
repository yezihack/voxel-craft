/* 诊断：MODS import 的 chests.js 与页面实例是否同一份 + seed 缺失问题 */
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { chromium } = req('playwright')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e && e.message || e)))

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 90000 })

const out = await page.evaluate(async () => {
  const res = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\/src\/game\/(chests|uiActions|state)\.js/.test(u))
  const pick = (w) => res.filter((u) => new RegExp('/src/game/' + w + '\\.js(\\?|$)').test(u)).pop()
  const A = await import(pick('chests'))
  const B = await import('/src/game/chests.js')
  const UA = await import(pick('uiActions'))
  const S = await import(pick('state'))
  const o = {}
  o.urls = res
  o.sameFn = A.getContainer === B.getContainer
  o.dimSnapshot = S.dim
  /* 实例共享测试：A 写、B 读 */
  A.setContainer(S.dim, 900, 100, 900, { type: 'wood', items: { 300: 7 } })
  o.crossRead = B.getContainer(S.dim, 900, 100, 900) ? 'shared' : 'different'
  /* UA.openChest 传入的 seed 是什么 —— 看它开箱后的内容 */
  const P = await import('/src/game/player.js')
  const G = await import('/src/game/generate.js')
  const C = await import('/src/game/config.js')
  const x = Math.floor(P.player.x) + 5, y = Math.floor(P.player.y), z = Math.floor(P.player.z)
  G.setBlock(x, y, z, C.I.BOX_WOOD)
  const opened = UA.openChest({ x, y, z, id: C.I.BOX_WOOD })
  o.opened = opened
  o.uiItems = { ...S.ui ? S.ui.chestItems : (await import('/src/game/uiState.js')).ui.chestItems }
  /* seed 传播：直接带 seed 调 chests.openChest */
  const v2 = A.openChest(S.dim, x + 1, y, z, C.I.BOX_WOOD, 123)
  o.withSeed = v2 && v2.items
  A.deleteContainer(S.dim, 900, 100, 900)
  A.deleteContainer(S.dim, x, y, z)
  A.deleteContainer(S.dim, x + 1, y, z)
  return o
})
console.log(JSON.stringify(out, null, 2))
console.log('pageerrors:', errs)
await browser.close()
