/* 移动端布局截图：用真 Chromium 起一个 iPhone 尺寸的触屏上下文，
 * 进游戏后截两张图（横屏 / 竖屏），用来肉眼确认按钮没压住快捷栏、
 * 9 格没有溢出屏幕、左上角确实没有文字卡。
 *
 * 跑法（playwright 走 npx 缓存，不往项目里装依赖）：
 *   npx vite preview --port 4173 &
 *   NODE_PATH=<npx 缓存>/node_modules node .scratch/mobile/shot.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

/* playwright 不装进项目依赖（那会往 package.json 里塞一个只给截图用的包），
 * 改成从 npx 缓存里 require。ESM 的 NODE_PATH 不生效，所以用 createRequire
 * 指定解析根目录：PW_ROOT=<...>/node_modules。 */
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.SHOT_URL || 'http://localhost:4173/';
const OUT = new URL('.', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: 'landscape', width: 844, height: 390 },   // iPhone 14 横屏
  { name: 'portrait', width: 390, height: 844 },    // iPhone 14 竖屏
];

/* 本机已装的 chromium 版本（1169）比 1.49.1 期望的（1148）新一档，
 * 直接指 executablePath 用现成的，免得为了截一张图再下一个 130MB 的浏览器。 */
const CHROME = process.env.PW_CHROME || `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(PAGE_URL, { waitUntil: 'load' });

  // 等引擎把地形铺完：开始按钮一直存在，但 veilHint 会从「正在生成地形…」变成就绪文案
  await page.waitForFunction(
    () => !/正在生成地形/.test(document.querySelector('.hint')?.textContent || ''),
    null, { timeout: 60000 },
  ).catch(() => {});
  await page.screenshot({ path: `${OUT}${c.name}-start.png` });

  /* 必须限定在开始面板里 —— 死亡面板的「重生」按钮同样带 .go 类 */
  await page.click('.veil .panel .go');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}${c.name}-play.png` });

  // 把关键元素的位置量出来，重叠与否用数字判断，别只靠眼睛
  const box = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) };
    };
    return {
      touch: window.__touch ?? null,
      hotbar: r('.hotbar'),
      stick: r('.stick'),
      pad: r('.pad'),
      sysrow: r('.sysrow'),
      vitals: r('.vitals'),
      hud: r('.hud'),
      vw: innerWidth, vh: innerHeight,
    };
  });
  console.log(`\n[${c.name}] ${c.width}×${c.height}`);
  for (const [k, v] of Object.entries(box)) {
    if (v && typeof v === 'object') console.log(`  ${k.padEnd(8)} ${JSON.stringify(v)}`);
    else console.log(`  ${k.padEnd(8)} ${v}`);
  }
  const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  console.log('  快捷栏×动作区重叠 :', overlap(box.hotbar, box.pad) ? '❌ 有' : '✓ 无');
  console.log('  快捷栏×摇杆重叠   :', overlap(box.hotbar, box.stick) ? '❌ 有' : '✓ 无');
  console.log('  生命条×快捷栏重叠 :', overlap(box.vitals, box.hotbar) ? '❌ 有' : '✓ 无');
  console.log('  左上角 HUD 残留   :', box.hud ? '❌ 还在' : '✓ 无');
  if (errs.length) console.log('  页面报错:', errs.slice(0, 3));
  await ctx.close();
}

await browser.close();
