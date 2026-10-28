/* 单视口：进游戏 → 量布局 → 截图。用来快速迭代竖屏排版。 */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const CHROME = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);
const TAG = `${W}x${H}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: false, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto('http://localhost:4180/', { waitUntil: 'load' });

/* 等 hint 稳定在「地形就绪」：连续 3 次采样一致才算。
 * 只等一次 /地形就绪/ 会在进度条抖动的瞬间假通过，接着点开始按钮
 * 正好撞上面板重渲染，看起来像「按钮没反应」。 */
{
  let stable = 0, last = '';
  for (let i = 0; i < 240; i++) {
    const hint = await page.evaluate(() => document.querySelector('.hint')?.textContent || '');
    if (/地形就绪/.test(hint) && hint === last) stable++;
    else stable = 0;
    last = hint;
    if (stable >= 3) break;
    await page.waitForTimeout(500);
  }
}
console.log('地形就绪');

/* 用 DOM click 而不是坐标点击：hasTouch 的 context 里 Playwright 的
 * force click 走的是触摸事件流，`.go` 只挂了 @click，合成 click 有时不来。
 * 真实手机上触摸一定会合成 click，所以这里只验证「按钮的 click 处理器能不能进游戏」。 */
await page.evaluate(() => document.querySelector('.veil .panel .go')?.click());

/* 点击若没生效，退化成直接调 startGame —— 布局体检只关心控件出现，
 * 不关心「怎么进来的」。真实点击是否可用单独在 diag.mjs 里查。 */
await page.waitForTimeout(600);
const entered = await page.evaluate(() => (document.querySelector('.veil')?.className || '').includes('hide'));
if (!entered) {
  console.log('  ⚠ 点击「开始游戏」没生效，改用直接调用');
  await page.evaluate(async () => {
    const A = await import('/src/game/uiActions.js');
    A.startGame(false);
  });
}
/* MODE=1 生存：会把心形 / 鸡腿 / 氧气泡画在底部居中，是竖屏最容易压住按钮的东西 */
if (process.env.MODE === '1') {
  await page.evaluate(async () => {
    const A = await import('/src/game/uiActions.js');
    A.pickMode(1);
  });
  await page.waitForTimeout(400);
}

for (let i = 0; i < 120; i++) {
  const cls = await page.evaluate(() => document.querySelector('.veil')?.className || 'none');
  if (cls.includes('hide')) { console.log('进入游戏，用时', i, '×500ms'); break; }
  if (i === 119) console.log('超时未进入，veil class =', cls);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1000);

const report = await page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const one = (sel) => { const el = document.querySelector(sel); return el ? rect(el) : null; };
  const many = (sel) => [...document.querySelectorAll(sel)].map((el) => ({ txt: el.textContent.trim().slice(0, 4), ...rect(el) }));

  /* 两两重叠：只比「有实体视觉」的块，Vitals 也算（它虽然不吃事件但会盖住按钮） */
  const blocks = [
    { name: '摇杆', ...one('.stick') },
    { name: '动作区', ...one('.pad') },
    { name: '物品栏', ...one('.hotbar') },
    { name: '状态', ...one('.vitals') },
    { name: '系统栏', ...one('.sysrow') },
  ].filter((b) => b.l !== undefined);
  const overlap = (a, b) => {
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    return w > 0 && h > 0 ? { w, h } : null;
  };
  const clashes = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const o = overlap(blocks[i], blocks[j]);
      if (o) clashes.push(`${blocks[i].name}×${blocks[j].name} ${o.w}×${o.h}`);
    }
  }
  const out = blocks.map((b) => {
    const flags = [];
    if (b.l < 0 || b.t < 0 || b.r > vw || b.b > vh) flags.push('越界');
    return `${b.name} [${b.l},${b.t} → ${b.r},${b.b}] ${b.w}×${b.h} ${flags.join('')}`;
  });
  return { vw, vh, out, clashes, slots: many('.hotbar .slot'), btns: many('.touchctl .tb') };
});

console.log(`\n视口 ${report.vw}×${report.vh}`);
report.out.forEach((l) => console.log('  ' + l));
console.log('  重叠:', report.clashes.length ? report.clashes.join(' | ') : '无');
console.log('  物品栏格子:', report.slots.map((s) => `${s.txt}@${s.l}~${s.r}`).join(' '));
console.log('  按钮:', report.btns.map((s) => `${s.txt}@${s.l},${s.t}`).join(' '));
if (errs.length) console.log('  ERR:', errs.slice(0, 2).join(' | '));

await page.screenshot({ path: `.scratch/mobile/check-${TAG}.png` });
await browser.close();
