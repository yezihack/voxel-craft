/* 浏览器端到端：存档导出 / 导入按钮
 *
 * 用法：PW_ROOT=... PAGE_URL=http://localhost:4184/ node .scratch/saveio/e2e.mjs
 *
 * 验证点：
 *  1. 面板上有导出 / 导入两枚按钮
 *  2. 点导出真的触发下载，文件是合法存档 JSON
 *  3. 改过种子/坐标的文件经 <input type=file> 导入后，浏览器存档被覆盖
 *  4. 坏文件导入被拒绝且页面不崩
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');
const PAGE_URL = process.env.PAGE_URL || 'http://localhost:4184/';
const CHROME = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe`;

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` —— ${extra}` : ''}`); }
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(PAGE_URL, { waitUntil: 'load' });
/* 等地形就绪：连续 3 次采样一致（进度条会抖，只等一次会假通过） */
let stable = 0, last = '';
for (let i = 0; i < 240; i++) {
  const hint = await page.evaluate(() => document.querySelector('.hint')?.textContent || '');
  if (/地形就绪/.test(hint) && hint === last) stable++;
  else stable = 0;
  last = hint;
  if (stable >= 3) break;
  await page.waitForTimeout(500);
}
ok(stable >= 3, '地形就绪');

/* ---------- 1. 按钮存在 ---------- */
const ioBtns = page.locator('.veil .panel .iobtn');
ok(await ioBtns.count() === 2, '面板上有导出 / 导入两枚按钮');

/* ---------- 2. 导出 → 真下载 ---------- */
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), ioBtns.nth(0).click()]);
const fname = dl.suggestedFilename();
ok(/^voxel-craft-save-\d{8}-\d{6}\.json$/.test(fname), `下载文件名规范：${fname}`);
const dlPath = path.join(process.cwd(), '.scratch/saveio/exported.json');
await dl.saveAs(dlPath);
const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
ok(exported && typeof exported.v === 'number' && typeof exported.seed === 'number', '导出文件是合法存档 JSON');
const origSeed = exported.seed;

/* ---------- 3. 改档 → 导入 → 浏览器存档被覆盖 ---------- */
const hackedSeed = (origSeed + 123456789) | 0;
exported.seed = hackedSeed;
if (exported.player) exported.player.hp = 7;
const hackedPath = path.join(process.cwd(), '.scratch/saveio/hacked.json');
fs.writeFileSync(hackedPath, JSON.stringify(exported));
await page.setInputFiles('.veil .panel input[type=file]', hackedPath);
await page.waitForTimeout(1500);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voxel-craft:save') || '{}'));
ok(saved.seed === hackedSeed, '导入后浏览器存档被文件覆盖', `seed=${saved.seed} 期望=${hackedSeed}`);
ok(saved.player && saved.player.hp === 7, '导入档的玩家状态生效');
/* 摘要面板也跟着换（saveMeta 重建） */
const metaText = await page.evaluate(() => document.querySelector('.veil .panel .savemeta')?.textContent || '');
ok(/\d/.test(metaText), '开始面板摘要已显示导入档信息', metaText);

/* ---------- 4. 坏文件导入：拒绝且不崩 ---------- */
const badPath = path.join(process.cwd(), '.scratch/saveio/bad.json');
fs.writeFileSync(badPath, '这!不#是JSON');
await page.setInputFiles('.veil .panel input[type=file]', badPath);
await page.waitForTimeout(800);
const still = await page.evaluate(() => JSON.parse(localStorage.getItem('voxel-craft:save') || '{}').seed);
ok(still === hackedSeed, '坏文件导入被拒，存档原样保留', `seed=${still}`);
ok(errs.length === 0, '全程零页面报错', errs.slice(0, 3).join(' | '));

await page.screenshot({ path: '.scratch/saveio/panel.png' });
await browser.close();
console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
