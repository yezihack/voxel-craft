/* 存档：把「世界 + 玩家」压成一份 JSON 存进 localStorage。
 *
 * 本作的地形是**纯函数**（种子 + 世界坐标就能算出任何一格），
 * 所以存档不需要保存地形本身 —— 只保存两样东西：
 *   ① 世界参数：种子 / 维度 / 世界类型 / 昼夜时间
 *   ② 玩家改动过的格子（每个维度一张 edits 表，键 'x,y,z' → 方块 id）
 * 加上玩家状态（坐标 / 血量 / 饥饿 / 背包 / 槽位 / 盔甲）就完整了。
 *
 * 这个设计的好处是存档体积极小：一片原始地形零字节，只有玩家真正动过的
 * 方块才占空间。代价是读档必须**重建全部区块**（见 applySave 末尾）。
 *
 * ⚠ 依赖方向：本模块可以被 uiActions / loop 引用，但它**不引用**它们 ——
 * 否则 save ↔ uiActions 会成环（uiActions 需要 saveGame 给按钮用）。
 * 需要弹提示的地方一律通过返回值表达，由调用方决定怎么显示。
 */
import { CD, CW, DIM_N } from './config.js'
import { armorRestore, armorSnapshot, clearArmor } from './armor.js'
import { dimEdits } from './generate.js'
import { chunks, initChunks } from './mesher.js'
import { setWorldTime, worldTime } from './mobs.js'
import { player } from './player.js'
import { dimSpawn } from './portal.js'
import { HOTBAR_N, SLOT_N, inv, invSlots } from './survival.js'
import {
  MODE, SEED, dim, flatWorld, mode, selected,
  setColCache, setColCacheSeed, setDim, setEdits, setFlatWorld, setModeState,
  setPortalCd, setSelected, setSEED, setStructShapeCache,
} from './state.js'

/* 存档格式版本。改动字段含义时**必须**加一 —— 老档直接判为不兼容，
 * 而不是让 applySave 读到 undefined 之后在某个奇怪的地方崩掉。 */
export const SAVE_VERSION = 1
const SAVE_KEY = 'voxel-craft:save'
const META_KEY = 'voxel-craft:save:meta'
/* 自动存档间隔（秒）。60 秒是「丢了不心疼、写盘不打扰」的折中：
 * 更密会让大地图每次卡一下（JSON.stringify 几 MB），更疏则丢进度太多。 */
export const AUTOSAVE_SEC = 60

/* ---------------- 存储层 ----------------
 * 浏览器里走 localStorage，无头测试（node）里退化成一张内存表 ——
 * 这样 probe 能把「存 → 读 → 比对」整条链路跑完，而不是只测到 snapshot。 */
const mem = new Map()
const store = {
  get(k) {
    try { if (typeof localStorage !== 'undefined') return localStorage.getItem(k) } catch { /* 隐私模式禁用 */ }
    return mem.has(k) ? mem.get(k) : null
  },
  set(k, v) {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(k, v); return true }
    } catch { /* 配额满 / 被禁用 → 落到内存表，至少本次会话还能读回来 */ }
    mem.set(k, v)
    return typeof localStorage === 'undefined'
  },
  del(k) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k) } catch { /* ignore */ }
    mem.delete(k)
  },
}

/* ---------------- 快照 ---------------- */

/* 世界覆盖层 → 可 JSON 化的数组。
 * Map 直接 JSON.stringify 会变成 {}，这是最容易踩的一个坑 ——
 * 所以必须显式转成 [[key, id], …]。 */
function editsToArray() {
  const out = []
  for (let d = 0; d < DIM_N; d++) out.push([...dimEdits[d].entries()])
  return out
}

export function snapshot() {
  const p = player
  return {
    v: SAVE_VERSION,
    t: Date.now(),
    seed: SEED,
    dim,
    flat: flatWorld,
    mode,
    time: worldTime,
    player: {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, food: p.food, air: p.air,
      spawn: [p.spawn[0], p.spawn[1], p.spawn[2]],
      fly: !!p.fly,
    },
    inv: [...inv.entries()],
    slots: [...invSlots],
    armor: armorSnapshot(),
    selected,
    edits: editsToArray(),
  }
}

/* ---------------- 写盘 ---------------- */

/* 存一次。返回 { ok, bytes, reason }：
 *   ok      —— 是否真的写成功
 *   bytes   —— JSON 字节数（给 UI 显示「存档 1.2 MB」）
 *   reason  —— 失败原因（'quota' / 'serialize' / 'empty'）
 * 不弹提示：调用方（uiActions / 自动存档）自己决定要不要打扰玩家。 */
export function saveGame() {
  let json
  try { json = JSON.stringify(snapshot()) } catch { return { ok: false, reason: 'serialize', bytes: 0 } }
  const bytes = json.length
  const ok = store.set(SAVE_KEY, json)
  /* meta 单独存一份：开始面板要显示「上次存档在哪个维度、多少方块」，
   * 而为了读这几个字去解析几 MB 的主存档太亏。 */
  const snap = { t: Date.now(), dim, mode, flat: flatWorld, blocks: countEdits() }
  try { store.set(META_KEY, JSON.stringify(snap)) } catch { /* meta 失败不影响主存档 */ }
  return { ok, bytes, reason: ok ? null : 'quota' }
}

/* 改动过的方块总数（给 meta 用，也用于 UI 上的「世界已被改动 N 格」） */
export function countEdits() {
  let n = 0
  for (let d = 0; d < DIM_N; d++) n += dimEdits[d].size
  return n
}

/* ---------------- 读盘 ---------------- */

export function readSave() {
  const raw = store.get(SAVE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function hasSave() { return !!store.get(SAVE_KEY) }

export function saveMeta() {
  const raw = store.get(META_KEY)
  if (!raw) {
    /* meta 丢了但主存档还在（早期版本 / 手工清过）→ 从主存档现算一份 */
    const d = readSave()
    if (!d) return null
    return { t: d.t, dim: d.dim | 0, mode: d.mode | 0, flat: !!d.flat, blocks: 0 }
  }
  try { return JSON.parse(raw) } catch { return null }
}

export function deleteSave() {
  store.del(SAVE_KEY)
  store.del(META_KEY)
}

/* 把存档应用到当前世界。
 * 返回 { ok, reason }。**不重建 GPU 资源** —— 区块只标脏，
 * 由主循环按每帧预算重建（和 switchDim 同一套机制），否则读档会卡住好几秒。 */
export function applySave(d) {
  if (!d || d.v !== SAVE_VERSION) return { ok: false, reason: 'version' }

  /* ---- 1. 世界参数 ----
   * 顺序很重要：先定种子和世界类型，再清缓存 —— 反过来的话缓存里
   * 还留着旧种子算出来的高度，地表会一半新一半旧。 */
  if (Number.isFinite(d.seed)) setSEED(d.seed | 0)
  setFlatWorld(!!d.flat)
  setColCache(new Map())
  setColCacheSeed(SEED)
  setStructShapeCache(new Map())

  /* ---- 2. 覆盖层：8 个维度逐张重建 ----
   * 必须 clear 而不是「就地补」：读到的是另一份世界，
   * 留着当前世界的改动会让两个世界的方块叠在一起。 */
  for (let i = 0; i < DIM_N; i++) {
    const m = dimEdits[i]
    m.clear()
    const list = d.edits && d.edits[i]
    if (!list) continue
    for (const pair of list) {
      if (!pair || pair.length < 2) continue
      const id = pair[1] | 0
      if (id > 0) m.set(pair[0], id)
    }
  }

  /* ---- 3. 维度 ----
   * setDim 之后必须重指 edits —— 它默认还指向上一个维度那张表。 */
  const target = Number.isInteger(d.dim) && d.dim >= 0 && d.dim < DIM_N ? d.dim : 0
  setDim(target)
  setEdits(dimEdits[target])

  /* ---- 4. 昼夜时间 ---- */
  if (Number.isFinite(d.time)) setWorldTime(d.time)

  /* ---- 5. 玩家 ----
   * dead 一律清掉：存档时正处在死亡界面也照样复活 ——
   * 否则读档的第一秒就会弹出死亡面板，玩家会以为档坏了。
   * fallPeak / exhaust 这些「瞬时量」也归零，避免读到一半摔死。 */
  const p = player
  const s = d.player || {}
  if (Number.isFinite(s.x)) p.x = s.x
  if (Number.isFinite(s.y)) p.y = s.y
  if (Number.isFinite(s.z)) p.z = s.z
  if (Number.isFinite(s.yaw)) p.yaw = s.yaw
  if (Number.isFinite(s.pitch)) p.pitch = s.pitch
  p.vx = p.vy = p.vz = 0
  p.hp = Number.isFinite(s.hp) ? Math.min(p.maxHp, Math.max(1, s.hp)) : p.maxHp
  p.food = Number.isFinite(s.food) ? Math.min(p.maxFood, Math.max(0, s.food)) : p.maxFood
  p.air = Number.isFinite(s.air) ? Math.min(p.maxAir, Math.max(0, s.air)) : p.maxAir
  p.dead = false
  p.fallPeak = null
  p.exhaust = 0
  p.drownT = p.lavaT = p.cactusT = p.regenT = p.starveT = 0
  p.hurtFlash = 0
  p.blocking = false
  if (Array.isArray(s.spawn) && s.spawn.length === 3) p.spawn = [s.spawn[0], s.spawn[1], s.spawn[2]]
  /* 生存模式不许飞：老档里若是创造时开着飞行、后来切成生存存的，
   * 读回来会变成「生存模式在空中飘」，那是个很怪的 bug 面。 */
  const wantMode = d.mode === MODE.SURVIVAL || d.mode === MODE.SPECTATOR ? d.mode : MODE.CREATIVE
  p.fly = wantMode === MODE.CREATIVE ? !!s.fly : wantMode === MODE.SPECTATOR

  /* ---- 6. 背包与槽位 ---- */
  inv.clear()
  if (Array.isArray(d.inv)) {
    for (const pair of d.inv) {
      if (!pair || pair.length < 2) continue
      const id = pair[0] | 0, n = pair[1] | 0
      if (id > 0 && n > 0) inv.set(id, n)
    }
  }
  for (let i = 0; i < SLOT_N; i++) {
    /* 槽里只认「背包里真有的东西」：手改过的存档可能槽里写着已清空的 id，
     * 那会留下一个数量 0 的僵尸格子（界面照旧画图标、点它却没东西）。 */
    const id = Array.isArray(d.slots) ? d.slots[i] | 0 : 0
    invSlots[i] = id > 0 && inv.has(id) ? id : 0
  }
  setSelected(Number.isInteger(d.selected) ? Math.min(HOTBAR_N - 1, Math.max(0, d.selected)) : 0)

  /* ---- 7. 盔甲 ---- */
  clearArmor()
  armorRestore(d.armor)

  /* ---- 8. 模式 ---- */
  setModeState(wantMode)

  /* ---- 9. 出生点与区块 ----
   * dimSpawn 要跟着存档走：否则在异界存的档，读回来按 R 会传回
   * 「上一次游戏里那个维度的出生点」，而那可能是另一份世界。 */
  dimSpawn[target] = [p.x, p.y, p.z]
  /* 区块窗口整体挪到玩家所在处 —— 读档点可能离当前位置几千格，
   * 只标脏不重排的话，玩家脚下根本没有区块（一片虚空）。 */
  initChunks(Math.floor(p.x / CW), Math.floor(p.z / CD))
  for (const c of chunks) c.dirty = true
  setPortalCd(1.5)                       // 别让脚下的返回门立刻把人吸走

  return { ok: true, reason: null }
}

/* 读盘 + 应用，一步到位 */
export function loadGame() {
  const d = readSave()
  if (!d) return { ok: false, reason: 'none' }
  return applySave(d)
}

/* ---------------- 自动存档 ----------------
 * 由主循环每帧推进；内部自己节流，不需要调用方记时间。
 * 只在「真的在玩」时存（暂停 / 背包打开时不存 —— 那些时刻玩家可能在
 * 摆弄合成台，存下来的是一个半途状态，读回去反而困惑）。 */
let autoT = 0
export function tickAutoSave(dt, active) {
  if (!active) return null
  autoT += dt
  if (autoT < AUTOSAVE_SEC) return null
  autoT = 0
  return saveGame()
}
export function resetAutoSaveTimer() { autoT = 0 }
