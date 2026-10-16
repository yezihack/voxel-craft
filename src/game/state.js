/* 共享可变状态。
 *
 * 原来这些变量散落在各自的段落里，被别的段落直接赋值。ESM 的导入绑定是**只读**的
 * （`import { dim } from ...; dim = 1` 是语法错误），所以凡是「跨模块会被重新赋值」
 * 的变量都集中到这里，配一个显式 setter。读取方仍然可以直接 import 这个名字
 * （ESM 是活绑定，读到的永远是当前值），只有写入方要改成调用 setter。
 *
 * 这里是纯数据：不依赖 vue、不依赖 DOM、不依赖 GL，任何模块都能安全引入。 */
export const MODE = { CREATIVE: 0, SURVIVAL: 1, SPECTATOR: 2 };

/* 世界种子。地形是纯函数，所有随机性都由它 + 世界坐标决定。 */
export let SEED = 20260918;
export function setSEED(v) { SEED = v; }

/* 当前维度（0 = 主世界） */
export let dim = 0;
export function setDim(v) { dim = v; }

/* 结构（村庄 / 遗迹 / 矿井）格形状缓存 */
export let structShapeCache = new Map();
export function setStructShapeCache(v) { structShapeCache = v; }

/* 地形列缓存（colInfo 的 memo），与维度强相关 */
export let colCache = new Map();
export function setColCache(v) { colCache = v; }
export let colCacheSeed = SEED;
export function setColCacheSeed(v) { colCacheSeed = v; }

/* 当前维度的方块覆盖层（玩家改动过的格子） */
export let edits = null;
export function setEdits(v) { edits = v; }

/* 传送后的冷却，防止站在返回门边上反复弹 */
export let portalCd = 0;
export function setPortalCd(v) { portalCd = v; }

/* 旁观模式附身的生物；null = 自由视角 */
export let spectate = null;
export function setSpectate(v) { spectate = v; }

/* 弓蓄力 0..1，界面用它画蓄力条 */
export let bowCharge = 0;
export function setBowCharge(v) { bowCharge = v; }

/* 挥手动画计时（第一人称手持物 / AI 玩家共用一套计时） */
export let swingT = 0;
export function setSwingT(v) { swingT = v; }
export let handSwing = 0;
export function setHandSwing(v) { handSwing = v; }

/* 当前游戏模式 */
export let mode = MODE.CREATIVE;
export function setModeState(v) { mode = v; }

/* 当前手持的快捷格号（0..HOTBAR_N-1） */
export let selected = 0;
export function setSelected(v) { selected = v; }

/* 生存逻辑往界面抛事件的钩子（界面层注入，引擎只负责调用） */
export let onHurt = null;
export function setOnHurt(v) { onHurt = v; }
export let onDeath = null;
export function setOnDeath(v) { onDeath = v; }

/* 当前指向的方块（渲染高亮框用） */
export let targetBlock = null;
export function setTargetBlock(v) { targetBlock = v; }

/* 是否处于游戏中（鼠标已锁定） */
export let running = false;
export function setRunning(v) { running = v; }
export let paused = false;
export function setPaused(v) { paused = v; }

/* 挖掘 / 放置的按住状态与节流 */
export let breakHeld = false;
export function setBreakHeld(v) { breakHeld = v; }
export let placeHeld = false;
export function setPlaceHeld(v) { placeHeld = v; }
/* 放置是否「按住连发」—— 触屏长按才连发，鼠标右键点一次只放一块 */
export let placeRepeat = false;
export function setPlaceRepeat(v) { placeRepeat = v; }
export let lastAction = 0;
export function setLastAction(v) { lastAction = v; }

/* 触屏双摇杆的方向向量。用「可变对象」而不是重新赋值：
 * ESM 不允许给导入的绑定赋值，但改对象上的属性是合法的，
 * 于是 Vue 侧的摇杆组件可以直接写 stickVec.x / lookVec.y。 */
export const stickVec = { x: 0, y: 0 }
export const lookVec = { x: 0, y: 0 }
