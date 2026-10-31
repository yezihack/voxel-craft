/* 探针 3：录屏前把三件事试清楚。
 *   A. 帧率 —— swiftshader 软件渲染够不够顺（不够就得想办法）
 *   B. switchDim 能不能在没建过门的情况下进异界，画面会不会黑
 *   C. spawnMob 能不能直接把 boss 刷到眼前
 */
import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const GL = (process.env.HW_GL === '1')
  ? ['--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: GL,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.veil .go', { timeout: 20000 });

/* 等地形就绪：连续 3 次采样一致 */
let last = '', stable = 0;
for (let i = 0; i < 250; i++) {
  const h = await page.textContent('.veil .hint').catch(() => '');
  if (h && h === last) { if (++stable >= 3) break; } else { stable = 0; last = h; }
  await page.waitForTimeout(300);
}
console.log('地形就绪');

await page.click('.veil .go');
await page.waitForTimeout(1500);

/* --- A. 帧率 --- */
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  function tick() {
    n++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else res(Math.round(n / ((performance.now() - t0) / 1000)));
  }
  requestAnimationFrame(tick);
}));
console.log('A) 帧率 ≈', fps, 'fps  (GL:', process.env.HW_GL === '1' ? '硬件' : 'swiftshader', ')');

/* --- B. 切维度 --- */
const dimRes = await page.evaluate(async () => {
  const P = await import('/src/game/portal.js');
  const S = await import('/src/game/state.js');
  const pl = await import('/src/game/player.js');
  const ok = P.switchDim(1);           // 熔火深渊
  return { ok, dim: S.dim, pos: [pl.player.x, pl.player.y, pl.player.z].map((v) => +v.toFixed(1)) };
});
console.log('B) switchDim(1) →', JSON.stringify(dimRes));
await page.waitForTimeout(3500);
const dimShot = await page.screenshot({ path: '.scratch/promo/_probe_dim.png' });
console.log('   截图字节数 =', dimShot.length, '(太小说明黑屏)');

/* --- C. 刷 boss --- */
const bossRes = await page.evaluate(async () => {
  const M = await import('/src/game/mobs.js');
  const pl = await import('/src/game/player.js');
  const px = pl.player.x, py = pl.player.y, pz = pl.player.z;
  M.spawnMob('dragon', px + 6, py + 3, pz + 2, 0);
  M.spawnMob('wither', px - 6, py + 3, pz + 4, 0);
  M.spawnMob('guardian', px + 2, py + 2, pz - 7, 0);
  return { mobs: M.mobs ? M.mobs.length : 'n/a' };
});
console.log('C) 刷 boss →', JSON.stringify(bossRes));
await page.waitForTimeout(1200);
await page.screenshot({ path: '.scratch/promo/_probe_boss.png' });

await browser.close();
