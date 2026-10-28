/* 真机回归：AI 玩家会不会被生物打伤
 *
 * 用法：
 *   npx vite --port 4176 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/bot-hurt/verify.mjs
 *
 * 纯逻辑已经在 probe.mjs 里断言过了，这里只验两件在浏览器里才会出问题的事：
 *   ① mobs.js ↔ bots.js 的循环依赖有没有在真实打包/加载下炸掉（页面零报错）
 *   ② boot() 里那次 installBotHook() 有没有真的把 bots 登记进生物模块 */

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
const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 90000 },
);
await page.click('.veil .panel .go');
await page.waitForTimeout(2500);

/* ① 注入是否生效 */
const hook = await page.evaluate(async () => {
  const M = await import('/src/game/mobs.js');
  const B = await import('/src/game/bots.js');
  return {
    hooked: M.botHook.list === B.bots,
    hasDamage: typeof M.botHook.damage === 'function',
    bots: B.bots.length,
    cap: M.MOB_CAP,
  };
});
ok(hook.hooked, 'bots 列表已登记进生物模块', `场上 ${hook.bots} 个 AI 玩家`);
ok(hook.hasDamage, '扣血函数已登记');
ok(hook.cap >= 38, `生物上限 ${hook.cap}`);

/* ② 真的打一架：把玩家挪远一点，在 bot 身边放三只僵尸，看血量掉不掉 */
const before = await page.evaluate(async () => {
  const M = await import('/src/game/mobs.js');
  const B = await import('/src/game/bots.js');
  const S = await import('/src/game/state.js');
  const { player } = await import('/src/game/player.js');
  S.setModeState(S.MODE.SURVIVAL);
  if (!B.bots.length) return null;
  const b = B.bots.find((x) => !x.dead);
  if (!b) return null;
  /* 玩家挪到 18 格外：僵尸会挑更近的那个，于是去打 bot */
  player.x = b.x + 18; player.z = b.z + 18; player.y = b.y;
  player.dead = false;
  for (let i = 0; i < 3; i++)
    M.spawnMob('zombie', b.x + 0.8 + i * 0.5, b.y, b.z + 0.4, 0);
  const T = M.hostileTarget(M.mobs[M.mobs.length - 1], 16);
  return { hp: b.hp, name: b.name, target: T && T.kind };
});
ok(!!before, '找到一只 AI 玩家并放了 3 只僵尸', before ? before.name : '');
ok(before && before.target === 'bot', '僵尸的第一目标就是 AI 玩家', before ? `kind=${before.target}` : '');

await page.waitForTimeout(3500);

const after = await page.evaluate(async (nm) => {
  const B = await import('/src/game/bots.js');
  const b = B.bots.find((x) => x.name === nm) || B.bots.find((x) => !x.dead) || B.bots[0];
  return { hp: b ? b.hp : -1, max: b ? b.maxHp : -1 };
}, before.name);
ok(after.hp < before.hp, `僵尸真的打掉了 AI 玩家的血（${before.hp} → ${after.hp}）`);

ok(errs.length === 0, '页面零报错（循环依赖没炸）', errs.slice(0, 2).join(' | '));

await page.screenshot({ path: new URL('./fight.png', import.meta.url).pathname.replace(/^\//, '') });
await browser.close();
console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
