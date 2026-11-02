/* 程序化贴图：canvas 现画贴图集、等距图标、平面图标 —— 迁移自 voxel-craft.html 第 3115-4256 行 */

import { ATLAS_COLS, ATLAS_PX, D, H, ITEMS, TILE_COLOR, TILE_NAMES, TILE_ORE, TILE_PX, TP, TPH, TPM, isBlockId, tileOfId } from './config.js'
import { hash2 } from './math.js'

/* ============================== 程序化贴图 ============================== */
/* 全部贴图在启动时用 canvas 现画 —— 不引任何图片文件，断网也能跑。
 * 每格 TILE_PX×TILE_PX（当前 32×32）像素，按 TILE_NAMES 的顺序写进一张
 * 512×512 的贴图集。画法统一走「逐像素写」而不是 canvas 的图形 API：
 * 像素级控制才能出 Minecraft 那种颗粒感，也让每张贴图都是确定性可复现的。
 *
 * ⚠ 本段内所有坐标常量必须写成 TP / TPM / TPH，不许出现裸的 16 或 15。
 * 那些数字以前是「格子边长 16」，提到 32 后必须同步放大；写成裸字面量会
 * 让花纹只占左上角四分之一，或者越界被 P() 裁掉整片变透明。 */

export const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = atlasCanvas.height = ATLAS_PX;
export const alctx = atlasCanvas.getContext('2d');
export let tilePenX = 0, tilePenY = 0;              // 当前正在画的格子原点

export const ITEM_TEX_COLOR = {};
for (const k in ITEMS) ITEM_TEX_COLOR['item_' + ITEMS[k].tex] = ITEMS[k].color;

/* 颜色通道钳制到 0..255。必须做：`shade(c, -76)` 这类调用在深色基色上会算出负数，
 * 而 `rgb(-22,-26,-22)` 是**无效 CSS**，canvas 遇到无效值会**保留上一次的 fillStyle**
 * —— 于是那一格画出的是上一个贴图的颜色，症状是「某个深色贴图整块变成别的颜色」。 */
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export function P(x, y, c, a) {
  if (x < 0 || y < 0 || x > TPM || y > TPM) return;   // 越界裁掉，防止画穿到隔壁格子
  alctx.fillStyle = (a === undefined || a >= 1)
    ? 'rgb(' + cl(c[0]) + ',' + cl(c[1]) + ',' + cl(c[2]) + ')'
    : 'rgba(' + cl(c[0]) + ',' + cl(c[1]) + ',' + cl(c[2]) + ',' + a + ')';
  alctx.fillRect(tilePenX + x, tilePenY + y, 1, 1);
}
export const shade = (c, d) => [c[0] + d, c[1] + d, c[2] + d];
/* 基色 + 两级颗粒噪点：石头/泥土/沙子/粘土/石英/雪 全靠它。
 * 只叠一层白噪声在 32×32 下会显得「沙沙的糊」，所以再加一层半频的粗颗粒
 * （`>> 1` 采样、幅度更大），形成「大颗粒里裹小颗粒」的层次 —— 这是
 * Minecraft 系贴图看起来有实体感的关键。 */
export function noiseTile(s, c, amp, speck) {
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    const fine = (hash2(x, y, s) - 0.5) * 2 * amp;
    const coarse = (hash2(x >> 1, y >> 1, s + 77) - 0.5) * 2 * amp * 0.55;
    let d = fine + coarse;
    if (speck && hash2(x >> 1, y >> 1, s + 3) < speck) d -= amp * 1.6;
    P(x, y, shade(c, d));
  }
}
/* 圆石式「最近种子点」分块：石缝自动出现在两个种子点的等距线上 */
export function cobbleBase(s, c, seeds, tone) {
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    let b1 = 1e9, b2 = 1e9, i1 = 0;
    for (let i = 0; i < seeds.length; i++) {
      let dx = Math.abs(x - seeds[i][0]); dx = Math.min(dx, TP - dx);
      let dy = Math.abs(y - seeds[i][1]); dy = Math.min(dy, TP - dy);
      const d = dx * dx + dy * dy;
      if (d < b1) { b2 = b1; b1 = d; i1 = i; } else if (d < b2) b2 = d;
    }
    let col = shade(c, seeds[i1][2] + (hash2(x, y, s + 9) - 0.5) * tone);
    if (Math.sqrt(b2) - Math.sqrt(b1) < 1.8) col = shade(c, -38);
    P(x, y, col);
  }
}

export const TILE_GEN = {
  grass_top(s, c) {
    const d = shade(c, -24), l = shade(c, 22);
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const n = hash2(x, y, s);
      P(x, y, n < 0.30 ? d : n > 0.74 ? l : c);
    }
    /* 草尖：成簇画（单像素点在 32 分辨率下太稀），并且用「两级亮色」做出
     * 受光面朝上的立体感，而不是均匀撒白点。 */
    for (let i = 0; i < 34; i++) {
      const x = Math.floor(hash2(i, 3, s + 11) * (TP - 2)) + 1;
      const y = Math.floor(hash2(i, 9, s + 13) * (TP - 3)) + 1;
      P(x, y, shade(c, 36)); P(x + 1, y, shade(c, 28));
      P(x, y + 1, shade(c, 24)); P(x + 1, y + 1, shade(c, 16));
    }
  },
  grass_side(s, c) {
    const dirt = TILE_COLOR['dirt'] || [134, 102, 68];
    const green = TILE_COLOR['grass_top'] || c;
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(dirt, (hash2(x, y, s) - 0.5) * 30));
    /* 草皮盖：厚度取 6~11 行（占 32 的 1/5~1/3），下缘用两级过渡色「咬」
     * 进泥土里 —— 单行跳变在 32 分辨率下会像贴纸，渗一层才自然。 */
    for (let x = 0; x < TP; x++) {
      const h = 6 + Math.floor(hash2(x, 77, s + 31) * 6);
      for (let y = 0; y < h; y++) P(x, y, shade(green, (hash2(x, y, s + 5) - 0.5) * 26));
      P(x, h, shade(green, -30));                                  // 过渡行
      if (hash2(x, 41, s + 17) > 0.55) P(x, h + 1, shade(green, -58));  // 垂下的草尖
    }
  },
  dirt(s, c) {
    /* 泥土：大颗粒底 + 小石子（受光/背光两像素）+ 几根细根。 */
    noiseTile(s, c, 16, 0.06);
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(hash2(i, 61, s) * (TP - 2)), y = Math.floor(hash2(i, 63, s) * (TP - 2));
      P(x, y, shade(c, 30)); P(x + 1, y, shade(c, 18)); P(x, y + 1, shade(c, -20));
    }
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(hash2(i, 71, s) * TP), y = Math.floor(hash2(i, 73, s) * TP);
      for (let k = 0; k < 7; k++) {
        P(x, y, shade(c, -26));
        y = Math.max(0, Math.min(TPM, y + 1));
        x = Math.max(0, Math.min(TPM, x + (hash2(x, y, s + 2) > 0.5 ? 1 : -1)));
      }
    }
  },
  stone(s, c) {
    noiseTile(s, c, 9, 0.06);
    /* 矿物闪点：稀疏亮点让石头在光下有「颗粒」而不是一片灰。 */
    for (let i = 0; i < 14; i++)
      P(Math.floor(hash2(i, 91, s) * TP), Math.floor(hash2(i, 93, s) * TP), shade(c, 26));
    /* 裂纹：走 10 步、并且「走一步补一格邻边」，让线宽约 1.5 像素 ——
     * 单像素线在 32 分辨率下会被 NEAREST 放大成断续的点，看着像脏点。 */
    for (let i = 0; i < 5; i++) {
      let x = Math.floor(hash2(i, 11, s) * TP), y = Math.floor(hash2(i, 21, s) * TP);
      for (let k = 0; k < 14; k++) {
        P(x, y, shade(c, -26));
        if (hash2(x, y, s + 41) > 0.5) P(x + 1, y, shade(c, -18));
        x = Math.max(0, Math.min(TPM, x + (hash2(x, y, s + 3) > 0.5 ? 1 : -1)));
        y = Math.max(0, Math.min(TPM, y + (hash2(x, y, s + 4) > 0.62 ? 1 : 0)));
      }
    }
  },
  cobble(s, c) {
    const seeds = [];
    for (let i = 0; i < 7; i++)
      seeds.push([hash2(i, 1, s) * TP, hash2(i, 2, s) * TP, (hash2(i, 3, s) - 0.5) * 42]);
    cobbleBase(s, c, seeds, 12);
  },
  mossy_stone(s, c) {
    const stone = TILE_COLOR['stone'] || [132, 134, 138];
    const seeds = [];
    for (let i = 0; i < 6; i++)
      seeds.push([hash2(i, 1, s) * TP, hash2(i, 2, s) * TP, (hash2(i, 3, s) - 0.5) * 40]);
    cobbleBase(s, stone, seeds, 12);
    const moss = [72, 122, 62];
    for (let i = 0; i < 5; i++) {           // 苔斑
      const cx = hash2(i, 31, s) * TP, cy = hash2(i, 37, s) * TP, r = 1.6 + hash2(i, 43, s) * 2.2;
      for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
        let dx = Math.abs(x - cx); dx = Math.min(dx, TP - dx);
        let dy = Math.abs(y - cy); dy = Math.min(dy, TP - dy);
        if (dx * dx + dy * dy < r * r) P(x, y, shade(moss, (hash2(x, y, s + i) - 0.5) * 26));
      }
    }
  },
  sand(s, c) {
    /* 沙子：细噪点 + 几道缓坡波纹。纯噪点在 32 分辨率下像水泥，
     * 波纹才让它看起来是「被风吹过的沙」。 */
    noiseTile(s, c, 10, 0.04);
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const w = Math.sin(x * 0.42 + y * 0.16 + s) * 5;
      if (w > 2.2) P(x, y, shade(c, 12));
      else if (w < -2.6) P(x, y, shade(c, -8));
    }
  },
  clay: (s, c) => noiseTile(s, c, 7, 0.03),
  quartz: (s, c) => noiseTile(s, c, 5, 0.02),
  snow(s, c) {
    /* 雪：暗部略偏蓝 + 冰晶闪点 + 底边压蓝，避免整块死白。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const d = (hash2(x, y, s) - 0.5) * 10;
      P(x, y, [c[0] + d, c[1] + d, c[2] + d * 0.6]);   // 暗部略偏蓝
    }
    for (let i = 0; i < 16; i++)
      P(Math.floor(hash2(i, 31, s) * TP), Math.floor(hash2(i, 37, s) * TP), [255, 255, 255]);
    for (let x = 0; x < TP; x++) P(x, TPM, [c[0] - 14, c[1] - 10, c[2] - 2]);
  },
  sandstone_top: (s, c) => noiseTile(s, c, 6, 0.03),
  sandstone_side(s, c) {
    /* 水平层理：频率按 TP/16 走，否则 32 分辨率下层数会翻倍、密得像条码。
     * 再叠一条低频色带，做出「砂岩块一层深一层浅」的沉积感。 */
    const F = TP / 16;
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const band = Math.sin(y * 0.85 / F + s) * 6;
      const macro = Math.sin(y * 0.22 / F + s * 0.7) * 9;   // 慢速大层
      P(x, y, shade(c, band + macro + (hash2(x, y, s) - 0.5) * 8));
    }
    for (let x = 0; x < TP; x++) {                    // 上下压边
      P(x, 0, shade(c, -22)); P(x, TPM, shade(c, -30));
    }
  },
  brick(s, c) {
    const mortar = [186, 176, 168];
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const row = Math.floor(y / 8);
      const off = (row % 2) * 8;                      // 错缝
      const isMortar = (y % 8 === 0) || ((x + off) % 16 === 0);
      const bx = Math.floor((x + off) / 16);
      if (isMortar) { P(x, y, mortar); continue; }
      /* 每块砖内部：左下偏暗、右上偏亮，模拟砖块受光；再叠细噪点做砖面粗糙感 */
      const lx = (x + off) % 16, ly = y % 8;
      const rel = (ly <= 3 ? -7 : 5) + (lx <= 7 ? -5 : 4);
      P(x, y, shade(c, rel + (hash2(bx, row, s) - 0.5) * 20 + (hash2(x, y, s + 2) - 0.5) * 9));
    }
  },
  stonebrick(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const bx = Math.floor(x / 16), by = Math.floor(y / 16);
      const isMortar = (x % 16 === 0) || (y % 16 === 0);
      if (isMortar) { P(x, y, shade(c, -50)); continue; }
      // 灰浆以上再压一圈内阴影，砖块才有「嵌进去」的厚度
      const lx = x % 16, ly = y % 16;
      const inner = (lx === 1 || ly === 1) ? -20 : (lx >= 14 || ly >= 14) ? -10 : 0;
      P(x, y, shade(c, inner + (hash2(bx, by, s) - 0.5) * 18 + (hash2(x, y, s + 4) - 0.5) * 8));
    }
  },
  plank(s, c) { plankLike(s, c); },
  dark_plank(s, c) { plankLike(s, c, -18); },
  log_side(s, c) {
    for (let x = 0; x < TP; x++) {
      const streak = (hash2(x, 1, s) - 0.5) * 32;
      for (let y = 0; y < TP; y++) {
        let d = streak + (hash2(x, y, s + 6) - 0.5) * 14;
        if (hash2(x, Math.floor(y / 6), s + 8) > 0.80) d -= 26;   // 断续裂纹
        P(x, y, shade(c, d));
      }
    }
    // 树皮的两条纵向深沟：单靠随机竖纹在 32 分辨率下看着太均匀
    for (const gx of [Math.floor(TP * 0.28), Math.floor(TP * 0.72)]) {
      const w = 1 + (hash2(gx, 3, s) > 0.5 ? 1 : 0);
      for (let y = 0; y < TP; y++) for (let i = 0; i < w; i++) P(gx + i, y, shade(c, -40));
    }
  },
  log_top(s, c) {
    const bark = shade(c, -36), inner = shade(c, 14);
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const dx = x - (TP / 2 - 0.5), dy = y - (TP / 2 - 0.5), r = Math.sqrt(dx * dx + dy * dy);
      if (r > TP / 2 - 0.8) { P(x, y, shade(bark, (hash2(x, y, s) - 0.5) * 14)); continue; }
      const ring = Math.sin(r * 1.1) > 0.1 ? 0 : -18;   // 同心年轮
      P(x, y, shade(inner, ring + (hash2(x, y, s + 3) - 0.5) * 10));
    }
  },
  leaves(s, c) {
    /* 树叶不能是「均匀撒透明点」—— 那样放大后像纱窗。改成按 2×2 成簇判断：
     * 一簇要么整体镂空要么整体保留，边缘再补一层深色描边，看着才像叶片堆。 */
    const d = shade(c, -30), l = shade(c, 30);
    for (let cy = 0; cy < TP; cy += 2) for (let cx = 0; cx < TP; cx += 2) {
      const g = hash2(cx >> 1, cy >> 1, s);
      const hole = g < 0.14;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const px = cx + x, py = cy + y;
        if (px >= TP || py >= TP) continue;
        if (hole) { P(px, py, [0, 0, 0], 0); continue; }       // 成簇镂空 → alpha 裁剪
        const n = hash2(px, py, s + 5);
        P(px, py, n > 0.76 ? l : n < 0.40 ? d : c);
      }
    }
  },
  glass(s, c) {
    // 内部：左上偏亮、右下偏暗的斜向渐变，模拟玻璃对天空的反射
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const g = (x + y) / (TP * 2);                  // 0 → 1
      P(x, y, shade(c, 14 - g * 20), 0.40);
    }
    for (let i = 0; i < TP; i++) {                   // 边框实一些
      P(i, 0, shade(c, 26), 1); P(i, TPM, shade(c, 26), 1);
      P(0, i, shade(c, 26), 1); P(TPM, i, shade(c, 26), 1);
    }
    // 一道粗斜高光 + 一道细副光，比原来的两根细线更像玻璃反光
    for (let i = 4; i < Math.floor(TP * 0.55); i++) {
      P(i, i + 2, [255, 255, 255], 0.55);
      P(i, i + 3, [255, 255, 255], 0.34);
      P(i + 1, i + 2, [255, 255, 255], 0.30);
    }
    for (let i = 4; i < Math.floor(TP * 0.38); i++) P(i + 2, i + 2, [255, 255, 255], 0.22);
  },
  water(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const w = Math.sin((x * 0.9 + y * 0.35) * 0.9 + s) * 0.5 + 0.5;   // 波纹
      P(x, y, shade(c, (w - 0.5) * 26 + (hash2(x, y, s) - 0.5) * 10));
    }
  },
  ice(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const g = (x + y) / (TP * 2);
      P(x, y, shade(c, (hash2(x, y, s) - 0.5) * 14 + (g < 0.5 ? 8 : -6)));
    }
    for (let i = 4; i < 20; i++) { P(i, i - 2, shade(c, 40)); P(i + 1, i - 2, shade(c, 24)); }   // 斜向高光
    for (let i = 0; i < 4; i++) {                            // 裂纹
      let x = Math.floor(hash2(i, 7, s) * TP);
      for (let y = 0; y < TP; y++) {
        P(x, y, shade(c, 32));
        x = Math.max(0, Math.min(TPM, x + (hash2(x, y, s + 3) > 0.5 ? 1 : -1)));
      }
    }
  },
  obsidian(s, c) {
    /* 黑曜石：近黑底 + 几道紫色反光 + 零星亮屑。 */
    noiseTile(s, c, 8, 0.05);
    for (let i = 0; i < 5; i++) {
      const x0 = Math.floor(hash2(i, 5, s) * TP);
      for (let y = 0; y < TP; y++) {
        const x = x0 + Math.floor(Math.sin(y * 0.35 + i) * 3);
        if (x >= 0 && x < TP) P(x, y, [86 + hash2(i, y, s) * 70, 58, 140]);
      }
    }
    for (let i = 0; i < 10; i++)
      P(Math.floor(hash2(i, 15, s) * TP), Math.floor(hash2(i, 17, s) * TP), shade(c, 24));
  },
  glowstone(s, c) {
    /* 萤石：暗底 + 一块块菱形晶簇（上半受光、下半压暗）。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, -28 + hash2(x, y, s) * TP));
    for (let i = 0; i < 9; i++) {
      const cx = Math.floor(hash2(i, 11, s) * TP), cy = Math.floor(hash2(i, 13, s) * TP);
      const r = 2 + hash2(i, 17, s) * 3;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= TP || py >= TP) continue;
        P(px, py, (dx + dy <= 0) ? [255, 244, 190] : [246, 208, 96]);
      }
    }
  },
  pumpkin_side(s, c) {
    for (let x = 0; x < TP; x++) {
      const rib = (x % 8 === 0) ? -30 : (x % 8 === 7) ? 14 : 0;   // 竖棱
      for (let y = 0; y < TP; y++) P(x, y, shade(c, rib + (hash2(x, y, s) - 0.5) * 10));
    }
  },
  pumpkin_top(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x, y, s) - 0.5) * TP));
    for (let i = 0; i < TP; i++) {
      P(i, 0, shade(c, -26)); P(i, TPM, shade(c, -26));
      P(0, i, shade(c, -26)); P(TPM, i, shade(c, -26));
    }
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++)     // 瓜蒂
      P(x, y, shade([104, 128, 58], (hash2(x, y, s) - 0.5) * TP));
  },
  jack_side(s, c) {
    TILE_GEN.pumpkin_side(s, c);
    const dark = [58, 26, 8];
    for (let y = TPH; y < TP; y++) {                          // 三角眼（下半格）
      const w = TPH - Math.abs(y - (TPH + 2));
      for (let x = 0; x <= w; x++) { P(4 + x, y, dark); P(TPM - 7 - x, y, dark); }
    }
    for (let x = TPH; x < 24; x++)                           // 锯齿嘴
      P(x, 22, dark);
    for (const x of [10, 14, 18, 22]) { P(x, 20, dark); P(x, 24, dark); }
  },
  cactus_top(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const dx = x - (TP / 2 - 0.5), dy = y - (TP / 2 - 0.5), r = Math.sqrt(dx * dx + dy * dy);
      P(x, y, shade(c, r < 6 ? 18 : (hash2(x, y, s) - 0.5) * 12));
    }
    for (const p of [[6, 6], [24, 8], [8, 24], [22, 22]]) P(p[0], p[1], [236, 236, 220]);
  },
  cactus_side(s, c) {
    for (let x = 0; x < TP; x++) {
      const groove = (x === 0 || x === TPM) ? -30 : (x % 10 === 0) ? -18 : 0;   // 竖沟
      for (let y = 0; y < TP; y++) P(x, y, shade(c, groove + (hash2(x, y, s) - 0.5) * 10));
    }
    for (let i = 0; i < 10; i++) {                            // 刺
      const x = 1 + Math.floor(hash2(i, 23, s) * 14), y = Math.floor(hash2(i, 29, s) * TP);
      P(x, y, [238, 238, 222]);
    }
  },
  jack_top: (s, c) => TILE_GEN.pumpkin_top(s, c),
  lava(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x, y, s) - 0.5) * 30));
    for (let i = 0; i < 9; i++) {                             // 亮浆泡
      const cx = hash2(i, 19, s) * TP, cy = hash2(i, 23, s) * TP, r = 3.2 + hash2(i, 31, s) * 4.4;
      for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) P(x, y, d2 < r * r * 0.4 ? [255, 236, 150] : [252, 176, 64]);
      }
    }
  },
  bookshelf(s, c) {
    const wood = TILE_COLOR['plank'] || [176, 140, 88];
    plankLike(s, wood);
    const spines = [[164, 62, 58], [72, 106, 176], [214, 186, 74], [92, 152, 84], [150, 96, 168]];
    for (const rowY of [4, 18]) {
      for (let x = 2; x < TPM - 1; x++) {
        if (hash2(x, rowY, s + 5) < 0.14) continue;            // 偶尔空一本
        const sp = spines[Math.floor(hash2(x, rowY, s + 7) * spines.length) % spines.length];
        for (let y = rowY; y < rowY + 11; y++) P(x, y, shade(sp, (hash2(x, y, s) - 0.5) * 20));
      }
    }
  },
  carrot(s, c) {
    const green = TILE_COLOR['grass_top'] || [96, 168, 74];
    const dirt = TILE_COLOR['dirt'] || [134, 102, 68];
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, y < 24 ? shade(green, -18 + (hash2(x, y, s) - 0.5) * 22) : shade(dirt, (hash2(x, y, s) - 0.5) * 24));
    for (let i = 0; i < 6; i++) {                              // 露头的胡萝卜
      const x = 4 + Math.floor(hash2(i, 51, s) * 24), y = 23 + Math.floor(hash2(i, 53, s) * 7);
      P(x, y, [236, 138, 44]); P(x, y + 1, [214, 112, 30]);
    }
    for (let x = 0; x < TP; x += 2) P(x, 0, shade(green, 26));  // 叶尖
  },
  wool_white: (s, c) => woolTile(s, c),
  wool_red: (s, c) => woolTile(s, c),
  wool_blue: (s, c) => woolTile(s, c),
  wool_yellow: (s, c) => woolTile(s, c),
  wool_green: (s, c) => woolTile(s, c),
  wool_black: (s, c) => woolTile(s, c),
  mob_pig: (s, c) => {
    /* 猪皮：细毛 + 背部一条更深的鬃毛带 + 稀疏泥点。
     * 只用 furTile 会显得「一块均匀的粉」，加了泥点才有在泥里打滚的猪味。 */
    furTile(s, c, 16, 24);
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      if (hash2(x >> 2, y >> 3, s + 41) > 0.74) P(x, y, shade(c, -16));
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(hash2(i, 12, s) * (TP - 2)), y = Math.floor(hash2(i, 15, s) * (TP - 2));
      P(x, y, [150, 118, 92]); P(x + 1, y, [160, 128, 100]);
    }
  },
  mob_pig_snout: (s, c) => {
    /* 鼻盘：外圈受光、内圈压暗，两个鼻孔画成 2×2 的深色椭圆。 */
    furTile(s, c, 8, 14);
    for (let x = 4; x < 28; x++) { P(x, 5, shade(c, 20)); P(x, 26, shade(c, -26)); }
    for (const ex of [9, 20]) {
      for (let y = 13; y <= 18; y++) for (let x = ex; x <= ex + 3; x++) P(x, y, shade(c, -80));
      P(ex, 13, shade(c, -34)); P(ex + 1, 13, shade(c, -34));
    }
  },
  mob_sheep_wool: (s, c) => {
    /* 羊毛：2×2 成团的卷毛 + 正弦交叉的卷曲纹，再点几处深沟。
     * 比纯噪点更像「一团一团堆起来的毛」。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const g = hash2(x >> 2, y >> 2, s);
      const curl = Math.sin((x + g * 6) * 0.9) * Math.cos((y - g * 6) * 0.9);
      P(x, y, shade(c, (g - 0.5) * 26 + curl * 10 + (hash2(x, y, s + 2) - 0.5) * 8));
    }
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(hash2(i, 71, s) * (TP - 1)), y = Math.floor(hash2(i, 73, s) * TP);
      P(x, y, shade(c, -32)); P(x + 1, y, shade(c, -22));
    }
  },
  mob_sheep_face: (s, c) => {
    /* 羊脸：顶部一圈羊毛刘海（和身体同色），下方是浅色长脸。
     * 眼睛画成竖长条并点一颗高光，才有「温顺」的表情。 */
    furTile(s, c, 10, 16);
    const wool = TILE_COLOR['mob_sheep_wool'] || [232, 232, 226];
    for (let x = 0; x < TP; x++) {
      const h = 4 + Math.floor(hash2(x, 5, s) * 5);
      for (let y = 0; y < h; y++) P(x, y, shade(wool, (hash2(x, y, s) - 0.5) * 22));
    }
    const eye = TILE_COLOR['mob_eye'] || [24, 20, 22];
    for (let x = 6; x <= 11; x++) for (let y = 13; y <= 17; y++) P(x, y, eye);
    for (let x = 20; x <= 25; x++) for (let y = 13; y <= 17; y++) P(x, y, eye);
    P(6, 13, [214, 214, 214]); P(20, 13, [214, 214, 214]);
    for (let x = 11; x <= 20; x++) { P(x, 23, shade(c, -58)); P(x, 24, shade(c, -40)); }
  },
  mob_chicken: (s, c) => {
    /* 鸡羽毛：细毛底 + 一层层向下弯的羽片弧线。
     * 均匀噪点会让鸡看起来像一块白布，弧线才有「羽毛叠着羽毛」的结构。 */
    furTile(s, c, 8, 12);
    for (let row = 0; row < 5; row++) {
      const y0 = row * 6 + 3;
      for (let x = 0; x < TP; x++) {
        const scallop = Math.floor(Math.sin((x + row * 3) * 0.8) * 1.6);
        P(x, y0 + scallop, shade(c, -24));
        P(x, y0 + scallop + 1, shade(c, -10));
      }
    }
  },
  mob_chicken_beak: (s, c) => {
    /* 喙 / 鸡爪共用这张：整块暖橙，上亮下暗，中间一道分缝。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (y < TPH ? 16 : -12) + (hash2(x, y, s) - 0.5) * 10));
    for (let x = 4; x < TP - 4; x++) P(x, TPH, shade(c, -40));
  },
  mob_zombie_skin: (s, c) => {
    /* 腐烂的皮肤：腐斑（成块的暗绿） + 深陷的眼窝 + 咧到耳根的嘴。
     * 眼窝下方再压一道阴影，脸才有「凹进去」的立体感。 */
    furTile(s, c, 12, 16);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(hash2(i, 31, s) * (TP - 2)), y = Math.floor(hash2(i, 37, s) * (TP - 2));
      const r = 1 + hash2(i, 41, s) * 2;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        if (dx * dx + dy * dy <= r * r) P(x + dx, y + dy, shade(c, -30));
    }
    const eye = TILE_COLOR['mob_eye'] || [20, 18, 20];
    for (let x = 6; x <= 11; x++) for (let y = 10; y <= 15; y++) P(x, y, eye);
    for (let x = 20; x <= 25; x++) for (let y = 10; y <= 15; y++) P(x, y, eye);
    for (let x = 5; x <= 12; x++) P(x, 16, shade(c, -40));
    for (let x = 19; x <= 26; x++) P(x, 16, shade(c, -40));
    for (let x = 10; x <= 21; x++) P(x, 24, shade(c, -66));
  },
  mob_zombie_shirt: (s, c) => {
    /* 破衬衫：布纹 + 几处露肉的破洞 + 领口 + 中缝。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 2, y >> 2, s) - 0.5) * 22 + (hash2(x, y, s) - 0.5) * 8));
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(hash2(i, 51, s) * (TP - 2)), y = Math.floor(hash2(i, 53, s) * (TP - 2));
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) P(x + dx, y + dy, shade(c, -52));
    }
    for (let x = 8; x < 24; x++) P(x, 0, shade(c, -26));
    for (let y = 0; y < TP; y++) P(15, y, shade(c, -40)), P(16, y, shade(c, -40));
  },
  mob_zombie_pants: (s, c) => {
    /* 裤腿：竖纹 + 中缝 + 下摆被撕开的锯齿。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 2, y >> 1, s) - 0.5) * 18 + (hash2(x, y, s) - 0.5) * 7));
    for (let y = 0; y < TP; y++) P(16, y, shade(c, -34));
    for (let x = 0; x < TP; x++) if (hash2(x, 9, s) > 0.45) {
      P(x, TPM, shade(c, -30)); P(x, TPM - 1, shade(c, -20));
    }
  },
  mob_eye: (s, c) => { for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) P(x, y, c); },
  mob_leg: (s, c) => furTile(s, c, 12, 18),

  /* ---------------- AI 玩家（8~10 个「别人」）----------------
   * 关键取舍：**贴图只画明暗，色相一律留给 uTint**。
   * 十个人各有各的肤色 / 上衣 / 裤子，如果每套配色都进图集，就得为 8~10 个人
   * 各开 4 张贴图（40 格）并为每种组合重建一份 GPU 网格。改成「一套网格 + 逐部件
   * tint」后：网格恒 1 份，换人只改三个 vec3，10 个人同屏也只多几十次
   * uniform3f。所以下面这几张都刻意画成接近中性的浅色基调
   * （tint = 1 时就是一个灰白人形，靠 FS 里的 uTint 相乘上色）。 */
  bot_skin: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 10 + (hash2(x, y, s) - 0.5) * 6));
  },
  bot_shirt: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 2, y >> 2, s) - 0.5) * 14 + (hash2(x, y, s) - 0.5) * 6));
    for (let y = 0; y < TP; y++) P(15, y, shade(c, -26)), P(16, y, shade(c, -26));   // 门襟
  },
  bot_pants: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 2, y >> 1, s) - 0.5) * 12 + (hash2(x, y, s) - 0.5) * 6));
  },
  /* 头发：顶部压深、两侧留鬓角，正面不遮眼 */
  bot_hair: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 14));
    for (let x = 0; x < TP; x++) for (let y = 0; y < 5; y++) P(x, y, shade(c, -30));
    for (let y = 5; y < 14; y++) { P(0, y, shade(c, -18)); P(TPH, y, shade(c, -18)); }
  },
  /* 脸：五官用「独立的深色格」而不是把底色调暗 —— 底色要留给 tint 染肤色，
   * 眼睛一旦跟着 tint 变色，深棕肤色的 AI 玩家就会长一双看不见的眼睛
   * （这坑在怪物贴图上踩过：蜘蛛眼与底色同色，整块看着像块红板）。 */
  bot_eye: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) P(x, y, c);
  },
  /* 村民：棕色粗布长袍，布纹比兽毛更「直」，腰上一条深色布带 */
  mob_villager_robe: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const weave = (hash2(x, Math.floor(y / 6), s) - 0.5) * 12;
      P(x, y, shade(c, weave + (hash2(x, y, s + 11) - 0.5) * 10));
    }
    // 腰带
    for (let y = 17; y <= 21; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade([120, 84, 48], (hash2(x, y, s) - 0.5) * 10));
    // 前襟
    for (let y = 0; y < TP; y++) P(TPH - 1, y, shade(c, -26)), P(TPH, y, shade(c, -26));
    // 布褶
    for (let i = 0; i < 5; i++) { const x = 3 + i * 6; for (let y = 22; y < TP; y++) P(x, y, shade(c, -16)); }
  },
  /* 村民的脸：大鼻子 + 连眉 + 平直的一字嘴 + 额头皱纹 */
  mob_villager_face: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 16 + (hash2(x, y, s) - 0.5) * 8));
    const eye = TILE_COLOR['mob_eye'] || [24, 20, 22];
    for (let x = 5; x <= 10; x++) for (let y = 12; y <= 15; y++) P(x, y, eye);
    for (let x = 21; x <= 26; x++) for (let y = 12; y <= 15; y++) P(x, y, eye);
    for (let x = 4; x <= 11; x++) P(x, 11, shade(c, -58));    // 眉毛压得很低，显得严肃
    for (let x = 20; x <= 27; x++) P(x, 11, shade(c, -58));
    for (let x = 13; x <= 18; x++) for (let y = 17; y <= 25; y++) P(x, y, shade(c, 16));  // 大鼻子
    for (let x = 11; x <= 20; x++) P(x, 28, shade(c, -50));   // 一字嘴
    for (let x = 8; x <= 23; x++) if (hash2(x, 3, s) > 0.45) P(x, 6, shade(c, -24));     // 额纹
    for (let y = 18; y <= 22; y++) { P(11, y, shade(c, -20)); P(20, y, shade(c, -20)); } // 法令纹
  },

  /* ---------------- 傀儡：铁 / 石 / 雪 ----------------
   * 三种材质各一底一脸，再共用一张青苔（铁傀儡身上的藤蔓）与一张树枝（雪/石傀儡的手臂）。
   * 脸谱的坐标沿用村民那套写法：五官位置写死像素（32 格画布上的美术选择），
   * 只有「半格」这种跟 TP 走的量才用 TPH —— 别在这里写裸的 16。 */
  mob_iron_plate: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const plate = (hash2(x >> 3, y >> 4, s) - 0.5) * 30;      // 大块面板之间的色差
      P(x, y, shade(c, plate + (hash2(x, y, s + 5) - 0.5) * 12));
    }
    /* 竖向拉丝：铁板压延留下的痕。基色 198 很亮，±14 的噪声根本看不出来，
     * 必须有这种「成条的暗线」才有金属质感。 */
    for (let x = 0; x < TP; x += 3)
      for (let y = 0; y < TP; y++) if (hash2(x, y, s + 9) > 0.3) P(x, y, shade(c, -26));
    const seam = shade(c, -62), hi = shade(c, 42);
    for (let x = 0; x < TP; x++) { P(x, TPH - 1, seam); P(x, TPH, hi); }   // 横向板缝
    for (const rx of [5, TP - 8]) for (const ry of [5, TP - 8]) {          // 四颗铆钉
      P(rx, ry, hi); P(rx + 1, ry, shade(c, 16));
      P(rx, ry + 1, shade(c, 4)); P(rx + 1, ry + 1, shade(c, -48));
    }
    for (let i = 0; i < 4; i++) {                                          // 锈斑：四团不规则的暗橙
      const bx = Math.floor(hash2(i, 21, s) * (TP - 7)) + 2;
      const by = Math.floor(hash2(i, 23, s) * (TP - 7)) + 2;
      for (let k = 0; k < 8; k++) {
        const x = bx + Math.floor(hash2(i * 9 + k, 31, s) * 4);
        const y = by + Math.floor(hash2(i * 9 + k, 37, s) * 4);
        P(x, y, [c[0] - 54, c[1] - 68, c[2] - 74]);
      }
    }
  },
  mob_iron_face: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const plate = (hash2(x >> 3, y >> 3, s) - 0.5) * 22;
      P(x, y, shade(c, plate + (hash2(x, y, s + 7) - 0.5) * 10));
    }
    const dark = shade(c, -96), hi = shade(c, 46);
    for (let x = 5; x <= 12; x++) for (let y = 11; y <= 15; y++) P(x, y, dark);
    for (let x = TP - 13; x <= TP - 6; x++) for (let y = 11; y <= 15; y++) P(x, y, dark);
    for (let y = 17; y <= 27; y++) for (let x = TPH - 2; x <= TPH + 1; x++) P(x, y, shade(c, -40));  // 长鼻梁
    for (let y = 17; y <= 27; y++) P(TPH - 3, y, shade(c, 30));       // 鼻梁左侧受光
    for (let x = 5; x <= 12; x++) P(x, 10, hi);                       // 眼上的一道受光棱
    for (let x = TP - 13; x <= TP - 6; x++) P(x, 10, hi);
    for (let x = 0; x < TP; x++) P(x, 28, shade(c, -54));             // 下颌分界
    for (let i = 0; i < 3; i++) {                                     // 脸颊锈斑
      const bx = Math.floor(hash2(i, 61, s) * (TP - 8)) + 2;
      const by = 18 + Math.floor(hash2(i, 63, s) * 8);
      for (let k = 0; k < 6; k++) {
        const x = bx + Math.floor(hash2(i * 7 + k, 71, s) * 4);
        const y = by + Math.floor(hash2(i * 7 + k, 73, s) * 3);
        P(x, y, [c[0] - 56, c[1] - 70, c[2] - 76]);
      }
    }
  },
  mob_golem_vine: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 26 + (hash2(x, y, s + 3) - 0.5) * 12));
    for (let i = 0; i < 24; i++) {                                    // 卷须：成对的亮绿小团
      const x = Math.floor(hash2(i, 31, s) * (TP - 3)) + 1;
      const y = Math.floor(hash2(i, 57, s) * (TP - 3)) + 1;
      P(x, y, shade(c, 34)); P(x + 1, y, shade(c, 26)); P(x, y + 1, shade(c, 18));
    }
  },
  mob_stone_plate: (s, c) => {
    const seeds = [];
    for (let i = 0; i < 6; i++)
      seeds.push([hash2(i, 1, s) * TP, hash2(i, 2, s) * TP, (hash2(i, 3, s) - 0.5) * 40]);
    cobbleBase(s, c, seeds, 12);
  },
  mob_stone_face: (s, c) => {
    const seeds = [];
    for (let i = 0; i < 5; i++)
      seeds.push([hash2(i, 5, s) * TP, hash2(i, 6, s) * TP, (hash2(i, 7, s) - 0.5) * 34]);
    cobbleBase(s, c, seeds, 12);
    const dark = shade(c, -80);
    for (let x = 5; x <= 11; x++) for (let y = 12; y <= 15; y++) P(x, y, dark);
    for (let x = TP - 12; x <= TP - 6; x++) for (let y = 12; y <= 15; y++) P(x, y, dark);
    for (let x = 9; x <= TP - 10; x++) P(x, 24, shade(c, -56));        // 一条横缝当嘴
  },
  mob_snowman: (s, c) => {
    /* 基色 240 已经贴到白，±8 的噪声等于没画 —— 必须用大颗粒 + 暗部 + 灰杂质
     * 三件套，雪球才有体积感。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const big = (hash2(x >> 2, y >> 2, s) - 0.5) * 28;
      P(x, y, shade(c, big + (hash2(x, y, s + 2) - 0.5) * 10));
    }
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)   // 右下暗部：雪球的体积
      if (x + y > TP * 1.42) P(x, y, shade(c, -20));
    for (let i = 0; i < 26; i++)                                // 雪的亮晶
      P(Math.floor(hash2(i, 17, s) * TP), Math.floor(hash2(i, 29, s) * TP), [255, 255, 255]);
    for (let i = 0; i < 10; i++)                                // 雪里的灰色杂质
      P(Math.floor(hash2(i, 41, s) * TP), Math.floor(hash2(i, 43, s) * TP), shade(c, -36));
  },
  mob_snow_face: (s, c) => {
    noiseTile(s, c, 8, 0.03);
    const coal = [34, 32, 36];
    for (let x = 5; x <= 11; x++) for (let y = 11; y <= 16; y++) P(x, y, coal);
    for (let x = TP - 12; x <= TP - 6; x++) for (let y = 11; y <= 16; y++) P(x, y, coal);
    const carrot = [232, 138, 34];                                    // 胡萝卜鼻
    for (let y = 17; y <= 25; y++) for (let x = TPH - 2; x <= TPH + 1; x++)
      P(x, y, shade(carrot, (hash2(x, y, s) - 0.5) * 20));
    for (let x = 7; x <= 12; x++) P(x, 28, [86, 62, 40]);             // 树枝嘴
    for (let x = TP - 13; x <= TP - 8; x++) P(x, 28, [86, 62, 40]);
  },
  mob_wood_arm: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const grain = hash2(Math.floor(x / 5), y * 3, s) > 0.68 ? -18 : 0;
      P(x, y, shade(c, grain + Math.sin(x * 0.7 + s) * 5 + (hash2(x, y, s + 4) - 0.5) * 10));
    }
    for (const kx of [9, 22, 11]) {                                   // 节疤
      const ky = kx === 11 ? 24 : kx === 9 ? 8 : 21;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        P(kx + dx, ky + dy, shade(c, dx * dx + dy * dy <= 1 ? -40 : -20));
      }
    }
  },

  /* ---------------- 蜘蛛：深褐近黑 + 刚毛 + 一排红眼点 ----------------
   * 腿是细方块，靠「数量」而不是形状取胜 —— 8 条腿的 voxel 蜘蛛远远看去
   * 就已经能认出来。眼睛只画在头胸那一格（mob_spider_eye）上。 */
  mob_spider: (s, c) => {
    /* 蜘蛛：深褐近黑的刚毛 + 三道体节横带 + 背中线。
     * 横带是「有节」的关键 —— 没有它，八条腿的盒子看着像一块毛毡。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const bristle = hash2(x, Math.floor(y / 3), s) > 0.72 ? 15 : 0;   // 刚毛
      P(x, y, shade(c, bristle + (hash2(x, y, s + 3) - 0.5) * 16));
    }
    for (const by of [6, 14, 22]) for (let x = 0; x < TP; x++) P(x, by, shade(c, -22));
    for (let y = 0; y < TP; y++) { P(TPH - 1, y, shade(c, 16)); P(TPH, y, shade(c, 16)); }
  },
  mob_spider_eye: (s, c) => {
    /* 底 = 深褐（跟头胸同色系），上面点三簇亮红眼睛。
     * 暗底 + 高亮红眼才像蜘蛛的脸；整块红板是踩过的坑。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x, y, s) - 0.5) * 14));
    const glow = [238, 66, 46];
    for (const ex of [5, 14, 23])
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 4; dx++) {
        const edge = (dx === 0 || dx === 3 || dy === 0 || dy === 4);
        P(ex + dx, 11 + dy, shade(glow, edge ? -34 : (hash2(ex, dy, s) - 0.5) * 18));
      }
    // 两侧两颗小副眼
    for (const ex of [2, 27]) { P(ex, 8, glow); P(ex, 9, glow); P(ex + 1, 8, glow); }
  },
  /* ---------------- 苦力怕：苔绿杂斑 + 经典黑脸 ----------------
   * 杂斑用 2×2 降采样的 hash，再叠一层竖向暗纹 —— 比纯噪点更像「苔藓爬满皮肤」。
   * 脸谱是死坐标：方眼、竖鼻、两边下垂的嘴 —— 辨识度全靠它。 */
  mob_creeper: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const patch = hash2(x >> 2, y >> 2, s + 21);
      const streak = hash2(x >> 3, y, s + 33) > 0.78 ? -14 : 0;
      P(x, y, shade(c, (patch - 0.5) * 34 + streak + (hash2(x, y, s) - 0.5) * 10));
    }
  },
  mob_creeper_face: (s, c) => {
    TILE_GEN.mob_creeper(s, c);
    const ink = [26, 32, 28];
    for (let y = 8; y <= 15; y++) for (let x = 6; x <= 12; x++) P(x, y, ink);    // 左眼
    for (let y = 8; y <= 15; y++) for (let x = 19; x <= 25; x++) P(x, y, ink);   // 右眼
    for (let y = 17; y <= 21; y++) for (let x = 14; x <= 17; x++) P(x, y, ink);  // 鼻梁
    for (let y = 18; y <= 26; y++) for (let x = 12; x <= 14; x++) P(x, y, ink);  // 嘴·左
    for (let y = 18; y <= 26; y++) for (let x = 17; x <= 19; x++) P(x, y, ink);  // 嘴·右
  },
  /* ---------------- 骷髅：白骨 + 骨缝 + 空洞脸 ----------------
   * 身体和僵尸一样是「骨头色人形」，但更高更瘦（1.85 格）、没有皮肤色块，
   * 远看就是一副会走路的骨架。 */
  mob_skeleton: (s, c) => {
    /* 白骨：骨缝底 + 一道道横向肋骨（亮棱压着暗缝）。
     * 之前只有竖缝，看着像一根白柱子；加了肋骨才认得出是骨架。 */
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(Math.floor(x / 8), Math.floor(y / 8), s) - 0.5) * 16 + (hash2(x, y, s + 6) - 0.5) * 8));
    for (const ry of [8, 13, 18, 23, 28]) {
      for (let x = 2; x < TP - 2; x++) P(x, ry, shade(c, -26));
      for (let x = 2; x < TP - 2; x++) P(x, ry + 1, shade(c, 14));
    }
    for (let y = 0; y < TP; y++) { P(TPH - 1, y, shade(c, -24)); P(TPH, y, shade(c, -24)); }
  },
  mob_skeleton_face: (s, c) => {
    TILE_GEN.mob_skeleton(s, c);
    const ink = [36, 34, 38];
    for (let y = 9; y <= 16; y++) for (let x = 5; x <= 12; x++) P(x, y, ink);    // 左眼窝
    for (let y = 9; y <= 16; y++) for (let x = 19; x <= 26; x++) P(x, y, ink);   // 右眼窝
    for (let y = 17; y <= 22; y++) for (let x = 14; x <= 17; x++) P(x, y, ink);  // 鼻缝
    for (let y = 24; y <= 28; y++) for (let x = 10; x <= 21; x++)               // 齿列
      P(x, y, (x - 10) % 3 === 2 ? shade(c, -28) : ink);
  },
  /* ---------------- 史莱姆：果冻绿核 + 高光带 + 豆豆眼 ----------------
   * 内核用 2×2 降采样 hash 做出「团絮」，左上角一条高光带是果冻感的关键；
   * 脸上只点两个方眼一张嘴（MC 小史莱姆其实没脸，大号的有）。 */
  mob_slime: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const core = hash2(x >> 2, y >> 2, s + 33);
      P(x, y, shade(c, (core - 0.5) * 40 + (hash2(x, y, s) - 0.5) * 12));
    }
    // 内部气泡
    for (let i = 0; i < 6; i++) {
      const x = 3 + Math.floor(hash2(i, 21, s) * (TP - 6)), y = 3 + Math.floor(hash2(i, 23, s) * (TP - 6));
      const r = 1 + hash2(i, 27, s) * 1.6;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        if (dx * dx + dy * dy <= r * r) P(x + dx, y + dy, shade(c, 28));
    }
    // 左上高光带（果冻感的关键）
    for (let y = 4; y < 14; y++) for (let x = 5; x < 16; x++)
      if (hash2(x, y, s + 7) > 0.55) P(x, y, shade(c, 34));
  },
  mob_slime_face: (s, c) => {
    TILE_GEN.mob_slime(s, c);
    const ink = [34, 64, 50];
    for (let y = 9; y <= 14; y++) for (let x = 6; x <= 11; x++) P(x, y, ink);
    for (let y = 9; y <= 14; y++) for (let x = 20; x <= 25; x++) P(x, y, ink);
    for (let y = 16; y <= 20; y++) for (let x = 13; x <= 18; x++) P(x, y, ink);
  },

  /* ---------------- Boss 贴图 ----------------
   * 三种各两格：身体 + 眼/脸。和普通 mob 同构，buildMobMesh 不需要改。
   * 末影龙 = 深紫黑鳞片 + 紫色发光眼；
   * 凋灵   = 深灰石体 + 三头黑脸；
   * 远古守卫 = 青蓝石甲 + 金色发光眼。 */
  mob_dragon: (s, c) => {
    /* 末影龙：菱形鳞片铺满 + 零星紫光点。鳞片比噪点更像「龙皮」。 */
    noiseTile(s, c, 6, 0.03);
    for (let y = 0; y < TP; y += 6) for (let x = 0; x < TP; x += 6) {
      const ox = (Math.floor(y / 6) % 2) * 3;
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
        if (dx + dy < 2 || dx + dy > 6) continue;
        const px = x + dx + ox, py = y + dy;
        if (px >= TP || py >= TP) continue;
        P(px, py, shade(c, (dx === 0 || dy === 0) ? 22 : (hash2(px, py, s) - 0.5) * 10 - 8));
      }
    }
    for (let i = 0; i < 10; i++)
      P(Math.floor(hash2(i, 3, s) * TP), Math.floor(hash2(i, 7, s) * TP), shade(c, 40));
  },
  mob_dragon_eye: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) P(x, y, shade(c, -20));
    for (let y = 10; y <= 21; y++) for (let x = 10; x <= 21; x++) P(x, y, c);
    for (let y = 14; y <= 17; y++) for (let x = 14; x <= 17; x++) P(x, y, shade(c, 60));
    // 竖瞳
    for (let y = 11; y <= 20; y++) { P(15, y, shade(c, -90)); P(16, y, shade(c, -90)); }
  },
  mob_wither: (s, c) => {
    /* 凋灵：深灰石体 + 发光裂纹（裂纹用亮灰，像内部有东西在烧）。 */
    noiseTile(s, c, 5, 0.03);
    for (let i = 0; i < 6; i++) {
      let x = Math.floor(hash2(i, 11, s) * TP), y = Math.floor(hash2(i, 13, s) * TP);
      for (let k = 0; k < 12; k++) {
        P(x, y, shade(c, 34));
        x = Math.max(0, Math.min(TPM, x + (hash2(x, y, s + 3) > 0.5 ? 1 : -1)));
        y = Math.max(0, Math.min(TPM, y + (hash2(x, y, s + 4) > 0.6 ? 1 : 0)));
      }
    }
    for (let y = 0; y < TP; y++)
      if (hash2(y, 11, s) > 0.5)
        for (let x = 0; x < TP; x++) P(x, y, shade(c, -18));
  },
  mob_wither_face: (s, c) => {
    /* 凋灵的脸：**不能**用 `shade(c, -50)` —— 基色 28 减完是负数，rgb() 拿到无效值，
     * canvas 会保留上一格的 fillStyle，整张脸糊成一块黑、五官全看不见。
     * 改成固定深灰紫底 + 噪点 + 发光紫瞳。 */
    const base = [48, 42, 52];
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(base, (hash2(x >> 1, y >> 1, s) - 0.5) * 18 + (hash2(x, y, s + 3) - 0.5) * 8));
    const ink = [10, 6, 12];
    for (let y = 12; y <= 16; y++) for (let x = 7; x <= 13; x++) P(x, y, ink);
    for (let y = 12; y <= 16; y++) for (let x = 18; x <= 24; x++) P(x, y, ink);
    for (let y = 19; y <= 23; y++) for (let x = 13; x <= 18; x++) P(x, y, ink);
    const eye = [176, 84, 208], eyeHi = [234, 180, 255];
    for (const [ex, ey] of [[9, 13], [20, 13]]) {
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) P(ex + x, ey + y, eye);
      P(ex + 1, ey + 1, eyeHi);
      P(ex - 1, ey + 1, [110, 52, 132], 0.55); P(ex + 3, ey + 1, [110, 52, 132], 0.55);
      P(ex + 1, ey - 1, [110, 52, 132], 0.55); P(ex + 1, ey + 3, [110, 52, 132], 0.55);
    }
  },
  mob_guardian: (s, c) => {
    /* 远古守卫：青蓝石甲 + 甲片分割线 + 四颗铆钉。 */
    noiseTile(s, c, 5, 0.03);
    for (let x = 0; x < TP; x++) { P(x, 8, shade(c, -26)); P(x, 16, shade(c, -26)); P(x, 24, shade(c, -26)); }
    for (let y = 0; y < TP; y++) { P(8, y, shade(c, -18)); P(24, y, shade(c, -18)); }
    for (const rx of [4, 27]) for (const ry of [4, 12, 20, 28]) {
      P(rx, ry, shade(c, 40)); P(rx, ry + 1, shade(c, -20));
    }
  },
  mob_guardian_face: (s, c) => {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) P(x, y, c);
    for (let y = 10; y <= 21; y++) for (let x = 10; x <= 21; x++) P(x, y, shade(c, 80));
    for (let y = 14; y <= 17; y++) for (let x = 14; x <= 17; x++) P(x, y, shade(c, -40));
    // 眼框
    for (let x = 8; x <= 23; x++) { P(x, 9, shade(c, -50)); P(x, 22, shade(c, -50)); }
    for (let y = 9; y <= 22; y++) { P(9, y, shade(c, -50)); P(22, y, shade(c, -50)); }
  },

  /* ---------------- 异界地形方块 ----------------
   * 每种都要求和主世界的同类方块**一眼分得开**：石头是乱裂纹、玄武岩是竖节理、
   * 末地石是密集细孔、晶簇岩是菱形晶面。 */
  /* 玄武岩：竖向柱状节理（暗缝）+ 细碎气孔 */
  basalt(s, c) {
    noiseTile(s, c, 8, 0.05);
    for (let x = 0; x < TP; x++)
      if (hash2(x, 5, s) > 0.66)
        for (let y = 0; y < TP; y++) P(x, y, shade(c, -30));
    for (let i = 0; i < 26; i++)
      P(Math.floor(hash2(i, 17, s) * TP), Math.floor(hash2(i, 19, s) * TP), shade(c, -44));
  },
  /* 末地石：淡黄白底 + 密集细孔 */
  endstone(s, c) {
    noiseTile(s, c, 10, 0.10);
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(hash2(i, 23, s) * TP), y = Math.floor(hash2(i, 29, s) * TP);
      P(x, y, shade(c, -48)); P(x + 1, y, shade(c, -30));
    }
  },
  /* 晶簇岩：暗紫底 + 若干菱形晶面（自发光方块，要看起来「自己在亮」） */
  crystal(s, c) {
    noiseTile(s, c, 7, 0.04);
    for (let i = 0; i < 7; i++) {
      const cx = Math.floor(hash2(i, 31, s) * TP), cy = Math.floor(hash2(i, 37, s) * TP);
      const r = 3 + hash2(i, 41, s) * 5;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;      // 菱形（曼哈顿距离）
        const m = 1 - (Math.abs(dx) + Math.abs(dy)) / (r + 1);
        P(cx + dx, cy + dy, shade(c, 14 + m * 104));
      }
    }
  },
  /* 蘑菇块：米白菌盖 + 深色菌斑 */
  mushroom(s, c) {
    noiseTile(s, c, 9, 0.05);
    for (let i = 0; i < 6; i++) {
      const cx = hash2(i, 43, s) * TP, cy = hash2(i, 47, s) * TP, r = 2.6 + hash2(i, 53, s) * 3.6;
      for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
        const dx = x - cx, dy = (y - cy) * 0.85;
        if (dx * dx + dy * dy < r * r) P(x, y, shade(c, -54));
      }
    }
  },
  /* 毒沼：墨绿波纹 + 大块浑浊（和水的蓝波纹同构，但更脏更稠） */
  toxic(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const w = Math.sin((x * 0.75 + y * 0.5) * 0.7 + s) * 0.5 + 0.5;
      const blob = hash2(x >> 2, y >> 2, s + 61);
      P(x, y, shade(c, (w - 0.5) * 22 + (blob - 0.5) * 20));
    }
  },
  /* 传送门：8 种只差基色，共用同一套「三臂旋涡」画法 */
  portal_over:    (s, c) => portalTile(s, c),
  portal_ember:   (s, c) => portalTile(s, c),
  portal_void:    (s, c) => portalTile(s, c),
  portal_frost:   (s, c) => portalTile(s, c),
  portal_crystal: (s, c) => portalTile(s, c),
  portal_blight:  (s, c) => portalTile(s, c),
  portal_dune:    (s, c) => portalTile(s, c),
  portal_garden:  (s, c) => portalTile(s, c),

  /* ---------------- 机制方块 ----------------
   * ⚠ 火把 / 铁轨 / 传送板是**带镂空**的：周围必须留透明（不调用 P 即可），
   *   由 shader 的 `uCutout → discard` 裁掉。写成整张不透明贴图的话，
   *   十字薄片会渲染成一块实心方板，火把看起来就是「悬空的木头方块」。 */
  torch:   (s, c) => torchTile(s, c, [246, 206, 132], [246, 148, 52]),
  torch_red: (s, c) => torchTile(s, c, [252, 132, 120], [226, 62, 62]),
  redstone_block(s, c) {
    noiseTile(s, c, 7, 0.03);                       // 红石底 + 细噪点
    const line = shade(c, 62);
    for (let i = 2; i < TP; i += 6) {               // 纵横电路走线
      for (let x = 1; x < TPM; x++) { P(x, i, line); P(i, x, line); }
    }
    for (let gy = 4; gy < TP; gy += 12)             // 结点：亮芯 + 暗边
      for (let gx = 4; gx < TP; gx += 12) {
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
          P(gx + dx, gy + dy, dx === 1 && dy === 1 ? shade(c, 120) : shade(c, -60));
      }
  },
  rail: (s, c) => railTile(s, c, [186, 178, 162]),
  rail_powered: (s, c) => railTile(s, c, [238, 196, 84], [222, 132, 40]),
  belt(s, c) {
    noiseTile(s, c, 6, 0);                          // 橡胶带面
    const seam = shade(c, -34);
    for (let y = 0; y < TP; y += 8) for (let x = 0; x < TP; x++) P(x, y, seam);
    /* 人字箭头：只朝一个方向，视觉上暗示「这条带子在往那边推」。
     * 真正的方向存在 beltDir 表里（放置时的朝向），贴图只是给个读得懂的暗示。 */
    const mark = shade(c, 74);
    for (let y = 2; y < TP; y += 8) {
      const yy = y + 3;
      for (let i = 0; i <= 4; i++) { P(TPH - 4 + i, yy - i, mark); P(TPH + 4 - i, yy - i, mark); }
    }
  },
  pad(s, c) {
    const man = (x, y) => Math.max(Math.abs(x - (TPH - 0.5)), Math.abs(y - (TPH - 0.5)));
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const d = man(x, y);
      if (d > TPH - 2) continue;                    // 四角留空（圆角方板）
      P(x, y, shade(c, d > TPH - 4 ? -70 : (hash2(x, y, s) - 0.5) * 12));
    }
    for (let i = 0; i < TP; i++) {                  // 外圈符文环
      const o = TPH - 4;
      P(o, i, shade(c, 90)); P(TP - 1 - o, i, shade(c, 90));
      P(i, o, shade(c, 90)); P(i, TP - 1 - o, shade(c, 90));
    }
    for (let y = TPH - 3; y <= TPH + 2; y++)        // 中心的传送眼
      for (let x = TPH - 3; x <= TPH + 2; x++) {
        const dx = x - (TPH - 0.5), dy = y - (TPH - 0.5);
        if (dx * dx + dy * dy < 9) P(x, y, shade(c, 130));
      }
  },
  /* ---------------- 附魔台 ----------------
   * 台面与台身两格，刻意做成「一眼是仪式家具」而不是又一块石头：
   *   台面 = 深紫石面 + 双层符文环 + 四向刻痕（俯视时像个法阵）
   *   台身 = 黑曜石质感的深灰噪点 + 一条竖向紫光缝（凹进去的立体感）
   * 两格都整张不透明，走 MAT_PLAIN —— 不做发光呼吸，
   * 那是传送门的语义（MAT_PORTAL），混用会让人以为这台子能走进去。
   *
   * ⚠ 所有坐标按 TP / TPH 的比例算，不写裸的 16 / 15（见文件头纪律）。 */
  enchant_top(s, c) {
    const rune = [190, 152, 255];
    const cx = TPH - 0.5, cy = TPH - 0.5;
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let col = shade(c, (hash2(x, y, s) - 0.5) * 18);
      if (d > TPH * 0.84) col = shade(c, -28);                       // 台面倒角压暗
      else if (d > TPH * 0.52 && d < TPH * 0.61) col = shade(rune, (hash2(x, y, s + 5) - 0.5) * 26);
      else if (d > TPH * 0.22 && d < TPH * 0.28) col = shade(rune, -46);
      else if (d < TPH * 0.11) col = shade(rune, 52);                // 中心亮芯
      P(x, y, col);
    }
    /* 四向刻痕：从中心指向四个斜角，像仪式连线。
     * 用「沿对角线走 5 步、每步补一格邻边」画，单像素线在 32 分辨率下会断。 */
    for (let k = 1; k <= 5; k++) {
      const o = Math.round(k * TPH / 6);
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = TPH - 1 + sx * o, py = TPH - 1 + sy * o;
        P(px, py, shade(rune, 14)); P(px + 1, py, shade(rune, -18));
      }
    }
  },
  enchant_side(s, c) {
    const dark = [24, 20, 32], glow = [152, 110, 232];
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
      /* 粗颗粒（>> 1 采样）+ 少量深斑，做出黑曜石那种玻璃质感的暗块 */
      const d = (hash2(x, y, s) - 0.5) * 26
        - (hash2(x >> 1, y >> 1, s + 9) > 0.82 ? 16 : 0);
      P(x, y, shade(c, d));
    }
    /* 竖向紫光缝：中间两列亮、两侧各一列近黑 —— 靠明暗差读出「凹槽」 */
    const x0 = TPH - 3, x1 = TPH + 2;
    for (let y = 2; y < TP - 2; y++) {
      const t = y / (TP - 1);
      const amp = Math.round(Math.sin(t * Math.PI) * 46) - 12;        // 上下收口
      for (let x = x0; x <= x1; x++) {
        const core = x >= TPH - 1 && x <= TPH;
        P(x, y, core ? shade(glow, amp) : dark);
      }
    }
    for (let x = 0; x < TP; x++) {                                    // 上下横缝
      P(x, 1, shade(c, -44)); P(x, TP - 2, shade(c, -36));
    }
  },
  /* 矿车车身：金属板 + 铆钉。整张不透明 —— 它是实体网格，不走镂空。 */
  cart_metal(s, c) {
    for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++)
      P(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 16 - (y > TP - 4 ? 26 : 0)));
    for (const rx of [4, TPM - 4]) for (const ry of [4, TPM - 4]) {   // 四角铆钉
      P(rx, ry, shade(c, 40)); P(rx + 1, ry, shade(c, -40));
      P(rx, ry + 1, shade(c, -40));
    }
  },
};

/* 火把：一根木柄 + 顶上的火苗，四周留透明。
 * ⚠ 坐标全部按 TP 的比例算（TPH / TPM），不许出现裸的 16 —— 那些数字是
 *   16 像素时代的遗留，贴图边长改了就会把柄画到格子外面去。 */
export function torchTile(s, c, flame, hot) {
  const wood = [138, 100, 62];
  const x0 = TPH - 1, x1 = TPH + 1;
  const y0 = Math.round(TP * 0.44), y1 = TPM - 3;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    P(x, y, shade(wood, (hash2(x, y, s) - 0.5) * 20 - (x === x0 ? 18 : x === x1 ? 8 : 0)));
  const top = Math.round(TP * 0.08);
  for (let i = 0; i < 9; i++) {                     // 火苗：上尖下宽的 9 层锥
    const t = i / 8;
    const yy = Math.round(top + t * (y0 - top));
    const w = Math.round(t * 3.4);
    for (let x = TPH - w; x <= TPH + w; x++)
      P(x, yy, Math.abs(x - TPH) >= w ? hot : (t > 0.5 ? flame : shade(flame, 40)));
  }
}

/* 铁轨：画成**十字道口**（两条轨道交叉）—— 方块 id 不带朝向，
 * 与其猜一个方向画错，不如画成四向通用，玩家看到的永远是「这里能跑车」。 */
export function railTile(s, c, metal, glow) {
  const dk = shade(metal, -66), lt = shade(metal, 46);
  const sleepers = [104, 82, 58];                   // 枕木
  for (let k = 0; k < 4; k++) {                     // 横向枕木
    const y0 = 3 + k * 8;
    for (let y = y0; y < y0 + 3; y++) for (let x = 4; x <= TPM - 4; x++)
      P(x, y, shade(sleepers, (hash2(x, y, s) - 0.5) * 18));
  }
  for (let y = 0; y < TP; y++) {                    // 纵向两条轨
    P(TPH - 5, y, dk); P(TPH - 4, y, lt);
    P(TPH + 4, y, lt); P(TPH + 5, y, dk);
  }
  for (let x = 0; x < TP; x++) {                    // 横向两条轨（交叉成道口）
    P(x, TPH - 5, dk); P(x, TPH - 4, lt);
    P(x, TPH + 4, lt); P(x, TPH + 5, dk);
  }
  if (glow) for (let y = 0; y < TP; y++) {          // 充能轨：轨心点亮一条
    P(TPH, y, glow); P(TPH - 1, y, glow);
    P(y, TPH, glow); P(y, TPH - 1, glow);
  }
}

/* 传送门贴图：以格心为原点的三臂旋涡 —— 极角方向三圈、径向从亮到暗，
 * 再压暗最外一圈当作「门框」。8 种门共用这一张画法，只换基色。 */
export function portalTile(s, c) {
  const cx = TPH - 0.5, cy = TPH - 0.5;
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy) / TPH;              // 0 格心 → 1 边缘
    const swirl = Math.sin(Math.atan2(dy, dx) * 3 + r * 9 - s) * 0.5 + 0.5;
    let d = 18 + swirl * 56 - r * 28;
    if (r > 0.96) d = -50;                                     // 最外一圈压暗
    P(x, y, shade(c, d + (hash2(x, y, s) - 0.5) * 12));
  }
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < 11) P(x, y, shade(c, 106));        // 旋涡眼
  }
}

/* 兽毛质感的通用底：短促的竖向毛流 + 噪点 */
export function furTile(s, c, amp, streak) {
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    const hair = (hash2(x, Math.floor(y / 4), s) - 0.5) * streak;
    P(x, y, shade(c, hair + (hash2(x, y, s + 9) - 0.5) * amp));
  }
}

export function plankLike(s, c, tone = 0) {
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    const row = Math.floor(y / 8);
    const seam = (y % 8 === 0);
    /* 木纹：沿板长方向的细长纹理（按 x 分段的 hash）比纯噪点更像木头，
     * 再叠一条低频明暗，让每块板整体有轻微色差。 */
    const grain = hash2(Math.floor(x / 12), y * 3 + row, s) > 0.72 ? -16 : 0;
    const wave = Math.sin(x * 0.42 + row * 1.7 + s) * 6;
    const board = (hash2(row, 91, s) - 0.5) * 14;
    P(x, y, shade(c, tone + (seam ? -42 : grain + wave + board + (hash2(x, y, s) - 0.5) * 9)));
  }
  for (let row = 0; row < 4; row++) {                          // 每块板端头的竖缝
    const ex = Math.floor(hash2(row, 5, s + 21) * TP);
    for (let y = row * 8 + 1; y < row * 8 + 8; y++) P(ex, y, shade(c, tone - 34));
  }
  /* 钉头：每块板两端各一颗，暗底 + 亮顶两像素 —— 这是让木板一眼可辨
   * 是「拼起来的板」而不是「一整块木」的关键细节。 */
  for (let row = 0; row < 4; row++) {
    const ny = row * 8 + 4;
    for (const nx of [3, TP - 5]) {
      P(nx, ny, shade(c, tone - 46));
      P(nx, ny + 1, shade(c, tone - 46));
      P(nx + 1, ny, shade(c, tone - 52));
      P(nx + 1, ny + 1, shade(c, tone - 52));
      P(nx, ny - 1, shade(c, tone + 34));
      P(nx + 1, ny - 1, shade(c, tone + 34));
    }
  }
}
export function woolTile(s, c) {
  for (let y = 0; y < TP; y++) for (let x = 0; x < TP; x++) {
    // 编织感：2×2 分组，同组同亮度，组间抖动
    const g = hash2(x >> 2, y >> 2, s);
    P(x, y, shade(c, (g - 0.5) * 26 + (hash2(x, y, s + 2) - 0.5) * 10));
  }
}
/* 矿石：石头打底 + 一簇簇带暗边的矿点。
 * 矿点别画成孤立圆点 —— 每个矿点周围描一圈深色边、左上角点一个高光，
 * 才有「金属/晶体嵌在石头里」的立体感。簇的数量与半径随 TP 走。 */
export function oreTile(s, c, ore) {
  TILE_GEN.stone(s, c);
  const F = TP / 16;
  const clusters = 3 + Math.floor(hash2(0, 0, s) * 2);
  const R = 2.4 * F;                       // 单簇半径
  for (let i = 0; i < clusters; i++) {
    const cx = Math.round(3 * F + hash2(i, 61, s) * (TP - 6 * F));
    const cy = Math.round(3 * F + hash2(i, 67, s) * (TP - 6 * F));
    for (let y = -Math.ceil(R); y <= Math.ceil(R); y++)
      for (let x = -Math.ceil(R); x <= Math.ceil(R); x++) {
        const d2 = x * x + y * y;
        if (d2 > R * R || hash2(cx + x, cy + y, s + 3) < 0.20) continue;
        const edge = d2 > R * R * 0.55;
        const hi = x <= 0 && y <= 0 && d2 < R * R * 0.30;
        P(cx + x, cy + y, edge ? shade(ore, -52)
                              : hi ? shade(ore, 42)
                                   : shade(ore, (hash2(cx + x, cy + y, s) - 0.5) * 26));
      }
  }
}
/* ---------------- 字块：A–Z ----------------
 * ⚠ 这里是**画贴图**，不是 3D 文字渲染 —— 和 ADR-0003「中文走 DOM 覆盖层」
 *   不冲突：26 个字母是有限集，可以进贴图集；汉字不是，所以只能走 DOM。
 *
 * 用 fillText 取字形、再按 alpha 阈值转成 0/1 掩码、最后用 P() 逐像素写。
 * 直接 fillText 到贴图集会被抗锯齿糊成灰边，和全场的「逐像素写」风格不搭；
 * 走一遍阈值就得到硬边字形，跟石头/木板那些贴图是同一种颗粒感。
 * 掩码按字母缓存 —— 26 个字母各画一次，之后纯复用。 */
const glyphMaskCache = new Map();
function glyphMask(ch) {
  let m = glyphMaskCache.get(ch);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TP;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(TP * 0.80)}px "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  /* +TP*0.04 是手写体的视觉补偿：middle 基线会让大写字母整体偏上一点 */
  c.fillText(ch, TP / 2, TP / 2 + TP * 0.04);
  const d = c.getImageData(0, 0, TP, TP).data;
  const mask = new Uint8Array(TP * TP);
  for (let i = 0; i < TP * TP; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  glyphMaskCache.set(ch, mask);
  return mask;
}

export function glyphTile(ch, s, base) {
  noiseTile(s, base, 7, 0);                       // 象牙底 + 细噪点，像一块字母牌
  const edge = shade(base, -52);
  for (let i = 0; i < TP; i++) {                  // 一圈压暗的边框
    P(i, 0, edge); P(i, TPM, edge);
    P(0, i, edge); P(TPM, i, edge);
  }
  const ink = shade(base, -170);
  const mask = glyphMask(ch);
  for (let y = 1; y < TPM; y++) for (let x = 1; x < TPM; x++) {   // 跳过边框那一圈
    if (mask[y * TP + x]) P(x, y, ink);
  }
  return true;
}

/* ---------------- 工具 / 武器 / 弹药图标 ----------------
 * 全部按 16×16 逻辑格绘制（IU = TP/16 = 2，即每格 2×2 像素）：
 * 逻辑坐标写起来清楚，落到 32×32 的贴图格上又正好和方块贴图同分辨率，
 * 还保住了像素画的硬边 —— 直接按 32 像素写坐标太容易数错。
 *
 * 配色约定：头的色相来自 ITEMS[id].color（按等级变），握柄永远是木色，
 * 所以五把镐并排放在背包里一眼就能按材质排序。 */
export const IU = TP / 16;
export const WOOD_HANDLE = [142, 104, 64], WOOD_HANDLE_DK = [100, 72, 42];

export function PQ(x, y, col) {                 // 逻辑格 → IU×IU 像素块
  for (let dy = 0; dy < IU; dy++) for (let dx = 0; dx < IU; dx++)
    P(x * IU + dx, y * IU + dy, col);
}
export function PL(x0, y0, x1, y1, col) {       // 逻辑格粗线（Bresenham，1 格粗）
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let g = 0; g < 96; g++) {
    PQ(x, y, col);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
/* 一条「有厚度」的斜线：把同一条线平移 1 格再画一遍。
 * 剑身、镐头的拱都是这么加粗的 —— 单像素斜线在 2 倍放大后会显得太细。 */
export function PL2(x0, y0, x1, y1, col, ox = 1, oy = 0) {
  PL(x0, y0, x1, y1, col);
  PL(x0 + ox, y0 + oy, x1 + ox, y1 + oy, col);
}

export function toolIconTile(kind, c) {
  const H = c, L = shade(c, 48), D = shade(c, -62);
  if (kind === 'pick') {
    /* 镐：木柄左下→右上，镐头是以 (8,1) 为顶点的拱，两端向下勾 */
    PL2(5, 15, 11, 8, WOOD_HANDLE, 0, 1);
    PL(12, 8, 12, 9, WOOD_HANDLE_DK);
    PL2(1, 8, 8, 1, H);                        // 左半拱
    PL2(8, 1, 15, 8, H);                       // 右半拱
    PL(1, 8, 1, 10, D); PL(15, 8, 15, 10, D);  // 两端勾尖加暗
    PL(6, 1, 9, 1, L);                          // 顶点高光
    PL(2, 7, 5, 3, L);
  } else if (kind === 'axe') {
    /* 斧：柄从左上斜到右下，刃是贴在左上的圆角方块 + 外凸的刃口 */
    PL2(9, 4, 12, 15, WOOD_HANDLE, -1, 0);
    for (let y = 2; y <= 9; y++) {
      const x1 = (y <= 2 || y >= 9) ? 8 : 9;
      for (let x = 3; x <= x1; x++) PQ(x, y, H);
    }
    PL(2, 3, 2, 8, H); PL(1, 5, 1, 6, H);      // 外凸刃口
    PL(3, 2, 7, 2, L); PL(2, 4, 2, 6, L);      // 刃口高光
    PL(4, 9, 7, 9, D); PL(3, 8, 3, 8, D);      // 下缘加暗
  } else if (kind === 'shovel') {
    /* 锹：柄左下→右上，铲头是右上的圆角梯形 */
    PL2(11, 15, 8, 7, WOOD_HANDLE, 0, 1);
    for (let y = 1; y <= 7; y++) {
      const sl = 6 - Math.min(4, y);                 // 左缘随高度内收
      for (let x = 6 + Math.max(0, 3 - y) - 2; x <= 11; x++) {
        if (x - 3 < sl) continue;
        if ((x === 11 || x === 3 + sl) && (y === 1 || y === 7)) continue;
        PQ(x, y, H);
      }
    }
    PL(7, 2, 10, 2, L); PL(6, 3, 6, 6, L);
    PL(11, 5, 11, 7, D); PL(6, 7, 10, 7, D);
  } else {
    /* 剑：剑身 45° 朝右上，护手横在根部，握柄再往左下 */
    PL2(6, 9, 12, 2, H, 0, 1);                     // 剑身（2 格宽）
    PL(5, 9, 5, 9, H); PQ(12, 1, L); PQ(13, 2, L); // 剑尖与锋口高光
    PL(6, 8, 11, 3, L);                            // 剑脊高光
    PL2(1, 10, 8, 10, D, 0, 1);                    // 护手
    PL2(2, 12, 5, 15, WOOD_HANDLE_DK, 1, 0);       // 握柄
    PQ(1, 15, WOOD_HANDLE_DK);
  }
}

/* 盔甲图标：四个部位各一个轮廓。
 * 刻意**不按材质**分别画 —— 16 件共用这 4 个形状，材质靠 ITEMS[id].color 区分，
 * 和工具「同一形状换材质」保持一致：玩家一眼看出「这是胸甲」，
 * 再看颜色就知道「这是铁的还是钻石的」。 */
export function armorIconTile(part, c) {
  const L = shade(c, 46), D = shade(c, -58), E = shade(c, -96);
  const rect = (x0, y0, x1, y1, col) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) PQ(x, y, col);
  };
  if (part === 'head') {
    /* 头盔：拱顶 + 两侧护耳 + 深色面甲开口 */
    rect(3, 3, 12, 12, c);
    rect(5, 1, 10, 2, c);                 // 顶部收窄
    rect(5, 6, 10, 11, E);                // 面甲开口（深色，一眼认出是头盔）
    rect(5, 1, 9, 1, L);                  // 高光
    rect(3, 12, 12, 12, D);               // 底缘
    PQ(3, 3, D); PQ(12, 3, D);
  } else if (part === 'chest') {
    /* 胸甲：双肩宽、腰身窄，中间一条竖脊 */
    rect(2, 3, 13, 6, c);                 // 肩
    rect(4, 7, 11, 13, c);                // 躯干
    rect(7, 3, 8, 13, L);                 // 竖脊
    rect(2, 6, 13, 6, D);
    rect(4, 13, 11, 13, D);
    PQ(2, 3, D); PQ(13, 3, D);
    PQ(3, 4, L); PQ(12, 4, L);
  } else if (part === 'legs') {
    /* 护腿：腰环 + 两条腿（中间留缝，和靴子区分开） */
    rect(3, 2, 12, 4, c);                 // 腰
    rect(3, 5, 6, 14, c);                 // 左腿
    rect(9, 5, 12, 14, c);                // 右腿
    rect(3, 2, 12, 2, L);
    rect(4, 5, 5, 14, L); rect(10, 5, 11, 14, L);
    rect(3, 14, 6, 14, D); rect(9, 14, 12, 14, D);
  } else {
    /* 靴子：两只 L 形，靴头朝内 —— 和护腿的「两条直腿」拉开距离 */
    rect(2, 7, 6, 13, c); rect(2, 13, 8, 14, c);
    rect(9, 7, 13, 13, c); rect(7, 13, 13, 14, c);
    rect(2, 7, 6, 7, L); rect(9, 7, 13, 7, L);
    rect(2, 14, 8, 14, D); rect(7, 14, 13, 14, D);
  }
}

/* 盾牌图标：上宽下尖的盾面 + 中央十字徽记 + 左上受光。
 * 木盾 / 铁盾共用同一个形状，只靠 color 区分 —— 和盔甲同一套约定。 */
export function shieldIconTile(c) {
  const L = shade(c, 46), D = shade(c, -62);
  for (let y = 2; y <= 15; y++) {
    const inset = y <= 8 ? 2 : 2 + Math.floor((y - 8) * 0.85);
    for (let x = inset; x <= 15 - inset; x++) {
      const edge = (x === inset || x === 15 - inset || y === 2 || y === 15);
      PQ(x, y, edge ? D : shade(c, (hash2(x, y, 7) - 0.5) * 14));
    }
  }
  /* 徽记：竖梁 + 横臂 */
  for (let y = 4; y <= 11; y++) { PQ(7, y, L); PQ(8, y, L); }
  for (let x = 5; x <= 10; x++) { PQ(x, 6, L); PQ(x, 7, L); }
  PQ(3, 4, shade(c, 70)); PQ(4, 3, shade(c, 70));   // 左上高光
}

/* 法杖图标：斜杆 + 顶端紫黑光球（内芯提亮）。
 * 法杖是「远程武器」，所以顶端必须有发光点 —— 和近战武器一眼分得开。 */
export function staffIconTile(c) {
  const glow = shade(c, 72);
  PL2(4, 15, 10, 7, WOOD_HANDLE_DK, 0, 1);          // 杖杆
  for (let y = 1; y <= 7; y++) for (let x = 9; x <= 15; x++) {
    const dx = x - 12, dy = y - 4;
    if (dx * dx + dy * dy > 9) continue;
    PQ(x, y, dx + dy < -1 ? glow : shade(c, (hash2(x, y, 3) - 0.5) * 18));
  }
  PQ(11, 3, [242, 224, 255]); PQ(12, 3, [242, 224, 255]);
  PQ(11, 4, glow); PQ(12, 4, glow);
  PQ(6, 12, WOOD_HANDLE); PQ(7, 11, WOOD_HANDLE);   // 缠绳
}

/* 弓 / 箭 / 木棍：同样按 16×16 逻辑格画 */
export function propIconTile(name, c) {
  if (name === 'item_bow') {
    /* 弓背是向左鼓的弧，弦是右侧的竖直线，握把在弧的最左点 */
    for (let y = 1; y <= 13; y++) {
      const t = (y - 7) / 6;
      PQ(3 + Math.round(Math.abs(t) * 4), y, WOOD_HANDLE);
    }
    for (let y = 1; y <= 13; y++) PQ(8, y, [226, 224, 212]);
    PQ(3, 6, WOOD_HANDLE_DK); PQ(3, 7, WOOD_HANDLE_DK); PQ(3, 8, WOOD_HANDLE_DK);
    PQ(2, 7, WOOD_HANDLE_DK);
  } else if (name === 'item_arrow') {
    PL2(3, 13, 11, 5, WOOD_HANDLE, 1, 0);              // 箭杆
    /* 石质三角箭头：三排逐层收窄，尖端单独提亮 */
    for (let x = 11; x <= 13; x++) PQ(x, 3, c);
    for (let x = 12; x <= 13; x++) { PQ(x, 2, c); PQ(x, 4, c); }
    PQ(14, 2, shade(c, 30)); PQ(14, 3, shade(c, 30)); PQ(14, 4, shade(c, 30));
    /* 尾羽：三片白羽扇形铺开 */
    PQ(1, 12, [232, 232, 226]); PQ(1, 13, [232, 232, 226]);
    PQ(2, 13, [232, 232, 226]); PQ(2, 15, [232, 232, 226]);
    PQ(3, 14, [232, 232, 226]); PQ(4, 15, [216, 216, 210]);
  } else {
    PL2(3, 13, 12, 3, WOOD_HANDLE, 1, 0);              // 木棍
    PQ(2, 14, WOOD_HANDLE_DK); PQ(13, 2, WOOD_HANDLE_DK);
  }
}

/* 物品图标：透明底 + 一个能认出来的小图形 */
/* 傀儡核心图标：一枚圆角核心，正中一只发光的眼。
 * kind 决定眼睛的颜色（铁青 / 石橙 / 雪蓝），三枚在物品栏里一眼分得开。 */
export function golemCoreIcon(kind, s, c) {
  const lite = shade(c, 46);
  const eye = kind === 'snow' ? [110, 186, 244] : kind === 'stone' ? [232, 140, 52] : [118, 226, 236];
  for (let y = 2; y <= 13; y++) for (let x = 2; x <= 13; x++) {
    const dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy);
    if (r > 6.0) continue;                        // 圆形轮廓（四角自然空掉）
    PQ(x, y, shade(c, r > 4.6 ? -56 : (hash2(x, y, s) - 0.5) * 16));
  }
  for (let x = 5; x <= 10; x++) PQ(x, 7, eye);
  PQ(5, 8, eye); PQ(10, 8, eye);
  PQ(7, 9, shade(eye, -70)); PQ(8, 9, shade(eye, -70));
  PQ(4, 4, lite); PQ(5, 4, lite); PQ(4, 5, lite);  // 左上受光
}

/* 维度核心图标：一枚菱形宝石 + 同心亮环 + 中心光点，颜色 = 目标维度的门色。
 * 刻意和「傀儡核心」的「圆角方块 + 横眼」拉开距离 —— 两者都是「核心」，
 * 图标撞脸的话物品栏里根本认不出哪枚能开门。 */
export function dimCoreIcon(s, c) {
  const man = (x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5);   // 菱形距离
  for (let y = 1; y <= 14; y++) for (let x = 1; x <= 14; x++) {
    const d = man(x, y);
    if (d > 6.6) continue;
    PQ(x, y, shade(c, d > 6.0 ? -72 : d > 4.4 ? -34 : (hash2(x, y, s) - 0.5) * 16));
  }
  for (let y = 1; y <= 14; y++) for (let x = 1; x <= 14; x++) {
    const d = man(x, y);
    if (d > 2.5 && d < 3.5) PQ(x, y, shade(c, 64));              // 中环
    if (d < 1.6) PQ(x, y, shade(c, 118));                        // 芯
  }
  PQ(4, 4, shade(c, 72)); PQ(5, 4, shade(c, 72)); PQ(4, 5, shade(c, 72));
}

/* 矿车图标：一只敞口车厢 + 两个轮子 + 底下一段轨，走 PQ/PL 的 16×16 逻辑格。
 * 车厢画成「上宽下窄」的斗形，轮子压在车底 —— 光一个方块认不出是车。 */
export function cartIcon(c) {
  const dk = shade(c, -70), lt = shade(c, 52);
  for (let y = 5; y <= 11; y++) {                          // 斗形车厢
    const inset = y < 8 ? (11 - y) : 0;
    for (let x = 3 + inset; x <= 12 - inset; x++) {
      if (y === 5) { PQ(x, y, lt); continue; }             // 上沿受光
      PQ(x, y, shade(c, (hash2(x, y, 7) - 0.5) * 18));
    }
  }
  PL(3, 5, 3, 11, dk); PL(12, 5, 12, 11, dk); PL(3, 11, 12, 11, dk);
  for (const wx of [5, 10]) {                              // 轮子
    PQ(wx, 12, dk); PQ(wx + 1, 12, dk); PQ(wx, 13, dk); PQ(wx + 1, 13, dk);
    PQ(wx, 12, shade(c, -20));
  }
  PL(2, 14, 13, 14, [150, 142, 126]);                      // 脚下那段轨
  PL(2, 15, 13, 15, shade(c, -90));
}

/* 传送珠图标：一颗发光宝珠 + 四道放射光。紫色和维度核心同色系，
 * 所以刻意用「圆 + 十字星芒」和核心的「菱形 + 同心环」拉开距离。 */
export function blinkIcon(s, c) {
  const cx = 7.5, cy = 8.5, R = 5.2;
  for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) {
    const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > R) continue;
    const hl = dx + dy < -2.4;
    PQ(x, y, hl ? shade(c, 78) : shade(c, d > R - 1.2 ? -64 : (hash2(x, y, s) - 0.5) * 16));
  }
  for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]])    // 四向星芒
    for (let k = 1; k <= 3; k++) {
      const px = Math.round(cx + ox * (R + k)), py = Math.round(cy + oy * (R + k));
      if (px >= 1 && px <= 14 && py >= 1 && py <= 14) PQ(px, py, shade(c, 96 - k * 22));
    }
  PQ(6, 7, shade(c, 130)); PQ(7, 7, shade(c, 130)); PQ(6, 8, shade(c, 130));
}

/* 刷怪蛋图标：一枚带斑点的卵形壳。
 * 颜色 = 该生物的标志色（ITEMS[id].color），所以一排蛋能按色相认出谁是谁；
 * 壳面留一块左上高光、再撒几粒深色斑点，和方块/工具图标放一起一眼能认出是「蛋」。
 * 走 16×16 逻辑格（PQ），与 TP 解耦 —— 直接按 32 像素写坐标太容易数错。 */
export function eggIconTile(s, c) {
  const dark = shade(c, -58), lite = shade(c, 48);
  const cx = 7.5, cy = 7.5, RX = 3.6, RY = 6.2;
  for (let y = 1; y <= 14; y++) for (let x = 4; x <= 12; x++) {
    const dx = (x - cx) / RX, dy = (y - cy) / RY;
    const d2 = dx * dx + dy * dy;
    if (d2 > 1) continue;
    const hl = (x - cx) * 0.8 + (y - cy) * 1.1 < -2.2;   // 左上受光
    PQ(x, y, hl ? lite : shade(c, d2 > 0.72 ? -24 : (hash2(x, y, s) - 0.5) * 12));
  }
  for (let i = 0; i < 8; i++) {                          // 斑点
    const x = 4 + Math.floor(hash2(i, 91, s) * 9);
    const y = 3 + Math.floor(hash2(i, 93, s) * 10);
    const dx = (x - cx) / RX, dy = (y - cy) / RY;
    if (dx * dx + dy * dy <= 0.74) PQ(x, y, dark);
  }
  PQ(6, 3, lite); PQ(5, 5, lite);                        // 高光补两点
}

/* ---------------- 药水 / 空瓶图标 ----------------
 * 16×16 逻辑格（PQ 体系）。瓶形固定，靠液体颜色区分 12 种药水；
 * 治疗加一个白十字、负面药水加两颗上浮气泡 —— 「一眼分辨」不只依赖色相，
 * 色弱玩家也能靠形状认出来。空瓶只画玻璃与瓶塞，瓶身半透明。
 *
 * mode：'normal' | 'heal' | 'debuff' | 'empty' */
export function potionIconTile(s, c, mode) {
  const glass = [214, 232, 242]
  const glassDk = [152, 180, 196]
  const empty = mode === 'empty'
  /* 逻辑格绘制（IU×IU 像素块 + 可选透明度）。瓶形必须走逻辑格：
   * 直接用 P() 逐像素画 0..15 的坐标，瓶子只会出现在格子左上 16×16，
   * 实际显示时缩成四分之一大、右下三块空白。 */
  const Q = (x, y, col, a) => {
    for (let dy = 0; dy < IU; dy++) for (let dx = 0; dx < IU; dx++)
      P(x * IU + dx, y * IU + dy, col, a)
  }
  /* 逐行描述瓶形：[y, x0, x1, 部位]。宽度 4→2→4→6→8 逐级外扩再收口：
   * 瓶塞 4 宽、细颈 2 宽、瓶肩过渡、瓶身 8 宽、圆底 —— 修长的玻璃瓶，
   * 而不是「一个彩色方块」。 */
  const rows = [
    [2, 6, 9, 'cork'], [3, 6, 9, 'cork'],
    [4, 7, 8, 'neck'], [5, 7, 8, 'neck'],
    [6, 6, 9, 'rim'],
    [7, 5, 10, 'shoulder'],
    [8, 4, 11, 'body'], [9, 4, 11, 'body'], [10, 4, 11, 'body'],
    [11, 4, 11, 'body'], [12, 4, 11, 'body'],
    [13, 5, 10, 'body'], [14, 6, 9, 'body'],
  ]
  for (const [y, x0, x1, part] of rows) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1
      if (part === 'cork') { Q(x, y, edge ? [108, 78, 44] : [156, 118, 72]); continue }
      if (part === 'neck' || part === 'rim') { Q(x, y, edge ? glassDk : glass, 0.75); continue }
      /* 瓶身：最外一列是玻璃边 —— 先铺液体暗色再叠一层半透明玻璃，
       * 这样整只瓶子仍以液体色为主调（纯灰玻璃边会把瓶子洗成白色），
       * 同时保留「玻璃壳」的高光边。空瓶走淡蓝白实心，否则 0.3 透明
       * 叠在物品栏背景上几乎看不见轮廓。 */
      if (edge) {
        if (empty) { Q(x, y, [178, 198, 214]); continue }
        Q(x, y, shade(c, -34)); Q(x, y, glassDk, 0.42); continue
      }
      if (empty) { Q(x, y, [202, 220, 232]); continue }
      if (part === 'shoulder') { Q(x, y, glass, 0.42); continue }   // 瓶肩以上留空腔
      let col = c
      if (y === 8) col = shade(c, 34)            // 液面
      else if (x <= 5) col = shade(c, 18)        // 左侧受光
      else if (y >= 13) col = shade(c, -16)      // 瓶底压暗
      Q(x, y, col)
    }
  }
  if (!empty) for (let x = 5; x <= 10; x++) Q(x, 8, shade(c, 58))        // 液面亮线
  for (let i = 0; i < 4; i++) Q(5 + i, 9 + i, [255, 255, 255], empty ? 0.5 : 0.38)  // 玻璃斜向反光
  Q(5, 9, [255, 255, 255], empty ? 0.85 : 0.72)                          // 高光点
  if (mode === 'heal') {                                     // 白十字（4×3，居中于液体区）
    for (let y = 9; y <= 11; y++) { Q(7, y, [255, 250, 250]); Q(8, y, [255, 250, 250]) }
    for (let x = 6; x <= 9; x++) Q(x, 10, [255, 250, 250])
  }
  if (mode === 'debuff') {                                   // 上浮气泡
    for (const [bx, by] of [[6, 11], [9, 9], [7, 13]]) {
      Q(bx, by, [38, 42, 38], 0.70); Q(bx + 1, by, [38, 42, 38], 0.50)
    }
  }
  if (!empty && mode !== 'debuff') { Q(9, 12, shade(c, 40), 0.8); Q(6, 13, shade(c, 30), 0.7) }
}

export function itemTile(name, s, c) {
  const dark = shade(c, -60), lite = shade(c, 44);
  /* --- 工具 / 武器 / 弹药：按 item_<kind>_<tier> 前缀分派 --- */
  const m = /^item_(pick|axe|shovel|sword)_/.exec(name);
  if (m) return toolIconTile(m[1], c);
  /* --- 盔甲 / 盾牌 / 法杖 ---
   * 同样必须各自单开一支：掉进下面「肉」兜底的话，16 件盔甲会全长得像猪排。
   * 盔甲按**部位**分形状、按 color 分材质 —— 和工具「同一形状换材质」同一个思路。 */
  const am = /^item_(helm|chest|legs|boots)_/.exec(name);
  if (am) return armorIconTile(am[1], c);
  if (/^item_shield/.test(name)) return shieldIconTile(c);
  if (name === 'item_staff_wither') return staffIconTile(c);
  if (name === 'item_bow' || name === 'item_arrow' || name === 'item_stick') return propIconTile(name, c);
  /* --- 运输：矿车 / 传送珠 ---
   * 同样必须单开一支：掉进下面「肉」兜底分支的话，矿车会画成一块生肉。 */
  if (name === 'item_minecart') return cartIcon(c);
  if (name === 'item_blink') return blinkIcon(s, c);
  /* --- 刷怪蛋：卵形壳。必须单开一支，否则掉进下面「肉」兜底、13 枚全像猪排。 --- */
  if (/^item_egg_\w+$/.test(name)) return eggIconTile(s, c);
  /* --- 药水 / 空瓶：瓶子形状，靠液体色 + 记号区分 --- */
  if (name === 'item_bottle') return potionIconTile(s, c, 'empty');
  if (/^item_potion_/.test(name)) {
    const key = name.slice(12);                       // 'item_potion_' 长 12
    const mode = key === 'heal' ? 'heal' : (key === 'poison' || key === 'slow') ? 'debuff' : 'normal';
    return potionIconTile(s, c, mode);
  }
  /* --- 傀儡核心：一枚带「发光眼」的圆角方块 ---
   * 不加这一支的话会掉进下面的「肉」兜底分支，三枚核心全长得像猪排。 */
  const gm = /^item_golem_(\w+)$/.exec(name);
  if (gm) return golemCoreIcon(gm[1], s, c);
  /* --- 维度核心：菱形宝石。同样必须单开一支，否则掉进「肉」兜底。 --- */
  if (/^item_core_\w+$/.test(name)) return dimCoreIcon(s, c);
  /* --- boss 材料：星陨装备的三味原料 ---
   * 三者形状刻意拉开：鳞（扇贝纹）/ 骨（带关节）/ 核心（菱形星芒）。 */
  if (name === 'item_dragon_scale') {
    /* 一片龙鳞：上宽下收的盾形 + 两圈同心纹 */
    for (let y = 2; y <= 14; y++) {
      const inset = 2 + Math.max(0, y - 9);
      for (let x = inset; x <= 15 - inset; x++) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 8) * 0.8;
        PQ(x, y, (d > 3.4 && d < 4.6) || d < 1.2 ? shade(c, 40) : shade(c, (hash2(x, y, s) - 0.5) * 16));
      }
    }
    PL(4, 6, 11, 6, shade(c, -54));
    PL(5, 10, 10, 10, shade(c, -46));
    PQ(3, 3, shade(c, 62)); PQ(4, 2, shade(c, 62));
    return;
  }
  if (name === 'item_wither_bone') {
    /* 凋灵骨：比普通骨头更短更粗，中缝一道暗线 */
    for (let y = 4; y <= 12; y++) for (let x = 6; x <= 10; x++)
      PQ(x, y, shade(c, (hash2(x, y, s) - 0.5) * 12));
    for (const ey of [2, 12]) {
      PQ(5, ey, c); PQ(6, ey, c); PQ(10, ey, c); PQ(11, ey, c);
      PQ(5, ey + 1, shade(c, -22)); PQ(11, ey + 1, shade(c, -22));
    }
    PL(8, 5, 8, 11, shade(c, -48));
    PQ(7, 3, shade(c, 34)); PQ(9, 13, shade(c, -30));
    return;
  }
  if (name === 'item_guardian_core') {
    /* 守卫核心：菱形多面体 + 四向星芒 + 中心白芯 */
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const man = Math.abs(dx) + Math.abs(dy);
      if (man > 6.4) continue;
      PQ(x, y, shade(c, (hash2(x, y, s) - 0.5) * 16 - (man > 4.6 ? 34 : 0)));
    }
    for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]])
      for (let k = 1; k <= 2; k++) {
        const px = Math.round(7.5 + ox * (5 + k)), py = Math.round(7.5 + oy * (5 + k));
        if (px >= 1 && px <= 14 && py >= 1 && py <= 14) PQ(px, py, shade(c, 80));
      }
    PQ(7, 7, [255, 250, 220]); PQ(8, 7, [255, 250, 220]);
    PQ(7, 8, [255, 250, 220]); PQ(8, 8, [255, 250, 220]);
    return;
  }
  /* --- 材料掉落物：火药 / 骨头 / 蛛眼 / 粘液球 ---
   * 必须单开一支：掉进下面「肉」兜底分支的话四样全长得像猪排。
   * 坐标走 PQ/PL 的 16×16 逻辑格，与 TP 解耦（和食物那段同一个理由）。 */
  if (name === 'item_gunpowder') {
    for (let i = 0; i < 11; i++) {                                   // 一撮灰黑颗粒
      const x = 3 + Math.floor(hash2(i, 81, s) * 11), y = 4 + Math.floor(hash2(i, 83, s) * 10);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        PQ(x + dx, y + dy, shade(c, (hash2(x + dx, y + dy, s) - 0.5) * 26));
    }
  } else if (name === 'item_bone') {
    for (let y = 4; y <= 12; y++) for (let x = 7; x <= 9; x++)      // 骨干
      PQ(x, y, shade(c, (hash2(x, y, s) - 0.5) * 10));
    for (const ey of [3, 13]) {                                      // 两端关节球
      PQ(6, ey, c); PQ(7, ey, c); PQ(9, ey, c); PQ(10, ey, c);
      PQ(6, ey + 1, shade(c, -14)); PQ(10, ey + 1, shade(c, -14));
    }
  } else if (name === 'item_spider_eye') {
    for (let y = 4; y <= 13; y++) for (let x = 4; x <= 13; x++)     // 球体
      { const dx = x - 8.5, dy = (y - 8.5) * 1.15;
        if (dx * dx + dy * dy > 24) continue;
        PQ(x, y, dx + dy < -3 ? shade(c, 42) : shade(c, (hash2(x, y, s) - 0.5) * 14 - 26)); }
    for (let y = 7; y <= 10; y++) for (let x = 7; x <= 10; x++) PQ(x, y, [42, 22, 38]);  // 竖瞳
  } else if (name === 'item_slimeball') {
    for (let y = 4; y <= 13; y++) for (let x = 4; x <= 13; x++)     // 一坨果冻
      { const dx = x - 8.5, dy = y - 8.5;
        if (dx * dx + dy * dy > 22) continue;
        PQ(x, y, shade(c, (hash2(x >> 1, y >> 1, s) - 0.5) * 26 + (dx + dy < -2 ? 30 : 0))); }
  /* --- 食物 ---
   * ⚠ 这一段以前是按 16 像素格写的坐标（`x < 13`、`y - 8.5`、`16 - w`…），
   * 贴图从 16 提到 32 之后那些数字全部失效 —— 苹果只画出了右中一小条，
   * 肉眼看着是「图标糊成一团」。现在统一走 PQ/PL 的 16×16 逻辑格，与 TP 解耦。 */
  } else if (name === 'item_apple') {
    for (let y = 3; y <= 14; y++) for (let x = 3; x <= 12; x++) {
      const dx = x - 7.5, dy = (y - 9) * 1.05;
      const d2 = dx * dx + dy * dy;
      if (d2 > 27) continue;
      if (y <= 5 && Math.abs(x - 8) <= 1 && d2 < 20) continue;   // 顶部凹口
      const hl = (x - 7.5) + (y - 9) < -3.4;                     // 左上受光
      PQ(x, y, hl ? lite : shade(c, d2 > 20 ? -30 : (hash2(x, y, s) - 0.5) * 14));
    }
    PQ(8, 2, [96, 68, 40]); PQ(8, 3, [96, 68, 40]);              // 果梗
    PQ(9, 2, [78, 138, 60]); PQ(10, 2, [92, 156, 70]); PQ(10, 3, [78, 138, 60]);
  } else if (name === 'item_carrot') {
    for (let y = 5; y <= 15; y++) {
      const w = Math.max(0, Math.round((15 - y) * 0.62));
      for (let x = 7 - w; x <= 8 + w; x++) PQ(x, y, shade(c, (hash2(x, y, s) - 0.5) * 24));
    }
    for (const dx of [-2, 0, 2]) {                               // 缨子
      const o = dx === 0 ? 0 : 1;
      PQ(8 + dx, 2 + o, [78, 138, 60]);
      PQ(8 + dx, 3 + o, [92, 156, 70]);
      PQ(8 + dx, 4 + o, [78, 138, 60]);
    }
  } else {
    // 肉：一块带骨头的肉（腐肉用偏绿的色调，其余沿用 item 色）
    const body = name === 'item_rotten' ? [126, 140, 90] : c;
    for (let y = 3; y <= 12; y++) for (let x = 2; x <= 11; x++) {
      const dx = x - 6.5, dy = y - 7.5;
      if (dx * dx * 0.62 + dy * dy > 17) continue;
      PQ(x, y, shade(body, (hash2(x, y, s) - 0.5) * 22));
    }
    PL(11, 10, 14, 10, [236, 234, 220]);                         // 骨头
    PL(11, 11, 13, 11, [236, 234, 220]);
    PQ(14, 9, [236, 234, 220]); PQ(14, 12, [236, 234, 220]);
    for (let i = 0; i < 4; i++)                                   // 纹理
      PQ(4 + Math.floor(hash2(i, 71, s) * 4), 5 + Math.floor(hash2(i, 73, s) * 4), shade(body, 36));
  }
}

/* 把 TILE_NAMES 里每一格画出来 */
export function drawNamedTile(name, idx, base) {
  const s = idx * 977 + 13;
  if (name.indexOf('wool_') === 0) return TILE_GEN[name] ? TILE_GEN[name](s, base) : woolTile(s, base);
  if (name.indexOf('ore_') === 0) return oreTile(s, TILE_COLOR['stone'] || base, TILE_ORE[name] || [200, 200, 200]);
  if (name.indexOf('glyph_') === 0) return glyphTile(name.slice(6), s, base);
  if (name.indexOf('item_') === 0) return itemTile(name, s, ITEM_TEX_COLOR[name] || base);
  const fn = TILE_GEN[name];
  if (fn) return fn(s, base);
  return noiseTile(s, base, 12, 0.04);          // 兜底：没写生成器的材质退化成噪点
}

export function buildAtlas() {
  for (let i = 0; i < TILE_NAMES.length; i++) {
    tilePenX = (i % ATLAS_COLS) * TILE_PX;
    tilePenY = Math.floor(i / ATLAS_COLS) * TILE_PX;
    alctx.clearRect(tilePenX, tilePenY, TILE_PX, TILE_PX);
    drawNamedTile(TILE_NAMES[i], i, TILE_COLOR[TILE_NAMES[i]] || [150, 150, 150]);
  }
  // 图标是从贴图集裁的，贴图重画过就必须把缓存丢掉 ——
  // 否则启动早期（贴图集还空着）建界面时缓存下来的空白图标会一直用下去
  isoCache.clear();
  flatCache.clear();
  atlasPixels = null;                // 贴图像素快照同理，重画过就得重取
}

/* ---- 从贴图集裁出某个方块的「等距立方体」图标，给物品栏用 ----
 * 顶面 + 左侧面 + 右侧面拼成一个 2:1.15 的立体，比色块可辨识得多。
 * 结果缓存成 dataURL，避免每次刷新界面都重画。
 *
 * 尺寸随 TILE_PX 走：贴图 16→32 后图标画布也 34→68，
 * 否则 32 纹素硬压进 15 像素会在侧棱上糊成一片。CSS 显示尺寸不变，
 * 靠 `image-rendering: pixelated` 做最近邻放大，观感上仍然是像素块。 */
export const ISO_W = 68, ISO_H = 68;
export const isoCache = new Map();
export function tileRect(tileIndex) {
  return [(tileIndex % ATLAS_COLS) * TILE_PX, Math.floor(tileIndex / ATLAS_COLS) * TILE_PX];
}
/* 贴图集的像素快照，只取一次。
 * blitFace 每画一个图标要采样 3 个面 × 上千个目标像素，
 * 每次都 getImageData 会慢到没法用（而且会触发大量 GPU→CPU 回读）。 */
export let atlasPixels = null;
export function atlasImageData() {
  if (!atlasPixels || atlasPixels.width !== atlasCanvas.width)
    atlasPixels = alctx.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height);
  return atlasPixels;
}
/* 把贴图集里的一格按仿射贴到目标平行四边形上。
 *
 * 采样必须从**贴图集**取，不能从目标画布取 —— 这里踩过一个很隐蔽的坑：
 * 早期写成 ctx.getImageData(fx, fy, 1, 1)，而 fx/fy 是贴图集坐标（0–255 量级），
 * ctx 却是 34×34 的图标画布。越界取样在 canvas 规范里恒返回全透明，
 * 于是被判 `if (!d[3]) continue` 全部跳过 —— **所有方块的等距图标都是空白**，
 * 而物品图标走的是 flatIcon/drawImage，一切正常。
 * 表现出来就是「方块图标全空、物品图标正常」这种很怪的组合。
 *
 * 采样方式选「遍历目标包围盒 + 逆仿射解回贴图坐标」而不是「逐个纹素正着贴」：
 * 后者在映射有缩小时（这里 TILE_PX 纹素 → 半宽 S 像素）会留下没被覆盖的缝，
 * 图标会漏光。 */
export function blitFace(ctx, tileIndex, ox, oy, ax, ay, bx, by) {
  const det = ax * by - bx * ay;
  if (!det) return;
  const [sx, sy] = tileRect(tileIndex);
  const src = atlasImageData();
  const SW = atlasCanvas.width;
  const xs = [ox, ox + ax, ox + bx, ox + ax + bx];
  const ys = [oy, oy + ay, oy + by, oy + ay + by];
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(ISO_W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(ISO_H - 1, Math.ceil(Math.max(...ys)));
  const img = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const dst = img.data, DW = x1 - x0 + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const rx = x - ox, ry = y - oy;
    const u = (rx * by - bx * ry) / det;          // 逆仿射：[ax bx; ay by]⁻¹ · [rx ry]
    const v = (ax * ry - ay * rx) / det;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const sxp = Math.min(TPM, (u * TP) | 0);
    const syp = Math.min(TPM, (v * TP) | 0);
    const so = ((sy + syp) * SW + sx + sxp) * 4;
    if (!src.data[so + 3]) continue;
    const o = ((y - y0) * DW + (x - x0)) * 4;
    dst[o] = src.data[so]; dst[o + 1] = src.data[so + 1];
    dst[o + 2] = src.data[so + 2]; dst[o + 3] = src.data[so + 3];
  }
  ctx.putImageData(img, x0, y0);
}
/* 非方块（苹果、生肉这些）画成立方体很怪，改成平面图标：
 * 直接从贴图集里把那一格放大 —— 关掉插值，保持像素颗粒感。 */
export const flatCache = new Map();
export function flatIcon(id) {
  if (flatCache.has(id)) return flatCache.get(id);
  const [sx, sy] = tileRect(tileOfId(id, 'side'));
  const cv = document.createElement('canvas');
  cv.width = ISO_W; cv.height = ISO_H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlasCanvas, sx, sy, TILE_PX, TILE_PX, 10, 10, ISO_W - 20, ISO_H - 20);
  const url = cv.toDataURL();
  flatCache.set(id, url);
  return url;
}
export function isoIcon(id) {
  if (isoCache.has(id)) return isoCache.get(id);
  if (!isBlockId(id)) {                    // 物品走平面图标
    const u = flatIcon(id);
    isoCache.set(id, u);
    return u;
  }
  const cv = document.createElement('canvas');
  cv.width = ISO_W; cv.height = ISO_H;
  const ctx = cv.getContext('2d');
  /* 半宽 S / 顶面半高 HY / 起始行 TOP 全部按 TILE_PX 等比放大：
   * 16 像素时代的 15 / 8 / 2 对应到 32 像素就是 31 / 16 / 4。
   * 总高 = TOP + 2*HY + S = 4 + 32 + 31 = 67，正好落在 68 的画布内；
   * 横向 = 2*S = 62，居中于 68。 */
  const S = 31, HX = ISO_W >> 1, HY = 16;
  const TOP = 4;                              // 立方体从第 4 行起画，底面尖角落在最后一行
  blitFace(ctx, tileOfId(id, 'top'), HX, TOP, S, HY, -S, HY);                  // 顶面
  blitFace(ctx, tileOfId(id, 'side'), HX - S, TOP + HY, S, HY, 0, S);          // 左侧（压暗）
  blitFace(ctx, tileOfId(id, 'side'), HX, TOP + HY * 2, S, -HY, 0, S);         // 右侧
  // 侧面压暗，做出立体明暗——直接乘在已有像素上
  const img = ctx.getImageData(0, 0, ISO_W, ISO_H);
  const p = img.data;
  for (let y = 0; y < ISO_H; y++) for (let x = 0; x < ISO_W; x++) {
    const o = (y * ISO_W + x) * 4;
    if (!p[o + 3]) continue;
    const top = y < TOP + HY * 2 && Math.abs(x - HX) <= S;
    const k = top ? 1.0 : (x < HX ? 0.72 : 0.86);
    p[o] = Math.min(255, p[o] * k); p[o + 1] = Math.min(255, p[o + 1] * k); p[o + 2] = Math.min(255, p[o + 2] * k);
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  isoCache.set(id, url);
  return url;
}
