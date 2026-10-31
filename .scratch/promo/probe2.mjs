/* 探针 2：确认 dev server 下 import('/src/game/state.js') 是不是应用那个实例。
 * 上一版点的是 data-mode="0"，而当前 mode 本来就是 0，所以看不出变化 —— 这版点 1（生存）。
 * 另外验证两件事：
 *   · 指针锁定状态下 mouse.move 能不能真的转视角（movementX 是否非零）
 *   · 能不能用 import 到的 player 直接改 yaw/pitch 做确定性取景
 */
import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.veil .go', { timeout: 20000 });
await page.waitForTimeout(3000);

/* --- A. 模块实例：点「生存模式」后，import 到的 state.mode 有没有跟着变 --- */
const a = await page.evaluate(async () => {
  const s = await import('/src/game/state.js');
  const before = s.mode;
  document.querySelector('.veil .mode[data-mode="1"]').click();
  await new Promise((r) => setTimeout(r, 400));
  return { before, after: s.mode, MODE_SURVIVAL: s.MODE.SURVIVAL };
});
console.log('A) 点生存模式按钮 → dev 侧 module.mode:', JSON.stringify(a));
console.log('   结论:', a.after === 1 ? '✅ 同一模块实例（可以直接驱动）' : '❌ 不同实例（只能靠真实输入事件）');

/* --- B. 指针锁定 + mouse.move 能不能转视角 --- */
await page.click('.veil .go');
await page.waitForTimeout(1200);
const locked = await page.evaluate(() => document.pointerLockElement?.tagName ?? null);
console.log('B) pointerLockElement =', locked);

const yawBefore = await page.evaluate(async () => (await import('/src/game/player.js')).player.yaw);
await page.mouse.move(640, 400);
await page.mouse.move(760, 400, { steps: 10 });
await page.waitForTimeout(300);
const yawAfter = await page.evaluate(async () => (await import('/src/game/player.js')).player.yaw);
console.log('   mouse.move 前后 yaw:', yawBefore.toFixed(4), '→', yawAfter.toFixed(4),
  yawBefore !== yawAfter ? '✅ 指针锁定下可转视角' : '❌ 转不动');

/* --- C. 直接改 yaw/pitch 能不能立刻反映到画面 --- */
await page.evaluate(async () => {
  const p = await import('/src/game/player.js');
  p.player.yaw = 1.0;
  p.player.pitch = -0.35;
});
await page.waitForTimeout(400);
const shot = await page.screenshot();
/* 简单判断：画面不是纯色 = 渲染仍然在跑 */
const uniq = new Set();
for (let i = 0; i < shot.length; i += 997) uniq.add(shot[i]);
console.log('C) 改 yaw/pitch 后截图字节采样数 =', uniq.size, '(>1 说明画面有内容)');

await browser.close();
