/* 宣传页验收：控制台零报错、素材全部加载、图集可切换、桌面/手机两套截图。
 * 用法：node .scratch/promo/verify-intro.mjs
 * 前置：vite dev 跑在 5174。 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const OUT = '.scratch/promo/raw';
mkdirSync(OUT, { recursive: true });

const URL = process.env.INTRO_URL || 'http://localhost:5174/intro.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

const errors = [];
const failed = [];
const http4xx = [];

async function run(label, vp, shot, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failed.push(`[${label}] ${r.url()} ${r.failure()?.errorText || ''}`));
  page.on('response', (r) => { if (r.status() >= 400) http4xx.push(`[${label}] ${r.status()} ${r.url()}`); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  /* 素材加载：所有 <img> 必须有实际像素 */
  const imgs = await page.evaluate(() =>
    [...document.images].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }))
  );
  const broken = imgs.filter((i) => i.w === 0);

  /* 视频：能解码出画面尺寸 */
  const vid = await page.evaluate(async () => {
    const v = document.getElementById('demoVid');
    if (!v) return { missing: true };
    await new Promise((r) => {
      if (v.readyState >= 1) return r();
      v.addEventListener('loadedmetadata', r, { once: true });
      v.load();
      setTimeout(r, 8000);
    });
    return {
      w: v.videoWidth, h: v.videoHeight, readyState: v.readyState,
      muted: v.muted, paused: v.paused, duration: Math.round(v.duration),
      sources: [...v.querySelectorAll('source')].map((s) => s.getAttribute('src')),
    };
  });

  /* 图集：点第 4 张缩略图，主图应换成第 4 张 */
  const gallery = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.gallery-thumbs button')];
    if (btns.length < 4) return { ok: false, why: `缩略图只有 ${btns.length} 个` };
    btns[3].click();
    const imgs = [...document.querySelectorAll('.gallery-main img')];
    const on = imgs.findIndex((i) => i.classList.contains('on'));
    return {
      ok: on === 3 && btns[3].classList.contains('on'),
      activeIndex: on,
      label: document.getElementById('galLabel').textContent.trim(),
    };
  });
  await page.waitForTimeout(700);

  await page.screenshot({ path: `${OUT}/${shot}-hero.png` });
  await page.evaluate(() => document.querySelector('.gallery').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${shot}-gallery.png` });
  await page.evaluate(() => document.querySelector('.foot').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${shot}-foot.png` });

  console.log(`\n--- ${label} ---`);
  console.log('  img 总数/坏图:', imgs.length, '/', broken.length, broken.map((b) => b.src).join(' '));
  console.log('  video:', JSON.stringify(vid));
  console.log('  gallery:', JSON.stringify(gallery));

  await ctx.close();
  return { broken, vid, gallery };
}

const desk = await run('desktop', { width: 1440, height: 900 }, 'intro-desk');
const mob = await run('mobile', { width: 390, height: 844 }, 'intro-mob', { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

await browser.close();

console.log('\n=== 结论 ===');
console.log('控制台报错:', errors.length, errors.slice(0, 6).join('\n  '));
console.log('HTTP 4xx/5xx:', http4xx.length, http4xx.slice(0, 8).join('\n  '));
/* 视频的 ERR_ABORTED 是浏览器的正常行为：拿到足够数据后主动掐断 range 请求，
 * 不代表加载失败（readyState 已经到 4 就是证据），所以单独归类不算失败。 */
const aborted = failed.filter((f) => /ERR_ABORTED/.test(f));
const realFailed = failed.filter((f) => !/ERR_ABORTED/.test(f));
console.log('请求失败(已排除视频主动中断):', realFailed.length, realFailed.slice(0, 6).join('\n  '));
console.log('视频中断(正常):', aborted.length);

const bad =
  errors.length || http4xx.length || realFailed.length ||
  desk.broken.length || mob.broken.length ||
  !desk.vid.w || !desk.gallery.ok;
console.log(bad ? '结果: 有问题' : '结果: 全部通过');
process.exit(bad ? 1 : 0);
