/* 自由视角探针：俯仰不再卡在 ±90°、触屏单次滑动不再被 90px 封顶。
 *
 * Seam：浏览器真实输入。CDP 派发真触摸事件，并从页面已加载的模块实例
 *       里读 addLook / player / M4.view，避免 HMR 拿到第二个实例。
 *
 * 用法（改完代码必须重启 dev server）：
 *   npx vite --port 4182 --strictPort
 *   PW_ROOT=<playwright 包所在的 node_modules> node .scratch/free-look/probe.mjs
 */
import { createRequire } from 'node:module';

const PW_ROOT = process.env.PW_ROOT ||
  'C:/Users/htop/AppData/Local/npm-cache/_npx/f0a362733743bae2/node_modules';
const req = createRequire(`${PW_ROOT}/x.js`);
const { chromium } = req('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4182/';
const CHROME = process.env.PW_CHROME ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};
const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;

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

/* 页面真实加载的模块 URL（HMR 会带 ?t=，直接写死路径会拿到另一个实例） */
const urls = await page.evaluate(() => {
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  const find = (f) => names.find((u) => u.includes('/src/game/' + f)) || '/src/game/' + f;
  return { input: find('input.js'), player: find('player.js'), math: find('math.js') };
});
console.log('模块 URL：', urls);

const look = () => page.evaluate(async (u) => {
  const { player } = await import(u.player);
  return { pitch: player.pitch, yaw: player.yaw };
}, urls);
const reset = () => page.evaluate(async (u) => {
  const { player } = await import(u.player);
  player.pitch = 0; player.yaw = 0;
}, urls);

/* ---------------- 1. 纯逻辑：俯仰不再有边界 ---------------- */
const logic = await page.evaluate(async (u) => {
  const inp = await import(u.input);
  const { player } = await import(u.player);
  const { M4 } = await import(u.math);
  const out = {};

  /* 连续抬头：20 × 50px = 2.2 rad ≈ 126°，越过 90° */
  player.pitch = 0; player.yaw = 0;
  for (let i = 0; i < 20; i++) inp.addLook(0, -50);
  out.up = player.pitch;

  /* 连续低头：同样越过 -90° */
  player.pitch = 0; player.yaw = 0;
  for (let i = 0; i < 20; i++) inp.addLook(0, 50);
  out.down = player.pitch;

  /* 转满一整圈：方向应回到起点（角度折回 [-π,π)） */
  player.pitch = 0; player.yaw = 0;
  inp.addLook(0, -(2 * Math.PI) / inp.SENS);
  out.fullTurn = player.pitch;

  /* 长时间连续转头后数值仍健康（pitch 与 yaw 都要看） */
  player.pitch = 0; player.yaw = 0;
  for (let i = 0; i < 500; i++) inp.addLook(0, -40);
  out.longRun = player.pitch;
  player.pitch = 0; player.yaw = 0;
  for (let i = 0; i < 500; i++) inp.addLook(40, 0);
  out.longYaw = player.yaw;

  /* 非有限输入不能把 NaN 写进 player.pitch（旧 clamp 会把 ±Inf 夹回边界） */
  player.pitch = 0; player.yaw = 0;
  inp.addLook(0, Infinity);
  out.infPitch = player.pitch;

  /* 翻转后的视图基：pitch=180°（yaw=0）时应当朝 +z、画面上下颠倒，
   * 三个基向量仍是单位正交基 —— 这是独立推导出来的期望值，不是复述实现。 */
  const v = M4.view(0, 0, 0, 0, Math.PI);
  out.view = { right: [...v.right], up: [...v.up], dir: [...v.dir] };
  out.SENS = inp.SENS;
  return out;
}, urls);

const HALF_PI = Math.PI / 2;
console.log(`\n抬头 20×50px → pitch ${deg(logic.up)}°`);
ok(logic.up > HALF_PI + 0.1, '抬头能越过 +90° 继续翻转', `${deg(logic.up)}°`);
console.log(`低头 20×50px → pitch ${deg(logic.down)}°`);
ok(logic.down < -HALF_PI - 0.1, '低头能越过 -90° 继续翻转', `${deg(logic.down)}°`);
console.log(`转满一圈 → pitch ${deg(logic.fullTurn)}°`);
ok(Math.abs(logic.fullTurn) < 1e-6, '转满 360° 回到原朝向', `${deg(logic.fullTurn)}°`);
ok(Number.isFinite(logic.longRun) && Math.abs(logic.longRun) <= Math.PI,
  '长时间转头后 pitch 有限且折回主值区间', `${deg(logic.longRun)}°`);
ok(Number.isFinite(logic.longYaw) && Math.abs(logic.longYaw) <= Math.PI,
  '长时间转头后 yaw 同样折回主值区间', `${deg(logic.longYaw)}°`);
ok(Number.isFinite(logic.infPitch),
  '非有限输入不会把 NaN 写进 pitch', String(logic.infPitch));

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
console.log(`pitch=180° 视图基：right ${logic.view.right.map((n) => n.toFixed(2))}, up ${logic.view.up.map((n) => n.toFixed(2))}, dir ${logic.view.dir.map((n) => n.toFixed(2))}`);
ok(near(logic.view.right, [1, 0, 0]), '翻转后 right 仍是 (1,0,0)');
ok(near(logic.view.up, [0, -1, 0]), '翻转后 up 指向 -Y（画面自然倒置）');
ok(near(logic.view.dir, [0, 0, 1]), '翻转后准星射线朝 +Z，与相机一致');

/* ---------------- 2. 真触摸：单次 400px 不再被 90px 封顶 ---------------- */
await reset();
await touch('touchStart', [{ x: 195, y: 200, id: 7 }]);
await touch('touchMove', [{ x: 195, y: 600, id: 7 }]);   // 单次下滑 400px
await page.waitForTimeout(80);
await touch('touchEnd', []);
const one = await look();
/* 期望 400 × TOUCH_LOOK(1.15) × SENS(0.0022) = 1.012 rad ≈ 58°。
 * 旧封顶只有 90 × 1.15 × 0.0022 = 0.228 rad ≈ 13°；
 * 若事件被重复处理会 ≈ 2.02 rad，也会被这条区间挡住。 */
console.log(`\n单次下滑 400px → pitch ${deg(one.pitch)}°`);
ok(one.pitch < -0.9 && one.pitch > -1.15,
  '单次 400px 按真实位移转头，不再被 90px 截断', `${deg(one.pitch)}°`);

await reset();
await touch('touchStart', [{ x: 195, y: 700, id: 8 }]);
await touch('touchMove', [{ x: 195, y: 300, id: 8 }]);   // 单次上滑 400px
await page.waitForTimeout(80);
await touch('touchEnd', []);
const up1 = await look();
ok(up1.pitch > 0.9 && up1.pitch < 1.15,
  '单次上滑 400px 同样按真实位移转头', `${deg(up1.pitch)}°`);

/* 两下 400px = 800px ≈ 116°，真触摸也能翻过头顶 */
await touch('touchStart', [{ x: 195, y: 700, id: 9 }]);
await touch('touchMove', [{ x: 195, y: 300, id: 9 }]);
await page.waitForTimeout(80);
await touch('touchEnd', []);
const up2 = await look();
console.log(`两次上滑共 800px → pitch ${deg(up2.pitch)}°`);
ok(up2.pitch > HALF_PI + 0.1, '真触摸连续上滑可翻过 +90°', `${deg(up2.pitch)}°`);

/* ---------------- 3. 删掉封顶后的兜底：touchend 被吞 + identifier 复用 ----------------
 * 合成 TouchEvent 才能精确造出这个状态（CDP 的触摸点状态机不让你「不发 touchEnd
 * 又用同一个 id 重新按下」）。旧版靠 90px 封顶把这类跳变兜住，封顶删了以后
 * 必须由 touchstart 刷新基准。最后只滑 20px，pitch 变化应当只有约 2.9°。 */
const stale = await page.evaluate(async (u) => {
  const { player } = await import(u.player);
  const cv = document.querySelector('canvas');
  const mk = (id, x, y) => new Touch({ identifier: id, target: cv, clientX: x, clientY: y });
  const fire = (type, t) => cv.dispatchEvent(new TouchEvent(type, {
    touches: [t], changedTouches: [t], bubbles: true, cancelable: true,
  }));
  player.pitch = 0; player.yaw = 0;
  let t = mk(7, 195, 200); fire('touchstart', t);
  t = mk(7, 195, 300); fire('touchmove', t);        // 第一段正常滑 100px
  const afterFirst = player.pitch;
  /* touchend / touchcancel 整段被系统手势吞掉，不发任何结束事件 */
  t = mk(7, 100, 700); fire('touchstart', t);      // 新手势复用同一个 id，落点差了 400px
  t = mk(7, 100, 720); fire('touchmove', t);       // 只滑 20px
  return { pitch: player.pitch, afterFirst, yaw: player.yaw };
}, urls);
/* 第一段的 -14.5° 是正常滑动，不该算进跳变：只比较基准刷新后那 20px 的增量。
 * 未修复时这里会是 -60.9°（落点差 400px 被整段算进来）。 */
const staleDelta = stale.pitch - stale.afterFirst;
console.log(`\n旧 id 复用后滑 20px → 增量 ${deg(staleDelta)}°（此前 ${deg(stale.afterFirst)}°）`);
ok(Math.abs(staleDelta) < 0.1,
  '基准过期且 identifier 被复用时不会一次甩出几百像素', `${deg(staleDelta)}°`);

/* ---------------- 4. 回归：方向、双指、零报错 ---------------- */
await reset();
await touch('touchStart', [{ x: 195, y: 400, id: 10 }]);
await touch('touchMove', [{ x: 195, y: 420, id: 10 }]);
await page.waitForTimeout(30);
await touch('touchMove', [{ x: 195, y: 420, id: 10 }, { x: 70, y: 640, id: 11 }]);
await touch('touchMove', [{ x: 195, y: 440, id: 10 }, { x: 70, y: 600, id: 11 }]);
await page.waitForTimeout(30);
await touch('touchEnd', []);
const two = await look();
ok(two.pitch < 0, '多指时画布仍只认第一根手指（方向不反）', `${deg(two.pitch)}°`);

ok(errs.length === 0, '零控制台报错', errs.slice(0, 2).join(' | '));

await browser.close();
console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
