/* 干净验证：只靠 DOM 观察「开始游戏」能不能进，不 import 任何模块
 * （dev 环境下 import('/src/xxx.js') 可能拿到与组件不同的模块实例）。 */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const CHROME = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
await page.goto('http://localhost:4180/', { waitUntil: 'load' });

const snap = () => page.evaluate(() => ({
  hint: (document.querySelector('.hint')?.textContent || '').slice(0, 30),
  veil: document.querySelector('.veil')?.className,
  touchctl: !!document.querySelector('.touchctl'),
}));

/* 等 hint 真的稳定在「地形就绪」——连续 3 次采样都一样才算 */
let stable = 0, last = '';
for (let i = 0; i < 240; i++) {
  const s = await snap();
  if (/地形就绪/.test(s.hint)) { if (s.hint === last) stable++; else { stable = 0; last = s.hint; } }
  else stable = 0;
  if (stable >= 3) break;
  await page.waitForTimeout(500);
}
console.log('就绪快照:', JSON.stringify(await snap()));

const box = await page.locator('.veil .panel .go').boundingBox();
console.log('按钮位置:', JSON.stringify(box));
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);
console.log('点击后:', JSON.stringify(await snap()));

/* 再试一次直接 DOM click */
await page.evaluate(() => document.querySelector('.veil .panel .go')?.click());
await page.waitForTimeout(1500);
console.log('DOM click 后:', JSON.stringify(await snap()));

await browser.close();
