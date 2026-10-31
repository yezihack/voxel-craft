/* 附魔台截图：① 方块本体在场景里的样子 ② 台面面板（桌面 / 手机两种视口）。
 * 用来人工核对「贴图像不像家具」「面板排版有没有挤」—— 数值由 probe.mjs 保证。
 *
 * 取景口径（踩过的坑）：
 *   · 不能站在方块正前方平视 —— 方块会落到屏幕最底部，被快捷栏整条挡住；
 *   · 也不能用 surfaceY(玩家脚下) 直接当放置高度 —— 地形有坡，隔三格就低一格，
 *     方块会半埋进土里；
 *   · 所以：先找一个**和脚下同高**的平地格，再让相机从斜上前方（悬停）俯看，
 *     这样台面的符文环和台身的紫光缝都能入镜。 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const OUT = '.scratch/enchant/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5174/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(400)

const modSrc = `
  const loaded = performance.getEntriesByType('resource').map((e) => e.name);
  const mod = (n) => {
    const re = new RegExp('/src/game/' + n.replace('.', '\\\\.') + '(\\\\?|$)');
    const hit = loaded.filter((x) => re.test(x)).pop();
    return import(hit || '/src/game/' + n);
  };
`

/* --- ① 方块本体 --- */
const info = await page.evaluate(async (src) => {
  const build = new Function('return (async () => {' + src + 'return {mod};})()')
  const { mod } = await build()
  const C = await mod('config.js')
  const G = await mod('generate.js')
  const M = await mod('mobs.js')
  const P = await mod('player.js')
  const ST = await mod('state.js')
  const U = await mod('uiActions.js')
  const { I } = C
  U.pickMode(ST.MODE.CREATIVE)
  U.startGame(false)
  await new Promise((r) => setTimeout(r, 1200))
  const p = P.player
  const gx = Math.floor(p.x), gz = Math.floor(p.z)
  const gy = M.surfaceY(gx, gz)

  /* 找一块和脚下同高的平地：四条正方向 + 四个斜角，取第一个平整的 */
  const cands = [[3, 0], [0, 3], [-3, 0], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3],
    [4, 0], [0, 4], [-4, 0], [0, -4], [2, 2], [-2, -2], [2, -2], [-2, 2]]
  let spot = null
  for (const [dx, dz] of cands) {
    const cx = gx + dx, cz = gz + dz
    if (M.surfaceY(cx, cz) === gy) { spot = [cx, cz]; break }
  }
  if (!spot) spot = [gx + 3, gz]
  const [tx, tz] = spot
  const ty = M.surfaceY(tx, tz) + 1

  /* 一排展示：书架 | 附魔台 | 附魔台 | 萤石 —— 有参照物才看得出颜色和亮度 */
  G.setBlock(tx - 1, ty, tz, I.BOOKSHELF)
  G.setBlock(tx, ty, tz, I.ENCHANT)
  G.setBlock(tx + 1, ty, tz, I.ENCHANT)
  G.setBlock(tx + 2, ty, tz, I.GLOW)

  /* 斜上前方悬停俯看，把方块中心放进画面正中 */
  const cx = tx + 0.5, cy = ty + 0.5, cz = tz + 0.5
  p.x = cx + 2.4; p.z = cz + 2.4; p.y = ty + 1.4
  p.vx = p.vy = p.vz = 0
  p.fly = true
  const dx = cx - p.x, dy = cy - (p.y + C.EYE), dz = cz - p.z
  p.yaw = Math.atan2(-dx, -dz)
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz))
  return { spot: [tx, ty, tz], hotbar0: C.HOTBAR[0], grass: I.GRASS, enchant: I.ENCHANT }
}, modSrc)
console.log('机位:', JSON.stringify(info))
await page.waitForTimeout(2600)
await page.screenshot({ path: OUT + 'shot-table.png' })

/* --- ② 面板：桌面 --- */
await page.evaluate(async (src) => {
  const build = new Function('return (async () => {' + src + 'return {mod};})()')
  const { mod } = await build()
  const C = await mod('config.js')
  const E = await mod('enchant.js')
  const S = await mod('survival.js')
  const ST = await mod('state.js')
  const U = await mod('uiActions.js')
  const { I } = C
  U.pickMode(ST.MODE.SURVIVAL)
  U.startGame(false)
  /* 一套「刚好在攒词条」的背包：几件装备 + 够刻两级的材料 */
  const give = (i, id, n) => { S.invSlots[i] = id; S.invAdd(id, n) }
  give(0, I.SWORD_DIAMOND, 1)
  give(1, I.PICK_DIAMOND, 1)
  give(2, I.AXE_DIAMOND, 1)
  give(3, I.BOW, 1)
  give(4, I.SHIELD_IRON, 1)
  give(5, I.CHEST_DIAMOND, 1)
  give(6, I.BOOTS_DIAMOND, 1)
  give(7, I.HELM_IRON, 1)
  give(8, I.REDSTONE, 12)
  S.invAdd(I.IRON, 8); S.invAdd(I.GOLD, 6); S.invAdd(I.QUARTZ, 4)
  S.invAdd(I.BONE, 4); S.invAdd(I.LEAF, 8); S.invAdd(I.WOOL, 2)
  S.invAdd(I.DIAMOND, 2); S.invAdd(I.STICK, 6); S.invAdd(I.GUNPOWDER, 2)
  /* 预置两条已刻的词条，让等级点 / 「升级」按钮 / 摘要文案都出现在画面里 */
  E.clearEnch()
  E.inscribe(I.SWORD_DIAMOND, 'sharp')
  E.inscribe(I.SWORD_DIAMOND, 'sharp')
  E.inscribe(I.SWORD_DIAMOND, 'leech')
  E.inscribe(I.PICK_DIAMOND, 'fortune')
  U.selectSlot(0)
  U.openEnchant()
}, modSrc)
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + 'shot-panel-desktop.png' })

/* --- ③ 面板：手机竖屏 --- */
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await page.screenshot({ path: OUT + 'shot-panel-mobile.png' })

await browser.close()
console.log('截图完成：shot-table / shot-panel-desktop / shot-panel-mobile')
