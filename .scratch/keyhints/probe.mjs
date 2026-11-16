/* 快捷键速查表 + 设置开关 · 无头验收探针
 *
 * 需求：新增一个设置，可以「开始进入游戏时」在左上角显示快捷键说明，
 *       可显示与隐藏，默认开启。
 *
 * 覆盖六组断言：
 *   A 默认值与设置行     B 首次进游戏自动弹出（左上角、内容齐全）
 *   C 12 秒自动收起       D H 键手动显隐（且手动唤出不会自动消失）
 *   E 设置关闭后彻底不弹（含 H 键提示 + 持久化 + 刷新后仍关）
 *   F 触屏版（TOUCH_HINTS + 真能点的 × 按钮）
 *
 * 用法：
 *   npx vite --port 4185 --strictPort        # 改完代码必须重启 dev server
 *   PW_ROOT=<playwright 所在 node_modules> node .scratch/keyhints/probe.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT
  ? `${process.env.PW_ROOT}/x.js`
  : 'C:/Users/htop/AppData/Local/npm-cache/_npx/f0a362733743bae2/node_modules/x.js')
const { chromium } = req('playwright')

const URL = process.env.GAME_URL || 'http://localhost:4185/'
const CHROME = process.env.PW_CHROME
  || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`

let fails = 0
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')) }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''))
}

/* 从页面真实加载的模块里 import（HMR 会加 ?t=，写死路径会拿到第二实例）。
 * 桌面探针驱动游戏走 uiActions.startGame(false)：不请求指针锁定，
 * headless 下 pointerlockerror 触发 pauseGame 会把 veil 又抬起来，测不了。 */
async function drive(page, fn) {
  return page.evaluate(async (fnBody) => {
    const loaded = performance.getEntriesByType('resource').map((e) => e.name)
    const mod = async (name) => {
      const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
      const hit = loaded.filter((n) => re.test(n)).pop()
      return import(hit || '/src/game/' + name)
    }
    /* eval 的函数体里要自己 await mod(...)，这里只负责执行 */
    return await eval(`(${fnBody})`)(mod)
  }, String(fn))
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

async function newPage(ctxOpts, initScript) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  if (initScript) await page.addInitScript(initScript)
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(
    () => /地形就绪/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
    null, { timeout: 120000 },
  ).catch(() => {})
  await page.waitForTimeout(400)
  return { ctx, page, errs }
}

/* ---------------- A + B + C + D：默认开启的完整链路 ---------------- */
{
  const { ctx, page, errs } = await newPage({ viewport: { width: 1280, height: 720 } })
  console.log('\n—— A 默认值与设置行 ——')

  const a = await drive(page, async (mod) => {
    const S = await mod('settings.js')
    return { showKeyHints: S.settings.showKeyHints }
  })
  ok(a.showKeyHints === true, '默认 showKeyHints = true', JSON.stringify(a))

  const row = await page.evaluate(() => {
    const el = document.querySelector('.veil .setitem')
    return el ? { exists: true, on: el.classList.contains('on'), text: el.textContent.trim() } : { exists: false }
  })
  ok(row.exists, '开始面板有「设置」行')
  ok(row.on, '开关默认是打开状态')
  ok(/快捷键/.test(row.text), '开关文案点明快捷键说明', row.text)

  console.log('\n—— B 首次进游戏自动弹出 ——')
  await drive(page, async (mod) => { (await mod('uiActions.js')).startGame(false); return true })
  await page.waitForSelector('.keyhints', { state: 'visible', timeout: 8000 })
    .catch(() => {})
  const b = await page.evaluate(() => {
    const el = document.querySelector('.keyhints')
    if (!el) return { present: false }
    const r = el.getBoundingClientRect()
    return {
      present: true,
      left: r.left, top: r.top,
      rows: el.querySelectorAll('.khrow').length,
      hasWASD: /W A S D/.test(el.textContent),
      hasH: /H/.test(el.textContent),
      veilHidden: !document.querySelector('.veil:not(.hide)'),
    }
  })
  ok(b.present, '进游戏后速查表出现')
  ok(b.left < 100 && b.top < 100, '位置在左上角', `left=${b.left} top=${b.top}`)
  ok(b.rows === 13, '桌面版 13 条按键说明', String(b.rows))
  ok(b.hasWASD && b.hasH, '内容含移动键与 H 键说明')
  ok(b.veilHidden, '开始面板已收起')

  console.log('\n—— C 12 秒后自动收起 ——')
  const ms = await drive(page, async (mod) => (await mod('uiState.js')).KEY_HINTS_AUTO_HIDE_MS)
  ok(ms === 12000, '自动收起时长常量 = 12000ms', String(ms))
  await page.waitForTimeout(12600)
  const c = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(!c, '12 秒后速查表自动消失')

  console.log('\n—— D H 键手动显隐 ——')
  await page.keyboard.press('h')
  await page.waitForTimeout(300)
  let d = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(d, '按 H 重新唤出')
  await page.waitForTimeout(500)   /* 手动唤出不应被自动收起（宽限一段） */
  d = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(d, '手动唤出的表不会自动消失')
  await page.keyboard.press('h')
  await page.waitForTimeout(300)
  d = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(!d, '再按 H 收起')

  console.log('\n—— E1 暂停再恢复不重复弹出 ——')
  await drive(page, async (mod) => { (await mod('uiActions.js')).pauseGame(); return true })
  await page.waitForTimeout(200)
  await drive(page, async (mod) => { (await mod('uiActions.js')).startGame(false); return true })
  await page.waitForTimeout(400)
  const e1 = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(!e1, '暂停 → 恢复不再弹（只有第一次进游戏才弹）')

  ok(errs.length === 0, '默认链路零控制台报错', errs.slice(0, 3).join(' | '))
  await ctx.close()
}

/* ---------------- E2：设置关闭后彻底不弹 + 持久化 ---------------- */
{
  console.log('\n—— E2 设置关闭链路 ——')
  const { ctx, page, errs } = await newPage({ viewport: { width: 1280, height: 720 } })

  /* 先在面板上真实点开关把它关掉 */
  await page.click('.veil .setitem')
  await page.waitForTimeout(200)
  const off = await page.evaluate(() => {
    const el = document.querySelector('.veil .setitem')
    return {
      on: el && el.classList.contains('on'),
      saved: localStorage.getItem('voxel-craft:settings'),
    }
  })
  ok(off.on === false, '点开关后变为关闭状态')
  ok(/"showKeyHints":false/.test(off.saved || ''), '关闭已写入 localStorage', off.saved)

  /* 刷新：设置必须还在 */
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(
    () => /地形就绪/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
    null, { timeout: 120000 },
  ).catch(() => {})
  const persisted = await page.evaluate(() => {
    const el = document.querySelector('.veil .setitem')
    return { on: el ? el.classList.contains('on') : null }
  })
  ok(persisted.on === false, '刷新后开关仍是关闭（持久化生效）')

  /* 进游戏：不应弹出 */
  await drive(page, async (mod) => { (await mod('uiActions.js')).startGame(false); return true })
  await page.waitForTimeout(600)
  let shown = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(!shown, '设置关闭时进游戏不弹速查表')

  /* H 键：静默无反应最伤人 —— 必须给一句提示 */
  await page.keyboard.press('h')
  await page.waitForTimeout(300)
  const hint = await page.evaluate(() => ({
    shown: !!document.querySelector('.keyhints'),
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }))
  ok(!hint.shown, '关闭状态下按 H 也不弹')
  ok(/已关闭/.test(hint.toast), '按 H 给出「已关闭」提示', hint.toast)

  /* 再点开开关 → 下一次进游戏要兑现 */
  await drive(page, async (mod) => { (await mod('uiActions.js')).pauseGame(); return true })
  await page.waitForTimeout(200)
  await page.click('.veil .setitem')
  await page.waitForTimeout(150)
  const reOn = await page.evaluate(() => {
    const el = document.querySelector('.veil .setitem')
    return { on: el && el.classList.contains('on') }
  })
  ok(reOn.on === true, '暂停面板里重新打开开关')
  await drive(page, async (mod) => { (await mod('uiActions.js')).startGame(false); return true })
  await page.waitForSelector('.keyhints', { state: 'visible', timeout: 8000 }).catch(() => {})
  shown = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(shown, '中途打开开关 → 下一次进游戏照样弹出（keyHintsPending 兑现）')

  ok(errs.length === 0, '关闭链路零控制台报错', errs.slice(0, 3).join(' | '))
  await ctx.close()
}

/* ---------------- F 触屏版 ---------------- */
{
  console.log('\n—— F 触屏版（手指操作 + × 按钮） ——')
  const { ctx, page, errs } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })

  /* 触屏左上角被生命条占了，速查表要让到 top:104px —— 位置一起验 */
  await drive(page, async (mod) => { (await mod('uiActions.js')).startGame(false); return true })
  await page.waitForSelector('.keyhints', { state: 'visible', timeout: 8000 }).catch(() => {})
  const f = await page.evaluate(() => {
    const el = document.querySelector('.keyhints')
    if (!el) return { present: false }
    const r = el.getBoundingClientRect()
    return {
      present: true,
      rows: el.querySelectorAll('.khrow').length,
      touch: el.classList.contains('touch'),
      top: r.top,
      hasClose: !!el.querySelector('.khclose'),
      hasWASD: /W A S D/.test(el.textContent),
      hasStick: /左摇杆/.test(el.textContent),
    }
  })
  ok(f.present, '触屏进游戏也弹速查表')
  ok(f.touch, '触屏走 .touch 布局')
  ok(f.rows === 4 && f.hasStick && !f.hasWASD, '触屏显示 4 条手指操作说明', String(f.rows))
  ok(f.hasClose, '触屏有能点的 × 收起按钮')
  ok(f.top > 90, '触屏版避开左上角生命条（top > 90px）', String(f.top))

  await page.locator('.khclose').click()
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => !!document.querySelector('.keyhints'))
  ok(!closed, '点 × 收起速查表')

  ok(errs.length === 0, '触屏链路零控制台报错', errs.slice(0, 3).join(' | '))
  await ctx.close()
}

/* ---------------- 附加：脏数据防御（sanitize 白名单） ---------------- */
{
  console.log('\n—— 附加 localStorage 脏数据防御 ——')
  const { ctx, page } = await newPage({
    viewport: { width: 1280, height: 720 },
  }, () => {
    localStorage.setItem('voxel-craft:settings', '{"showKeyHints":"yes","evil":1}')
  })
  const dirty = await drive(page, async (mod) => {
    const S = await mod('settings.js')
    return { showKeyHints: S.settings.showKeyHints, evil: S.settings.evil }
  })
  ok(dirty.showKeyHints === true, '非布尔值被拒，回落默认 true', JSON.stringify(dirty))
  ok(dirty.evil === undefined, '白名单外的键不进响应式对象')
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} 条失败` : '\n全部通过')
process.exit(fails ? 1 : 0)
