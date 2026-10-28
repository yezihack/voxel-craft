/* 截图：白天露天的僵尸在烧（橙色 tint + 火苗粒子），以及低头到 -90° 能不能看见脚下
 *
 * 用法：
 *   npx vite --port 4182 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/sunburn/shot.mjs
 */
import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4182/';
const CHROME = process.env.PW_CHROME ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

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
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 120000 },
);
await page.click('.veil .panel .go');
await page.waitForTimeout(2200);

/* 白天 + 正前方 4 格放一只僵尸，视线朝它 */
const info = await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const M = await import('/src/game/mobs.js');
  const G = await import('/src/game/generate.js');
  const { I } = await import('/src/game/config.js');
  M.setWorldTime(M.DAY_LEN * 0.25);            // 正午
  M.mobs.length = 0;

  /* 现场清出一块空地：经典地形上随便找的位置很可能被树/山坡挡着，
   * 截出来只剩树叶，看不到僵尸。 */
  const px = Math.floor(player.x), py = Math.floor(player.y) + 1, pz = Math.floor(player.z);
  for (let x = px - 3; x <= px + 8; x++)
    for (let z = pz - 4; z <= pz + 4; z++) {
      for (let y = py; y <= py + 5; y++) G.setBlock(x, y, z, 0);
      G.setBlock(x, py - 1, z, I.STONE);
    }
  player.x = px + 0.5; player.y = py; player.z = pz + 0.5;
  player.vy = 0;
  /* 飞起来悬停：僵尸追人很快（实测 1.3 秒能走 5 格），站地上会被它贴脸，
   * 一是挡镜头，二是它会把玩家打得满屏红。 */
  player.fly = true;
  player.y = py + 2.5;

  const m = M.spawnMob('zombie', px + 6.5, py, pz + 0.5, 0);
  m.yaw = Math.PI;                              // 面朝玩家
  /* 把僵尸头顶那一列捅到天：出生点上方可能是树冠或山体，
   * 那样 underOpenSky 会判成「有遮挡」，僵尸根本不烧。
   * 注意要用僵尸的**格子坐标**（floor 之后），别拿 player 的浮点坐标去清。 */
  const zx = Math.floor(px + 6.5), zz = Math.floor(pz + 0.5);
  for (let y = py; y < 64; y++) G.setBlock(zx, y, zz, 0);
  /* 把僵尸钉在原地：它追人比设定速度还快（实测 1.3 秒走 5 格），
   * 不钉住就会贴到镜头前，燃烧效果反而看不清。位置钉死不影响燃烧判定。 */
  const fixX = px + 6.5, fixZ = pz + 0.5;
  globalThis.__pin = setInterval(() => { m.x = fixX; m.z = fixZ; m.vx = 0; m.vz = 0; }, 16);
  player.yaw = -Math.PI / 2;                    // 视线朝 +x
  player.pitch = -0.40;                         // 俯视约 23°
  return { px: player.x, py: player.y, pz: player.z, isNight: M.isNight(), phase: M.dayPhase() };
});
console.log('场景:', JSON.stringify(info));

/* 只等 1.3 秒：烧起来只要 0.34 秒（burnFx 3/s 涨到 1），
 * 再久僵尸就走到跟前开始打人了，红屏会盖住整个画面。 */
await page.waitForTimeout(1300);
const burn = await page.evaluate(async () => {
  const M = await import('/src/game/mobs.js');
  const G = await import('/src/game/generate.js');
  const { player } = await import('/src/game/player.js');
  player.hurtFlash = 0;                          // 别让受伤红屏糊住截图
  const m = M.mobs[0];
  if (!m) return null;
  /* 手动复算一次头顶遮挡，把挡住的层号打出来 —— 只看 burning=false
   * 分不清是「天黑了」还是「头顶有方块」。 */
  const blocked = [];
  const xi = Math.floor(m.x), zi = Math.floor(m.z);
  for (let y = Math.floor(m.y) + 1; y < 64; y++) {
    if (G.isSolid(G.getEffective(xi, y, zi))) blocked.push(y);
  }
  return {
    hp: +m.hp.toFixed(1), burnFx: +m.burnFx.toFixed(2), burning: m.burning,
    dist: +Math.hypot(m.x - player.x, m.z - player.z).toFixed(1),
    pos: [+m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1)],
    night: M.isNight(), phase: +M.dayPhase().toFixed(3), blocked,
  };
});
console.log('燃烧状态:', JSON.stringify(burn));
await page.screenshot({ path: '.scratch/sunburn/zombie-burning.png' });

/* 低头到 -90°：应该能看到脚下方块，而不是被弹回抬头 */
await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  player.pitch = -Math.PI / 2 + 0.001;
  player.yaw = 0;
});
await page.waitForTimeout(400);
const p1 = await page.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  return +player.pitch.toFixed(4);
});
console.log('pitch 设为 -90° 后读回:', p1, 'rad =', (p1 * 180 / Math.PI).toFixed(1), '°');
await page.screenshot({ path: '.scratch/sunburn/look-down.png' });

if (errs.length) console.log('ERR:', errs.slice(0, 3).join(' | '));
else console.log('控制台零报错');
await browser.close();
