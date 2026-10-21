/* 引擎门面：Vue 侧只需要 import 这一个文件。
 *
 * ⚠ 本模块必须**动态 import**（`await import('./game/index.js')`）：
 * renderer.js 在顶层就要拿 canvas 建 WebGL 上下文，所以 App.vue 必须先把
 * <canvas> 挂好并调用 setCanvas()，再拉起引擎。
 *
 * 这里只导出 Vue 侧真正会用到的名字 —— 引擎内部互相引用的那些（openBag /
 * toggleBag / setMode / onEscape / pauseGame…）由各模块直接从 uiActions.js 取，
 * 不在这里再转发一遍。 */

/* 生命周期 */
export { setCanvas } from './canvasHost.js'
export { attachSystemEvents, attachSurvivalHooks, boot, startLoop } from './boot.js'

/* 响应式状态 */
export { setTagHook, ui } from './uiState.js'

/* 界面动作 */
export {
  clearCraftAll, clearCraftSlot, clickInvSlot, closeBag, pickLibraryItem, pickMode,
  pickRecipe, pickWorldType, respawnAndStart, selectSlot, setInputKey, setLook,
  setStick, startGame, takeCraftResult, toggleBagExpand, toggleFly,
} from './uiActions.js'

/* 派生数据 */
export {
  allItemIds, allPlaceableIds, bagSubtitle, hotbarSlots, invSlotsView, totalStore, usedStore,
} from './selectors.js'

/* 常量与查询 */
export { HOTBAR_N, heldId } from './survival.js'
export { craftResult, craftSlots, recipeBookEntries, recipeMissing } from './crafting.js'
export { defName, itemTip } from './config.js'
export { isoIcon } from './textures.js'
export { MODE } from './state.js'
