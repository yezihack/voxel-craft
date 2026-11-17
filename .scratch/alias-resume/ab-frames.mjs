/* 同机 A/B 对照：新版本（HEAD，带别名弹窗）vs 改动前版本（HEAD~1）。
 *
 * 目的：线上跑 online-frames.mjs 时两次结果不一致（一次 longtask 0 个、
 * 一次 2 个），无法判断是环境抖动还是本次改动引入的回归。
 * 这个脚本把两个版本**同时**跑在本机 preview 上（同一 CPU、同一 swiftshader、
 * 同一网络条件），交替测 N 轮，看 longtask 数量是否有系统性差异。
 *
 * 用法：
 *   PW_ROOT="C:/Users/htop/.workbuddy-ai/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules" \
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   node .scratch/alias-resume/ab-frames.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const BASE = process.env.BASE_URL || 'http://localhost:4180/'   // 改动前
const NEW = process.env.NEW_URL || 'http://localhost:4181/'     // 改动后
const ROUNDS = Number(process.env.ROUNDS || 3)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

async function measure(url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const errs = []
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(() => {
    window.__lt = []
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push({ d: e.duration, name: e.name })
      }).observe({ entryTypes: ['longtask'] })
    } catch (e) { /* ignore */ }
  })
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(
    () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
    null, { timeout: 120000 },
  )
  /* 进游戏（纯 DOM 点击，无头环境指针锁不可靠） */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /开始游戏|开始/.test(b.textContent || ''))
    if (btn) btn.click()
  })
  await page.waitForTimeout(1500)
  /* 清空采样窗口，只测「静置 + 行走」这段 */
  await page.evaluate(() => { window.__lt.length = 0 })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    const k = (t) => window.dispatchEvent(new KeyboardEvent(t, { code: 'KeyW', key: 'w', bubbles: true }))
    k('keydown')
    setTimeout(() => k('keyup'), 3000)
  })
  await page.waitForTimeout(3600)
  const lt = await page.evaluate(() => window.__lt.slice())
  await ctx.close()
  return { lt, errs }
}

const rows = []
for (let i = 0; i < ROUNDS; i++) {
  /* 交替顺序：每轮换先后，抵消热机/缓存顺序偏差 */
  const order = i % 2 === 0 ? [['base', BASE], ['new', NEW]] : [['new', NEW], ['base', BASE]]
  for (const [tag, url] of order) {
    const r = await measure(url)
    const n = r.lt.length
    const total = r.lt.reduce((s, e) => s + e.d, 0)
    const max = n ? Math.max(...r.lt.map((e) => e.d)) : 0
    rows.push({ tag, n, total: Math.round(total), max: Math.round(max), errs: r.errs.length })
    console.log(`第 ${i + 1} 轮 ${tag.padEnd(4)} longtask ${n} 个 · 总 ${Math.round(total)}ms · 最长 ${Math.round(max)}ms · 控制台报错 ${r.errs.length}`)
  }
}

console.log('\n=== 汇总 ===')
for (const tag of ['base', 'new']) {
  const g = rows.filter((r) => r.tag === tag)
  const n = g.reduce((s, r) => s + r.n, 0)
  const total = g.reduce((s, r) => s + r.total, 0)
  const max = g.reduce((s, r) => Math.max(s, r.max), 0)
  const errs = g.reduce((s, r) => s + r.errs, 0)
  console.log(`${tag.padEnd(4)} 共 ${g.length} 轮：longtask 合计 ${n} 个 · 总 ${total}ms · 单次最长 ${max}ms · 控制台报错 ${errs}`)
}
await browser.close()
