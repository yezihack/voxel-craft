/* 优化后验收：在真实浏览器里量「区块重建」对帧时间的影响。
 *
 * 用法：
 *   PW_ROOT=".../@playwright/cli/node_modules" \
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   BASE_URL=http://localhost:5173/ node .scratch/perf/after-frames.mjs
 *
 * 做法：进游戏后直接调引擎导出的 buildChunk 计时（用页面上真实加载的模块），
 * 再模拟「挖一个方块」触发脏区块重建，量那一帧的实际耗时。
 *
 * ⚠ headless 是 SwiftShader 软件渲染，帧率数字不可信；
 *   这里只取「主线程 JS 占用」这一项，与 GPU 无关。
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.BASE_URL || 'http://localhost:5173/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
await page.waitForFunction(
  () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
  null, { timeout: 120000 },
)
console.log('地形就绪')

/* 找到页面上真实加载的 game 模块 URL */
const MODS = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map((e) => e.name)
  const anyGame = res.find((u) => /\/src\/game\/[^/]+\.js/.test(u))
  if (!anyGame) throw new Error('没有加载任何 /src/game/ 模块')
  const dir = anyGame.match(/^(.*\/src\/game\/)/)[1]
  const want = ['mesher', 'generate', 'state']
  const out = {}
  for (const w of want) {
    const u = res.filter((x) => x.startsWith(dir) && new RegExp('/' + w + '\\.js(\\?|$)').test(x)).pop()
    if (!u) throw new Error('找不到 ' + w + '.js')
    out[w] = u
  }
  return out
})

const R = await page.evaluate(async (MODS) => {
  const M = await import(MODS.mesher)
  const G = await import(MODS.generate)
  const S = await import(MODS.state)
  S.setDim(0)
  S.setFlatWorld(false)

  /* 1) 单 chunk 网格构建耗时 */
  const c = M.chunks[0]
  M.buildChunk(c)                                  // 预热
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) M.buildChunk(c);
  const perChunk = (performance.now() - t0) / 10;

  /* 2) 挖一个方块 → 那一帧的重建耗时 */
  const before = M.chunks.map((x) => x.dirty)
  const cx = c.min[0] + 5, cy = 20, cz = c.min[2] + 5;
  G.setBlock(cx, cy, cz, 0);
  const dirty = M.chunks.filter((x) => x.dirty);
  const t1 = performance.now();
  for (const x of dirty) M.buildChunk(x);
  const digFrame = performance.now() - t1;
  /* 还原 */
  G.setBlock(cx, cy, cz, 0);
  for (let i = 0; i < M.chunks.length; i++) M.chunks[i].dirty = before[i];

  return { perChunk, dirtyCount: dirty.length, digFrame };
}, MODS)

console.log('\n=== 优化后实测（浏览器真实模块）===');
console.log(`  单 chunk 网格构建：${R.perChunk.toFixed(1)} ms`);
console.log(`  挖一个方块 → 脏区块 ${R.dirtyCount} 个，单帧重建 ${R.digFrame.toFixed(1)} ms`);
console.log(`  该帧理论帧率上限：${(1000 / Math.max(0.01, R.digFrame)).toFixed(0)} fps`);
console.log(`  （优化前：单 chunk 72.6 ms、挖方块单帧 87 ms → 11.5 fps）`);

/* 3) 主线程 longtask 分布 */
const lt = await page.evaluate(async () => {
  const out = [];
  let po = null;
  try {
    po = new PerformanceObserver((l) => { for (const e of l.getEntries()) out.push(e.duration) });
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) { return null }
  await new Promise((r) => setTimeout(r, 3000));
  po.disconnect();
  return out;
});
if (lt) {
  const sum = lt.reduce((s, v) => s + v, 0);
  console.log(`\n  3 秒内 longtask ${lt.length} 个，总计 ${sum.toFixed(0)}ms，最长 ${lt.length ? Math.max(...lt).toFixed(0) : 0}ms`);
}

console.log(errs.length ? '\n控制台报错：\n  ' + errs.slice(0, 8).join('\n  ') : '\n零控制台报错')
await browser.close()
