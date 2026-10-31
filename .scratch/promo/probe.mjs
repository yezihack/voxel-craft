/* 探针：搞清楚三件事，决定录屏 / 截图脚本怎么写。
 *   1. 无头 Chromium 里 requestPointerLock 能不能成功（失败会触发 pauseGame）
 *   2. 拖拽转视角（pointerdown + pointermove）在没锁指针时能不能用
 *   3. dev server 下 import('/src/game/xxx.js') 拿到的是不是应用同一个模块实例
 */
import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/* ---------- 1 & 2：生产构建（preview）上的指针锁定 + 拖拽转视角 ---------- */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto('http://localhost:4173/', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.veil .go', { timeout: 20000 });
/* 等地形就绪：提示语连续 3 次采样一致（进度条抖动时会假通过） */
let last = '', stable = 0;
for (let i = 0; i < 200; i++) {
  const h = await page.textContent('.veil .hint').catch(() => '');
  if (h && h === last) { if (++stable >= 3) break; } else { stable = 0; last = h; }
  await page.waitForTimeout(300);
}
console.log('1) 地形就绪提示:', (last || '').slice(0, 60));

await page.click('.veil .go');
await page.waitForTimeout(1500);
console.log('2) 点击开始后 pointerLockElement =', await page.evaluate(() => document.pointerLockElement?.tagName ?? null));
console.log('   遮罩是否已隐藏 =', await page.evaluate(() => document.querySelector('.veil')?.classList.contains('hide')));

/* 视角是否真的能改：读 canvas 上的准星周围像素不好读，
 * 改成读「相机朝向」—— 用引擎暴露的 DOM 侧证：点击热键栏切换格子看 DOM 变化。
 * 这里直接验证拖拽路径有没有产生 pointermove：注入计数器。 */
await page.evaluate(() => {
  window.__pm = 0;
  window.addEventListener('pointermove', () => { window.__pm++; }, true);
});
/* 拖拽转视角：在画布上按下左键再移动 */
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.move(760, 430, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
console.log('   拖拽期间 pointermove 次数 =', await page.evaluate(() => window.__pm));

/* 键盘能否驱动：按 W 走 1.2 秒，看玩家有没有动 */
const before = await page.evaluate(() => window.__probePos ?? null);
await page.keyboard.down('w');
await page.waitForTimeout(1200);
await page.keyboard.up('w');
await page.waitForTimeout(300);
console.log('   按键后页面仍在运行 =', await page.evaluate(() => !document.querySelector('.veil')?.classList.contains('hide') === false));

/* ---------- 3：dev server 模块实例 ---------- */
const page2 = await ctx.newPage();
await page2.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 60000 });
await page2.waitForSelector('.veil .go', { timeout: 20000 });
await page2.waitForTimeout(2500);
const inst = await page2.evaluate(async () => {
  const p = await import('/src/game/player.js');
  const s = await import('/src/game/state.js');
  return {
    playerYaw: p.player.yaw,
    stateDim: s.dim,
    hasPortal: !!(await import('/src/game/portal.js')).switchDim,
    hasMode: s.mode,
  };
});
console.log('3) dev 模块实例:', JSON.stringify(inst));
/* 再看 UI 上的 mode 是不是同一个实例的反应 */
const modeSeen = await page2.evaluate(async () => {
  const s = await import('/src/game/state.js');
  const before = s.mode;
  document.querySelector('.veil .mode[data-mode]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: s.mode };
});
console.log('   点模式按钮后 dev 侧 module 看到的变化:', JSON.stringify(modeSeen));

await browser.close();
