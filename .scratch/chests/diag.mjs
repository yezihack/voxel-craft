import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT + '/x.js')
const { chromium } = req('playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu'] })
const page = await browser.newPage()
await page.goto('http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => { const h = document.querySelector('.veil .hint'); return h && /地形就绪/.test(h.textContent || '') }, { timeout: 90000 })
const out = await page.evaluate(async () => {
  const C = await import('/src/game/config.js')
  const CH = await import('/src/game/chests.js')
  const S = await import('/src/game/state.js')
  const G = await import('/src/game/generate.js')
  const P = await import('/src/game/player.js')
  const SV = await import('/src/game/survival.js')
  const UA = await import('/src/game/uiActions.js')
  const UI = await import('/src/game/uiState.js')
  const x = Math.floor(P.player.x) + 6, y = Math.floor(P.player.y), z = Math.floor(P.player.z)
  G.setBlock(x, y, z, C.I.BOX_WOOD)
  CH.openChest(S.dim, x, y, z, C.I.BOX_WOOD, 42)
  CH.writeChest(S.dim, x, y, z, { [C.I.BREAD]: 7 })
  const opened = UA.openChest({ x, y, z, id: C.I.BOX_WOOD })
  const uiItems = { ...UI.ui.chestItems }
  const before = SV.invCount(C.I.BREAD)
  const took = UA.chestTake(C.I.BREAD)
  return {
    opened, uiItems, before, took,
    after: SV.invCount(C.I.BREAD),
    uiAfter: { ...UI.ui.chestItems },
    container: CH.getContainer(S.dim, x, y, z),
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
