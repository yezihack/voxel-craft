/* 触屏摇杆 → 方向键的换算。
 *
 * 单独成一个模块是为了能在 node 里直接跑（loop.js 会 import renderer.js，
 * 一进 node 就因为没有 WebGL 上下文而炸），这样「松手后是否真的停下」
 * 可以写成断言，而不是靠肉眼在手机上试。
 *
 * 这里只有一件事：把摇杆的归一化向量写进 input 的四个方向位。
 * 真正的 bug 在于「什么时候不写」—— 见下面 applyStickInput 的注释。 */

/* 死区：手指在圆心附近的小幅抖动不该让角色动起来 */
export const STICK_DEAD = 0.22;

/* 摇杆当前是否在接管方向键。
 * 为什么要这个标志：摇杆向量归零（松手）之后，如果整段逻辑被 `if (有输入)`
 * 挡住不执行，上一帧写下的 input.f = true 就没人清 —— 人会一直往前走。
 * 反过来若无条件每帧都写，桌面端 WASD 按下的状态会被立刻覆盖成 false。
 * 于是用一个「接管期」把两种情况分开：推过一次摇杆就开始接管（含归零那一帧，
 * 把 false 写下去），写完再交出接管权。 */
export const stickInput = { active: false };

export function applyStickInput(stick, input) {
  if (stick.x || stick.y) stickInput.active = true;
  if (!stickInput.active) return;
  const dead = STICK_DEAD;
  input.f = stick.y < -dead;
  input.b = stick.y > dead;
  input.l = stick.x < -dead;
  input.r = stick.x > dead;
  if (!stick.x && !stick.y) stickInput.active = false;
}
