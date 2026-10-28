/* 手机端「进游戏就闪退」复现器
 *
 * 用法：
 *   npx vite --port 4176 --strictPort &
 *   PW_ROOT=<npx 缓存>/node_modules node .scratch/crash/probe.mjs [url]
 *
 * 做法：真 Chromium 手机竖屏 + 触摸，进游戏后持续采样 45 秒，
 * 每 3 秒打一行：JS 堆大小 / DOM 节点 / 帧率 / 生物数 / AI 玩家数 / 报错数。
 * 崩溃（renderer 挂掉）会被 page.on('crash') 抓到。
 * 同时把 console.error / pageerror 全文留下来 —— 闪退前最后一条通常是根因。 */

import { createRequire } from 'node:module';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const PAGE_URL = process.argv[2] || 'http://localhost:4176/';
const CHROME = process.env.PW_CHROME ||
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;
const SECONDS = +(process.env.SECONDS || 45);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },        // iPhone 14 竖屏
  deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('crash', () => { console.log('\n!!! 页面崩溃（renderer crash）'); });
page.on('close', () => console.log('\n!!! 页面被关闭'));

console.log('打开', PAGE_URL);
await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 60000 });

await page.waitForFunction(
  () => /地形就绪/.test(document.querySelector('.hint')?.textContent || ''),
  null, { timeout: 90000 },
);
console.log('地形就绪，点开始游戏');
await page.click('.veil .panel .go');

const sample = async () => page.evaluate(async () => {
  const S = await import('/src/game/state.js');
  const M = await import('/src/game/mobs.js');
  const B = await import('/src/game/bots.js');
  const L = await import('/src/game/loop.js');
  return {
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    nodes: document.getElementsByTagName('*').length,
    fps: Math.round(L.fps || 0),
    mobs: M.mobs.length,
    bots: B.bots.length,
    drops: B.botDrops ? B.botDrops.length : -1,
    playerY: +S.player?.y?.toFixed?.(1),
  };
}).catch((e) => ({ err: String(e).slice(0, 120) }));

for (let t = 0; t <= SECONDS; t += 3) {
  const s = await sample();
  console.log(`t=${String(t).padStart(2)}s`, JSON.stringify(s), 'errs=' + errs.length);
  if (t === 0) await page.waitForTimeout(3000); else await page.waitForTimeout(3000);
}

if (errs.length) {
  console.log('\n---- 报错（前 6 条）----');
  for (const e of errs.slice(0, 6)) console.log(e + '\n');
} else {
  console.log('\n无报错');
}

await page.screenshot({ path: new URL('./shot.png', import.meta.url).pathname.replace(/^\//, '') }).catch(() => {});
await browser.close();
