/* 端到端断言：手机进游戏后不会被「暂停回面板」、切后台会暂停、
 * 以及挖放距离真的变成 13 格。
 *
 * 用法：
 *   npx vite --port 4176 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/crash/e2e.mjs
 */

import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4176/';
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
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 90000 },
);

/* ---- 1. 触屏判定 ---- */
const touch = await page.evaluate(async () => {
  const { ui } = await import('/src/game/uiState.js');
  return { touch: ui.touch, coarse: matchMedia('(pointer: coarse)').matches, w: innerWidth };
});
ok(touch.touch === true, '窄屏 + 触摸能力 → 判定为触屏', JSON.stringify(touch));

/* ---- 2. 点开始游戏后不能「闪回」开始面板 ---- */
await page.click('.veil .panel .go');
await page.waitForTimeout(1200);
const afterStart = await page.evaluate(async () => {
  const { ui } = await import('/src/game/uiState.js');
  const S = await import('/src/game/state.js');
  return { veil: ui.veilVisible, running: S.running, paused: S.paused, dead: ui.deathVisible };
});
ok(afterStart.veil === false, '开始后遮罩保持关闭（不会闪退回面板）', JSON.stringify(afterStart));
ok(afterStart.running === true && afterStart.paused === false, '游戏处于运行状态');

/* ---- 3. 触屏环境下 pointerlockerror 不该暂停游戏 ---- */
const afterPlErr = await page.evaluate(async () => {
  document.dispatchEvent(new Event('pointerlockerror'));
  await new Promise((r) => setTimeout(r, 200));
  const S = await import('/src/game/state.js');
  const { ui } = await import('/src/game/uiState.js');
  return { paused: S.paused, veil: ui.veilVisible };
});
ok(afterPlErr.paused === false && afterPlErr.veil === false,
  '触屏下 pointerlockerror 不会把游戏踢回面板', JSON.stringify(afterPlErr));

/* ---- 4. 切后台自动暂停（回来时至少有个暂停面板可点） ---- */
const afterHide = await page.evaluate(async () => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 200));
  const S = await import('/src/game/state.js');
  const { ui } = await import('/src/game/uiState.js');
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  return { paused: S.paused, veil: ui.veilVisible };
});
ok(afterHide.paused === true, '切到后台会暂停（避免回来时黑屏）', JSON.stringify(afterHide));

/* ---- 5. 挖放距离 13 格：raycast 能命中 11 格外的方块 ---- */
const reach = await page.evaluate(async () => {
  const C = await import('/src/game/config.js');
  const { player, raycast } = await import('/src/game/player.js');
  const G = await import('/src/game/generate.js');
  const S = await import('/src/game/state.js');
  S.setPaused(false);
  /* 找一块空地，然后朝 -z 方向在 11 格外放一块石头 */
  let px = 0, py = 0, pz = 0;
  outer:
  for (let x = 2000; x < 2100; x++)
    for (let z = 2000; z < 2100; z++) {
      const y = 30;
      if (G.getBlock(x, y, z) === 0 && G.getBlock(x, y + 1, z) === 0) { px = x; py = y; pz = z; break outer; }
    }
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -14; dz <= 0; dz++) G.setBlock(px + dx, py + dy, pz + dz, 0);
  /* 石头必须放在眼睛那一层：raycast 是水平射线（pitch=0），
   * 放在脚下会从头顶飞过去，测出来永远是 null。 */
  G.setBlock(px, py + 1, pz - 11, 3);        // 11 格外一块石头（眼高）
  player.x = px + 0.5; player.y = py; player.z = pz + 0.5;
  player.yaw = 0; player.pitch = 0;          // 看向 -z
  const hit = raycast(C.REACH);
  const hitOld = raycast(9);
  G.setBlock(px, py + 1, pz - 11, 0);
  return { REACH: C.REACH, ATK: C.REACH_ATTACK, hitDist: hit && hit.dist, oldHit: hitOld && hitOld.dist };
});
ok(reach.REACH >= 12, 'REACH 调远', `REACH=${reach.REACH}`);
ok(reach.hitDist > 9 && reach.hitDist <= 13,
  '11 格外的方块现在够得到了（9 格时够不到）', `命中距离 ${reach.hitDist}, 旧距离命中 ${reach.oldHit}`);
ok(reach.oldHit === undefined || reach.oldHit === null, '9 格射程确实够不到它');

/* ---- 6. 64 只生物同时在场：不崩、帧率不塌 ---- */
const crowd = await page.evaluate(async () => {
  const M = await import('/src/game/mobs.js');
  const L = await import('/src/game/loop.js');
  const { player } = await import('/src/game/player.js');
  M.despawnAllMobs();
  for (let i = 0; i < M.MOB_CAP; i++) {
    const a = (i / M.MOB_CAP) * Math.PI * 2;
    M.spawnMob(i % 3 === 0 ? 'zombie' : 'pig',
      player.x + Math.cos(a) * 8, player.y + 1, player.z + Math.sin(a) * 8);
  }
  await new Promise((r) => setTimeout(r, 2500));
  return { n: M.mobs.length, fps: Math.round(L.fps || 0) };
});
ok(crowd.n === 64, '64 只生物全部在场', JSON.stringify(crowd));
ok(crowd.fps >= 12, '满编生物时帧率没有塌掉（软件渲染下的下限）', `fps=${crowd.fps}`);

ok(errs.length === 0, '页面零报错', errs.slice(0, 2).join(' | '));

await browser.close();
console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
