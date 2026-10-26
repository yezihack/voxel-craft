/* 界面动作门面。
 *
 * 所有「用户点了界面上某个东西」要触发的逻辑都在这里导出，组件只管调用，
 * 不去碰引擎内部状态。原先散落在 onclick / addEventListener 里的代码全部收拢到此。 */
import { audio, blip } from './audio.js'
import { armorAt, armorPoints, armorReduction, setArmorPiece } from './armor.js'
import { despawnAllBots, despawnAllBotDrops } from './bots.js'
import { despawnAllCarts } from './carts.js'
import { ARMOR_OF, ARMOR_PART_NAME, HOTBAR, defName } from './config.js'
import {
  craftAutoFill, craftClearAt, craftResult, craftSlots,
  clearCraft, doCraft, recipeBookEntries, recipeMissing,
} from './crafting.js'
import { DIMS } from './dims.js'
import { input, keys } from './input.js'
import { clamp } from './math.js'
import { chunks } from './mesher.js'
import { arrows, despawnAllMobs, surfaceY } from './mobs.js'
import { player } from './player.js'
import { canvas } from './renderer.js'
import { countEdits, deleteSave, hasSave, loadGame, saveGame, saveMeta } from './save.js'
import { HOTBAR_N, activeSlots, cancelDig, invAdd, invCount, invTake, respawn } from './survival.js'
import {
  MODE, SEED, bowCharge, breakHeld, dim, flatWorld, lookVec, mode, paused, placeHeld,
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

/* ---------------- 盔甲 ----------------
 * 背包里点一件护甲 → 穿到对应槽；点槽位 → 脱下来回背包。
 *
 * 扣减顺序刻意是「先扣背包、再写槽位」：反过来的话，一旦 invTake 失败
 * （背包里其实没有），槽位上会凭空多出一件无中生有的护甲。
 * 创造模式不扣也不退 —— 那边本来就没有背包账。 */
export function equipArmorItem(id) {
  const a = ARMOR_OF[id]
  if (!a) return false
  const surv = mode === MODE.SURVIVAL
  if (surv && !invCount(id)) return false
  const old = armorAt(a.part)
  if (surv) {
    if (!invTake(id, 1)) return false
    if (old) invAdd(old, 1)
  }
  setArmorPiece(a.part, id)
  blip(760, 0.07, 'sine', 0.045)
  toast(`🛡 穿上${defName(id)}（${ARMOR_PART_NAME[a.part]} · 护甲 +${a.pts}）`)
  return true
}

export function unequipArmorSlot(part) {
  const id = armorAt(part)
  if (!id) return false
  setArmorPiece(part, 0)
  if (mode === MODE.SURVIVAL) invAdd(id, 1)
  blip(420, 0.06, 'sine', 0.04)
  toast(`脱下${defName(id)}（已放回背包）`)
  return true
}

/* 护甲总点数 / 减伤百分比 —— 给 HUD 与背包面板显示 */
export const armorStat = () => ({ pts: armorPoints(), red: armorReduction() })

/* ---------------- 存档 ---------------- */

/* 手动存档。返回 saveGame() 的结果，UI 自己决定要不要弹提示。 */
export function saveNow(announce = true) {
  const r = saveGame()
  ui.saveRev++
  if (!announce) return r
  if (r.ok) {
    const kb = Math.max(1, Math.round(r.bytes / 1024))
    toast(`💾 已存档 · ${kb} KB · ${countEdits()} 格改动`)
    blip(880, 0.10, 'sine', 0.06)
  } else {
    toast(r.reason === 'quota' ? '⚠ 存档失败：浏览器存储空间已满' : '⚠ 存档失败：无法序列化当前世界')
    blip(180, 0.12, 'square', 0.05)
  }
  return r
}

/* 读档：应用之后**必须清场**。
 * 生物 / AI 玩家 / 矿车 / 飞行中的箭，它们的坐标都属于上一份世界 ——
 * 不清的话会出现「一只僵尸卡在新世界的岩壁里」这种穿帮
 * （和 switchDim 里那几行是同一个理由）。 */
export function loadNow() {
  const r = loadGame()
  if (!r.ok) {
    toast(r.reason === 'none' ? '还没有存档 —— 先按 F5 存一次' : '⚠ 存档版本不兼容，无法读取')
    blip(180, 0.12, 'square', 0.05)
    return r
  }
  ui.saveRev++
  despawnAllMobs()
  despawnAllBots()
  despawnAllBotDrops()
  despawnAllCarts()
  arrows.length = 0
  cancelDig()
  /* UI 侧的派生状态跟着引擎走：ui.mode / ui.survival / ui.worldFlat
   * 是组件判断「显示哪套面板」的依据，不同步的话读档后会停在错误的界面。 */
  ui.mode = mode
  ui.survival = mode === MODE.SURVIVAL
  ui.worldFlat = flatWorld
  ui.selected = selected
  ui.flyTag = player.fly ? '(开)' : '(关)'
  ui.deathVisible = false
  if (ui.bagOpen) closeBag(true)
  toast(`📂 已读档 · ${DIMS[dim].name} · ${countEdits()} 格改动`)
  blip(660, 0.12, 'sine', 0.06)
  return r
}

/* 删档 + 重开。
 * 不做「逐项重置内存状态」—— 引擎里该重置的东西太多（缓存 / 区块 / 生物 /
 * 传送门 / 运输装置…），漏一个就是幽灵 bug。重载页面是唯一可靠的重置。 */
export function newWorld() {
  deleteSave()
  ui.saveRev++
  blip(300, 0.14, 'triangle', 0.05)
  if (typeof location !== 'undefined' && location.reload) location.reload()
}

/* 存档摘要（开始面板 / 暂停面板上显示） */
export function saveStatus() {
  if (!hasSave()) return null
  const m = saveMeta()
  if (!m) return null
  const d = new Date(m.t)
  const pad = (n) => String(n).padStart(2, '0')
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const dimName = DIMS[m.dim] ? DIMS[m.dim].name : '主世界'
  const modeName = m.mode === MODE.SURVIVAL ? '生存' : m.mode === MODE.SPECTATOR ? '旁观' : '创造'
  return { when, dimName, modeName, blocks: m.blocks | 0, flat: !!m.flat }
}

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
