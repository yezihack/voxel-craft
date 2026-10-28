/* 真机触屏回归：在 Chromium 的触摸上下文里推摇杆 → 松手 → 看人是否真的停下
 *
 * 用法：
 *   npx vite --port 4175 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/flat-stick/touch.mjs
 *
 * 为什么不用 page.touchscreen：它只有 tap，没有「按住拖动」。
 * 摇杆要的是 touchStart → touchMove → 停一会儿 → touchEnd，
 * 只能走 CDP 的 Input.dispatchTouchEvent。
 *
 * 断言的坐标直接从游戏模块读（vite dev 下 '/src/game/player.js' 与页面内
 * import 的是同一个模块实例），不靠截图肉眼比对。 */

import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4175/';
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
  viewport: { width: 844, height: 390 },      // 手机横屏
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(PAGE_URL, { waitUntil: 'load' });
/* 必须等到「地形就绪」这四个字出现 —— 只等「正在生成地形」消失是不够的：
 * 引擎还没拉起时 .hint 元素根本不存在，取到空字符串会让这个条件立刻成立，
 * 于是脚本在引擎就绪前就去点按钮。 */
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 90000 },
);

/* 选超平坦：顺带验证「开始面板能切世界类型」这条链路还是通的 */
await page.locator('.mode', { hasText: '超平坦' }).click();
const worldFlat = await page.evaluate(async () => {
  const { ui } = await import('/src/game/uiState.js');
  const S = await import('/src/game/state.js');
  return { ui: ui.worldFlat, st: S.flatWorld };
});
ok(worldFlat.ui === true && worldFlat.st === true, '点「超平坦」后世界类型真的切过去了');
await page.click('.veil .panel .go');
await page.waitForTimeout(2600);

/* 把玩家挪到一块空地上（超平坦下 FLAT_H 以上三格是空气才算空地），
 * 免得出生就卡在村庄墙里，导致「前进」测不出位移。 */
const spot = await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const G = await import('/src/game/generate.js');
  const W = await import('/src/game/world.js');
  for (let i = 0; i < 400; i++) {
    const x = 3000 + i * 5, z = 3000;
    if (G.getBlock(x, W.FLAT_H + 1, z) === 0 && G.getBlock(x, W.FLAT_H + 2, z) === 0) {
      player.x = x + 0.5; player.y = W.FLAT_H + 1.05; player.z = z + 0.5;
      player.vx = player.vy = player.vz = 0;
      return { x: player.x, z: player.z, flatH: W.FLAT_H };
    }
  }
  return null;
});
ok(!!spot, '找到一块空地把玩家放下', spot ? `FLAT_H=${spot.flatH}` : '');

const readPos = () => page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  return { x: player.x, z: player.z };
});

const stick = await page.evaluate(() => {
  const b = document.querySelector('.stick').getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
ok(!!stick, '摇杆已渲染');

const cdp = await ctx.newCDPSession(page);
const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

const before = await readPos();

/* 按住摇杆往上推 900ms —— 正常应该一路前进 */
await send('touchStart', [{ x: stick.x, y: stick.y, id: 1 }]);
await send('touchMove', [{ x: stick.x, y: stick.y - 40, id: 1 }]);
await page.waitForTimeout(900);
const moving = await readPos();
const dist1 = Math.hypot(moving.x - before.x, moving.z - before.z);
ok(dist1 > 1.0, '推住摇杆 → 玩家确实在移动', `位移 ${dist1.toFixed(2)} 格`);

/* 松手：这是本次修复的核心 —— 松手之后必须停下 */
await send('touchEnd', []);
await page.waitForTimeout(400);
const afterEnd = await readPos();
await page.waitForTimeout(900);
const later = await readPos();
const drift = Math.hypot(later.x - afterEnd.x, later.z - afterEnd.z);
ok(drift < 0.35, '松手后不再自己往前走', `松手 0.4s→1.3s 内位移 ${drift.toFixed(2)} 格`);

/* 摇杆小圆点必须归位 */
const knob = await page.evaluate(() => document.querySelector('.knob').style.transform);
ok(knob === '', '摇杆小圆点回到圆心', `transform="${knob}"`);

/* 再推一次左 → 松手，确认换方向也一样停 */
await send('touchStart', [{ x: stick.x, y: stick.y, id: 1 }]);
await send('touchMove', [{ x: stick.x - 40, y: stick.y, id: 1 }]);
await page.waitForTimeout(600);
await send('touchEnd', []);
await page.waitForTimeout(300);
const a2 = await readPos();
await page.waitForTimeout(900);
const b2 = await readPos();
ok(Math.hypot(b2.x - a2.x, b2.z - a2.z) < 0.35, '横推后松手同样停得住');

/* 最后：传送到最近的村庄门口截一张图，用肉眼确认「建筑真的长出来了」，
 * 而不是只有断言通过。 */
const shot = await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const D = await import('/src/game/dims.js');
  const W = await import('/src/game/world.js');
  const G = await import('/src/game/generate.js');
  /* 找**离玩家最近**的村庄再传送。
   * 为什么不是「随便找一个」：区块窗口每帧只平移一格、每帧只重建 4 个区块，
   * 瞬移几千格要十几秒才铺完 —— 那不是 bug（正常游戏走不到这么快），
   * 但会让截图拍到还没重建的旧地形。传近一点，两三秒就位。 */
  const g0x = Math.floor(player.x / D.CELL), g0z = Math.floor(player.z / D.CELL);
  let best = null, bestD = Infinity;
  for (let gx = g0x - 8; gx <= g0x + 8; gx++)
    for (let gz = g0z - 8; gz <= g0z + 8; gz++) {
      if (D.structAt(gx, gz) !== 3) continue;
      const a = D.structAnchor(gx, gz);
      if (!a) continue;
      const d = (a.x - player.x) ** 2 + (a.z - player.z) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
  if (!best) return null;
  const a = best;
  /* 数一下锚点周围 34×34 范围内地表以上的方块数 —— 房子、广场、农田
   * 都算，用来确认「建筑真的被生成器铺出来了」，而不是只判了个类型。 */
  let solid = 0;
  for (let dx = -17; dx <= 17; dx++)
    for (let dz = -17; dz <= 17; dz++)
      for (let y = W.FLAT_H + 1; y <= W.FLAT_H + 10; y++)
        if (G.getBlock(a.x + dx, y, a.z + dz) !== 0) solid++;
  /* 站位：锚点北侧 15 格、45° 俯视。
   * 两个坑：
   *   · 别站太远（>20 格）—— 区块窗口稳定后玩家总落在窗口边角
   *     （shift 的容差是 halfX±1），朝 -z 只剩 1 格区块 ≈ 24 格可见距离；
   *   · 别平视 —— 超平坦是一望无际的平面，pitch 接近 0 时整屏都是雾，
   *     村庄会被雾色吃掉。45° 俯视才能同时看到广场和屋顶。 */
  player.x = a.x + 0.5; player.z = a.z - 15.5; player.y = W.FLAT_H + 1.05;
  player.vx = player.vy = player.vz = 0;
  player.yaw = Math.PI; player.pitch = -0.55;
  return { at: [a.x, a.z], solid, dist: Math.round(Math.sqrt(bestD)), yaw: player.yaw, ground: G.getBlock(a.x, W.FLAT_H, a.z) };
});
if (shot) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: new URL('./village.png', import.meta.url).pathname.replace(/^\//, '') });
  console.log('  村庄', JSON.stringify(shot));
  ok(shot.solid > 50, '村庄地表以上确实有大量方块', `${shot.solid} 格`);
} else {
  console.log('  （附近 8 格内没有村庄，跳过截图）');
}

ok(errs.length === 0, '页面零报错', errs.slice(0, 2).join(' | '));

await page.screenshot({ path: new URL('./play.png', import.meta.url).pathname.replace(/^\//, '') });
await browser.close();
console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
