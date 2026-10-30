/* 二维码可用性验收：把页面上的 QR 画到 canvas，用 jsQR 真解码一次。
 * 目的不是验证「图里有方块」，而是验证扫出来的字符串确实是试玩地址。 */
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const JSQR = 'C:/Users/htop/.workbuddy-ai/binaries/node/workspace/node_modules/jsqr/dist/jsQR.js';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto('http://localhost:5174/intro.html', { waitUntil: 'load' });
await page.addScriptTag({ path: JSQR });

const out = await page.evaluate(async () => {
  const img = document.querySelector('.dl-qr img');
  if (!img) return { err: 'no qr img' };
  if (!img.complete) await new Promise((r) => { img.onload = r; setTimeout(r, 4000); });
  const N = 600;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N);
  const r = window.jsQR(d.data, N, N, { inversionAttempts: 'attemptBoth' });
  return r ? { ok: true, text: r.data, version: r.version } : { ok: false, why: 'jsQR 未识别' };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(out.ok && out.text === 'https://voxel-craft-516.pages.dev/' ? 0 : 1);
