/* 线上验收：真实地址 + 竖屏视口，纯 DOM 量布局（不 import 源码模块，
 * 线上是打包产物，没有 /src/game/*）。
 *
 * 用法：PAGE_URL=https://voxel-craft-516.pages.dev/ PW_ROOT=... node .scratch/mobile/verify-live.mjs
 */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const CHROME = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;
const PAGE_URL = process.env.PAGE_URL || 'https://voxel-craft-516.pages.dev/';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
];

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2, isMobile: false, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(PAGE_URL, { waitUntil: 'load' });

  /* 等 hint 连续 3 次稳定在「地形就绪」 */
  let stable = 0, last = '';
  for (let i = 0; i < 240; i++) {
    const hint = await page.evaluate(() => document.querySelector('.hint')?.textContent || '');
    if (/地形就绪/.test(hint) && hint === last) stable++;
    else stable = 0;
    last = hint;
    if (stable >= 3) break;
    await page.waitForTimeout(500);
  }

  /* 生存模式：只有生存模式才画心形/鸡腿，也就是原来压住按钮的那批 */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.modes .mode')].find((x) => x.textContent.includes('生存'));
    b?.click();
  });
  await page.waitForTimeout(300);

  const box = await page.locator('.veil .panel .go').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const rect = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const one = (sel) => { const el = document.querySelector(sel); return el ? rect(el) : null; };
    const blocks = [
      { name: '摇杆', ...one('.stick') },
      { name: '动作区', ...one('.pad') },
      { name: '物品栏', ...one('.hotbar') },
      { name: '状态', ...one('.vitals') },
      { name: '系统栏', ...one('.sysrow') },
    ].filter((b) => b.l !== undefined);
    const clash = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 0 && h > 0) clash.push(`${a.name}×${b.name} ${w}×${h}`);
      }
    }
    const outside = blocks.filter((b) => b.l < -1 || b.t < -1 || b.r > vw + 1 || b.b > vh + 1).map((b) => b.name);
    return { vw, vh, blocks, clash, outside, hasVitals: !!one('.vitals'), hasTouch: !!document.querySelector('.touchctl'), veil: document.querySelector('.veil')?.className };
  });

  console.log(`\n===== ${vp.name} =====`);
  ok(r.veil.includes('hide'), '进入游戏（遮罩已隐藏）', r.veil);
  ok(r.hasTouch, '触屏控件已渲染');
  ok(r.hasVitals, '生存模式状态条已渲染');
  ok(r.outside.length === 0, '没有控件越出屏幕', r.outside.join(',') || '');
  ok(r.clash.length === 0, '控件之间没有重叠', r.clash.join(' | ') || '');
  ok(errs.length === 0, '控制台零报错', errs.slice(0, 2).join(' | '));
  if (process.env.SHOT !== '0') await page.screenshot({ path: `.scratch/mobile/live-${vp.name}.png` });

  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
