/* 界面动作门面。
 *
 * 所有「用户点了界面上某个东西」要触发的逻辑都在这里导出，组件只管调用，
 * 不去碰引擎内部状态。原先散落在 onclick / addEventListener 里的代码全部收拢到此。 */
import { audio, blip } from './audio.js'
import { despawnAllBots } from './bots.js'
import { despawnAllCarts } from './carts.js'
import { defName, HOTBAR } from './config.js'
import {
  craftAutoFill, craftClearAt, craftResult, craftSlots,
  clearCraft, doCraft, recipeBookEntries, recipeMissing,
} from './crafting.js'
import { input, keys } from './input.js'
import { clamp } from './math.js'
import { chunks } from './mesher.js'
import { despawnAllMobs, surfaceY } from './mobs.js'
import { player } from './player.js'
import { canvas } from './renderer.js'
import { HOTBAR_N, activeSlots, cancelDig, respawn } from './survival.js'
import {
  MODE, SEED, bowCharge, breakHeld, flatWorld, lookVec, mode, paused, placeHeld,
  placeRepeat, running, selected, setBowCharge, setBreakHeld, setColCache,
  setColCacheSeed, setFlatWorld, setModeState, setPaused, setPlaceHeld,
  setPlaceRepeat, setRunning, setSelected, setSpectate, setStructShapeCache,
  spectate, stickVec,
} from './state.js'
import { toast, ui } from './uiState.js'

/* ---------------- 快捷栏 ---------------- */

export function selectSlot(i) {
  // 只有快捷栏 9 格是可选中/手持的，储物格再大也不能让 selected 越界
  setSelected(clamp(i, 0, HOTBAR_N - 1))
  ui.selected = selected
  blip(520 + selected * 40, 0.04, 'sine', 0.03)
}

/* 点快捷格 = 选中它；点储物格 = 和当前快捷格对调
 * （对调而不是搬，免得手滑把快捷栏里的东西顶掉还不自知） */
export function clickInvSlot(i) {
  if (i < HOTBAR_N) { selectSlot(i); return }
  const tmp = activeSlots()[selected]
  activeSlots()[selected] = activeSlots()[i]
  activeSlots()[i] = tmp
  blip(600, 0.04, 'sine', 0.03)
}

/* 创造模式方块库：点一下把方块放进当前选中的格子 */
export function pickLibraryItem(id) {
  HOTBAR[selected] = id
}

export function toggleBagExpand() {
  ui.bagExpanded = !ui.bagExpanded
  blip(ui.bagExpanded ? 720 : 480, 0.05, 'sine', 0.035)
}

/* ---------------- 合成台 ---------------- */

/* 点合成格：把材料放回背包 */
export function clearCraftSlot(i) {
  if (!craftSlots[i]) return
  craftClearAt(i)
  blip(420, 0.04, 'sine', 0.03)
}

export function clearCraftAll() {
  clearCraft(true)
  blip(360, 0.05, 'sine', 0.03)
}

/* 点结果格：取走成品。
 * 拼写是另一条路（合成台里摆出一行字块） —— 它不发物品，只报「拼成了哪个词」，
 * 学识结算等 learning/progress 接进来（工单 08/09）。 */
export function takeCraftResult() {
  const r = doCraft()
  if (!r) return
  if (r.spell) {
    const e = r.spell.entries[0]
    blip(980, 0.10, 'sine', 0.05)
    toast('✏️ 拼出了「' + e.text + '」' + (e.gloss ? ' · ' + e.gloss : e.pinyin ? ' · ' + e.pinyin : ''))
    return
  }
  blip(880, 0.09, 'sine', 0.05)
  toast('🔨 合成 ' + defName(r.out) + (r.n > 1 ? ' ×' + r.n : ''))
}

/* 配方书：点一条就自动摆料 */
export function pickRecipe(entry) {
  const miss = mode === MODE.SURVIVAL ? recipeMissing(entry) : []
  if (miss.length) {
    toast('材料不够：缺 ' + miss.map((m) => m[0] + '×' + m[2]).join('、'))
    blip(200, 0.08, 'square', 0.03)
    return
  }
  craftAutoFill(entry)
  blip(700, 0.05, 'sine', 0.04)
}

/* ---------------- 模式 ---------------- */

/* 模式切换：创造 ↔ 生存 ↔ 旁观 */
export function setMode(m, announce = true) {
  setModeState(m)
  ui.mode = m
  const surv = m === MODE.SURVIVAL
  const spec = m === MODE.SPECTATOR
  ui.survival = surv
  /* 换模式一律脱离附身：否则切回创造，相机还骑在僵尸头上。 */
  setSpectate(null)
  if (surv) {
    player.fly = false                        // 生存模式没有飞行
    player.hp = player.maxHp
    player.food = player.maxFood
    player.air = player.maxAir
    player.dead = false
    player.fallPeak = null
    player.exhaust = 0
    cancelDig()
  } else if (spec) {
    /* 切到旁观：**不清怪** —— 这一模式的存在意义就是看它们。
     * 一直可飞（穿墙飞行见 updatePhysics）、免伤（见 hurt）、不挖不放。 */
    player.fly = true
    player.vy = 0
    cancelDig()
  } else {
    /* 切到创造：把场上的怪清掉。 */
    despawnAllMobs()
    cancelDig()
  }
  ui.flyTag = player.fly ? '(开)' : '(关)'
  if (announce) {
    toast(surv ? '⚔️ 生存模式：会饿、会摔伤、挖矿要花时间'
      : spec ? '👁 旁观模式：隐身穿墙观战 · 准星对准生物按 F 附身 · 再按 F 脱离'
        : '🌿 创造模式：无限方块、可飞行')
  }
}

/* 开始面板上选模式 */
export function pickMode(m) {
  ui.mode = m
  setMode(m, false)
}

/* ---------------- 世界类型 ---------------- */

/* 开始面板上选「经典 / 超平坦」。
 * 换世界类型 = 换地形生成器的参数，但**不换种子**：同一个种子在两种地形下
 * 是两张完全不同的图，这正是玩家想看到的（不是「重新掷骰子」）。
 *
 * ⚠ 三张缓存必须一起清：
 *   · colCache（列高度 / 群系）—— 键里只有坐标和维度，**没有**世界类型，
 *     不清的话平坦世界里会读出经典地形算出来的高度，地表一半平一半起伏；
 *   · structShapeCache（结构形状）—— 村庄是按旧地形高度摆的，留着会悬空；
 *   · 区块几何 —— 全部标脏，下一帧开始重建。
 * 场上的人/怪/车也一并清掉：它们的坐标属于上一张地形，
 * 在平坦世界里可能整个埋在地下（经典地形的山谷在新图里是实心的）。 */
export function pickWorldType(flat) {
  const v = !!flat
  if (v === flatWorld) return
  ui.worldFlat = v
  setFlatWorld(v)
  setColCache(new Map()); setColCacheSeed(SEED)
  setStructShapeCache(new Map())
  for (const c of chunks) c.dirty = true
  despawnAllMobs()
  despawnAllBots()
  despawnAllCarts()
  const gy = surfaceY(Math.floor(player.x), Math.floor(player.z))
  if (gy > 1) {
    player.y = gy + 1.2
    player.vy = 0
    player.spawn = [player.x, player.y, player.z]
  }
  toast(v ? '▬ 超平坦世界：地表恒高，无村庄无树林，适合搭轨道与装置'
          : '⛰️ 经典世界：起伏地形 + 村庄 / 遗迹 / 矿井')
  blip(v ? 620 : 420, 0.10, 'sine', 0.05)
}

/* ---------------- 开始 / 暂停 / 背包面板 ---------------- */

export function startGame(wantLock = true) {
  audio()
  if (ui.bagOpen) closeBag(true)
  setRunning(true)
  setPaused(false)
  ui.veilVisible = false
  ui.deathVisible = false
  if (wantLock && canvas.requestPointerLock) canvas.requestPointerLock()
}

export function pauseGame() {
  setRunning(false)
  setPaused(true)
  Object.keys(input).forEach((k) => (input[k] = false))
  setBreakHeld(false); setPlaceHeld(false); setPlaceRepeat(false)
  setBowCharge(0)
  cancelDig()
  if (ui.bagOpen) return              // 背包面板自己就是「暂停界面」，别叠加遮罩
  ui.veilVisible = true
  ui.veilHint = '已暂停 — 点击继续，或按 <b>Esc</b> 关闭鼠标锁定'
}

/* 面板需要真实鼠标指针，所以打开时必须退出指针锁定；关闭时再请求锁回来。
 * 浏览器对「刚退出锁定就立刻重新锁定」有冷却，若被拒绝，
 * 就退化成显示暂停遮罩 —— 点一下即可继续，不会卡死。 */
export function openBag() {
  ui.bagOpen = true
  ui.veilVisible = false
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  else pauseGame()                    // 触屏等没有指针锁定的环境，手动暂停
  blip(600, 0.06, 'sine', 0.05)
}

export function closeBag(silent) {
  ui.bagOpen = false
  if (ui.touch) { startGame(false); return }
  if (canvas.requestPointerLock) canvas.requestPointerLock()
  if (!silent) blip(440, 0.06, 'sine', 0.05)
}

export function toggleBag() { ui.bagOpen ? closeBag() : openBag() }

/* ---------------- 死亡与重生 ---------------- */

export function showDeath(reason) {
  ui.deathMsg = reason
  ui.deathVisible = true
}

export function respawnAndStart() {
  respawn()
  ui.deathVisible = false
  startGame(true)
}

/* ---------------- 触屏控件 ---------------- */

/* 触屏按钮 / 摇杆把语义状态写进 input（摇杆 knob 的高频视觉位移由组件自己处理）。
 * stickVec / lookVec 是可变对象，主循环每帧读它们换算成移动与转向。 */
export function setInputKey(key, val) { input[key] = val }
export function setStick(x, y) { stickVec.x = x; stickVec.y = y }
export function setLook(x, y) { lookVec.x = x; lookVec.y = y }

/* 触屏「飞行」按钮 */
export function toggleFly() {
  player.fly = !player.fly
  player.vy = 0
  ui.flyTag = player.fly ? '(开)' : '(关)'
  blip(player.fly ? 880 : 440, 0.09, 'sine', 0.06)
}

/* 键盘 Esc：开着背包就关背包，其余交给 pointerlockchange */
export function onEscape() {
  if (ui.bagOpen) closeBag()
}

/* 供 boot 阶段清一次按键状态 */
export function clearKeys() { Object.keys(keys).forEach((k) => (keys[k] = false)) }

/* ---------------- 导出给组件用的只读查询 ---------------- */
export const craftResultOf = () => craftResult()
export const recipeEntries = () => recipeBookEntries()
export const isRunning = () => running
export const isPaused = () => paused
export const isSpectating = () => spectate
export const heldFlags = () => ({ breakHeld, placeHeld, placeRepeat, bowCharge })
