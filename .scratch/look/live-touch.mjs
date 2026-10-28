/* 线上验证触屏视角：真触摸下滑，截图看视线是否跟着低头。
 * 线上是打包产物，读不到 /src/game/*，只能靠画面判断。
 *
 * 用法：PW_ROOT=... node .scratch/look/live-touch.mjs
 */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const PAGE_URL = process.env.PAGE_URL || 'https://voxel-craft-516.pages.dev/';
const CHROME = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0 })),
});

await page.goto(PAGE_URL, { waitUntil: 'load' });
let stable = 0, last = '';
for (let i = 0; i < 240; i++) {
  const hint = await page.evaluate(() => document.querySelector('.hint')?.textContent || '');
  if (/地形就绪/.test(hint) && hint === last) stable++;
  else stable = 0;
  last = hint;
  if (stable >= 3) break;
  await page.waitForTimeout(500);
}
const box = await page.locator('.veil .panel .go').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(2500);
console.log('已进入游戏');

await page.screenshot({ path: '.scratch/look/live-0-level.png' });

/* 下滑 260px：按 14.5°/100px 算约 -38°，应该从天空/远景转到地面 */
await touch('touchStart', [{ x: 195, y: 260 }]);
for (let i = 1; i <= 13; i++) {
  await touch('touchMove', [{ x: 195, y: 260 + i * 20 }]);
  await page.waitForTimeout(18);
}
await touch('touchEnd', []);
await page.waitForTimeout(300);
await page.screenshot({ path: '.scratch/look/live-38-down.png' });

/* 再滑一段，一路顶到 -90° */
await touch('touchStart', [{ x: 195, y: 200 }]);
for (let i = 1; i <= 20; i++) {
  await touch('touchMove', [{ x: 195, y: 200 + i * 30 }]);
  await page.waitForTimeout(16);
}
await touch('touchEnd', []);
await page.waitForTimeout(300);
await page.screenshot({ path: '.scratch/look/live-90-down.png' });

/* 反向：上滑 700px，应该从脚下抬到天空 */
await touch('touchStart', [{ x: 195, y: 780 }]);
for (let i = 1; i <= 20; i++) {
  await touch('touchMove', [{ x: 195, y: 780 - i * 35 }]);
  await page.waitForTimeout(16);
}
await touch('touchEnd', []);
await page.waitForTimeout(300);
await page.screenshot({ path: '.scratch/look/live-up.png' });

console.log(errs.length ? 'ERR: ' + errs.slice(0, 3).join(' | ') : '控制台零报错');
await browser.close();
