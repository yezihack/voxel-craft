/* Vue 与引擎之间的桥。
 *
 * 关键点：引擎**必须动态 import**。renderer.js 在模块顶层就要拿 canvas 建
 * WebGL 上下文，而 canvas 要等 Vue 挂载完才有 —— 所以先把画布交给
 * canvasHost，再 `await import('./game/index.js')` 拉起引擎。
 *
 * 可以静态引入的只有两个不依赖 GL 的模块：canvasHost.js 与 uiState.js。
 * 其余（方块表、背包、合成…）一律从 engine 上取，保证「画布就位」的先后关系。 */
import { shallowReactive } from 'vue'
import { setCanvas } from './game/canvasHost.js'

export { setTagHook, ui } from './game/uiState.js'

/* MODE 是编译期常量（state.js 是纯数据叶模块，不依赖 vue / DOM / GL），
 * 所以能静态引入。组件在首屏就要用它判模式，而那时引擎还没被动态拉起 ——
 * 走 engine.MODE 会在第一帧读到 undefined。 */
export { MODE } from './game/state.js'

/* 引擎门面的占位对象。用 shallowReactive：值本身（函数 / 常量）保持原样，
 * 但组件里的 computed 能感知「引擎已就绪」。 */
export const engine = shallowReactive({})

export async function initEngine(canvasEl) {
  setCanvas(canvasEl)
  const m = await import('./game/index.js')
  Object.assign(engine, m)
  m.attachSystemEvents()
  m.attachSurvivalHooks()
  m.pickMode(m.MODE.CREATIVE)
  m.boot()
  m.startLoop()
}
