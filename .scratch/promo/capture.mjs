/* 宣传页素材采集：录屏 + 截图。
 *
 * 用 dev server（不是 preview）：生产构建把模块打包了，
 * import('/src/game/player.js') 拿不到实例，就没法精确摆镜头 / 切维度 / 刷 boss。
 * 画面与生产构建完全一致（同渲染代码），只是模块没合并。
 *
 * 镜头不是拍脑袋定 yaw/pitch 的 —— 先**勘探**再摆位：
 * 用 world.js 的 colInfo() 拿地形高度、dims.js 的 treeAt() 拿树，
 * 扫一圈候选点，筛出「看得远、脚下没树、别被山挡住」的机位。
 * 第一版就是拍脑袋定的，结果生存模式那张镜头怼在树冠上，全是树叶。
 *
 * 输出：
 *   .scratch/promo/raw/   原始素材（webm + png）
 *   public/media/         最终素材（mp4 + webp + svg）
 */
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const RAW = '.scratch/promo/raw';
const MEDIA = 'public/media';
mkdirSync(RAW, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

const URL = 'http://localhost:5174/';

/* 硬件 GL：swiftshader 软件渲染只有 16fps，录出来是幻灯片；
 * 开 --enable-gpu 后实测 50fps。 */
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

/* ---------------- 公共工具 ---------------- */

/* 等「地形就绪」：提示语连续 3 次采样一致。
 * 只等一次会在进度条抖动时假通过（进度 99% → 100% 之间文本会变）。 */
async function waitReady(page) {
  let last = '', stable = 0;
  for (let i = 0; i < 300; i++) {
    const h = await page.textContent('.veil .hint').catch(() => '');
    if (h && h === last) { if (++stable >= 3) return h; }
    else { stable = 0; last = h; }
    await page.waitForTimeout(300);
  }
  throw new Error('地形迟迟不就绪');
}

/* 装一个 rAF 驱动的镜头插值器。
 * 用逐帧 lerp 而不是 mouse.move：鼠标事件是离散的，
 * 录成视频会一格一格跳；lerp 出来的转动是连续的，推镜头才顺。 */
async function installCam(page) {
  await page.evaluate(async () => {
    const { player } = await import('/src/game/player.js');
    window.__cam = null;
    const step = () => {
      const t = window.__cam;
      if (t) {
        let dy = t.y - player.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        player.yaw += dy * t.l;
        player.pitch += (t.p - player.pitch) * t.l;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
async function cam(page, y, p, l = 0.06) {
  await page.evaluate(([y, p, l]) => { window.__cam = { y, p, l }; }, [y, p, l]);
}
async function camStop(page) {
  await page.evaluate(() => { window.__cam = null; });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 打开一个已进游戏的页面（跳过开始遮罩） */
async function openGame(ctx, { width = 1280, height = 720, mode = 1, scale = 1 } = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.veil .go', { timeout: 20000 });
  await waitReady(page);
  /* mode: 0 创造 / 1 生存 / 2 旁观 */
  await page.click(`.veil .mode[data-mode="${mode}"]`);
  await sleep(200);
  await page.click('.veil .go');
  await sleep(1500);
  await installCam(page);
  return page;
}

/* ------------------------------------------------------------------
 * 勘探：找一个「看得远」的机位。
 *
 * 判据（全部用游戏自己的生成函数算，不是拍脑袋）：
 *   occl   视线方向上挡住视线的地形最大高度差（越小越好）
 *   treeHit 近处挡镜头的树（相机正前方 8 格内，树冠高过视平线）
 *   water  远景里的水面（湖更好看）
 *   pitch  按远景平均高度反算，让地平线落在画面下三分之一
 * ------------------------------------------------------------------ */
async function scoutVista(page) {
  return await page.evaluate(async () => {
    const { colInfo } = await import('/src/game/world.js');
    const { treeAt } = await import('/src/game/dims.js');
    const EYE = 1.62, SEA = 16;
    let best = null;
    for (let x = -48; x <= 48; x += 3) {
      for (let z = -48; z <= 48; z += 3) {
        const h = colInfo(x, z).height;
        if (h <= SEA + 1) continue;          // 水里 / 太低，不站
        if (treeAt(x, z)) continue;          // 别站在树干里
        const eyeY = h + 1 + EYE;
        for (let k = 0; k < 24; k++) {
          const yaw = k / 24 * Math.PI * 2;
          /* 视线方向与 math.js 的 view() 一致：fwd = (-sin yaw, -cos yaw) */
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
          let occl = 0, treeHit = 0, water = 0, far = 0, nFar = 0;
          for (let d = 2; d <= 40; d += 2) {
            const px = Math.round(x + fx * d), pz = Math.round(z + fz * d);
            const ph = colInfo(px, pz).height;
            const o = ph + 1 - eyeY;
            if (o > occl) occl = o;
            if (d >= 6) { far += ph; nFar++; if (ph < SEA) water++; }
            if (d <= 8) {
              const tt = treeAt(px, pz);
              if (tt && tt.y + tt.trunk > eyeY - 1) treeHit++;
            }
          }
          if (occl > 6) continue;            // 视线被山挡死
          const avgFar = far / nFar;
          const pitch = Math.max(-0.55, Math.min(0.05, Math.atan2(avgFar - eyeY, 34)));
          const score = -occl * 4 - treeHit * 6 + water * 1.5 + (h - SEA) * 0.25;
          if (!best || score > best.score) {
            best = { x, z, h, yaw, pitch, score, occl, treeHit, water };
          }
        }
      }
    }
    return best;
  });
}

/* 熔火深渊专用勘探：站在玄武岩台地边缘，脚下能看见岩浆海。 */
async function scoutLava(page) {
  return await page.evaluate(async () => {
    const { colInfo } = await import('/src/game/world.js');
    const SEA = 16;
    let best = null;
    for (let x = -48; x <= 48; x += 3) {
      for (let z = -48; z <= 48; z += 3) {
        const h = colInfo(x, z).height;
        if (h < SEA + 8) continue;          // 要在高处，才看得见下面的岩浆
        const eyeY = h + 1 + 1.62;
        for (let k = 0; k < 24; k++) {
          const yaw = k / 24 * Math.PI * 2;
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
          let drop = 0, lava = 0, occl = 0, far = 0, nFar = 0;
          for (let d = 2; d <= 44; d += 2) {
            const px = Math.round(x + fx * d), pz = Math.round(z + fz * d);
            const ph = colInfo(px, pz).height;
            if (d >= 8 && ph < SEA) { lava++; drop = Math.max(drop, h - ph); }
            const o = ph + 1 - eyeY;
            if (o > occl) occl = o;
            far += ph; nFar++;
          }
          if (occl > 8) continue;
          if (!lava) continue;               // 视线里必须真的有岩浆
          const avgFar = far / nFar;
          const pitch = Math.max(-0.7, Math.min(0.0, Math.atan2(avgFar - eyeY, 36)));
          const score = lava * 2 + drop * 1.2 - occl * 3;
          if (!best || score > best.score) {
            best = { x, z, h, yaw, pitch, score, lava, drop };
          }
        }
      }
    }
    return best;
  });
}

/* 把玩家放到指定位置并摆好镜头。 */
async function place(page, { x, z, y, yaw, pitch, fly = false }) {
  await page.evaluate(async ([x, z, y, yaw, pitch, fly]) => {
    const { player } = await import('/src/game/player.js');
    player.fly = fly;
    player.x = x; player.z = z;
    player.y = (y !== null && y !== undefined) ? y : player.y;
    player.vx = player.vy = player.vz = 0;
    player.yaw = yaw; player.pitch = pitch;
  }, [x, z, y, yaw, pitch, fly]);
  /* 区块窗口要跟着平移重建，等它追上来 */
  await sleep(2600);
}

/* =======================================================================
 * 一、截图
 * ======================================================================= */
console.log('=== 截图 ===');
const sctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

/* --- 1. 生存模式：HUD + 户外远景 --- */
{
  const page = await openGame(sctx, { mode: 1 });
  const v = await scoutVista(page);
  console.log('  机位:', JSON.stringify(v));
  await place(page, { x: v.x, z: v.z, y: v.h + 1, yaw: v.yaw, pitch: v.pitch });
  await cam(page, v.yaw, v.pitch, 0.05);
  await sleep(2200);
  await page.screenshot({ path: `${RAW}/shot-survival.png` });
  console.log('  ✓ shot-survival');
  await page.close();
}

/* --- 2. 创造模式：飞高俯瞰 --- */
{
  const page = await openGame(sctx, { mode: 0 });
  await page.evaluate(async () => {
    const { player } = await import('/src/game/player.js');
    player.fly = true;
    player.y = player.spawn[1] + 26;
  });
  await sleep(600);
  await cam(page, Math.PI * 0.82, -0.42, 0.05);
  await sleep(2600);
  await page.screenshot({ path: `${RAW}/shot-creative.png` });
  console.log('  ✓ shot-creative');
  await page.close();
}

/* --- 3. 方块库面板 --- */
{
  const page = await openGame(sctx, { mode: 0 });
  await sleep(800);
  await page.keyboard.press('e');
  await sleep(1200);
  await page.screenshot({ path: `${RAW}/shot-library.png` });
  console.log('  ✓ shot-library');
  await page.close();
}

/* --- 4. 熔火深渊：站在台地边看岩浆海 --- */
{
  const page = await openGame(sctx, { mode: 0 });
  await page.evaluate(async () => {
    const { player } = await import('/src/game/player.js');
    const { switchDim } = await import('/src/game/portal.js');
    switchDim(1, [player.x, 40, player.z]);   // stayAt 直接给落点，省得等找门
  });
  await sleep(4000);                            // 等区块重建
  const v = await scoutLava(page);
  console.log('  机位:', JSON.stringify(v));
  if (v) {
    await place(page, { x: v.x, z: v.z, y: v.h + 1, yaw: v.yaw, pitch: v.pitch, fly: true });
    await cam(page, v.yaw, v.pitch, 0.05);
    await sleep(2000);
  }
  await page.screenshot({ path: `${RAW}/shot-lava.png` });
  console.log('  ✓ shot-lava');
  await page.close();
}

/* --- 5. 手机竖屏：触屏控件 --- */
{
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await mctx.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.veil .go', { timeout: 20000 });
  await waitReady(page);
  await page.click('.veil .go');
  await sleep(2500);
  await installCam(page);
  const v = await scoutVista(page);
  console.log('  机位:', JSON.stringify(v));
  if (v) {
    await place(page, { x: v.x, z: v.z, y: v.h + 1, yaw: v.yaw, pitch: v.pitch });
    await cam(page, v.yaw, v.pitch, 0.05);
    await sleep(2000);
  }
  await page.screenshot({ path: `${RAW}/shot-mobile.png` });
  console.log('  ✓ shot-mobile');
  await mctx.close();
}
await sctx.close();

/* =======================================================================
 * 二、录屏
 * ======================================================================= */
console.log('=== 录屏 ===');
const vctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
});
const vpage = await vctx.newPage();
vpage.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await vpage.goto(URL, { waitUntil: 'load', timeout: 60000 });
await vpage.waitForSelector('.veil .go', { timeout: 20000 });
await waitReady(vpage);

/* 0-2.5s：开始面板（标题「方块世界」）*/
await sleep(2500);

/* 选生存模式再开始 —— 让录屏从「真实玩法」切入 */
await vpage.click('.veil .mode[data-mode="1"]');
await sleep(500);
await vpage.click('.veil .go');
await sleep(2000);
await installCam(vpage);

/* 站在勘探出来的机位上，环视远景 */
const vista = await scoutVista(vpage);
console.log('  生存机位:', JSON.stringify(vista));
if (vista) {
  await vpage.evaluate(async ([x, z, y, yaw, pitch]) => {
    const { player } = await import('/src/game/player.js');
    player.x = x; player.z = z; player.y = y;
    player.vx = player.vy = player.vz = 0;
    player.yaw = yaw; player.pitch = pitch;
  }, [vista.x, vista.z, vista.h + 1, vista.yaw, vista.pitch]);
  await sleep(2600);
}

/* 环视 + 走动 */
await cam(vpage, vista.yaw, vista.pitch, 0.05);
await sleep(1800);
await vpage.keyboard.down('w');
await cam(vpage, vista.yaw + Math.PI * 0.28, vista.pitch, 0.03);
await sleep(3200);
await vpage.keyboard.up('w');
await sleep(600);

/* 打开背包（面板）*/
await vpage.keyboard.press('e');
await sleep(3000);
await vpage.keyboard.press('e');
await sleep(800);

/* 切创造 + 飞行俯瞰 */
await vpage.keyboard.press('g');          // 生存 → 创造
await sleep(600);
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  player.fly = true;
  player.y += 22;
});
await cam(vpage, Math.PI * 0.8, -0.4, 0.03);
await sleep(4000);
await cam(vpage, Math.PI * 1.35, -0.25, 0.03);
await sleep(3000);

/* boss 登场 */
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const { spawnMob } = await import('/src/game/mobs.js');
  const px = player.x, py = player.y, pz = player.z;
  spawnMob('dragon', px + 7, py + 4, pz + 9, 0);
  spawnMob('guardian', px - 6, py + 2, pz + 11, 0);
  spawnMob('wither', px + 1, py + 6, pz + 14, 0);
});
await cam(vpage, Math.PI * 1.5, -0.05, 0.04);
await sleep(3500);
await cam(vpage, Math.PI * 1.75, 0.05, 0.04);
await sleep(2500);

/* 熔火深渊收尾 */
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const { switchDim } = await import('/src/game/portal.js');
  switchDim(1, [player.x, 46, player.z]);
});
await sleep(4500);
const lava = await scoutLava(vpage);
console.log('  熔火机位:', JSON.stringify(lava));
if (lava) {
  await vpage.evaluate(async ([x, z, y, yaw, pitch]) => {
    const { player } = await import('/src/game/player.js');
    player.fly = true;
    player.x = x; player.z = z; player.y = y;
    player.yaw = yaw; player.pitch = pitch;
  }, [lava.x, lava.z, lava.h + 1, lava.yaw, lava.pitch]);
  await sleep(2600);
}
await cam(vpage, lava ? lava.yaw : Math.PI * 2.1, lava ? lava.pitch : -0.08, 0.035);
await sleep(3500);

await camStop(vpage);
await sleep(700);

const video = vpage.video();
await vctx.close();
const vpath = await video.path();
console.log('  录屏原始文件:', vpath);
await browser.close();

/* 把原始文件搬到 public/media */
copyFileSync(vpath, `${MEDIA}/demo.webm`);
console.log('完成。');
