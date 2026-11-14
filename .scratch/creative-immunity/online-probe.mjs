/* 线上验收：确认「创造模式免疫怪物攻击」这一版已经部署、页面能正常跑起来。
 *
 * ⚠ 生产 bundle 会 minify，`playerAttackable` 这类导出名会被改名，没法像
 * .scratch/mine-density/online-probe.mjs 那样在 JS 里查源码标记。改用**产物指纹**：
 * 线上 index.html 引用的入口、入口文本里引用的游戏动态 chunk，必须与本次
 * 干净 worktree 构建一致且都返回 200；功能逻辑本身由同目录 probe.mjs 的
 * 32 条纯 Node 断言覆盖，线上只负责证明「跑的是这一版」+ 页面没坏。
 * 换构建时用 EXPECT_ENTRY / EXPECT_CHUNK 环境变量或改下面两个默认值。
 *
 * 用法：
 *   PW_ROOT=<含 playwright 的 node_modules> CHROME_PATH=<系统 chrome> \
 *     node .scratch/creative-immunity/online-probe.mjs
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.CF_URL || 'https://voxel-craft-516.pages.dev/'
const EXPECT_ENTRY = process.env.EXPECT_ENTRY || 'main-C_k1fH4G.js'
const EXPECT_CHUNK = process.env.EXPECT_CHUNK || 'index-CGS8fpFh.js'

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

/* 未就绪提示里也含「地形就绪」四字，用紧跟的全角左括号认真正的就绪文案 */
await page.waitForFunction(
  () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
  null, { timeout: 90000 },
)
ok('地形就绪', true, (await page.textContent('.veil .hint') || '').slice(0, 60))

const info = await page.evaluate(async () => {
  const s = document.querySelector('script[type="module"]');
  const src = (s && s.src) || '';
  let text = '';
  try { const r = await fetch(src); text = r.ok ? await r.text() : '' } catch { /* ignore */ }
  const chunks = [...new Set([...text.matchAll(/(?:assets\/)?([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js)/g)].map((m) => m[1]))];
  return { entry: src.split('/').pop(), chunks };
})
ok('线上入口是本次干净构建', info.entry === EXPECT_ENTRY, info.entry)
ok('入口引用了本次游戏 chunk', info.chunks.includes(EXPECT_CHUNK), info.chunks.join(',') || '无')
const chunkStatus = await page.evaluate(async (name) => {
  try { return (await fetch('/assets/' + name)).status } catch { return 0 }
}, EXPECT_CHUNK)
ok('游戏 chunk 可加载（HTTP 200）', chunkStatus === 200, chunkStatus)

const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'no-canvas';
  return (c.getContext('webgl2') || c.getContext('webgl')) ? 'webgl ok' : 'no-context';
})
ok('WebGL 正常', /webgl ok/.test(gl), gl)

await page.click('.veil .go');
/* StartVeil.vue 是 `:class="{hide: !ui.veilVisible}"` + `.veil.hide { display:none }`，
 * 显式等 hide 类，别用固定 sleep 猜时序。 */
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
