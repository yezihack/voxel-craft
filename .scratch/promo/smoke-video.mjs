/* 录屏冒烟测试：确认 Playwright 能找到 ffmpeg 并成功落盘一个 .webm。
 *
 * 背景：机器上装的是 ffmpeg-1011，但 PW 1.49.1 的 registry 要 1010，
 * 之前录制直接报「Executable doesn't exist」。已把 1011 复制成 1010，
 * 这个脚本专门验证这条链路通不通（3 秒就够，不必等正式录制）。
 */
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const RAW = '.scratch/promo/raw';
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

const ctx = await browser.newContext({
  viewport: { width: 640, height: 360 },
  recordVideo: { dir: RAW, size: { width: 640, height: 360 } },
});
const page = await ctx.newPage();
await page.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(3000);
const video = page.video();
await ctx.close();
const p = await video.path();
await browser.close();

const sz = statSync(p).size;
console.log('录屏成功:', p, (sz / 1024).toFixed(1) + ' KB');
if (sz < 1000) throw new Error('视频文件太小，多半是空的');
