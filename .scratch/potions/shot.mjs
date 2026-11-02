/* 药水实机截图：进游戏 → 切生存模式 → 快捷栏摆满药水 → 喝几瓶 → 拍 HUD 与物品栏。
 * 用法：PW_ROOT=<playwright 包根> CHROME_PATH=<chrome> node .scratch/potions/shot.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(process.env.GAME_URL || 'http://localhost:5188/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(600)

const info = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const modUrl = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((u) => re.test(u))
    return hit[hit.length - 1]
  }
  const load = (name) => import(modUrl(name))
  const C = await load('config.js')
  const SV = await load('survival.js')
  const UA = await load('uiActions.js')
  const ST = await load('state.js')
  const P = await load('player.js')

  UA.startGame(false)                     // 不进指针锁，脚本才能继续操作
  await new Promise((r) => setTimeout(r, 900))

  /* 必须走 UA.setMode()：它会同时写 ui.survival / ui.mode，
   * 直接 ST.setModeState() 只改引擎侧，Vitals 与 PotionHud 都不会出现。
   * setMode 内部会 player.fly = false，所以飞行要在它之后设。 */
  UA.setMode(ST.MODE.SURVIVAL, false)
  P.player.fly = true
  P.player.y += 16                        // 飞高一点，画面里有天空和地平线

  const potions = Object.keys(C.ITEMS).map(Number).filter((id) => C.ITEMS[id].potion)
  /* 快捷栏直接摆：invSlots（生存）与 HOTBAR（创造）两条路都写一遍，
   * 不管当前 activeSlots() 返回哪一个都能看到药水。
   * 数量仍统一记在 inv（Map）里，所以两边都要写。 */
  potions.slice(0, 9).forEach((id, i) => {
    SV.inv.set(id, 3)
    SV.invSlots[i] = id
    C.HOTBAR[i] = id
  })
  SV.inv.set(C.I.BOTTLE, 5)
  return { potions: potions.length, mode: ST.mode, held: SV.heldId() }
})

/* 喝几瓶，让 HUD 出现多个环（含一个负面） */
await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const modUrl = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((u) => re.test(u))
    return hit[hit.length - 1]
  }
  const PO = await import(modUrl('potions.js'))
  PO.applyPotion('speed')
  PO.applyPotion('regen')
  PO.applyPotion('night')
})

await page.waitForTimeout(900)
await page.screenshot({ path: '.scratch/potions/shot_hud.png' })

/* 开背包看储物格里的药水图标 */
await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const modUrl = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((u) => re.test(u))
    return hit[hit.length - 1]
  }
  const UA = await import(modUrl('uiActions.js'))
  UA.openBag()
})
await page.waitForTimeout(700)
await page.screenshot({ path: '.scratch/potions/shot_bag.png' })

console.log('药水', info.potions, '种 · 控制台错误:', errs.length ? errs : '无')
await browser.close()
