/* 线上帧时间探针：真实浏览器里量「每帧主线程占用」与「长任务」。
 *
 * 用法：
 *   PW_ROOT="C:/Users/htop/.workbuddy-ai/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules" \
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   node .scratch/perf/online-frames.mjs
 *
 * 做法：注入 PerformanceObserver 收 longtask，并在页面里包一层 rAF，
 * 统计每帧间隔的分布（p50 / p95 / 最长）以及长任务总时长。
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

await page.addInitScript(() => {
  window.__lt = []
  window.__frames = []
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push({ d: e.duration, name: e.name })
    }).observe({ entryTypes: ['longtask'] })
  } catch (e) { /* 老浏览器没有 longtask */ }
  let last = performance.now()
  const tick = (t) => {
    window.__frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
await page.waitForFunction(
  () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
  null, { timeout: 120000 },
)
console.log('地形就绪，开始测量…')

/* 进游戏 */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /开始游戏|开始/.test(b.textContent || ''))
  if (btn) btn.click()
})
await page.waitForTimeout(1500)

/* 采样：先静置 3 秒（站着不动），再模拟走 3 秒 */
const res = await page.evaluate(async () => {
  const snap = () => window.__frames.slice();
  window.__frames.length = 0;
  window.__lt.length = 0;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 3000));
  const idle = { frames: snap(), lt: window.__lt.slice() };

  window.__frames.length = 0;
  window.__lt.length = 0;
  /* 模拟按住前进：直接派发键盘事件 */
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: 'w', bubbles: true }));
  key('keydown', 'KeyW');
  await new Promise((r) => setTimeout(r, 3000));
  key('keyup', 'KeyW');
  const walk = { frames: snap(), lt: window.__lt.slice() };
  return { idle, walk, elapsed: performance.now() - t0 };
});

function stats(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const p = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  const sum = a.reduce((s, v) => s + v, 0);
  return {
    n: a.length, p50: p(0.5), p95: p(0.95), max: a[a.length - 1],
    mean: sum / a.length, over50: a.filter((v) => v > 50).length,
    over100: a.filter((v) => v > 100).length, over16: a.filter((v) => v > 16.7).length,
  };
}
function show(label, d) {
  const f = stats(d.frames);
  console.log(`\n=== ${label} ===`);
  console.log(`  帧数 ${f.n}，平均帧间隔 ${f.mean.toFixed(1)}ms（≈ ${(1000 / f.mean).toFixed(0)} fps）`);
  console.log(`  p50 ${f.p50.toFixed(1)}ms · p95 ${f.p95.toFixed(1)}ms · 最长 ${f.max.toFixed(1)}ms`);
  console.log(`  >16.7ms 的帧 ${f.over16}（${(f.over16 / f.n * 100).toFixed(0)}%）· >50ms ${f.over50} · >100ms ${f.over100}`);
  const lt = d.lt || [];
  const ltSum = lt.reduce((s, e) => s + e.d, 0);
  console.log(`  longtask ${lt.length} 个，总计 ${ltSum.toFixed(0)}ms，最长 ${lt.length ? Math.max(...lt.map(e => e.d)).toFixed(0) : 0}ms`);
  const big = lt.sort((a, b) => b.d - a.d).slice(0, 8);
  for (const e of big) console.log(`    · ${e.d.toFixed(0)}ms  ${e.name}`);
}
show('静置（站着不动）', res.idle);
show('行走（按住 W 3 秒）', res.walk);

if (errs.length) {
  console.log('\n控制台报错：')
  for (const e of errs.slice(0, 10)) console.log('  ' + e)
} else console.log('\n零控制台报错')

await browser.close()
