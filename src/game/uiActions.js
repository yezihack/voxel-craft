/* 界面动作门面。
 *
 * 所有「用户点了界面上某个东西」要触发的逻辑都在这里导出，组件只管调用，
 * 不去碰引擎内部状态。原先散落在 onclick / addEventListener 里的代码全部收拢到此。 */
import { audio, blip } from './audio.js'
import { doBreak, doPlace, setOpenEnchantHook } from './actions.js'
import { armorAt, armorPoints, armorReduction, setArmorPiece } from './armor.js'
import { despawnAllBots, despawnAllBotDrops } from './bots.js'
import { despawnAllCarts } from './carts.js'
import { ARMOR_OF, ARMOR_PART_NAME, HOTBAR, I, defName } from './config.js'
import {
  craftAutoFill, craftClearAt, craftResult, craftSlots,
  clearCraft, doCraft, recipeBookEntries, recipeMissing,
} from './crafting.js'
import { DIMS } from './dims.js'
import { ENCH, costOf, enchantLevel, inscribe, isEnchantable } from './enchant.js'
import { input, keys } from './input.js'
import { clamp } from './math.js'
import { chunks } from './mesher.js'
import { arrows, despawnAllMobs, surfaceY } from './mobs.js'
import { player } from './player.js'
import { canvas } from './renderer.js'
import { countEdits, deleteSave, exportSaveJson, hasSave, importSaveJson, loadGame, saveGame, saveMeta } from './save.js'
import { HOTBAR_N, activeSlots, cancelDig, heldId, invAdd, invCount, invTake, respawn } from './survival.js'
import {
  MODE, SEED, bowCharge, breakHeld, dim, flatWorld, lookVec, mode, paused, placeHeld,
  placeRepeat, running, selected, setBowCharge, setBreakHeld, setColCache,
  setColCacheSeed, setFlatWorld, setLastAction, setModeState, setPaused, setPlaceHeld,
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
  toast(v ? '▬ 超平坦世界：一马平川无树林，村庄 / 遗迹 / 矿井照旧生成'
          : '⛰️ 经典世界：起伏地形 + 村庄 / 遗迹 / 矿井')
  blip(v ? 620 : 420, 0.10, 'sine', 0.05)
}

/* ---------------- 开始 / 暂停 / 背包面板 ----------------
 *
 * 请求指针锁定的安全封装。
 * 新版 Chrome 的 requestPointerLock() 返回 Promise，没有用户手势时它会
 * **reject**；不接住就是一条 unhandledrejection，而 App.vue 把未捕获异常
 * 一律显示成「游戏出错了」—— 玩家会看到一句英文报错糊在屏幕上。
 * 典型触发场景：按 Esc 关面板时那一下点击不被算作手势、或者刚 alt-tab 回来。
 * 所以：接住 promise，同步抛也吞掉。锁不上本来就有 pointerlockerror 兜底。 */
function requestLockSafe() {
  try {
    const r = canvas.requestPointerLock && canvas.requestPointerLock()
    if (r && typeof r.catch === 'function') r.catch(() => {})
  } catch { /* 老浏览器同步抛，忽略 */ }
}

export function startGame(wantLock = true) {
  audio()
  if (ui.bagOpen) closeBag(true)
  if (ui.enchantOpen) closeEnchant(true)
  setRunning(true)
  setPaused(false)
  ui.started = true
  ui.veilVisible = false
  ui.deathVisible = false
  if (wantLock) requestLockSafe()
}

export function pauseGame() {
  setRunning(false)
  setPaused(true)
  Object.keys(input).forEach((k) => (input[k] = false))
  setBreakHeld(false); setPlaceHeld(false); setPlaceRepeat(false)
  setBowCharge(0)
  cancelDig()
  /* 背包 / 附魔台面板本身就是「暂停界面」，别再叠一层遮罩 ——
   * 两层叠在一起时点掉遮罩会留下一个还在暂停的游戏，玩家以为卡死了。 */
  if (ui.bagOpen || ui.enchantOpen) return
  ui.veilVisible = true
  ui.veilHint = ui.touch
    ? '已暂停 — 点「开始游戏」继续'
    : '已暂停 — 点击继续，或按 <b>Esc</b> 关闭鼠标锁定'
}

/* 面板需要真实鼠标指针，所以打开时必须退出指针锁定；关闭时再请求锁回来。
 * 浏览器对「刚退出锁定就立刻重新锁定」有冷却，若被拒绝，
 * 就退化成显示暂停遮罩 —— 点一下即可继续，不会卡死。 */
export function openBag() {
  if (ui.enchantOpen) closeEnchant(true)   // 两个面板互斥，不然会叠在一起
  ui.bagOpen = true
  ui.veilVisible = false
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  else pauseGame()                    // 触屏等没有指针锁定的环境，手动暂停
  blip(600, 0.06, 'sine', 0.05)
}

export function closeBag(silent) {
  ui.bagOpen = false
  if (ui.touch) { startGame(false); return }
  requestLockSafe()
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

/* ---------------- 附魔台 ----------------
 * 词条规则（哪些能刻、刻到几级、要什么材料）全在 enchant.js；
 * 这里只做三件界面侧的事：开关台面、选装备、扣材料后调用 inscribe。
 *
 * 和背包面板完全同构：打开 = 退出指针锁（拿不到就手动暂停），关闭 = 请求锁回来。
 * 两个面板互斥 —— 同时开着的话，Esc 只能关掉其中一个，另一个就成了鬼影。 */
export function openEnchant() {
  if (ui.bagOpen) closeBag(true)
  ui.enchantOpen = true
  ui.veilVisible = false
  /* 台面默认把**手上正拿着的**可附魔装备摆上去：玩家是「手持剑对着台子右键」
   * 进来的，想刻的多半就是手里这把，省掉一次多余的点击。
   * 手里是方块/食物时就保持上一次的选择（可能是空）。 */
  const held = heldId()
  if (isEnchantable(held)) ui.enchantTarget = held
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  else pauseGame()
  blip(760, 0.09, 'sine', 0.05)
}

export function closeEnchant(silent) {
  if (!ui.enchantOpen) return
  ui.enchantOpen = false
  ui.enchantTarget = 0
  if (ui.touch) { startGame(false); return }
  requestLockSafe()
  if (!silent) blip(440, 0.06, 'sine', 0.05)
}

/* 点左侧的装备 = 摆到台面上 */
export function enchantPickItem(id) {
  const v = id | 0
  if (v && !isEnchantable(v)) {
    toast('这件东西上不了附魔台 —— 只有武器 / 工具 / 护甲 / 弓 / 盾能铭刻')
    blip(180, 0.09, 'square', 0.04)
    return false
  }
  ui.enchantTarget = v
  blip(660, 0.05, 'sine', 0.035)
  return true
}

/* 铭刻一级：先整体校验材料，再一次性扣，最后改等级。
 * 顺序不能反 —— 先扣再校验的话，一旦后面失败，材料就白扣了（背包是不可回滚的）。 */
export function enchantInscribe(key) {
  const id = ui.enchantTarget | 0
  const e = ENCH[key]
  if (!id || !e) return { ok: false, reason: 'none' }
  if (!e.fits(id)) return { ok: false, reason: 'fit' }
  const lv = enchantLevel(id, key)
  if (lv >= e.max) {
    toast(e.name + ' 已经到顶了（' + 'I'.repeat(e.max) + '）')
    blip(200, 0.08, 'square', 0.03)
    return { ok: false, reason: 'max' }
  }
  const cost = costOf(key, lv + 1)
  const surv = mode === MODE.SURVIVAL
  if (surv) {
    const miss = cost.filter((c) => invCount(c.id) < c.n)
    if (miss.length) {
      toast('材料不够：缺 ' + miss.map((c) => defName(c.id) + '×' + (c.n - invCount(c.id))).join('、'))
      blip(200, 0.08, 'square', 0.03)
      return { ok: false, reason: 'cost' }
    }
    for (const c of cost) invTake(c.id, c.n)
  }
  const r = inscribe(id, key)
  if (!r.ok) return r
  blip(980, 0.10, 'sine', 0.06)
  toast(`✨ ${defName(id)} 铭刻「${e.name} ${'I'.repeat(r.level)}」 · ${e.desc(r.level)}`)
  return r
}

/* 把「开台」这个动作接回 actions.js 的右键分派（那边不能反向 import 本模块）。
 *
 * ⚠ **不能在本模块顶层调用**。actions.js 和本模块之间本来就有一条环：
 *   actions → mobs → input → uiActions → actions
 * 于是本模块的函数体可能在 actions.js 还停在「求值中」的时候就开始跑，
 * 此刻 actions 里的 `let onOpenEnchant` 还没初始化 —— 顶层调用必然撞
 * 「Cannot access 'onOpenEnchant' before initialization」（TDZ）。
 * 这和 bots.js 的 installBotHook 是同一个坑，解法也一样：
 * 由一个「一切都就位之后」的时机来装，即 boot()。 */
export function installEnchantHook() { setOpenEnchantHook(openEnchant) }

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
  ui.deathVisible = false
  if (ui.bagOpen) closeBag(true)
  if (ui.enchantOpen) closeEnchant(true)
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

/* 把存档导出成一个 .json 文件（浏览器下载）。
 * 先 saveGame 一遍：保证导出的是「此刻的进度」而不是上次自动存档的旧档。
 * 下载失败不报异常 —— 有些内嵌 WebView 禁下载，提示玩家换浏览器即可。 */
export function exportSave() {
  saveGame()
  ui.saveRev++
  const json = exportSaveJson()
  if (!json) {
    toast('⚠ 还没有可导出的存档')
    blip(180, 0.12, 'square', 0.05)
    return { ok: false, reason: 'none' }
  }
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const name = `voxel-craft-save-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    const kb = Math.max(1, Math.round(json.length / 1024))
    toast(`⬇ 已导出 ${name} · ${kb} KB`)
    blip(880, 0.10, 'sine', 0.06)
    return { ok: true, bytes: json.length }
  } catch {
    toast('⚠ 导出失败：当前浏览器不允许下载文件')
    blip(180, 0.12, 'square', 0.05)
    return { ok: false, reason: 'download' }
  }
}

/* 从文件导入存档：校验 → 覆盖浏览器存档 → 立刻读档进世界。
 * 「导入即生效」比「导入后还得再点一次继续」直白 —— 文件就是玩家选的那份，
 * 没有比让世界直接变成它更不容易误解的反馈了。 */
export async function importSaveFile(file) {
  if (!file) return { ok: false, reason: 'none' }
  let text
  try { text = await file.text() } catch {
    toast('⚠ 读文件失败')
    blip(180, 0.12, 'square', 0.05)
    return { ok: false, reason: 'read' }
  }
  const ir = importSaveJson(text)
  if (!ir.ok) {
    toast(ir.reason === 'version' ? '⚠ 存档版本不兼容，无法导入' : '⚠ 这个文件不是有效的存档 JSON')
    blip(180, 0.12, 'square', 0.05)
    return ir
  }
  ui.saveRev++
  const lr = loadNow()
  return lr
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
  blip(player.fly ? 880 : 440, 0.09, 'sine', 0.06)
  toast(player.fly ? '✈ 飞行已开启' : '✈ 飞行已关闭')
}

/* 触屏「模式」按钮：和键盘 G 完全同一套循环（创造 ↔ 生存，旁观回创造）。
 * 抽到这里是为了让键盘与按钮共用一个入口 —— 两边各写一遍迟早会跑偏。 */
export function cycleMode() {
  setMode(mode === MODE.SURVIVAL ? MODE.CREATIVE
    : mode === MODE.CREATIVE ? MODE.SURVIVAL
      : MODE.CREATIVE)
}

/* ---------------- 触屏「挖」与「放」 ----------------
 * 触屏没有左右键，所以各给一个独立按钮。语义必须和鼠标逐条对齐，
 * 否则同一个人换设备就会遇到「挖不动 / 放不下」：
 *
 *   挖：按住 = setBreakHeld(true)，松手 = 松开并 cancelDig。
 *       生存模式不在这里直接破块 —— 必须走 updateDig 的硬度计时，
 *       否则按住按钮会绕过挖掘时间；创造模式才瞬破。
 *   放：按下立刻 doPlace() 给一次反馈；同时打开 placeRepeat，
 *       按住不放由主循环按 0.22s 节流连发（铺路时不用一直点）。
 *       手持弓时 placeHeld 会让主循环蓄力，手持盾牌时则进入格挡 ——
 *       这两个复用都是「按住右键」的语义，按钮天然一致。 */
export function touchMine(on) {
  if (!on) { setBreakHeld(false); cancelDig(); return }
  if (mode === MODE.SPECTATOR || !running) return
  setBreakHeld(true)
  setLastAction(performance.now() / 1000)
  if (mode !== MODE.SURVIVAL) doBreak()
}

export function touchPlace(on) {
  if (!on) { setPlaceHeld(false); setPlaceRepeat(false); return }
  if (mode === MODE.SPECTATOR || !running) return
  setPlaceHeld(true)
  setPlaceRepeat(true)
  doPlace()
  setLastAction(performance.now() / 1000)
}

/* 键盘 Esc：开着附魔台 / 背包就关掉，其余交给 pointerlockchange。
 * 顺序固定（附魔台 → 背包）：两个面板互斥，所以这个顺序只在「都开着」这种
 * 本不该出现的状态里才有意义，但按「后开的先关」总不会错。 */
export function onEscape() {
  if (ui.enchantOpen) { closeEnchant(); return }
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
