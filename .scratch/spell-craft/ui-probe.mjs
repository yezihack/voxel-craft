/* 拼写面板 · 浏览器 DOM 探针（seam 2：真实 UI 点击）
 *
 * 用法：
 *   PW_ROOT=<含 playwright 的目录> CHROME_PATH=<系统 chrome> GAME_URL=http://127.0.0.1:5174/ \
 *     node .scratch/spell-craft/ui-probe.mjs
 *
 * ⚠ 改完代码必须重启 dev server；不要用 import('/src/engine.js') 驱动游戏
 *   （拿到的是 NOT_READY_KEYS 占位）。驱动一律 import 页面真实加载过的模块 URL。
 *
 * 覆盖：默认创造模式能不能看见合成台、字母盘能不能把字块放进去、
 * 词表能不能筛/选并自动摆料、结果格能不能完成课业、字块是否不占背包账、
 * 生存模式是否同样可用。
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.GAME_URL || 'http://127.0.0.1:5174/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 60000 })
await page.waitForTimeout(500)

const out = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((e) => e.name)
  const mod = (name) => {
    const re = new RegExp('/src/game/' + name.replace('.', '\\.') + '(\\?|$)')
    const hit = loaded.filter((n) => re.test(n)).pop()
    return import(hit || '/src/game/' + name)
  }
  const C = await mod('config.js')
  const K = await mod('crafting.js')
  const S = await mod('survival.js')
  const ST = await mod('state.js')
  const U = await mod('uiActions.js')
  const UIS = await mod('uiState.js')
  const ui = UIS.ui
  const R = []
  const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })
  const wait = () => new Promise((r) => setTimeout(r, 90))
  const q = (sel) => document.querySelector(sel)
  const qa = (sel) => [...document.querySelectorAll(sel)]
  const visible = (sel) => {
    const el = q(sel)
    return !!el && getComputedStyle(el).display !== 'none'
  }

  /* ---------------- A 默认创造模式：合成台可达 ---------------- */
  U.pickMode(ST.MODE.CREATIVE)
  U.startGame(false)
  U.openBag()
  await wait()
  ok('打开背包', visible('.bag'))
  ok('默认创造模式也显示合成台', !!q('.craftbox'), ui.mode)
  ok('合成台有 9 个合成格', qa('.craftbox .cslot').length === 9, qa('.craftbox .cslot').length)

  /* ---------------- B A–Z 字母盘 ---------------- */
  const pads = qa('.glyphpad .gp')
  ok('字母盘有 26 个按钮', pads.length === 26, pads.length)
  const abc = ['A', 'B', 'C']
  for (const ch of abc) {
    const b = qa('.glyphpad .gp').find((x) => x.dataset.ch === ch)
    if (b) b.click()
  }
  await wait()
  ok('点字母盘把字块放进合成格',
    abc.every((ch, i) => K.craftSlots[i] === C.GLYPH_BLOCK[ch]),
    K.craftSlots.slice(0, 3).join(','))
  const invGlyphBefore = C.GLYPH_CHARS.map((ch) => S.invCount(C.GLYPH_BLOCK[ch]))
  ok('放字块不扣背包（本来也没有字块账）',
    invGlyphBefore.every((n) => n === 0), invGlyphBefore.reduce((a, b) => a + b, 0))

  /* 清掉手动摆的三个字母，不该凭空往背包里塞字块 */
  U.clearCraftAll()
  await wait()
  ok('清空后合成格为空', K.craftSlots.every((v) => !v), K.craftSlots.join(','))
  ok('清空字块不往背包退回物品',
    C.GLYPH_CHARS.every((ch) => S.invCount(C.GLYPH_BLOCK[ch]) === 0),
    C.GLYPH_CHARS.reduce((a, ch) => a + S.invCount(C.GLYPH_BLOCK[ch]), 0))

  /* ---------------- C 词表：分类、搜索、选中自动摆料 ---------------- */
  const tab = q('.crafttab[data-tab="spell"]')
  if (tab) tab.click()
  await wait()
  ok('词表面板可见', visible('.spellbook'))
  const items = qa('.spellbook .sp')
  ok('词表列出可拼词条（≥300）', items.length >= 300, items.length)
  ok('词表同时含英语与拼音',
    qa('.spellbook .sp[data-lang="en"]').length > 0 &&
    qa('.spellbook .sp[data-lang="zh"]').length > 0,
    `en=${qa('.spellbook .sp[data-lang="en"]').length} zh=${qa('.spellbook .sp[data-lang="zh"]').length}`)
  ok('词表不列 9 格摆不下的长词', !q('.spellbook .sp[data-key="blackboard"]'))

  const search = q('.spellsearch')
  if (search) {
    search.value = 'cat'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
  }
  const filtered = qa('.spellbook .sp')
  ok('搜索框能按词筛', !!search && filtered.length > 0 && filtered.length < 20, filtered.length)
  ok('搜索 cat 命中 cat', !!q('.spellbook .sp[data-key="cat"]'))

  /* 选一个 5 字母词，验证跨行自动摆料 + 结果格命中 */
  if (search) {
    search.value = 'apple'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
  }
  const apple = q('.spellbook .sp[data-key="apple"]')
  if (apple) apple.click()
  await wait()
  ok('点词表条目自动摆好字块',
    [...'APPLE'].every((ch, i) => K.craftSlots[i] === C.GLYPH_BLOCK[ch]),
    K.craftSlots.slice(0, 5).join(','))
  const res = K.craftResult()
  ok('摆完结果格命中拼写', !!res && !!res.spell && res.spell.letters === 'APPLE',
    res && res.spell ? res.spell.letters : JSON.stringify(res))
  ok('结果格显示拼出的词', /apple/i.test((q('.craftout') || {}).textContent || ''),
    (q('.craftout') || {}).textContent)

  /* ---------------- D 完成一次课业 ---------------- */
  const outEl = q('.craftout')
  if (outEl) outEl.click()
  await wait()
  ok('点结果格完成课业（Toast 报出词）', /拼出了/.test(ui.toastText || ''), ui.toastText)
  ok('完成后合成格清空', K.craftSlots.every((v) => !v), K.craftSlots.join(','))

  /* ---------------- E 生存模式同样可用，且不占背包账 ---------------- */
  U.pickMode(ST.MODE.SURVIVAL)
  U.startGame(false)
  U.openBag()
  await wait()
  ok('生存模式也有词表与合成台', !!q('.craftbox') && !!q('.spellbook'))
  /* 组件可能没随模式切换重新挂载，搜索框还留着上一段的 'apple' ——
   * 先把筛选清掉，否则列表里根本没有拼音条目可选。 */
  const search2 = q('.spellsearch')
  if (search2) {
    search2.value = ''
    search2.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
  }
  const before = C.GLYPH_CHARS.reduce((a, ch) => a + S.invCount(C.GLYPH_BLOCK[ch]), 0)
  const zh = q('.spellbook .sp[data-lang="zh"]')
  if (zh) zh.click()
  await wait()
  const r2 = K.craftResult()
  ok('生存模式点词表也能拼出词', !!r2 && !!r2.spell,
    `key=${zh && zh.dataset.key} slots=${K.craftSlots.slice(0, 6).join(',')} res=${JSON.stringify(r2)}`)
  const afterPlace = C.GLYPH_CHARS.reduce((a, ch) => a + S.invCount(C.GLYPH_BLOCK[ch]), 0)
  ok('生存模式放字块不扣背包', afterPlace === before, `${before} → ${afterPlace}`)
  U.clearCraftAll()
  await wait()
  const afterClear = C.GLYPH_CHARS.reduce((a, ch) => a + S.invCount(C.GLYPH_BLOCK[ch]), 0)
  ok('生存模式清空不退回字块', afterClear === before, `${before} → ${afterClear}`)

  U.closeBag(true)
  return { R }
})

await browser.close()
for (const r of out.R) console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.extra ? '  · ' + r.extra : ''}`)
console.log('\n页面报错:', errs.length ? errs.join('\n  ') : '无')
const bad = out.R.filter((r) => !r.pass).length + errs.length
console.log(`\n结果: ${bad === 0 ? '全部通过' : bad + ' 项失败'} （共 ${out.R.length} 项断言）`)
process.exit(bad === 0 ? 0 : 1)
