/* 数学工具：4x4 矩阵、值噪声 / fbm、clamp —— 迁移自 voxel-craft.html 第 1155-1257 行 */
/* ============================== 数学工具 ============================== */
export const M4 = {
  ident: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
    return new Float32Array([
      t / asp, 0, 0, 0,
      0, t, 0, 0,
      0, 0, (f + n) * nf, -1,
      0, 0, 2 * f * n * nf, 0,
    ]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2/(r-l),0,0,0, 0,2/(t-b),0,0, 0,0,2/(n-f),0,
      -(r+l)/(r-l), -(t+b)/(t-b), (f+n)/(n-f), 1,
    ]);
  },
  /* 由 yaw/pitch + 位置构造视图矩阵（先平移后旋转） */
  view(px, py, pz, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 相机基向量：右 R、上 U、前 F(=视线方向)
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, ry = 0, rz = -sy;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return {
      view: new Float32Array([
        rx, ux, -fx, 0,
        ry, uy, -fy, 0,
        rz, uz, -fz, 0,
        -(rx*px + ry*py + rz*pz),
        -(ux*px + uy*py + uz*pz),
         (fx*px + fy*py + fz*pz), 1,
      ]),
      dir: [fx, fy, fz],
      /* 右/上基向量也一并返回：天空着色要按屏幕像素反算视线方向，
       * 而视线方向 = right·(x·tanHalf·aspect) + up·(y·tanHalf) + fwd。
       * 这三个量在 view() 里本来就算出来了，白白重算一遍容易和这里不一致。 */
      right: [rx, ry, rz],
      up: [ux, uy, uz],
    };
  },
  mul(a, b) {   // a * b
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
    return o;
  },
  trans: (x, y, z) => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]),
  /* 绕 Y 轴转：把局部 +Z 映射到 (sin(yaw), 0, cos(yaw))，与 mobAI 里的 yaw 约定一致 */
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  },
  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  },
  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  },
  scale(sx, sy, sz) {
    return new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1]);
  },
  /* 绕某点旋转：T(p) · R · T(-p) */
  about(p, R) {
    return M4.mul(M4.mul(M4.trans(p[0], p[1], p[2]), R),
                  M4.trans(-p[0], -p[1], -p[2]));
  },
};

/* 确定性伪随机 + 值噪声 */
export function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 144665;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}
export function smooth(t) { return t * t * (3 - 2 * t); }
export function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += noise2(x * f, y * f, seed + i * 97) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
