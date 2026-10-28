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
import { ui as uiState } from './game/uiState.js'

/* MODE 是编译期常量（state.js 是纯数据叶模块，不依赖 vue / DOM / GL），
 * 所以能静态引入。组件在首屏就要用它判模式，而那时引擎还没被动态拉起 ——
 * 走 engine.MODE 会在第一帧读到 undefined。 */
export { MODE } from './game/state.js'

/* 引擎门面的占位对象。用 shallowReactive：值本身（函数 / 常量）保持原样，
 * 但组件里的 computed 能感知「引擎已就绪」。 */
export const engine = shallowReactive({})

/* 引擎是**异步**拉起的（要等 canvas 挂好才能建 GL 上下文），而开始面板从
 * 第一帧就渲染出来了 —— 中间这一两百毫秒里，玩家完全可能已经点下
 * 「超平坦」或「开始游戏」。那些按钮直接写 engine.xxx，此刻还是 undefined，
 * 于是控制台炸出 `engine.pickWorldType is not a function`，而按钮毫无反应。
 *
 * 所以先给所有「模板里会点到」的方法铺一层占位：点了不报错，只是把提示语
 * 改成「还在加载」，玩家能看懂为什么没反应。initEngine 里的 Object.assign
 * 会用真实现整片覆盖掉这些占位。 */
const NOT_READY_KEYS = [
  'pickMode', 'pickWorldType', 'startGame', 'newWorld', 'respawnAndStart',
  'saveNow', 'loadNow', 'saveStatus', 'pauseGame',
  'toggleBag', 'toggleBagExpand', 'cycleMode', 'toggleFly', 'selectSlot',
  'setStick', 'setLook', 'setInputKey', 'touchMine', 'touchPlace',
]
for (const k of NOT_READY_KEYS) {
  engine[k] = () => {
    uiState.veilHint = '引擎还在加载，等这一行变成「地形就绪」再点 🙂'
    return null
  }
}

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
