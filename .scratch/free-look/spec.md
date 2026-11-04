# 取消转视角的两处限制

用户要求：**把转动的视角限制取消掉**。经确认，范围是两处都放开 ——
① 俯仰角 ±90° 的 clamp；② 触屏单次 touchmove 的 90px 位移封顶。
灵敏度 `SENS = 0.0022` / `TOUCH_LOOK = 1.15` 保持不变。

## 一、根因

### 1. 俯仰卡死在 ±90°
`input.js` 的 `addLook()` 把 `player.pitch` 夹在
`PITCH_LIM = π/2 - 0.0005` 内。滑到边界后继续滑不积累，手感是「卡死」。

历史工单 `.scratch/look/spec.md` 写明「不能真的删掉 —— 删了 pitch 会越过 ±90°，
画面上下颠倒」「防 sin/cos 在正好 ±π/2 时视图矩阵退化成不可逆」。
**后半句不成立**：`M4.view()` 的基向量是

```
r = ( cos yaw, 0, -sin yaw )
f = (-sin yaw · cos p, sin p, -cos yaw · cos p)
u = r × f = (sin yaw · sin p, cos p, cos yaw · sin p)
```

`|r| = |f| = |u| = 1` 且三者两两正交，对任意 pitch 都成立，矩阵不会退化、
行列式恒为 1。pitch = π（yaw=0）时 `r=(1,0,0)`、`u=(0,-1,0)`、`f=(0,0,1)`，
即朝背后看且画面倒置 —— 这是**连续翻转的自然结果**，不是错误。
`actions.js` / `mobs.js` / `bots.js` 里的射线同样用
`[-sin(yaw)cos(p), sin(p), -cos(yaw)cos(p)]`，与 `f` 同源，翻转后准星仍对准视线中心。

### 2. 触屏快速甩动被限速
`TOUCH_STEP_MAX = 90` 把单次 touchmove 的位移向量缩到 90px。
它的本意是防「基准过期 → 一次几百像素的跳变」，但跳变的真正根因是 `lookId`
没复位；常规场景已由 `touchstart` 的活手指检查 + `endLook` 的
「页面上没手指就无条件复位」兜底解决。封顶现在只剩副作用：滑 400px 也只转 13°。

但有一处边界是旧兜底盖不住的：**touchend 整段被吞、且新手势复用了同一个
identifier**。`touchstart` 看到 `e.touches` 里还有这个 id，会误判「旧手指还活着」
而直接 return，基准停在几百像素之前。旧版靠 90px 封顶把伤害兜住，删掉封顶后
第一次 touchmove 就会一次甩飞（只滑 20px 却产生 -60.9° 增量，见验证）。
这是删封顶必须配套的修复。

## 二、做法（只动 `src/game/input.js`）

- 删 `PITCH_LIM` 与 `clamp(...)`，新增 `wrapAngle(a) = a - 2π·floor((a+π)/2π)`，
  yaw / pitch 都折回 `[-π, π)`。这是**等价角折叠**，不是边界：方向不受限，只是避免
  长时间转圈累积成大数后 `sin/cos` 掉精度。非有限输入（NaN / ±Inf）返回 0，
  不把 NaN 写进 player / 存档 —— 旧 `clamp` 会把 ±Inf 夹回边界，这里不能倒退。
- 删 `TOUCH_STEP_MAX` 及 `touchmove` 里的向量缩放，直接按真实 delta 调 `addLook`。
- `touchstart` 增加「`changedTouches` 里出现与 `lookId` 相同的 identifier → 刷新
  `lookX/lookY` 后 return」分支，补住上面那处兜底盲区；原有的活手指检查与
  `endLook` 无条件复位兜底全部保留。
- 删掉因此不再使用的 `import { clamp } from './math.js'`。
- **未改**：`M4.view`、`SENS`、`TOUCH_LOOK`、`save.js`（读档只判 `Number.isFinite`，
  任意 pitch 都能往返）、射线与准星、天空/后处理。鼠标、拖拽、键盘 lookVec
  都走 `addLook`，自动获得自由翻转。

### 行为变化（需要知道）
越过 ±90° 后画面上下颠倒。想「无限翻转」又要「画面永远正立」在几何上不可兼得，
除非保留某种边界；本次按用户要求选择前者。相应地，「一路下滑到底」不再停在
正下方，而会翻过去（实测 -101.5°）。快速甩动一次也可能转过多圈。

## 三、验证

Seam：浏览器真实输入（Playwright + CDP 真触摸），从页面已加载的模块实例读
`addLook` / `player` / `M4.view`，避开 HMR 的第二实例陷阱（改代码后重启 dev server）。

`.scratch/free-look/probe.mjs`：

| 阶段 | 结果 |
|---|---|
| 红 · 切片一（改前） | **6 条失败**：抬头/低头都停在 ±90°、转满一圈回不到 0°、单次 400px 只转 13°、两次 800px 只到 26.1° |
| 绿 · 切片一 | **12 条全过**：抬头 126.1°、低头 -126.1°、转 360° 回 0°、长时间转头数值仍有限、pitch=180° 时 right/up/dir 单位正交、单次 400px = 58°、两次 800px = 116°、多指不抢视角、零控制台报错 |
| 红 · 切片二（审查后补测） | **3 条失败**：yaw 累积到 -2521°、Infinity 输入把 pitch 写成 NaN、id 复用场景只滑 20px 却产生 -60.9° 增量 |
| 绿 · 切片二 | **15 条全过**：yaw 也折回主值区间、非有限输入归零、id 复用时 20px 只转 2.9°；切片一的 12 条保持通过 |

断言口径：id 复用场景比较的是「基准刷新后那 20px 的增量」，不是总 pitch ——
第一段 100px 的 -14.5° 是正常滑动，算进去会假失败。

其它：
- `npx vite build` 通过（111 modules，index js 256.06 kB / gzip 97.33 kB）。
- `npm run check:curriculum` 通过。
- 既有 `.scratch/look/probe.mjs` 回归 9 条全过（灵敏度 14.5°/100px、双指、
  基准过期不跳变均保持）；「一路下滑到底」从 -90° 变成 -101.5°，断言仍成立。

复现：
```
npx vite --port 4182 --strictPort
PW_ROOT=<playwright 包所在 node_modules> node .scratch/free-look/probe.mjs
```

## 四、遗留

- 画面倒置是设计取舍，不是 bug；若后续要「翻转但保持正立」，需要引入 roll 补偿，
  那会在越过 90° 处产生一次方向突变，需重新评估。
- 快速甩动一次可能转过多圈；`wrapAngle` 在 ±π 处折回但方向连续，画面不会跳。
- `touchstart` 的 id 复用判断依赖「活动手指不会复用 identifier」这一浏览器约定；
  合成 TouchEvent 已覆盖该边界，真机多指仍由既有 `.scratch/look/probe.mjs` 回归守护。
