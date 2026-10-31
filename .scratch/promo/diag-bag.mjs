/* 诊断：按 E 之后背包面板到底可不可见（DOM 状态 + 几何 + 层级） */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1314, height: 824 } });
const page = await ctx.newPage();
await page.goto('http://localhost:5174/', { waitUntil: 'load' });
await page.waitForSelector('.veil .go', { timeout: 20000 });
await page.waitForTimeout(6000);
await page.click('.veil .mode[data-mode="1"]');
await page.waitForTimeout(400);
await page.click('.veil .go');
await page.waitForTimeout(2500);

const before = await page.evaluate(async () => {
  const { ui } = await import('/src/game/uiState.js');
  return { bagOpen: ui.bagOpen };
});
console.log('按 E 之前:', JSON.stringify(before));

await page.keyboard.press('e');
await page.waitForTimeout(1200);

const info = await page.evaluate(async () => {
  const { ui } = await import('/src/game/uiState.js');
  const el = document.querySelector('.bag');
  if (!el) return { bagOpen: ui.bagOpen, found: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const cv = document.querySelector('canvas');
  const cvz = cv ? getComputedStyle(cv).zIndex : null;
  return {
    bagOpen: ui.bagOpen,
    found: true,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    zIndex: cs.zIndex,
    position: cs.position,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    canvasZ: cvz,
    inlineDisplay: el.style.display || '(none set)',
    text: (el.textContent || '').trim().slice(0, 40),
  };
});
console.log('按 E 之后:', JSON.stringify(info, null, 2));

await page.screenshot({ path: '.scratch/promo/raw/diag-bag.png' });
await browser.close();
