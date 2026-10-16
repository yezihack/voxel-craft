/* WebGL 渲染：上下文、着色器程序、uniform / attribute 位置 —— 迁移自 voxel-craft.html 第 4257-4470 行 */
/* ============================== WebGL 渲染 ============================== */
import { canvasEl } from './canvasHost.js'
import { setFatal } from './uiState.js'

export const canvas = canvasEl;
export const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
        || canvas.getContext('webgl', { antialias: true, alpha: false });

if (!gl) {
  setFatal('你的浏览器/显卡不支持 WebGL，无法运行这个 3D 游戏 😢');
  throw new Error('no webgl');
}
export const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

/* 顶点 / 片元的默认浮点精度**必须两边一致**，否则链接期直接失败：
 *   link: Precisions of uniform 'uTime' differ between VERTEX and FRAGMENT shaders.
 * 坑在于「不一致本来一直存在」——片元着色器写的是 mediump，而顶点着色器的
 * 默认就是 highp —— 但 ANGLE 只对**两个阶段都真正用到**的 uniform 报错。
 * 以前两边没有任何同名且都用到的 float uniform，所以相安无事；
 * 这一轮 uTime 同时驱动顶点摇曳和片元水波，立刻就撞上了。
 * （uCam / uProj 只在顶点阶段用，precision 不一致也照样链接通过，千万别以为没坑。）
 *
 * 显式查一次硬件能力、两边用同一个字符串，比让每个着色器各自声明可靠得多。
 * 精度只影响吞吐量，对这套像素风没有实质影响。 */
export const PREC = (() => {
  try {
    const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    return f && f.precision > 0 ? 'precision highp float;' : 'precision mediump float;';
  } catch (e) { return 'precision mediump float;'; }
})();

export const VS = `
${PREC}
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aLit;
attribute float aAlpha;
attribute float aFlag;
uniform mat4 uProj, uView, uModel;
uniform vec3 uCam;
uniform float uTime;
varying vec2 vUV;
varying float vLit;
varying float vAlpha;
varying float vDist;
varying float vFlag;
varying vec3 vWP;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  /* 植被摇曳（flag 3，只有树叶）。相位取**世界坐标**而不是顶点索引：
   * 相邻树叶自然连成一片起伏，区块重建也不会把相位重置成抖动。
   * 只推 x/z、不动 y —— 树梢平移比整体摇晃更像被风吹，也更不容易穿模。
   * 上界 3.5 是必须的：传送门的 flag 是 4，少了它整片传送门会跟着树叶一起摆。 */
  if (aFlag > 2.5 && aFlag < 3.5) {
    float ph = wp.x * 1.6 + wp.z * 1.9 + uTime * 1.7;
    float sway = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.1)) * 0.030;
    wp.x += sway;
    wp.z += sway * 0.55;
  }
  gl_Position = uProj * uView * wp;
  vUV = aUV;
  vLit = aLit;
  vAlpha = aAlpha;
  vFlag = aFlag;
  vWP = wp.xyz;
  vDist = length(wp.xyz - uCam);
}`;

export const FS = `
${PREC}
uniform sampler2D uAtlas;
uniform vec3 uFog;
uniform vec3 uTint;        // 全局染色：生物受伤时推红
uniform float uFogNear, uFogFar, uFogHeight;
uniform float uCutout;
uniform float uTime;
uniform float uAmbient;    // 昼夜环境光（夜晚整体压暗）
uniform float uTexel;      // 1 / 贴图集边长，动画位移以「纹素」为单位
uniform vec4 uWaterRect;   // 水贴图在集里的 UV 矩形，用来把动画位移夹在格子内
uniform vec4 uLavaRect;
varying vec2 vUV;
varying float vLit;
varying float vAlpha;
varying float vDist;
varying float vFlag;
varying vec3 vWP;
void main(){
  vec2 uv = vUV;
  float lit = vLit;
  vec3 glow = vec3(0.0);
  /* ⚠ 分支顺序 = 材质标志从高到低，**必须严格递减**。
   * 这里是一串 [vFlag > 阈值] 的判断，低阈值分支会「吞掉」所有更高的标志：
   * 曾经把「树叶」写成第一条 [> 2.5]，而传送门 flag=4 同样满足 —— 门整片
   * 走了树叶分支，既不发光也没有紫色辉光，看起来只是「贴图比较亮的门」。
   * 加新材质时：先想好它的数值，再把它插到**比它小的阈值之前**。 */
  if (vFlag > 4.5) {
    // 毒沼：低频对流，只压明暗、**不动 uv** —— 因为 clamp 用的 uWaterRect
    // 是「水」那张贴图的矩形，毒沼的 uv 取自 toxic 贴图，一夹就变水色。
    float s = sin(vWP.x * 0.71 + uTime * 0.85) * cos(vWP.z * 0.83 - uTime * 1.03);
    lit *= 1.0 + s * 0.075;
    glow = vec3(0.16, 0.34, 0.12) * (0.12 + 0.10 * s);
  } else if (vFlag > 3.5) {
    // 传送门：整格做低幅度发光呼吸。**不做 uv 位移** —— 8 种门各有一张贴图，
    // 逐格位移要按门类型切 8 个矩形 uniform，收益不抵复杂度；发光呼吸已经够「活」。
    float p = 0.5 + 0.5 * sin(uTime * 1.7 + vWP.y * 2.2 + vWP.x * 1.3);
    lit *= 0.86 + 0.30 * p;
    glow = vec3(0.42, 0.24, 0.62) * (0.20 + 0.28 * p);
  } else if (vFlag > 2.5) {
    // 树叶：明暗轻微呼吸，像有风穿过树冠
    lit *= 1.0 + 0.05 * sin(uTime * 1.9 + vWP.x * 2.4 + vWP.z * 1.7);
  } else if (vFlag > 1.5) {
    // 岩浆：低频对流 + 自发光（交给泛光放大成真亮）
    float w = sin(vWP.x * 0.85 + uTime * 0.90) * cos(vWP.z * 1.05 - uTime * 1.15);
    uv += vec2(w, -w * 0.7) * uTexel * 1.8;
    lit *= 1.0 + w * 0.10;
    glow = vec3(1.00, 0.38, 0.08) * (0.30 + 0.12 * w);
  } else if (vFlag > 0.5) {
    // 水：两个不同频率的波叠加出流动感。**不靠平移贴图实现**——
    // uv 位移一旦越过格子边界就会吸到隔壁贴图，水面四周会挂一圈杂色边。
    // 这里位移很小（约 1 个纹素），并夹在本格矩形内，双重保险。
    float w = sin(vWP.x * 0.62 + uTime * 1.25) + cos(vWP.z * 0.78 - uTime * 1.02);
    uv += vec2(w * 0.50, w * 0.34) * uTexel * 1.2;
    lit *= 1.0 + w * 0.045;
    glow = vec3(0.14, 0.26, 0.38) * max(w, 0.0) * 0.22;
  }
  // 水/岩浆的动画位移夹回自己那格，杜绝「水边一圈杂色」。
  // ⚠ 上界必须是 2.5，**只能夹「真的会位移 uv」的那两档（水 1 / 岩浆 2）**。
  //   这里原来写的是 [vFlag < 3.5]，于是树叶（flag 3）也被夹进了 uLavaRect ——
  //   树叶的 uv 本来落在 leaves 那格，一夹就贴到岩浆格的某个角上，整片树叶渲染成
  //   一块**纯橙色**。地图上表现为「橙色的树」，看着像刻意做的秋叶风格，
  //   其实是 bug（贴图集里 leaves 明明是绿的，肉眼在游戏画面里根本对不出来）。
  if (vFlag > 0.5 && vFlag < 2.5) {
    vec4 r = vFlag > 1.5 ? uLavaRect : uWaterRect;
    uv = clamp(uv, r.xy, r.zw);
  }
  vec4 t = texture2D(uAtlas, uv);
  // 不透明趟里只有树叶带镂空；透明趟（玻璃/水/冰/岩浆）绝不能裁，
  // 否则半透明的内部会被整片丢掉。
  if (uCutout > 0.5 && t.a < 0.5) discard;
  float a = clamp(lit, 0.30, 1.15) * uAmbient;
  vec3 c = t.rgb * a * uTint + glow * t.rgb * 1.7;
  /* 雾。除了距离，还按**世界高度**衰减：站在山顶时脚下山谷会起雾，
   * 贴脸的地面却清清楚楚 —— 这就是「空气透视」，比单一个距离雾立体得多。 */
  float hf = exp(-max(vWP.y - uFogHeight, 0.0) * 0.030);
  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0) * hf;
  c = mix(c, uFog, clamp(f, 0.0, 1.0) * 0.92);
  gl_FragColor = vec4(c, t.a * vAlpha);
}`;

/* 线框 shader（选中方块高亮） */
export const LVS = `
attribute vec3 aPos;
uniform mat4 uProj, uView;
void main(){ gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
export const LFS = `
${PREC}
uniform vec4 uColor;
void main(){ gl_FragColor = uColor; }`;

export function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
export function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export const progMain = program(VS, FS);
export const locMain = {
  aPos: gl.getAttribLocation(progMain, 'aPos'),
  aUV: gl.getAttribLocation(progMain, 'aUV'),
  aLit: gl.getAttribLocation(progMain, 'aLit'),
  aAlpha: gl.getAttribLocation(progMain, 'aAlpha'),
  aFlag: gl.getAttribLocation(progMain, 'aFlag'),
  uProj: gl.getUniformLocation(progMain, 'uProj'),
  uView: gl.getUniformLocation(progMain, 'uView'),
  uModel: gl.getUniformLocation(progMain, 'uModel'),
  uCam: gl.getUniformLocation(progMain, 'uCam'),
  uFog: gl.getUniformLocation(progMain, 'uFog'),
  uFogNear: gl.getUniformLocation(progMain, 'uFogNear'),
  uFogFar: gl.getUniformLocation(progMain, 'uFogFar'),
  uFogHeight: gl.getUniformLocation(progMain, 'uFogHeight'),
  uCutout: gl.getUniformLocation(progMain, 'uCutout'),
  uAtlas: gl.getUniformLocation(progMain, 'uAtlas'),
  uTint: gl.getUniformLocation(progMain, 'uTint'),
  uTime: gl.getUniformLocation(progMain, 'uTime'),
  uAmbient: gl.getUniformLocation(progMain, 'uAmbient'),
  uTexel: gl.getUniformLocation(progMain, 'uTexel'),
  uWaterRect: gl.getUniformLocation(progMain, 'uWaterRect'),
  uLavaRect: gl.getUniformLocation(progMain, 'uLavaRect'),
};
/* 顶点属性必须全部真正生效。编译期被优化掉（比如 shader 里没用它）时
 * getAttribLocation 返回 -1，而 enableVertexAttribArray(-1) 只抛一个 GL 错误、
 * 不抛异常 —— 表现就是「一切照跑、某个通道全是 0」，属于最难查的一类静默失败。
 * 这里在启动期直接炸掉，比事后看画面强。 */
for (const k of ['aPos', 'aUV', 'aLit', 'aAlpha', 'aFlag'])
  if (locMain[k] < 0) throw new Error(`顶点属性 ${k} 被着色器优化掉了（真的用到了吗？）`);
/* TEXEL / WATER_RECT / LAVA_RECT 定义在「常量配置」段（纯数据，无头测试要验）。 */
export const progLine = program(LVS, LFS);
export const locLine = {
  aPos: gl.getAttribLocation(progLine, 'aPos'),
  uProj: gl.getUniformLocation(progLine, 'uProj'),
  uView: gl.getUniformLocation(progLine, 'uView'),
  uColor: gl.getUniformLocation(progLine, 'uColor'),
};
