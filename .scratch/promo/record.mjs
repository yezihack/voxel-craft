/* 宣传页录屏：1280×720 满幅、约 50 秒、覆盖 5 个卖点。
 *
 * 两个踩过的坑（都写在代码注释里，别删）：
 *
 * 1) **录屏有灰边**：Playwright 把浏览器**窗口外框**设成视口大小，
 *    而窗口里真正能画的面比外框小一圈（宽 −34 / 高 −104）。
 *    录屏录的是内容面，多出来的由 Playwright 用灰底补齐 →
 *    视频上下左右出现灰条。解法：视口请求 1314×824，
 *    内容面正好回到 1280×720。（三组视口独立验证过这个差值是恒定的。）
 *
 * 2) **背包面板关不掉**：按 E 打开面板后再按 E 应该关，但录制里
 *    面板一直留着。原因是要等 UI 真正响应，不能想当然地 sleep。
 *    这里改成**轮询 DOM 状态**：等 .bag 可见 / 隐藏，条件满足才继续。
 *
 * 镜头用 rAF lerp 插值，不用 mouse.move —— 鼠标事件是离散的，
 * 录出来一格一格跳；lerp 出来的转动是连续的。
 */
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync } from 'node:fs';

const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url);
const { chromium } = req('playwright');

const RAW = '.scratch/promo/raw';
const MEDIA = 'public/media';
mkdirSync(RAW, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

const URL = 'http://localhost:5174/';

/* 视口比目标大 34×104 —— 见文件头「坑 1」的说明 */
const VP = { width: 1314, height: 824 };
const TARGET = { width: 1280, height: 720 };

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* rAF 镜头插值器 */
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

/* 等背包面板可见 / 不可见 —— 见文件头「坑 2」 */
async function waitBag(page, want, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const vis = await page.evaluate(() => {
      const el = document.querySelector('.bag');
      if (!el) return false;
      return !!(el.offsetParent !== null || getComputedStyle(el).display !== 'none');
    }).catch(() => false);
    if (vis === want) return true;
    await page.waitForTimeout(150);
  }
  console.log(`  [warn] 背包面板状态未达成（期望 ${want}），继续`);
  return false;
}

/* 勘探机位：站得高、看得远、脚下没树 */
async function scoutVista(page) {
  return await page.evaluate(async () => {
    const { colInfo } = await import('/src/game/world.js');
    const { treeAt } = await import('/src/game/dims.js');
    const EYE = 1.62, SEA = 16;
    let best = null;
    for (let x = -48; x <= 48; x += 3) {
      for (let z = -48; z <= 48; z += 3) {
        const h = colInfo(x, z).height;
        if (h <= SEA + 1) continue;
        if (treeAt(x, z)) continue;
        const eyeY = h + 1 + EYE;
        for (let k = 0; k < 24; k++) {
          const yaw = k / 24 * Math.PI * 2;
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
          if (occl > 6) continue;
          const avgFar = far / nFar;
          const pitch = Math.max(-0.55, Math.min(0.05, Math.atan2(avgFar - eyeY, 34)));
          const score = -occl * 4 - treeHit * 6 + water * 1.5 + (h - SEA) * 0.25;
          if (!best || score > best.score) best = { x, z, h, yaw, pitch, score };
        }
      }
    }
    return best;
  });
}

async function scoutLava(page) {
  return await page.evaluate(async () => {
    const { colInfo } = await import('/src/game/world.js');
    const SEA = 16;
    let best = null;
    for (let x = -48; x <= 48; x += 3) {
      for (let z = -48; z <= 48; z += 3) {
        const h = colInfo(x, z).height;
        if (h < SEA + 8) continue;
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
          if (occl > 8 || !lava) continue;
          const avgFar = far / nFar;
          const pitch = Math.max(-0.7, Math.min(0.0, Math.atan2(avgFar - eyeY, 36)));
          const score = lava * 2 + drop * 1.2 - occl * 3;
          if (!best || score > best.score) best = { x, z, h, yaw, pitch, score };
        }
      }
    }
    return best;
  });
}

async function teleport(page, x, y, z, yaw, pitch, fly) {
  await page.evaluate(async ([x, y, z, yaw, pitch, fly]) => {
    const { player } = await import('/src/game/player.js');
    player.fly = fly;
    player.x = x; player.y = y; player.z = z;
    player.vx = player.vy = player.vz = 0;
    player.yaw = yaw; player.pitch = pitch;
  }, [x, y, z, yaw, pitch, fly]);
  await sleep(2800);   // 等区块窗口平移重建
}

/* =======================================================================
 * 录制
 * ======================================================================= */
const vctx = await browser.newContext({
  viewport: VP,
  recordVideo: { dir: RAW, size: TARGET },
});
const vpage = await vctx.newPage();
vpage.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await vpage.goto(URL, { waitUntil: 'load', timeout: 60000 });
await vpage.waitForSelector('.veil .go', { timeout: 20000 });
await waitReady(vpage);

/* --- 0-3s：标题面板 --- */
await sleep(2600);

/* --- 选生存模式进场 --- */
await vpage.click('.veil .mode[data-mode="1"]');
await sleep(600);
await vpage.click('.veil .go');
await sleep(2200);
await installCam(vpage);

/* --- 站上勘探到的机位 --- */
const vista = await scoutVista(vpage);
console.log('  生存机位:', JSON.stringify(vista));
await teleport(vpage, vista.x, vista.h + 1, vista.z, vista.yaw, vista.pitch, false);

/* --- 环视远景 + 走动 --- */
await cam(vpage, vista.yaw, vista.pitch, 0.05);
await sleep(2000);
await vpage.keyboard.down('w');
await cam(vpage, vista.yaw + Math.PI * 0.22, vista.pitch - 0.04, 0.028);
await sleep(3200);
await vpage.keyboard.up('w');
await sleep(900);

/* --- 打开背包面板（合成台 + 物品栏）---
 * 关闭**不能**再按 E：openBag() 在拿不到指针锁时会 pauseGame()，
 * 把 running 置 false，而 KeyE 的处理条件是 `k === 'KeyE' && running`，
 * 于是第二次按 E 被直接忽略 —— 无头浏览器必然拿不到指针锁，所以必然复现。
 * 这里走动作层：startGame(false) 内部会 closeBag(true) 并恢复 running，
 * 且不请求指针锁（无头环境请求也只会失败）。 */
await vpage.keyboard.press('e');
await waitBag(vpage, true);
await sleep(2600);
await vpage.evaluate(async () => {
  const { startGame } = await import('/src/game/uiActions.js');
  startGame(false);
});
await waitBag(vpage, false);
await sleep(700);

/* --- 切创造 + 飞行俯瞰 --- */
await vpage.keyboard.press('g');            // 生存 → 创造
await sleep(900);
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  player.fly = true;
  player.y += 24;
});
await sleep(1200);
await cam(vpage, Math.PI * 0.78, -0.4, 0.03);
await sleep(3200);
await cam(vpage, Math.PI * 1.28, -0.22, 0.03);
await sleep(2600);

/* --- boss 登场 --- */
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const { spawnMob } = await import('/src/game/mobs.js');
  const px = player.x, py = player.y, pz = player.z;
  spawnMob('dragon', px + 6, py + 3, pz + 8, 0);
  spawnMob('guardian', px - 5, py + 1, pz + 10, 0);
  spawnMob('wither', px + 1, py + 5, pz + 13, 0);
});
await cam(vpage, Math.PI * 1.45, -0.08, 0.035);
await sleep(3000);
await cam(vpage, Math.PI * 1.68, 0.04, 0.035);
await sleep(2200);

/* --- 熔火深渊收尾 --- */
await vpage.evaluate(async () => {
  const { player } = await import('/src/game/player.js');
  const { switchDim } = await import('/src/game/portal.js');
  switchDim(1, [player.x, 46, player.z]);
});
await sleep(4400);
const lava = await scoutLava(vpage);
console.log('  熔火机位:', JSON.stringify(lava));
if (lava) {
  await teleport(vpage, lava.x, lava.h + 1, lava.z, lava.yaw, lava.pitch, true);
  await cam(vpage, lava.yaw, lava.pitch, 0.03);
  await sleep(7400);
}

await camStop(vpage);
await sleep(800);

const video = vpage.video();
await vctx.close();
const vpath = await video.path();
console.log('  录屏原始文件:', vpath);
await browser.close();

copyFileSync(vpath, `${MEDIA}/demo.webm`);
console.log('完成。');
