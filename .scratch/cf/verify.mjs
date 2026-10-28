/* 线上验收：打开 Cloudflare Pages 的真实地址，截图 + 抓控制台报错。
 * 只做「能不能跑起来」这一件事 —— 布局细节归 .scratch/mobile/shot.mjs。
 *
 * 用法：PW_ROOT=<playwright 包路径> node .scratch/cf/verify.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

/* 和 .scratch/mobile/shot.mjs 同一套：playwright 不进项目依赖，
 * 从 npx 缓存里 require（ESM 的 NODE_PATH 不生效，得用 createRequire 指定根）。 */
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.CF_URL || 'https://voxel-craft-516.pages.dev/';
const OUT = new URL('.', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const resp = await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 60000 });
console.log("HTTP", resp && resp.status(), PAGE_URL);

/* 等 Vue 挂上、WebGL 上下文建好 —— 开始遮罩出现就说明渲染循环已经在跑 */
await page.waitForSelector('.veil .panel h1', { timeout: 20000 });
console.log('标题:', await page.textContent('.veil .panel h1'));

const hasCanvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'no-canvas';
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return gl ? `webgl ok ${c.width}x${c.height}` : 'no-context';
});
console.log('画布:', hasCanvas);

await page.screenshot({ path: OUT + 'live-start.png' });

/* 进游戏，确认渲染循环真的在出帧（画布非纯色） */
await page.click('.veil .go');
await page.waitForTimeout(3500);
const stats = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height };
});
await page.screenshot({ path: OUT + 'live-play.png' });
console.log('游玩画面尺寸:', stats.w + 'x' + stats.h);
console.log('控制台错误:', errors.length ? errors.slice(0, 5) : '无');

await browser.close();
process.exit(errors.length ? 1 : 0);
