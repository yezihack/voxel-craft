/* 天空：渐变天穹、太阳月亮、云 —— 迁移自 voxel-craft.html 第 4471-4628 行 */

import { clamp, fbm } from './math.js'
import { CLOUD_AMT, CLOUD_TINT, NIGHT, SHADER_T, SKY, SKY_GROUND, SKY_TOP, SUN_COL, SUN_DIR, drawFullscreenQuad } from './post.js'
import { PREC, canvas, gl, program } from './renderer.js'

/* ============================== 天空 ==============================
 * 一块铺满屏幕的三角形，在**最前面**画（关深度测试、不写深度），
 * 整个世界就画在它上面。相比「清成纯色」，渐变天穹提供了三件事：
 *   1. 视线朝上/朝下时颜色不同 —— 一眼就有「天空是个半球」的空间感；
 *   2. 屏幕空间反算视线方向，才能把太阳/月亮/云放在**世界里的固定位置**，
 *      转头时它们跟着走，而不是贴在屏幕上；
 *   3. 地平色顺带当成雾色，远处地形自然融进天际线，看不到「贴片边」。 */
export const SKY_VS = `
${PREC}
attribute vec2 aP;
varying vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 1.0, 1.0); }`;

/* 天穹的三段渐变：地平附近颜色变化快、天顶慢，所以对 h 取幂次压缩。
 * varying / uniform 的精度必须与顶点阶段一致（见 PREC 的注释）——
 * 星空哈希要算 sin(很大的数)，精度不够会直接算成一坨噪点。 */
export const SKY_FS = `
${PREC}
uniform vec3 uTop, uHorizon, uGround;
uniform vec3 uSunDir, uSunCol, uCloudTint;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect, uTime, uNight, uCloudAmt;
uniform sampler2D uCloud;
varying vec2 vP;
void main(){
  // 屏幕像素 → 世界视线方向
  vec3 dir = normalize(uRight * (vP.x * uTanHalf * uAspect)
                     + uUp    * (vP.y * uTanHalf)
                     + uFwd);
  float h = dir.y;
  vec3 col = (h >= 0.0)
    ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62))
    : mix(uHorizon, uGround, clamp(-h * 3.2, 0.0, 1.0));

  // 星空：方向向量量化成格子哈希。用 smoothstep 而不是 pow(x,300) ——
  // mediump 下大指数的结果是不可靠的，圆形会烂成噪点。
  if (uNight > 0.01 && h > -0.02) {
    vec3 q = floor(dir * 170.0);
    float r = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(0.86, 0.89, 1.0) * smoothstep(0.9972, 1.0, r)
         * uNight * clamp(h * 4.0, 0.0, 1.0) * 0.9;
  }

  // 太阳：一个硬边圆盘 + 一圈很宽的暖光晕（光晕替泛光提前把天空点亮）
  float s = dot(dir, uSunDir);
  col += uSunCol * (smoothstep(0.9978, 0.9995, s) * 2.4
                  + pow(max(s, 0.0), 7.0) * 0.17);
  // 月亮：太阳的正对面
  float mo = dot(dir, -uSunDir);
  col += vec3(0.82, 0.86, 0.94) * smoothstep(0.9986, 0.9997, mo) * 1.5 * uNight;

  // 云层：把视线投到一块水平面上采样噪声。除以 h 会让云在地平线处自然收拢
  // （h→0 时 cp→∞，采样频率趋近无穷，视觉上就是「云缩成一条线」）。
  if (h > 0.015) {
    vec2 cp = dir.xz / h * 0.42 + vec2(uTime * 0.0045, uTime * 0.0028);
    float c = texture2D(uCloud, cp).r;
    float cov = smoothstep(0.42, 0.78, c) * smoothstep(0.015, 0.17, h) * uCloudAmt;
    col = mix(col, uCloudTint * (0.55 + 0.42 * max(s, 0.0)) * (0.70 + 0.55 * c), cov);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
export const progSky = program(SKY_VS, SKY_FS);
export const locSky = {
  aP: gl.getAttribLocation(progSky, 'aP'),
  uTop: gl.getUniformLocation(progSky, 'uTop'),
  uHorizon: gl.getUniformLocation(progSky, 'uHorizon'),
  uGround: gl.getUniformLocation(progSky, 'uGround'),
  uSunDir: gl.getUniformLocation(progSky, 'uSunDir'),
  uSunCol: gl.getUniformLocation(progSky, 'uSunCol'),
  uCloudTint: gl.getUniformLocation(progSky, 'uCloudTint'),
  uRight: gl.getUniformLocation(progSky, 'uRight'),
  uUp: gl.getUniformLocation(progSky, 'uUp'),
  uFwd: gl.getUniformLocation(progSky, 'uFwd'),
  uTanHalf: gl.getUniformLocation(progSky, 'uTanHalf'),
  uAspect: gl.getUniformLocation(progSky, 'uAspect'),
  uTime: gl.getUniformLocation(progSky, 'uTime'),
  uNight: gl.getUniformLocation(progSky, 'uNight'),
  uCloudAmt: gl.getUniformLocation(progSky, 'uCloudAmt'),
  uCloud: gl.getUniformLocation(progSky, 'uCloud'),
};
/* 铺满屏幕的两个三角形（比一个大三角形多一个顶点，换来不依赖任何扩展） */
export const skyQuad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
gl.bufferData(gl.ARRAY_BUFFER,
  new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);

/* ---------------- 云纹理（CPU 生成一次，之后只做采样） ----------------
 * 可平铺是关键：天色一铺满就是几屏，纹理接缝会直接显成一条折线。
 * 做法是标准四角混合 —— 把 (u,v) 和它的四处平移版本按距离加权，
 * 于是 u=0 与 u=1 采到的是同一条边。 */
export const CLOUD_PX = 256;
export const cloudCanvas = document.createElement('canvas');
cloudCanvas.width = cloudCanvas.height = CLOUD_PX;
export const cloudTex = gl.createTexture();
export function buildCloudTexture() {
  const cc = cloudCanvas.getContext('2d');
  const im = cc.createImageData(CLOUD_PX, CLOUD_PX);
  const N = CLOUD_PX, d = im.data;
  const base = (a, b) => fbm(a * 5.0, b * 5.0, 9137, 4);
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const n = base(u, v) * (1 - u) * (1 - v) + base(u - 1, v) * u * (1 - v)
              + base(u, v - 1) * (1 - u) * v + base(u - 1, v - 1) * u * v;
      // 压一下对比，让「云团」和「晴空」分开，而不是一片均匀的灰
      const k = clamp((n - 0.34) / 0.42, 0, 1);
      const val = (k * k * (3 - 2 * k) * 255) | 0;
      const o = (y * N + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = val;
      d[o + 3] = 255;
    }
  }
  cc.putImageData(im, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, cloudTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cloudCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  /* 云是唯一用 REPEAT 的纹理 —— 贴图集必须是 CLAMP_TO_EDGE，
   * WRAP 是「每张纹理各自的状态」，切纹理时要各自设好，不能只在初始化时设一次。 */
}

/* 画天穹。proj[5] = 1/tan(fovY/2)，由投影矩阵反推视锥，避免 fov 在两处各写一遍
 * （现状就是「透视矩阵用 72°、天空按另一个数字算」那种早晚会对不上的重复）。 */
export function drawSky(cam, proj) {
  gl.useProgram(progSky);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  const tanHalf = 1 / proj[5];
  const aspect = canvas.width / Math.max(1, canvas.height);
  gl.uniform3f(locSky.uTop, SKY_TOP[0], SKY_TOP[1], SKY_TOP[2]);
  gl.uniform3f(locSky.uHorizon, SKY[0], SKY[1], SKY[2]);
  gl.uniform3f(locSky.uGround, SKY_GROUND[0], SKY_GROUND[1], SKY_GROUND[2]);
  gl.uniform3f(locSky.uSunDir, SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
  gl.uniform3f(locSky.uSunCol, SUN_COL[0], SUN_COL[1], SUN_COL[2]);
  gl.uniform3f(locSky.uCloudTint, CLOUD_TINT[0], CLOUD_TINT[1], CLOUD_TINT[2]);
  gl.uniform3f(locSky.uRight, cam.right[0], cam.right[1], cam.right[2]);
  gl.uniform3f(locSky.uUp, cam.up[0], cam.up[1], cam.up[2]);
  gl.uniform3f(locSky.uFwd, cam.dir[0], cam.dir[1], cam.dir[2]);
  gl.uniform1f(locSky.uTanHalf, tanHalf);
  gl.uniform1f(locSky.uAspect, aspect);
  gl.uniform1f(locSky.uTime, SHADER_T());
  gl.uniform1f(locSky.uNight, NIGHT);
  gl.uniform1f(locSky.uCloudAmt, CLOUD_AMT);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, cloudTex);
  gl.uniform1i(locSky.uCloud, 1);
  drawFullscreenQuad(progSky, locSky.aP);
  gl.activeTexture(gl.TEXTURE0);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
}
