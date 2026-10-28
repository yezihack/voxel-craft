/* 触屏视角：滑动方向、灵敏度、以及「delta 爆炸」的复现。
 *
 * 用法：
 *   npx vite --port 4181 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/look/probe.mjs
 */
import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4181/';
const CHROME = process.env.PW_CHROME ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};

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

const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0 })),
});

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 120000 },
);
await page.click('.veil .panel .go');
await page.waitForTimeout(2000);

const look = () => page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  return { pitch: player.pitch, yaw: player.yaw };
});
const reset = () => page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  player.pitch = 0; player.yaw = 0;
});
const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;

/* ---------- 1. 手指下滑 = 低头？ ---------- */
await reset();
let a = await look();
await touch('touchStart', [{ x: 195, y: 300 }]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [{ x: 195, y: 300 + i * 20 }]);   // 下滑 200px
  await page.waitForTimeout(16);
}
await touch('touchEnd', []);
await page.waitForTimeout(120);
let b = await look();
console.log(`\n下滑 200px：pitch ${deg(a.pitch)}° → ${deg(b.pitch)}°`);
ok(b.pitch < a.pitch, '手指下滑 → 视线向下（低头）', `${deg(b.pitch)}°`);
ok(Math.abs(deg(b.pitch)) < 80, '滑 200px 不会顶到边界', `${deg(b.pitch)}°`);

/* ---------- 2. 手指上滑 = 抬头？ ---------- */
await reset();
a = await look();
await touch('touchStart', [{ x: 195, y: 600 }]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [{ x: 195, y: 600 - i * 20 }]);
  await page.waitForTimeout(16);
}
await touch('touchEnd', []);
await page.waitForTimeout(120);
b = await look();
console.log(`上滑 200px：pitch ${deg(a.pitch)}° → ${deg(b.pitch)}°`);
ok(b.pitch > a.pitch, '手指上滑 → 视线向上（抬头）', `${deg(b.pitch)}°`);

/* ---------- 3. 灵敏度：滑 100px 转多少度 ---------- */
await reset();
await touch('touchStart', [{ x: 195, y: 400 }]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [{ x: 195, y: 400 + i * 10 }]);
  await page.waitForTimeout(16);
}
await touch('touchEnd', []);
await page.waitForTimeout(120);
const per100 = Math.abs(deg((await look()).pitch));
console.log(`\n滑 100px 转了 ${per100}°`);
ok(per100 > 8 && per100 < 30, '灵敏度落在「滑 100px 转 8~30°」区间', `${per100}°`);

/* ---------- 4. 多指：摇杆 + 画布同时按 ---------- */
await reset();
a = await look();
await touch('touchStart', [{ x: 195, y: 500, id: 1 }]);          // 画布
await touch('touchMove', [{ x: 195, y: 520, id: 1 }]);
await page.waitForTimeout(30);
const oneFinger = await look();
/* 第二根手指落在摇杆上（左下角），再滑画布 */
await touch('touchMove', [{ x: 195, y: 520, id: 1 }, { x: 70, y: 640, id: 2 }]);
await page.waitForTimeout(30);
await touch('touchMove', [{ x: 195, y: 540, id: 1 }, { x: 70, y: 600, id: 2 }]);
await page.waitForTimeout(30);
await touch('touchEnd', []);
await page.waitForTimeout(120);
b = await look();
console.log(`\n双指：pitch ${deg(oneFinger.pitch)}° → ${deg(b.pitch)}°`);
ok(Math.abs(deg(b.pitch) - deg(oneFinger.pitch)) < 8, '第二根手指不抢视角（画布只认第一根）', `${deg(b.pitch)}°`);

/* ---------- 5. delta 爆炸：touchstart 被吞后基准是否过期 ---------- */
await reset();
/* 第一段：正常滑一段，然后**不发 touchEnd**，直接在别处 touchStart。
 * 模拟「touchend 被系统手势吞掉」——旧代码里 lookId 残留会让第二次
 * touchStart 直接 return，lookX/lookY 停在上一段末尾。 */
await touch('touchStart', [{ x: 100, y: 200, id: 1 }]);
await touch('touchMove', [{ x: 100, y: 220, id: 1 }]);
await page.waitForTimeout(30);
/* 换个位置重新按下（不发 touchEnd） */
await touch('touchStart', [{ x: 100, y: 220, id: 1 }, { x: 300, y: 700, id: 2 }]);
await page.waitForTimeout(30);
await touch('touchMove', [{ x: 100, y: 220, id: 1 }, { x: 305, y: 710, id: 2 }]);
await page.waitForTimeout(30);
const jump = await look();
console.log(`\n基准过期场景：pitch ${deg(jump.pitch)}°（起点 0°）`);
ok(Math.abs(deg(jump.pitch)) < 20, '基准过期后滑一小段不会跳变', `${deg(jump.pitch)}°`);
await touch('touchEnd', []);

/* ---------- 6. 能低头到脚下吗 ---------- */
await reset();
await touch('touchStart', [{ x: 195, y: 100 }]);
for (let i = 1; i <= 20; i++) {
  await touch('touchMove', [{ x: 195, y: 100 + i * 35 }]);        // 一路滑到 800
  await page.waitForTimeout(12);
}
await touch('touchEnd', []);
await page.waitForTimeout(120);
const down = await look();
console.log(`\n一路下滑到底：pitch ${deg(down.pitch)}°`);
ok(deg(down.pitch) < -80, '能低头到接近正下方（≥80°）', `${deg(down.pitch)}°`);

ok(errs.length === 0, '零控制台报错', errs.slice(0, 2).join(' | '));

await browser.close();
console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
