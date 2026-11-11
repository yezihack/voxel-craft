/* 线上验收：确认新的矿井分布已经部署、页面能正常跑起来。
 *
 * 生产 bundle 没有 /src/ 模块路径，密度本身由 .scratch/mine-density/probe.mjs
 * 在 Node 里验证；这里只做端到端证据：
 *   - 页面加载的 JS 里出现 `9013`（新增的独立矿井 hash 种子偏移，旧版没有）；
 *   - 开始面板的地形提示里仍有「N 条废弃矿井」这一项（worldCensus 未被改坏）；
 *   - 标题 / WebGL / 零控制台报错。
 *
 * 用法：
 *   PW_ROOT=<含 playwright 的目录> CHROME_PATH=<系统 chrome> \
 *     node .scratch/mine-density/online-probe.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.CF_URL || 'https://voxel-craft-516.pages.dev/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))

const R = []
const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })

const resp = await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
ok('HTTP 200', resp && resp.status() === 200, resp && resp.status())
await page.waitForSelector('.veil .panel h1', { timeout: 20000 })
ok('页面标题', /方块世界/.test(await page.textContent('.veil .panel h1') || ''), await page.textContent('.veil .panel h1'))

/* ⚠ 未完成时的提示语是「等这一行变成「地形就绪」再点」，里面也含这四个字。
 * 用紧跟的全角左括号区分真正的就绪文案（「地形就绪（N 棵树 · …）」）。 */
await page.waitForFunction(
  () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
  null, { timeout: 90000 },
)
const hint = await page.textContent('.veil .hint')
const mineCount = (hint || '').match(/(\d+)\s*条废弃矿井/)
ok('开始面板仍有「废弃矿井」统计项', !!mineCount, mineCount ? mineCount[1] + ' 条' : (hint || '').slice(0, 80))

/* ⚠ 生产入口是 main-*.js，游戏引擎在异步加载的 index-*.js 动态 chunk 里，
 * `9013` 只存在于后者。只扫 performance resource 会漏掉尚未加载的动态 chunk。
 * 做法：把入口 JS 文本里引用的 chunk 名解析出来，显式 fetch 后一起找标记。 */
const marker = await page.evaluate(async () => {
  const jsUrls = performance.getEntriesByType('resource')
    .map((e) => e.name).filter((n) => /\.js(\?|$)/.test(n));
  const seen = new Set(jsUrls);
  const texts = [];
  const fetchText = async (u) => {
    try { const r = await fetch(u); return r.ok ? await r.text() : '' } catch { return '' }
  };
  for (const u of jsUrls) {
    const t = await fetchText(u);
    texts.push(t);
    // Vite 在入口里以相对名引用动态 chunk，如 "index-Dl5uXyaa.js"
    for (const m of t.matchAll(/(?:assets\/)?([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js)/g)) {
      const abs = new URL('assets/' + m[1], location.origin + '/').href;
      if (!seen.has(abs)) { seen.add(abs); texts.push(await fetchText(abs)) }
    }
  }
  const hitAt = texts.findIndex((t) => t.includes('9013'));
  return { count: seen.size, hit: hitAt >= 0, hitAt };
})
ok('线上 bundle 含新的矿井 hash 标记 9013（旧版没有）', marker.hit, `${marker.count} 个 JS${marker.hit ? ' · 第 ' + (marker.hitAt + 1) + ' 个命中' : ''}`)

const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'no-canvas';
  return (c.getContext('webgl2') || c.getContext('webgl')) ? 'webgl ok' : 'no-context';
})
ok('WebGL 正常', /webgl ok/.test(gl), gl)

await page.click('.veil .go');
/* StartVeil.vue 里 `.veil.hide { display: none }`。别用固定 sleep 猜时序，
 * 显式等到遮罩挂上 hide 类 / 计算样式不可见。 */
const entered = await page.waitForFunction(
  () => {
    const v = document.querySelector('.veil');
    return !!v && (v.classList.contains('hide') || getComputedStyle(v).display === 'none');
  },
  null, { timeout: 30000 },
).then(() => true).catch(() => false);
ok('能进入游戏', entered)

await browser.close()
for (const r of R) console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.extra ? '  · ' + r.extra : ''}`)
console.log('\n页面报错:', errs.length ? errs.slice(0, 5).join('\n  ') : '无')
const bad = R.filter((r) => !r.pass).length + errs.length
console.log(`\n结果: ${bad === 0 ? '全部通过' : bad + ' 项失败'} （共 ${R.length} 项断言）`)
process.exit(bad === 0 ? 0 : 1)
