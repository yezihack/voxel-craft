/* WebGL 画布宿主。
 * 引擎模块在「顶层」就要拿到 canvas 建 WebGL 上下文，所以画布必须在引擎被
 * import 之前就位。Vue 挂载完 <canvas> 后调用 setCanvas()，再由 App.vue
 * 用动态 import() 拉起引擎 —— 这样引擎里所有顶层 GL 初始化代码都能原样保留。 */
export let canvasEl = null

export function setCanvas(el) {
  canvasEl = el
}
