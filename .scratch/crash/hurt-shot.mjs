/* 截图：AI 玩家被僵尸围攻，头顶血条真的在掉
 *
 * 用法：
 *   npx vite --port 4178 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/crash/hurt-shot.mjs
 */

import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4178/';
const CHROME = process.env.PW_CHROME ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;
const OUT = new URL('.', import.meta.url).pathname.replace(/^\//, '');

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 900, height: 560 }, deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 90000 },
);
/* 必须用超平坦：场景里所有 y 都按 FLAT_H 算，经典地形下地面高度不固定，
 * 摆在 FLAT_H 的僵尸会卡在石头里 / 悬在半空。 */
await page.locator('.mode', { hasText: '超平坦' }).click();
await page.click('.veil .panel .go');
await page.waitForTimeout(1500);

/* 摆一个场景：玩家站在 (x,z)，正前方 4 格放一个 AI 玩家，再往前 2 格放三只僵尸。
 * botFreeze 让 AI 玩家站着不动（否则它会跑去打架，拍不到「挨打」）。 */
const setup = await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const G = await import('/src/game/generate.js');
  const W = await import('/src/game/world.js');
  const M = await import('/src/game/mobs.js');
  const B = await import('/src/game/bots.js');

  /* 找一块空地 */
  let px = 0, pz = 0;
  outer:
  for (let x = 1200; x < 1400; x += 4)
    for (let z = 1200; z < 1400; z += 4) {
      if (G.getBlock(x, W.FLAT_H + 1, z) === 0 && G.getBlock(x, W.FLAT_H + 2, z) === 0) { px = x; pz = z; break outer; }
    }
  player.x = px + 0.5; player.z = pz + 6.5; player.y = W.FLAT_H + 1.05;
  player.vx = player.vy = player.vz = 0;
  player.yaw = 0; player.pitch = -0.04;      // 看向 -z

  /* 把场上第一个 AI 玩家直接搬到镜头前（不新造：spawnBot 造的人会被
   * 「跑远了回收」带走，两次跑下来对不上号）。 */
  const b = B.bots[0];
  if (!b) return { err: '场上没有 AI 玩家' };
  b.name = '沙包';
  b.x = px + 0.5; b.z = pz - 0.5; b.y = W.FLAT_H + 1.05;
  b.vx = b.vy = b.vz = 0; b.hp = 20; b.dead = false; b.state = 'idle';
  b.home = [b.x, b.y, b.z];

  /* 三只僵尸直接贴着它放：atkRange 1.35，1.2 格一进来就能咬 */
  for (const dx of [-1.2, 1.2, 0]) {
    const m = M.spawnMob('zombie', b.x + dx, b.y, b.z - 1.2);
    if (m) { m.y = b.y; m.atkT = 0; }
  }
  return { px, pz, flat: W.FLAT_H, bot: [b.x, b.z] };
});
console.log('场景', JSON.stringify(setup));

await page.waitForTimeout(2600);            // 让僵尸走过去咬几口
await page.screenshot({ path: OUT + 'hurt-before.png' });

const state = await page.evaluate(async () => {
  const B = await import('/src/game/bots.js');
  const M = await import('/src/game/mobs.js');
  /* 别用 bots[last] —— 游戏自己会刷一堆 AI 玩家，最后一个多半不是我们摆的那个 */
  const b = B.bots.find((x) => x.name === '沙包') || B.bots[B.bots.length - 1];
  const zs = M.mobs.filter((m) => m.type === 'zombie');
  return {
    name: b.name, hp: +b.hp.toFixed(1), max: b.maxHp, block: b.regenBlockT,
    botAt: [+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)],
    zombies: zs.map((m) => ({
      at: [+m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1)],
      d: +Math.hypot(m.x - b.x, m.z - b.z).toFixed(2),
      dead: m.dead, atkT: +m.atkT.toFixed(2),
    })),
    mobs: M.mobs.length,
  };
});
console.log('AI 玩家状态', JSON.stringify(state));

await page.waitForTimeout(2400);
const after = await page.evaluate(async () => {
  const B = await import('/src/game/bots.js');
  const { player } = await import('/src/game/player.js');
  const b = B.bots.find((x) => x.name === '沙包') || B.bots[B.bots.length - 1];
  /* 把相机挪到它正面 6 格，这样头顶的名字 + 血条才在视野里（贴脸时标签会被
   * 视锥剔除掉）。bot 被打会跑，所以位置要现读现用。 */
  player.x = b.x + 0.5; player.z = b.z + 6.5; player.y = b.y + 0.05;
  player.vx = player.vy = player.vz = 0;
  player.yaw = 0; player.pitch = -0.02;
  return { hp: +b.hp.toFixed(1), at: [+b.x.toFixed(1), +b.z.toFixed(1)] };
});
console.log('再过 2.4 秒', JSON.stringify(after));
await page.waitForTimeout(260);
await page.screenshot({ path: OUT + 'hurt-hp.png' });

await browser.close();
