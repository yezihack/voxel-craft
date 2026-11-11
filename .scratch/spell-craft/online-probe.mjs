/* 线上拼写面板验收（纯 DOM，不 import 页面模块）。
 *
 * 生产 bundle 里没有 /src/game/*.js，本地 ui-probe.mjs 那套「import 页面真实模块」
 * 在线上不成立，所以这里只走可见 DOM 与真实点击。
 *
 * 用触屏 context 有两个理由：
 *   1. 触屏有显式的「背包」按钮（.tb.sys），不必依赖指针锁和 KeyE；
 *   2. 顺带覆盖手机端 —— 项目里 bagOpen 的指针锁兜底在 ui.touch 下是另一条路径。
 *
 * 用法：
 *   PW_ROOT=<含 playwright 的目录> CHROME_PATH=<系统 chrome> \
 *     node .scratch/spell-craft/online-probe.mjs
 *   CF_URL=<其它地址> 可覆盖默认线上地址。
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.CF_URL || 'https://voxel-craft-516.pages.dev/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const ctx = await browser.newContext({
  viewport: { width: 420, height: 900 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
})
const page = await ctx.newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))

const R = []
const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })

const resp = await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
ok('HTTP 200', resp && resp.status() === 200, resp && resp.status())
await page.waitForSelector('.veil .panel h1', { timeout: 20000 })
ok('页面标题', /方块世界/.test(await page.textContent('.veil .panel h1') || ''), await page.textContent('.veil .panel h1'))

/* 等地形就绪再进游戏 —— 引擎是异步拉起的 */
await page.waitForFunction(
  () => /地形就绪/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
  null, { timeout: 60000 },
).catch(() => {})
await page.click('.veil .go')
await page.waitForTimeout(2500)

/* 触屏控件要等 veil 收起后才渲染；v-show 切换与词表 370 条卡片的首帧也有竞态，
 * 一律显式等到 visible 再点，别用固定 sleep 赌时序。 */
await page.waitForSelector('.tb.sys', { state: 'visible', timeout: 15000 }).catch(() => {})
const bagBtn = page.locator('.tb.sys').first()
const bagVisible = await bagBtn.isVisible().catch(() => false)
ok('触屏背包按钮可见', bagVisible)
if (bagVisible) await bagBtn.click()
await page.waitForSelector('.spellbook .sp', { state: 'visible', timeout: 15000 }).catch(() => {})
await page.waitForTimeout(300)

const dom = await page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel)
    return !!el && getComputedStyle(el).display !== 'none'
  }
  return {
    bag: vis('.bag'),
    craft: !!document.querySelector('.craftbox'),
    slots: document.querySelectorAll('.craftbox .cslot').length,
    pads: document.querySelectorAll('.glyphpad .gp').length,
    spell: vis('.spellbook'),
    items: document.querySelectorAll('.spellbook .sp').length,
    en: document.querySelectorAll('.spellbook .sp[data-lang="en"]').length,
    zh: document.querySelectorAll('.spellbook .sp[data-lang="zh"]').length,
    tabs: document.querySelectorAll('.crafttab').length,
  }
})
ok('背包面板打开', dom.bag)
ok('合成台已渲染（不挑游戏模式）', dom.craft && dom.slots === 9, `slots=${dom.slots}`)
ok('A–Z 字母盘 26 键', dom.pads === 26, dom.pads)
ok('词表面板可见', dom.spell)
ok('词表列出各种单词选项（≥300）', dom.items >= 300, dom.items)
ok('词表同时含英语与拼音', dom.en > 0 && dom.zh > 0, `en=${dom.en} zh=${dom.zh}`)
ok('词表 / 配方书双 tab', dom.tabs === 2, dom.tabs)
console.log('DOM 诊断:', JSON.stringify(dom))

/* 真实交互：点一个词条 → 字块自动摆进九宫格 → 结果格亮起并显示词 */
const first = page.locator('.spellbook .sp').first()
if (dom.items) await first.click({ timeout: 15000 })
await page.waitForTimeout(300)
const afterPick = await page.evaluate(() => ({
  filled: document.querySelectorAll('.craftbox .cslot.filled').length,
  can: !!document.querySelector('.craftout.can'),
  out: (document.querySelector('.craftout') || {}).textContent || '',
  toast: (document.querySelector('.toast') || {}).textContent || '',
}))
ok('点词条自动把字块放进合成格', afterPick.filled >= 2, afterPick.filled)
ok('结果格命中拼写', afterPick.can, `out=${afterPick.out.trim()}`)

/* 点结果格完成一次课业 */
if (afterPick.can) {
  const out = page.locator('.craftout')
  if (await out.isVisible().catch(() => false)) await out.click()
  await page.waitForTimeout(300)
}
const afterTake = await page.evaluate(() => ({
  body: document.body.innerText || '',
  filled: document.querySelectorAll('.craftbox .cslot.filled').length,
}))
ok('点结果格完成课业（出现「拼出了」提示）', /拼出了/.test(afterTake.body))
ok('完成后合成格清空', afterTake.filled === 0, afterTake.filled)

/* 字母盘：点两个字母，合成格里应出现字块 */
const pad0 = page.locator('.glyphpad .gp').nth(0)
const pad1 = page.locator('.glyphpad .gp').nth(1)
if (await pad0.isVisible().catch(() => false)) await pad0.click()
if (await pad1.isVisible().catch(() => false)) await pad1.click()
await page.waitForTimeout(250)
const pads = await page.evaluate(() => document.querySelectorAll('.craftbox .cslot.filled').length)
ok('字母盘能直接把字块放进合成格', pads === 2, pads)

const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return 'no-canvas'
  return (c.getContext('webgl2') || c.getContext('webgl')) ? 'webgl ok' : 'no-context'
})
ok('WebGL 正常', /webgl ok/.test(gl), gl)

await browser.close()
for (const r of R) console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.extra ? '  · ' + r.extra : ''}`)
console.log('\n页面报错:', errs.length ? errs.slice(0, 5).join('\n  ') : '无')
const bad = R.filter((r) => !r.pass).length + errs.length
console.log(`\n结果: ${bad === 0 ? '全部通过' : bad + ' 项失败'} （共 ${R.length} 项断言）`)
process.exit(bad === 0 ? 0 : 1)
