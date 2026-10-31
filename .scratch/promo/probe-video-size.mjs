/* 探针：把「窗口装饰差」补回来，验证录屏能拿到满幅画面。
 *
 * 实测规律（三组视口独立验证）：
 *   vp 1280x720 → 内容 1246x619
 *   vp 1280x800 → 内容 1246x696
 *   vp 1304x810 → 内容 1270x706
 * 差值恒定：宽 −34，高 −104。
 * 即：Playwright 把 **窗口外框** 设成视口大小，而窗口里真正能画的
 * 内容面比外框小一圈（浏览器边框 + 工具栏），录屏录的是内容面，
 * 多出来的部分由 Playwright 用灰底补齐 → 视频上下左右出现灰边。
 *
 * 反推：想让内容面正好 1280x720，视口要请求 1314x824。
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const RAW = '.scratch/promo/raw';
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

const TARGET = { width: 1280, height: 720 };
const cases = [
  { tag: 'W1', vp: { width: 1314, height: 824 } },
  { tag: 'W2', vp: { width: 1314, height: 820 } },
  { tag: 'W3', vp: { width: 1320, height: 828 } },
];

for (const c of cases) {
  const ctx = await browser.newContext({
    viewport: c.vp,
    recordVideo: { dir: RAW, size: TARGET },
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2000);
  const video = page.video();
  await ctx.close();
  const p = await video.path();
  console.log(`${c.tag} vp=${c.vp.width}x${c.vp.height} -> ${p}`);
}

await browser.close();
