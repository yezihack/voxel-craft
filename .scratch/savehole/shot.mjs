/* 挖坑 → 导出 → 导入 的端到端截图验证。
 *
 * 逻辑层由 probe.mjs 保证（21 项断言）；这里补的是「玩家真正看到的画面」——
 * 因为 getEffective 对了不等于区块被重建、更不等于渲染正确。
 *
 * 做法：同一机位拍两张，中间走真实的 saveGame → exportSaveJson →
 * deleteSave → importSaveJson → loadNow 链路。两张图像素一致才算过。
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const OUT = '.scratch/savehole/'
const URL = process.env.PROBE_URL || 'http://localhost:5180/'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

await page.goto(URL, { waitUntil: 'load' })
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

/* --- ① 挖一个坑 + 垒一根柱子当对照，然后把相机架到斜上方俯看 --- */
const setup = await page.evaluate(async (src) => {
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

  /* 找一块和脚下同高的平地（地形有坡，隔三格可能就低一格） */
  const cands = [[4, 0], [0, 4], [-4, 0], [0, -4], [4, 4], [-4, -4], [4, -4], [-4, 4],
    [5, 0], [0, 5], [-5, 0], [0, -5]]
  let spot = null
  for (const [dx, dz] of cands) {
    const cx = gx + dx, cz = gz + dz
    if (M.surfaceY(cx, cz) === gy) { spot = [cx, cz]; break }
  }
  if (!spot) spot = [gx + 4, gz]
  const [tx, tz] = spot

  /* 挖 5×5、两格深 —— 坑在画面里要占足够面积，否则全局摇曳噪声会盖过信号 */
  const dug = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const cx = tx + dx, cz = tz + dz
      const sy = M.surfaceY(cx, cz)
      for (let k = 0; k < 2; k++) {
        G.setBlock(cx, sy - k, cz, 0)
        dug.push([cx, sy - k, cz])
      }
    }
  }
  /* 柱子：挖掉的会消失、放上去的必须留着 —— 一眼就能看出是哪一种丢了 */
  const pillar = []
  for (let k = 1; k <= 3; k++) {
    G.setBlock(tx + 3, gy + k, tz, I.GLOW)
    pillar.push([tx + 3, gy + k, tz])
  }

  /* 斜上方悬停俯看，坑占满画面中央（拉太远坑就只剩几个像素） */
  const cx = tx + 0.5, cy = gy - 0.5, cz = tz + 0.5
  p.x = cx + 3.2; p.z = cz + 3.2; p.y = gy + 3.4
  p.vx = p.vy = p.vz = 0
  p.fly = true
  const dx = cx - p.x, dy = cy - (p.y + C.EYE), dz = cz - p.z
  p.yaw = Math.atan2(-dx, -dz)
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz))
  /* 留给第 ③ 步逐格核对（读档会重建状态，所以记在 window 上） */
  window.__dug = dug
  window.__pillar = pillar
  return { spot: [tx, gy, tz], dug, pillar, edits: G.dimEdits[0].size }
}, modSrc)
console.log('机位:', JSON.stringify(setup.spot), '改动格数:', setup.edits)

await page.waitForTimeout(2600)
await page.screenshot({ path: OUT + 'hole-before.png' })

/* --- ② 走真实链路：存 → 导出 → 删档 → 导入 → 读档 --- */
const round = await page.evaluate(async (src) => {
  const build = new Function('return (async () => {' + src + 'return {mod};})()')
  const { mod } = await build()
  const S = await mod('save.js')
  const U = await mod('uiActions.js')
  const G = await mod('generate.js')
  S.saveGame()
  const json = S.exportSaveJson()
  const before = G.dimEdits[0].size
  S.deleteSave()
  G.dimEdits[0].clear()                 // 模拟「换了一台机器 / 清过浏览器数据」
  const ir = S.importSaveJson(json)
  const lr = U.loadNow()
  return { before, ir, lr, bytes: json.length, after: G.dimEdits[0].size }
}, modSrc)
console.log('往返:', JSON.stringify(round))

await page.waitForTimeout(3000)
await page.screenshot({ path: OUT + 'hole-after.png' })

/* --- ③ 逐格核对（必须在清改动之前做）：挖的还是空气，柱子还在 --- */
const check = await page.evaluate(async (src) => {
  const build = new Function('return (async () => {' + src + 'return {mod};})()')
  const { mod } = await build()
  const G = await mod('generate.js')
  const dugBad = []
  const pilBad = []
  for (const [x, y, z] of window.__dug) if (G.getEffective(x, y, z) !== 0) dugBad.push([x, y, z, G.getEffective(x, y, z)])
  for (const [x, y, z] of window.__pillar) if (G.getEffective(x, y, z) === 0) pilBad.push([x, y, z])
  return { dugBad, pilBad, dugN: window.__dug.length, pilN: window.__pillar.length }
}, modSrc)
console.log('逐格核对:', JSON.stringify(check))

/* --- ④ 对照组：按**旧逻辑**精确复刻 bug —— 只保留 id > 0 的改动 ---
 * 注意不能直接 clear：旧代码 `if (id > 0)` 会丢掉挖空的记录，但**放上去的
 * 方块是留着的**，那才是玩家看到的「沟没了、塔还在」。
 * 光看「A 和 B 像不像」也不够 —— 树叶摇曳（uTime）与手部摆动让任意两帧都有
 * 全局细微差异，所以必须有一个「确实变坏了」的参照 C。 */
await page.evaluate(async (src) => {
  const build = new Function('return (async () => {' + src + 'return {mod};})()')
  const { mod } = await build()
  const G = await mod('generate.js')
  const M = await mod('mesher.js')
  const m = G.dimEdits[0]
  for (const [k, v] of [...m.entries()]) if (!(v > 0)) m.delete(k)
  for (const c of M.chunks) c.dirty = true
}, modSrc)
await page.waitForTimeout(3000)
await page.screenshot({ path: OUT + 'hole-bug.png' })

console.log('页面报错:', errs.length ? errs.join(' | ') : '无')

await browser.close()
