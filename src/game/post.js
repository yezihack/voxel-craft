/* 后处理与绘制：泛光、合成、各几何体的上传与绘制 —— 迁移自 voxel-craft.html 第 4629-5480 行 */

import { MODE, dim, handSwing, mode, swingT } from './state.js'
import { BOT_PARTS, botDrops, bots } from './bots.js'
import { ATLAS_PX, D, EYE, MAT_PLAIN, OFF_ALPHA, OFF_FLAG, OFF_LIT, OFF_POS, OFF_UV, QUAD_POS, SEA, STRIDE, UV_QUAD, defColor, isBlockId, tileOfId, tileUV } from './config.js'
import { DIMS } from './dims.js'
import { M4, clamp } from './math.js'
import { FACES } from './mesher.js'
import { MOB_TYPES, arrows, boxGeo, buildMobMesh, dayPhase, mobs, worldTime } from './mobs.js'
import { player } from './player.js'
import { PREC, gl, isGL2, locMain, progMain, program } from './renderer.js'
import { skyQuad } from './sky.js'
import { heldId, hurt } from './survival.js'
import { alctx, atlasCanvas, shade } from './textures.js'

/* ============================== 后处理 ==============================
 * 场景先画进离屏帧缓冲，再经「亮部提取 → 两次可分离高斯 → 合成」贴回屏幕。
 * 串这条链换来三件事：
 *   泛光   —— 岩浆/萤石/日落的亮部会往外洇，暗处才有「真的在发光」的感觉；
 *   调色   —— 高光软压缩 + 暗角 + 轻微加饱和，画面立刻有镜头感；
 *   FXAA  —— 离屏渲染会丢掉 MSAA，用后处理补回来（比 4×MSAA 便宜得多）。
 *
 * ⚠ 一旦走离屏，默认帧缓冲的 antialias 就完全不起作用了 —— 所以 FXAA 不是
 *   可选装饰，是必需品，否则整体观感会比改动前更毛糙。 */
/* 与 SKY_VS 内容一致的「全屏三角形」顶点着色器。
 * 这里**内联一份**而不是 import SKY_VS：post 与 sky 互相引用，
 * 而 POST_VS 是顶层常量，一旦求值顺序反过来就会撞上 TDZ。 */
export const POST_VS = `
${PREC}
attribute vec2 aP;
varying vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 1.0, 1.0); }`;
export const BLUR_FS = `
${PREC}
uniform sampler2D uSrc;
uniform vec2 uTexel, uDir;
uniform float uThresh;           // >0 时先做亮部提取（只用第一趟）
varying vec2 vP;
void main(){
  vec2 o = uTexel * uDir;
  // 5 抽样的可分离高斯：借线性插值一次读两个纹素，等效 9 抽样
  vec3 c  = texture2D(uSrc, vP).rgb * 0.227027;
  c += (texture2D(uSrc, vP + o * 1.3846).rgb + texture2D(uSrc, vP - o * 1.3846).rgb) * 0.316216;
  c += (texture2D(uSrc, vP + o * 3.2308).rgb + texture2D(uSrc, vP - o * 3.2308).rgb) * 0.070270;
  if (uThresh > 0.0) {
    float l = max(max(c.r, c.g), c.b);
    c *= clamp((l - uThresh) / max(l, 1e-4), 0.0, 1.0);   // 只留亮部，暗部整流掉
  }
  gl_FragColor = vec4(c, 1.0);
}`;
export const POST_FS = `
${PREC}
uniform sampler2D uScene, uBloom;
uniform vec2 uTexel;
uniform float uBloomAmt, uVig, uSat, uEdge;
varying vec2 vP;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 uv = vP * 0.5 + 0.5;
  vec3 rgbM = texture2D(uScene, uv).rgb;

  /* ---- FXAA（FXAA 3.11 的控制台精简版）----
   * 先看 3×3 邻域的亮度跨度，平坦区域直接跳过 —— 画面大部分是平面，
   * 这条早退把开销削掉一大半，也让贴图细节原样保留。 */
  vec3 rgbNW = texture2D(uScene, uv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(uScene, uv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(uScene, uv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(uScene, uv + vec2( 1.0,  1.0) * uTexel).rgb;
  float lM = luma(rgbM), lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 col = rgbM;
  if (lMax - lMin > uEdge) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
    vec3 rgbA = 0.5 * (texture2D(uScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb
                     + texture2D(uScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(uScene, uv + dir * -0.5).rgb
                                   + texture2D(uScene, uv + dir *  0.5).rgb);
    float lB = luma(rgbB);
    col = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }

  col += texture2D(uBloom, uv).rgb * uBloomAmt;

  /* 高光软压缩：**只压 0.80 以上**，中间调一像素不动。
   * 用完整 ACES 曲线会把已经调好的手绘色板整体压暗、变灰 —— 那套色板本来就是
   * 按「直接输出」配的，这里只需要给泛光留出不过曝的余量。 */
  vec3 over = max(col - 0.80, 0.0);
  col -= over * over / (over + 0.35);

  float l = luma(col);
  col = mix(vec3(l), col, uSat);                  // 轻微加饱和，抵消压缩带来的发灰

  vec2 q = uv - 0.5;
  col *= 1.0 - uVig * dot(q, q) * 1.35;           // 暗角
  gl_FragColor = vec4(col, 1.0);
}`;
export const progBlur = program(POST_VS, BLUR_FS);
export const locBlur = {
  aP: gl.getAttribLocation(progBlur, 'aP'),
  uSrc: gl.getUniformLocation(progBlur, 'uSrc'),
  uTexel: gl.getUniformLocation(progBlur, 'uTexel'),
  uDir: gl.getUniformLocation(progBlur, 'uDir'),
  uThresh: gl.getUniformLocation(progBlur, 'uThresh'),
};
export const progPost = program(POST_VS, POST_FS);
export const locPost = {
  aP: gl.getAttribLocation(progPost, 'aP'),
  uScene: gl.getUniformLocation(progPost, 'uScene'),
  uBloom: gl.getUniformLocation(progPost, 'uBloom'),
  uTexel: gl.getUniformLocation(progPost, 'uTexel'),
  uBloomAmt: gl.getUniformLocation(progPost, 'uBloomAmt'),
  uVig: gl.getUniformLocation(progPost, 'uVig'),
  uSat: gl.getUniformLocation(progPost, 'uSat'),
  uEdge: gl.getUniformLocation(progPost, 'uEdge'),
};

export const BLOOM_DIV = 4;                       // 泛光在 1/4 分辨率上算 —— 糊的东西不需要清晰
export let postOK = false;                        // 帧缓冲建不起来时自动退回直出，别让整屏黑掉
export let sceneTex = null, sceneDepth = null, sceneFbo = null;
export let bloomTex = [null, null], bloomFbo = [null, null];
export let fbW = 0, fbH = 0;

export function mkColorTex(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
/* 尺寸变了就重建。**每次都重新 createTexture**（而不是只 texImage2D 改尺寸）：
 * 某些驱动上给已附加到 FBO 的纹理改尺寸会留下未定义状态，
 * 反正只在 resize 时发生，重建的代价可以忽略。 */
export function ensureFbos(w, h) {
  if (w < 2 || h < 2) return;
  if (sceneTex && w === fbW && h === fbH) return;
  /* ⚠ 深度附件是 **renderbuffer**，必须用 deleteRenderbuffer ——
   * 混进 deleteTexture 会抛 TypeError，而且是在 resize 里抛的，
   * 直接把这一帧的渲染打断（画面停住、下次 resize 又炸一遍）。 */
  for (const t of [sceneTex, bloomTex[0], bloomTex[1]]) if (t) gl.deleteTexture(t);
  if (sceneDepth) gl.deleteRenderbuffer(sceneDepth);
  for (const f of [sceneFbo, bloomFbo[0], bloomFbo[1]]) if (f) gl.deleteFramebuffer(f);
  fbW = w; fbH = h;
  postOK = false;

  sceneTex = mkColorTex(w, h);
  sceneFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  sceneDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return;                                // 保持 postOK=false，退回直出
  }

  const bw = Math.max(2, w / BLOOM_DIV | 0), bh = Math.max(2, h / BLOOM_DIV | 0);
  for (let i = 0; i < 2; i++) {
    bloomTex[i] = mkColorTex(bw, bh);
    bloomFbo[i] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[i]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTex[i], 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  postOK = true;
}

/* 全屏三角形一趟。调用方负责 useProgram / 绑纹理 / 设 viewport。 */
export function drawFullscreenQuad(prog, aLoc) {
  gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/* 把一个纹理画回正在绑定的目标（FBO 或屏幕） */
export function blit(tex, dstFbo, dstW, dstH) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
  gl.viewport(0, 0, dstW, dstH);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(locBlur.uSrc, 0);
  gl.uniform2f(locBlur.uTexel, 1 / dstW, 1 / dstH);
  drawFullscreenQuad(progBlur, locBlur.aP);
}

/* 泛光：亮部提取 → 横向模糊 → 纵向模糊。结果留在 bloomTex[1]。 */
export function runBloom(w, h) {
  const bw = Math.max(2, w / BLOOM_DIV | 0), bh = Math.max(2, h / BLOOM_DIV | 0);
  gl.useProgram(progBlur);
  gl.uniform1f(locBlur.uThresh, 0.78);
  gl.uniform2f(locBlur.uDir, 1, 0);
  blit(sceneTex, bloomFbo[0], bw, bh);
  gl.uniform1f(locBlur.uThresh, 0.0);
  gl.uniform2f(locBlur.uDir, 0, 1);
  gl.uniform2f(locBlur.uTexel, 1 / bw, 1 / bh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[1]);
  gl.viewport(0, 0, bw, bh);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, bloomTex[0]);
  gl.uniform1i(locBlur.uSrc, 0);
  drawFullscreenQuad(progBlur, locBlur.aP);
}

/* 合成到屏幕 */
export function composite(w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(progPost);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.uniform1i(locPost.uScene, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, bloomTex[1]);
  gl.uniform1i(locPost.uBloom, 1);
  gl.uniform2f(locPost.uTexel, 1 / w, 1 / h);
  gl.uniform1f(locPost.uBloomAmt, 0.55);
  gl.uniform1f(locPost.uVig, 0.34);
  gl.uniform1f(locPost.uSat, 1.07);
  gl.uniform1f(locPost.uEdge, 0.055);
  drawFullscreenQuad(progPost, locPost.aP);
  gl.activeTexture(gl.TEXTURE0);
}

/* 线框立方体（12 条边） */
export const lineBuf = gl.createBuffer();
export const LINE_VERTS = (() => {
  const a = [];
  const e = [[0,0,0,1,0,0],[1,0,0,1,0,1],[1,0,1,0,0,1],[0,0,1,0,0,0],
             [0,1,0,1,1,0],[1,1,0,1,1,1],[1,1,1,0,1,1],[0,1,1,0,1,0],
             [0,0,0,0,1,0],[1,0,0,1,1,0],[1,0,1,1,1,1],[0,0,1,0,1,1]];
  for (const s of e) a.push(s[0],s[1],s[2], s[3],s[4],s[5]);
  return new Float32Array(a);
})();
gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
gl.bufferData(gl.ARRAY_BUFFER, LINE_VERTS, gl.STATIC_DRAW);

/* ---------------- 天空 / 太阳 / 环境光 ----------------
 * 每帧由 dayPhase() 推一次，推出来的五个量各管一摊：
 *   SKY        （取地平色）→ clearColor 与 uFog，地形才能融进天际线
 *   SKY_TOP    → 天穹顶部的蓝
 *   SKY_GROUND → 视线朝下时的暗部（云海下方那种压暗）
 *   SUN_DIR    → 太阳/月亮的方向，天穹里的圆盘与云的高光都靠它
 *   AMBIENT    → 全局明暗（夜晚压到 0.52），让地形真的会「入夜」
 * 以前只有一个 SKY 常量，白天黑夜只有背景色在变，地面永远是正午亮度 ——
 * 那是「天空在演，世界在装没看见」。 */
export const SKY_DAY   = { top: [0.24, 0.49, 0.90], hor: [0.66, 0.82, 0.97], gnd: [0.42, 0.46, 0.52] };
export const SKY_DUSK  = { top: [0.19, 0.21, 0.43], hor: [0.97, 0.52, 0.24], gnd: [0.30, 0.24, 0.27] };
export const SKY_NIGHT = { top: [0.012, 0.022, 0.080], hor: [0.050, 0.070, 0.160], gnd: [0.028, 0.032, 0.055] };
export const SKY = SKY_DAY.hor.slice();
export const SKY_TOP = SKY_DAY.top.slice();
export const SKY_GROUND = SKY_DAY.gnd.slice();
export const SUN_DIR = [0, 1, 0];
export const SUN_COL = [1, 1, 1];
export const CLOUD_TINT = [1, 1, 1];
export let AMBIENT = 1, NIGHT = 0, CLOUD_AMT = 1;
export let FOG_NEAR = 40, FOG_FAR = 100;
/* 起雾高度。主世界是「海面上方一点点」（SEA+4），但异界各不相同：
 * 熔火深渊要从岩浆面起、虚空群岛几乎不该有高度衰减（脚下是云海不是地面）。
 * 原来是渲染段里的硬编码，现在由维度档案逐帧写。 */
export let FOG_HEIGHT = SEA + 4;

/* 送给着色器的动画时间要**取模**。worldTime 是一直累加的，挂机几小时后能到十几万：
 *   · 顶点摇曳里算 sin(uTime * 1.7)，几万弧度下 highp float 也只剩不到 0.01 弧度
 *     的分辨率，树叶会从「摆动」退化成「一格一格地跳」；
 *   · 云的 UV 是 uTime * 0.0045 直接当地图坐标用，数值越大越容易看出抖动。
 * 取个能把两个周期都盖住的模数（云的漂移一个周期内也走不满一个来回），
 * 跳变发生时相位差极小，肉眼看不出来。 */
export const SHADER_T = () => worldTime % 3600;

export const mixSky = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const put3 = (dst, c) => { dst[0] = c[0]; dst[1] = c[1]; dst[2] = c[2]; };

export function updateSkyColor() {
  const t = dayPhase();
  const D = DIMS[dim];

  /* 雾与雾高：每个维度一套（主世界是 40/100/SEA+4，与加维度之前逐字相同）。 */
  FOG_NEAR = D.fog[0]; FOG_FAR = D.fog[1]; FOG_HEIGHT = D.fog[2];

  /* ---- 异界天穹：固定调色板 ----
   *   skyNight === null   → 永远白天（炙沙之境 / 天空花园）
   *   fixedNight === true → 永远夜/常暗（熔火 / 虚空 / 霜寂 / 晶簇）
   *   其余                 → 昼夜插值（腐化沼泽，唯一保留昼夜的异界）
   * 「夜」的程度沿用主世界那条曲线（clamp(-sy*2.4, 0, 1)），
   * 只是把它当插值因子用 —— 两个世界的「什么时候天黑」才是同一个手感。 */
  if (D.skyDay) {
    const ph = (t - 0.25) * Math.PI * 2;
    const sy = Math.cos(ph), sinp = Math.sin(ph), sz = 0.34;
    const L = Math.hypot(sinp, sy, sz) || 1;
    const k = clamp(-sy * 2.4, 0, 1);
    let pal, night;
    if (D.skyNight === null) { pal = D.skyDay; night = 0; }
    else if (D.fixedNight) { pal = D.skyNight; night = 1; }
    else {
      pal = { top: mixSky(D.skyDay.top, D.skyNight.top, k),
              hor: mixSky(D.skyDay.hor, D.skyNight.hor, k),
              gnd: mixSky(D.skyDay.gnd, D.skyNight.gnd, k) };
      night = k;
    }
    put3(SKY_TOP, pal.top); put3(SKY, pal.hor); put3(SKY_GROUND, pal.gnd);

    /* 太阳/月亮方向：常暗维度把太阳压到地平线以下（天穹里就不出现圆盘，
     * 只剩星空）；永昼维度钉在正午。 */
    if (D.skyNight === null)      { SUN_DIR[0] = 0; SUN_DIR[1] = 1; SUN_DIR[2] = 0; }
    else if (D.fixedNight)        { SUN_DIR[0] = sinp / L; SUN_DIR[1] = -Math.abs(sy) / L - 0.15; SUN_DIR[2] = sz / L; }
    else                          { SUN_DIR[0] = sinp / L; SUN_DIR[1] = sy / L; SUN_DIR[2] = sz / L; }

    put3(SUN_COL, [1.0, 0.74, 0.50]);          // 异界的太阳一律更暖更暗
    AMBIENT = D.ambient === null ? clamp(0.52 + 0.56 * SUN_DIR[1], 0.52, 1.06) : D.ambient;
    NIGHT = night;
    const dayK = D.skyNight === null ? 1 : (D.fixedNight ? 0.20 : clamp(SUN_DIR[1] * 2.2 + 0.30, 0, 1));
    put3(CLOUD_TINT, mixSky([0.16, 0.18, 0.26], mixSky(pal.hor, [1, 1, 0.99], 0.55), dayK));
    CLOUD_AMT = (D.gen === 'crystal' ? 0 : 0.30) + 0.45 * dayK;
    return;
  }

  /* ---- 主世界：原逻辑，逐字未动 ---- */
  let pal;
  if (t < 0.10) pal = { top: mixSky(SKY_NIGHT.top, SKY_DAY.top, t / 0.10),
                        hor: mixSky(SKY_NIGHT.hor, SKY_DAY.hor, t / 0.10),
                        gnd: mixSky(SKY_NIGHT.gnd, SKY_DAY.gnd, t / 0.10) };  // 破晓
  else if (t < 0.42) pal = SKY_DAY;                                          // 白天
  else if (t < 0.56) {                                                       // 黄昏
    const k = (t - 0.42) / 0.14;
    pal = { top: mixSky(SKY_DAY.top, SKY_DUSK.top, k), hor: mixSky(SKY_DAY.hor, SKY_DUSK.hor, k),
            gnd: mixSky(SKY_DAY.gnd, SKY_DUSK.gnd, k) };
  } else if (t < 0.68) {                                                     // 入夜
    const k = (t - 0.56) / 0.12;
    pal = { top: mixSky(SKY_DUSK.top, SKY_NIGHT.top, k), hor: mixSky(SKY_DUSK.hor, SKY_NIGHT.hor, k),
            gnd: mixSky(SKY_DUSK.gnd, SKY_NIGHT.gnd, k) };
  } else if (t < 0.94) pal = SKY_NIGHT;                                      // 深夜
  else {                                                                     // 黎明
    const k = (t - 0.94) / 0.06;
    pal = { top: mixSky(SKY_NIGHT.top, SKY_DAY.top, k), hor: mixSky(SKY_NIGHT.hor, SKY_DAY.hor, k),
            gnd: mixSky(SKY_NIGHT.gnd, SKY_DAY.gnd, k) };
  }
  put3(SKY_TOP, pal.top); put3(SKY, pal.hor); put3(SKY_GROUND, pal.gnd);

  /* 太阳按天球走：t=0.25 正午在头顶，0.5 落到地平（+x，西沉），
   * 0.75 在地底，0.0 从另一侧（-x）升起。z 给一点倾角，免得太阳永远走正头顶。 */
  const ph = (t - 0.25) * Math.PI * 2;
  const sx = Math.sin(ph), sy = Math.cos(ph), sz = 0.34;
  const L = Math.hypot(sx, sy, sz) || 1;
  SUN_DIR[0] = sx / L; SUN_DIR[1] = sy / L; SUN_DIR[2] = sz / L;

  // 太阳越低越暖越红（接近地平线时的红光），正午接近白色
  const up = clamp(SUN_DIR[1], 0, 1);
  SUN_COL[0] = 1.0;
  SUN_COL[1] = 0.80 + 0.17 * up;
  SUN_COL[2] = 0.52 + 0.44 * up;

  // 环境光：太阳在地平线下时压到 0.52（暗但还看得清路），正午略高于 1
  AMBIENT = clamp(0.52 + 0.56 * SUN_DIR[1], 0.52, 1.06);
  NIGHT = clamp(-SUN_DIR[1] * 2.4, 0, 1);

  // 云：白天被染成地平色的补色偏白，夜里压成暗蓝灰；夜里也少一点
  const dayK = clamp(SUN_DIR[1] * 2.2 + 0.30, 0, 1);
  put3(CLOUD_TINT, mixSky([0.16, 0.18, 0.26], mixSky(pal.hor, [1, 1, 0.99], 0.55), dayK));
  CLOUD_AMT = 0.55 + 0.45 * dayK;
}

/* 贴图集纹理。
 *
 * 放大（贴脸看方块）用 NEAREST —— 像素画的锐利边缘是刻意保留的，
 * 换成线性会把方块糊成一团。缩小（远处方块）则必须走 mipmap：
 * 只用 NEAREST 时远处每个像素都在几个纹素间随机跳，成片的地面会疯狂闪烁
 * （这是之前最显眼的画质问题）。
 *
 * 为什么可以放心给贴图集开 mipmap —— 一般图集开 mipmap 会在格子边界串色，
 * 因为低分辨率层是「整图缩一半」，相邻格子被平均进同一个纹素。本文件不会：
 * 格子边长 TILE_PX 是 2 的幂，512→256→…→1 的每一次整图对折，
 * 格子边界（32 的倍数）永远落在偶数坐标上，所以「整图 2×2 取平均」
 * 与「每格各自 2×2 取平均」是**逐像素等价**的 —— 金字塔每层都保持了格子整齐，
 * 一格的水不会渗进隔壁的沙。 */
export const atlasTex = gl.createTexture();
export let atlasMipLevels = 0;
/* 逐层 2×2 平均，返回 ImageData 数组（不含第 0 层） */
export function buildMipChain() {
  const chain = [];
  let w = ATLAS_PX, h = ATLAS_PX;
  let src = alctx.getImageData(0, 0, w, h);
  while (w > 1 && h > 1) {
    const nw = w >> 1, nh = h >> 1;
    const dst = alctx.createImageData(nw, nh);   // 借用同一个 2D 上下文来分配
    const s = src.data, d = dst.data;
    for (let y = 0; y < nh; y++) {
      const r0 = (y * 2) * w, r1 = (y * 2 + 1) * w, ro = y * nw;
      for (let x = 0; x < nw; x++) {
        const a = (r0 + x * 2) * 4, b = (r0 + x * 2 + 1) * 4;
        const c = (r1 + x * 2) * 4, e = (r1 + x * 2 + 1) * 4;
        const o = (ro + x) * 4;
        /* 按 alpha **预乘**再平均，最后除回去。
         * 直接平均非预乘 RGBA 的话，树叶镂空处的 (0,0,0,0) 会把邻接的不透明
         * 叶子像素往黑色拉 —— 远处树冠会挂一圈黑边。 */
        const sa = s[a + 3] + s[b + 3] + s[c + 3] + s[e + 3];
        const sr = s[a] * s[a + 3] + s[b] * s[b + 3] + s[c] * s[c + 3] + s[e] * s[e + 3];
        const sg = s[a + 1] * s[a + 3] + s[b + 1] * s[b + 3] + s[c + 1] * s[c + 3] + s[e + 1] * s[e + 3];
        const sb = s[a + 2] * s[a + 3] + s[b + 2] * s[b + 3] + s[c + 2] * s[c + 3] + s[e + 2] * s[e + 3];
        const oa = sa >> 2;
        d[o + 3] = oa;
        if (oa > 0) {
          d[o]     = Math.min(255, Math.round(sr / 4 / oa));
          d[o + 1] = Math.min(255, Math.round(sg / 4 / oa));
          d[o + 2] = Math.min(255, Math.round(sb / 4 / oa));
        }
      }
    }
    chain.push(dst);
    src = dst; w = nw; h = nh;
  }
  return chain;
}
export function uploadAtlas() {
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  const chain = buildMipChain();
  for (let l = 1; l <= chain.length; l++) {
    const im = chain[l - 1];
    gl.texImage2D(gl.TEXTURE_2D, l, gl.RGBA, im.width, im.height, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, im);
  }
  atlasMipLevels = 1 + chain.length;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  /* 各向异性过滤：地面几乎是「贴地斜看」的，各向异性差极大，
   * 只靠 mipmap 会把远处地面糊成一片（因为它按最差的那个方向选层）。
   * 开 8× 后远处的地砖/草纹能一直保持清晰，成本几乎为零。 */
  const ext = gl.getExtension('EXT_texture_filter_anisotropic')
           || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  if (ext) {
    const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
    gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
}

/* 上传几何到 GPU。
 * 同一个顶点缓冲里前半段是不透明面、后半段是半透明面（玻璃/水/冰/岩浆），
 * 由 opaCount 记下分界点 —— 渲染时先画完所有区块的不透明部分，
 * 再统一画半透明部分，否则隔着水看后面的地形会缺一块。 */
/* STRIDE / OFF_* 定义在「常量配置」段（网格构建与渲染共享的契约，测试要验）。 */
export function uploadChunk(c, data) {
  if (!c.vbo) {
    c.vbo = gl.createBuffer();
    c.ibo = gl.createBuffer();
    c.vao = isGL2 ? gl.createVertexArray() : null;
  }
  const n = data.pos.length / 3;
  const inter = new Float32Array(n * STRIDE);
  for (let i = 0, o = 0; i < n; i++) {
    inter[o++] = data.pos[i * 3];
    inter[o++] = data.pos[i * 3 + 1];
    inter[o++] = data.pos[i * 3 + 2];
    inter[o++] = data.uv[i * 2];
    inter[o++] = data.uv[i * 2 + 1];
    inter[o++] = data.lit[i];
    inter[o++] = data.alp[i];
    inter[o++] = data.flag[i];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, inter, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
  const iboData = isGL2 ? data.idx : new Uint16Array(data.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iboData, gl.DYNAMIC_DRAW);
  c.count = data.idx.length;
  c.opaCount = data.opaCount;               // 不透明段的索引数
  c.dirty = false;
  c.built = true;
}

/* 顶点属性接线。区块 / 生物 / 手持 / 箭四种网格共用同一套交错布局，
 * 所以这里只写一遍 —— 以前是四处复制粘贴，加一个属性要改四个地方，
 * 漏一处就是「字段错位、画面诡异但不报错」，代价太大。 */
export function bindLayout(vbo, ibo) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const bs = STRIDE * 4;
  gl.enableVertexAttribArray(locMain.aPos);
  gl.vertexAttribPointer(locMain.aPos, 3, gl.FLOAT, false, bs, OFF_POS);
  gl.enableVertexAttribArray(locMain.aUV);
  gl.vertexAttribPointer(locMain.aUV, 2, gl.FLOAT, false, bs, OFF_UV);
  gl.enableVertexAttribArray(locMain.aLit);
  gl.vertexAttribPointer(locMain.aLit, 1, gl.FLOAT, false, bs, OFF_LIT);
  gl.enableVertexAttribArray(locMain.aAlpha);
  gl.vertexAttribPointer(locMain.aAlpha, 1, gl.FLOAT, false, bs, OFF_ALPHA);
  gl.enableVertexAttribArray(locMain.aFlag);
  gl.vertexAttribPointer(locMain.aFlag, 1, gl.FLOAT, false, bs, OFF_FLAG);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
}
/* 绑定一个区块的顶点属性 */
export function bindChunk(c) { bindLayout(c.vbo, c.ibo); }
/* 只画不透明段 */
export function drawChunkOpaque(c) {
  if (!c.count || !c.vbo || !c.opaCount) return;
  bindChunk(c);
  gl.drawElements(gl.TRIANGLES, c.opaCount, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
}
/* 只画半透明段 */
export function drawChunkBlend(c) {
  const n = c.count - c.opaCount;
  if (!c.count || !c.vbo || n <= 0) return;
  bindChunk(c);
  const off = c.opaCount * (isGL2 ? 4 : 2);
  gl.drawElements(gl.TRIANGLES, n, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, off);
}

/* ---------------- 生物的 GPU 资源 ----------------
 * 每种生物只上传一次（静态），绘制时靠 uModel 摆位置，不重建缓冲。 */
export const mobGpu = {};
export function uploadMobMeshes() {
  for (const t in MOB_TYPES) {
    const data = buildMobMesh(t);
    if (!data) continue;
    const n = data.pos.length / 3;
    const inter = new Float32Array(n * STRIDE);
    for (let i = 0, o = 0; i < n; i++) {
      inter[o++] = data.pos[i * 3]; inter[o++] = data.pos[i * 3 + 1]; inter[o++] = data.pos[i * 3 + 2];
      inter[o++] = data.uv[i * 2]; inter[o++] = data.uv[i * 2 + 1];
      inter[o++] = data.lit[i];
      inter[o++] = data.alp[i];
      inter[o++] = data.flag[i];
    }
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, isGL2 ? data.idx : new Uint16Array(data.idx), gl.STATIC_DRAW);
    mobGpu[t] = { vbo, ibo, parts: data.parts };
  }
}
export function bindMob(g) { bindLayout(g.vbo, g.ibo); }

export function drawMobs(cam) {
  if (!mobs.length) return;
  const uT = locMain.uTint;
  for (const m of mobs) {
    const g = mobGpu[m.type];
    if (!g) continue;
    const dx = m.x - player.x, dz = m.z - player.z;
    if (dx * dx + dz * dz > 52 * 52) continue;         // 太远不画
    const D = MOB_TYPES[m.type];
    const base = M4.mul(M4.trans(m.x, m.y, m.z), M4.rotY(m.yaw));
    const moving = Math.min(1, Math.hypot(m.vx, m.vz) / (D.speed || 1));
    const hurt = m.hurtFlash > 0;
    gl.uniform3f(uT, hurt ? 2.0 : 1, hurt ? 0.55 : 1, hurt ? 0.55 : 1);
    bindMob(g);
    for (const p of g.parts) {
      let model = base;
      if (p.leg && moving > 0.02) {
        const a = Math.sin(m.animT * 7 + (p.phase > 0 ? 0 : Math.PI)) * 0.6 * moving;
        model = M4.mul(base, M4.about(p.pivot, M4.rotX(a)));
      } else if (p.arm) {
        /* 挥击：atkT 从冷却值一路减到 0。归一化到 [0,1] 后取半周期正弦，
         * 手臂就是「抬起 → 砸下」一个来回。1.1 是近战冷却，雪傀儡的冷却更长，
         * 同一个式子会让它的动作慢半拍 —— 正好，扔东西本来就该有个预备动作。 */
        const ph = 1 - Math.max(0, Math.min(1, (m.atkT || 0) / 1.1));
        model = M4.mul(base, M4.about(p.pivot, M4.rotX(-Math.sin(ph * Math.PI) * 1.15)));
      }
      gl.uniformMatrix4fv(locMain.uModel, false, model);
      gl.drawElements(gl.TRIANGLES, p.count, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, p.start * (isGL2 ? 4 : 2));
    }
  }
  gl.uniform3f(uT, 1, 1, 1);
  gl.uniformMatrix4fv(locMain.uModel, false, M4.ident());
}

/* ---------------- AI 玩家的 GPU 资源 ----------------
 * **所有 AI 玩家共用一份网格**（BOT_PARTS），每个人的颜色靠逐部件 uTint 相乘。
 * 这是本段唯一一处和 drawMobs 结构不同的地方：drawMobs 一次 draw 前只设一次
 * tint（受伤泛红），而 AI 玩家一个模型里有肤色/上衣/裤子/头发四种色，
 * 所以 tint 必须**在每个部件前重设**。 */
export let botGpu = null;
export function uploadBotMesh() {
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [], parts = [];
  for (const p of BOT_PARTS) {
    const vBase = pos.length / 3, iBase = idx.length;
    boxGeo(pos, uv, lit, alp, flag, p.box, p.at, p.tex);
    for (let f = 0; f < 6; f++) {
      const b = vBase + f * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    parts.push({
      start: iBase, count: idx.length - iBase,
      pivot: [p.at[0], p.at[1] + p.box[1] / 2, p.at[2]],
      leg: p.leg || 0, phase: (p.leg || 0) % 2 ? 1 : -1,
      arm: p.arm || 0, tint: p.tint,
    });
  }
  const n = pos.length / 3;
  const inter = new Float32Array(n * STRIDE);
  for (let i = 0, o = 0; i < n; i++) {
    inter[o++] = pos[i * 3]; inter[o++] = pos[i * 3 + 1]; inter[o++] = pos[i * 3 + 2];
    inter[o++] = uv[i * 2]; inter[o++] = uv[i * 2 + 1];
    inter[o++] = lit[i]; inter[o++] = alp[i]; inter[o++] = flag[i];
  }
  const vbo = gl.createBuffer(), ibo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
  botGpu = { vbo, ibo, parts };
}

export function drawBots(cam) {
  if (!botGpu || !bots.length) return;
  const uT = locMain.uTint;
  bindLayout(botGpu.vbo, botGpu.ibo);
  for (const b of bots) {
    const dx = b.x - player.x, dz = b.z - player.z;
    if (dx * dx + dz * dz > 52 * 52) continue;
    const base = M4.mul(M4.trans(b.x, b.y, b.z), M4.rotY(b.yaw));
    const moving = Math.min(1, Math.hypot(b.vx, b.vz) / 2.6);
    const hurt = b.hurtFlash > 0;
    /* 挥击/挖矿时手臂抬起：和生物同一个式子，只是时间源换成了 b.swingT
     * （AI 没有 atkT 冷却语义，swingT 是「挥了一下」的 0.28s 倒计时）。 */
    const ph = b.swingT > 0 ? Math.sin((b.swingT / 0.32) * Math.PI) : 0;
    for (const p of botGpu.parts) {
      let model = base;
      if (p.leg && moving > 0.02) {
        const a = Math.sin(b.animT * 7 + (p.phase > 0 ? 0 : Math.PI)) * 0.6 * moving;
        model = M4.mul(base, M4.about(p.pivot, M4.rotX(a)));
      } else if (p.arm && ph > 0.01) {
        model = M4.mul(base, M4.about(p.pivot, M4.rotX(-ph * 1.15)));
      }
      const t = b.col[p.tint] || [1, 1, 1];
      /* 受伤泛红是**乘**在配色上的：tint 变成 (t*2, t*0.55, t*0.55)，
       * 而不是在 (1,1,1) 基准上推红 —— 否则受伤时连衣服颜色都飞了。 */
      gl.uniform3f(uT, hurt ? t[0] * 2.0 : t[0], hurt ? t[1] * 0.55 : t[1], hurt ? t[2] * 0.55 : t[2]);
      gl.uniformMatrix4fv(locMain.uModel, false, model);
      gl.drawElements(gl.TRIANGLES, p.count, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, p.start * (isGL2 ? 4 : 2));
    }
  }
  gl.uniform3f(uT, 1, 1, 1);
  gl.uniformMatrix4fv(locMain.uModel, false, M4.ident());
}

/* ---------------- 地面掉落物（小方块 + 染色）----------------
 * 直接复用 chunk 那套 drawLineBox 风格的线框太丑，所以给掉落物也用 uModel：
 * 一份「小方块」网格（单位立方，缩放到 0.28），颜色走 uTint。
 * 缩放靠 M4.scale —— 与其另写一个网格，不如复用单位盒 + 矩阵缩放。 */
export let dropGpu = null;
export function uploadDropMesh() {
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [];
  boxGeo(pos, uv, lit, alp, flag, [1, 1, 1], [0, 0, 0], 'bot_skin');
  for (let f = 0; f < 6; f++) { const b = f * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const n = pos.length / 3;
  const inter = new Float32Array(n * STRIDE);
  for (let i = 0, o = 0; i < n; i++) {
    inter[o++] = pos[i * 3]; inter[o++] = pos[i * 3 + 1]; inter[o++] = pos[i * 3 + 2];
    inter[o++] = uv[i * 2]; inter[o++] = uv[i * 2 + 1];
    inter[o++] = lit[i]; inter[o++] = alp[i]; inter[o++] = flag[i];
  }
  const vbo = gl.createBuffer(), ibo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
  dropGpu = { vbo, ibo, count: idx.length };
}
export function drawBotDrops() {
  if (!dropGpu || !botDrops.length) return;
  bindLayout(dropGpu.vbo, dropGpu.ibo);
  const uT = locMain.uTint;
  const S = 0.28;
  for (const d of botDrops) {
    const dx = d.x - player.x, dz = d.z - player.z;
    if (dx * dx + dz * dz > 40 * 40) continue;
    const bob = Math.sin(d.spin * 2) * 0.06;
    const c = defColor(d.id);
    /* 数量越多越大一点：一堆 20 块和一格煤块的视觉重量不该一样 */
    const s = S * (1 + Math.min(0.6, Math.log2(1 + d.n) * 0.18));
    const model = M4.mul(M4.trans(d.x, d.y + bob, d.z), M4.rotY(d.spin));
    const sm = new Float32Array(16);
    for (let i = 0; i < 16; i++) sm[i] = model[i];
    sm[0] *= s; sm[5] *= s; sm[10] *= s;
    gl.uniform3f(uT, c[0] / 255 * 1.5 + 0.25, c[1] / 255 * 1.5 + 0.25, c[2] / 255 * 1.5 + 0.25);
    gl.uniformMatrix4fv(locMain.uModel, false, sm);
    gl.drawElements(gl.TRIANGLES, dropGpu.count, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }
  gl.uniform3f(uT, 1, 1, 1);
  gl.uniformMatrix4fv(locMain.uModel, false, M4.ident());
}

/* ---------------- 飞行中的投掷物 ----------------
 * 箭是一根细长方杆、雪球是一个小方块，都用 uModel 摆成飞行姿态（+z 是箭尖）。 */
export let arrowGpu = null, ballGpu = null;
/* 把 pos/uv/lit/alp/flag/idx 六份数组交错打包上传 —— 箭与雪球共用这一处。 */
export function gpuFromArrays(pos, uv, lit, alp, flag, idx) {
  const n = pos.length / 3;
  const inter = new Float32Array(n * STRIDE);
  for (let i = 0, o = 0; i < n; i++) {
    inter[o++] = pos[i * 3]; inter[o++] = pos[i * 3 + 1]; inter[o++] = pos[i * 3 + 2];
    inter[o++] = uv[i * 2];  inter[o++] = uv[i * 2 + 1];
    inter[o++] = lit[i];     inter[o++] = alp[i];
    inter[o++] = flag[i];
  }
  const vbo = gl.createBuffer(), ibo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  /* ⚠ 必须转成定型数组：bufferData 只吃 ArrayBufferView，
   * 传普通 Array 时 WebGL2 既不报错也建不出缓冲（IBO 长度为 0），
   * 之后 drawElements 报 INVALID_OPERATION 而屏幕上一个像素都没有。 */
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, isGL2 ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
  return { vbo, ibo, count: idx.length };
}
export function buildArrowGpu() {
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [];
  boxGeo(pos, uv, lit, alp, flag, [0.07, 0.07, 0.56], [0, 0, 0], 'item_arrow');
  for (let f = 0; f < 6; f++) { const b = f * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return (arrowGpu = gpuFromArrays(pos, uv, lit, alp, flag, idx));
}
/* 雪傀儡扔的雪球：一个 0.24 的小方块，用雪块贴图。 */
export function buildBallGpu() {
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [];
  boxGeo(pos, uv, lit, alp, flag, [0.24, 0.24, 0.24], [0, 0, 0], 'snow');
  for (let f = 0; f < 6; f++) { const b = f * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return (ballGpu = gpuFromArrays(pos, uv, lit, alp, flag, idx));
}
export function drawArrows() {
  if (!arrows.length) return;
  const gA = arrowGpu || buildArrowGpu();
  const gS = ballGpu || buildBallGpu();
  gl.uniform1f(locMain.uCutout, 1);
  gl.uniform3f(locMain.uTint, 1, 1, 1);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  for (const a of arrows) {
    const g = a.snow ? gS : gA;
    /* 骷髅的箭染一层红：满屏幕箭矢飞舞时，敌我弹药必须一眼可分 */
    gl.uniform3f(locMain.uTint, a.foe ? 1.45 : 1, a.foe ? 0.62 : 1, a.foe ? 0.62 : 1);
    bindHand(g);                                   // interleaved 布局和生物/手持完全一样
    const sp = Math.hypot(a.vx, a.vy, a.vz) || 1;
    let m = M4.mul(M4.trans(a.x, a.y, a.z), M4.rotY(Math.atan2(a.vx, a.vz)));
    /* 雪球是球，不需要顺着速度俯仰；只有箭要摆出「尖朝前」的姿态。 */
    if (!a.snow) m = M4.mul(m, M4.rotX(Math.asin(clamp(a.vy / sp, -1, 1))));
    gl.uniformMatrix4fv(locMain.uModel, false, m);
    gl.drawElements(gl.TRIANGLES, g.count, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }
  gl.uniformMatrix4fv(locMain.uModel, false, M4.ident());
}

/* ---------------- 第一人称手持显示 ----------------
 * 和地形/生物不同，手上这件东西是画在**视图空间**里的：
 * uView 传单位矩阵、uModel 直接把模型摆在镜头右下方，画之前再清一次深度缓冲，
 * 于是它永远压在地形之上、也不会被墙“挡掉”——这正是《我的世界》的做法。
 * （雾必须一起关掉：视图空间里模型坐标很小，而 uCam 是世界坐标，
 *   vDist 会算成「镜头到原点的世界距离」，整只手直接糊成天空色。）
 *
 * 方块画成小立方体（六面各取顶/侧/底贴图），工具/武器/物品画成朝镜头的薄片，
 * 和背包里用的是同一张贴图，前后观感一致。 */
export const handGpu = {};
export function handMeshData(id) {
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [];
  if (isBlockId(id)) {
    const faceTiles = [
      tileOfId(id, 'side'), tileOfId(id, 'side'),
      tileOfId(id, 'top'),  tileOfId(id, 'bot'),
      tileOfId(id, 'side'), tileOfId(id, 'side'),
    ];
    /* 手里拿着水/岩浆方块时也让它动起来 —— 但手上物画在**视图空间**，
     * 世界坐标是跟着相机跑的，所以直接给 0：水/岩浆用世界坐标算波形，
     * 若按视图坐标算，手一动水面就会“抖”。这里让它们静止，观感更稳。 */
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], tile = faceTiles[f], vB = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        const v = F.v[k];
        pos.push(v[0] - 0.5, v[1] - 0.5, v[2] - 0.5);
        const t = tileUV(tile, UV_QUAD[k][0], UV_QUAD[k][1]);
        uv.push(t[0], t[1]); lit.push(F.shade); alp.push(1); flag.push(MAT_PLAIN);
      }
      idx.push(vB, vB + 1, vB + 2, vB, vB + 2, vB + 3);
    }
  } else {
    // 薄片：+z 面朝镜头（视图空间里 +z 指向眼睛）
    const tile = tileOfId(id, 'side');
    for (let k = 0; k < 4; k++) {
      const p = QUAD_POS[k];
      pos.push(p[0] - 0.5, p[1] - 0.5, 0);
      const t = tileUV(tile, UV_QUAD[k][0], UV_QUAD[k][1]);
      uv.push(t[0], t[1]); lit.push(1); alp.push(1); flag.push(MAT_PLAIN);
    }
    idx.push(0, 1, 2, 0, 2, 3);
  }
  /* ⚠ idx 必须交回**类型化数组**，不能是普通 Array：
   * WebGL2 的 bufferData 只吃 ArrayBufferView，喂普通数组既不报错也建不出缓冲区
   * （IBO 长度为 0），紧接着 drawElements 就是 INVALID_OPERATION ——
   * 表现是「网格对象建出来了、count 也对，但屏幕上一个像素都没有」，
   * 而 frame() 把 rAF 排在第一行，循环照样活着，所以看起来像「渲染静默失效」。 */
  return { pos, uv, lit, alp, flag, idx: new Uint32Array(idx), flat: !isBlockId(id) };
}
export function bindHand(g) { bindLayout(g.vbo, g.ibo); }
export function drawHandView(cam, proj) {
  if (mode === MODE.SPECTATOR) return;    // 旁观者没有手（附身时更不该有）
  const id = heldId();
  if (!id) return;
  let g = handGpu[id];
  if (!g) {
    const d = handMeshData(id);
    const n = d.pos.length / 3;
    const inter = new Float32Array(n * STRIDE);
    for (let i = 0, o = 0; i < n; i++) {
      inter[o++] = d.pos[i * 3]; inter[o++] = d.pos[i * 3 + 1]; inter[o++] = d.pos[i * 3 + 2];
      inter[o++] = d.uv[i * 2];  inter[o++] = d.uv[i * 2 + 1];
      inter[o++] = d.lit[i];     inter[o++] = d.alp[i];
      inter[o++] = d.flag[i];
    }
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, isGL2 ? d.idx : new Uint16Array(d.idx), gl.STATIC_DRAW);
    g = handGpu[id] = { vbo, ibo, count: d.idx.length, flat: d.flat };
  }

  const arc = Math.sin(Math.min(1, handSwing) * Math.PI);
  const mv = Math.min(1, Math.hypot(player.vx, player.vz) / 4.4);
  const bob = Math.sin(worldTime * 8.4) * mv;

  gl.clear(gl.DEPTH_BUFFER_BIT);      // 手上物永远压在最上层
  gl.useProgram(progMain);
  gl.uniformMatrix4fv(locMain.uProj, false, proj);
  gl.uniformMatrix4fv(locMain.uView, false, M4.ident());
  gl.uniform3f(locMain.uCam, 0, 0, 0);
  gl.uniform1f(locMain.uFogNear, 1e5);
  gl.uniform1f(locMain.uFogFar, 2e5);
  gl.uniform1f(locMain.uCutout, 1);
  gl.uniform3f(locMain.uTint, 1, 1, 1);
  gl.disable(gl.CULL_FACE);           // 薄片只有单面，绕序赌不得
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(locMain.uAtlas, 0);

  const s = g.flat ? 0.32 : 0.24;
  let m = M4.trans(0.34 + bob * 0.02 - arc * 0.05,
                   -0.26 - Math.abs(bob) * 0.02 + arc * 0.07,
                   -0.62 + arc * 0.06);
  m = M4.mul(m, M4.rotY(-0.50 - arc * 0.25));
  m = M4.mul(m, M4.rotX(0.14 - arc * 0.95));
  m = M4.mul(m, M4.rotZ(-0.24 - arc * 0.45));
  m = M4.mul(m, M4.scale(s, s, s));
  gl.uniformMatrix4fv(locMain.uModel, false, m);
  bindHand(g);
  gl.drawElements(gl.TRIANGLES, g.count, isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

  gl.enable(gl.CULL_FACE);
  gl.uniform1f(locMain.uFogNear, FOG_NEAR);
  gl.uniform1f(locMain.uFogFar, FOG_FAR);
  gl.uniformMatrix4fv(locMain.uView, false, cam.view);
  gl.uniform3f(locMain.uCam, player.x, player.y + EYE, player.z);
}
