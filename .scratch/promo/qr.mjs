/* 生成宣传页用的二维码（在线试玩地址）。
 *
 * 用 npm 的 qrcode 包直接吐 SVG —— 矢量、无损、体积只有几 KB，
 * 塞进 <img src="media/qr.svg"> 就行，不用 canvas 画。
 *
 * 深色模块 + 白底：多数扫码器对「深底浅码」（反色）识别不稳，
 * 所以做成白底卡片贴在深色页脚上，而不是把二维码本身反过来。
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const req = createRequire(import.meta.url);
const QR = req('qrcode');

const TARGET = 'https://voxel-craft-516.pages.dev/';

const svg = await QR.toString(TARGET, {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#0b0d12', light: '#ffffff' },
});

writeFileSync('public/media/qr.svg', svg);
console.log('public/media/qr.svg 已生成，目标地址:', TARGET);
