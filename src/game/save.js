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
import { CD, CW, DIM_N, isBlockId } from './config.js'
import { armorRestore, armorSnapshot, clearArmor } from './armor.js'
import { chestRestore, chestSnapshot } from './chests.js'
import { enchantRestore, enchantSnapshot } from './enchant.js'
import { dimEdits } from './generate.js'
import { buildEditDelta } from './cloudDelta.js'
import { isOwnerCode, normalizeAlias } from './aliasName.js'
import { chunks, initChunks } from './mesher.js'
import { setWorldTime, worldTime } from './mobs.js'
import { player } from './player.js'
import { dimSpawn } from './portal.js'
import { potionRestore, potionSnapshot } from './potions.js'
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
    /* 附魔铭刻：{ 物品id: { 词条键: 等级 } }。是「世界状态」而不是「玩家状态」
     * （换了世界也该跟着走），但存档本来就是世界 + 玩家一体的，放这一层最省事。 */
    ench: enchantSnapshot(),
    /* 正在生效的药水：[key, 剩余秒]。读档后继续倒计时，
     * 而不是「存一次档就把药水续满」—— 后者等于无限药水。 */
    potions: potionSnapshot(),
    /* 箱子内容：[[ '维度:x,y,z', 种类键, {物品id: 数量} ], …]。
     * 箱子是**世界状态**（不是玩家状态），换档也跟着走。 */
    chests: chestSnapshot(),
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
  let snap, json
  try { snap = snapshot(); json = JSON.stringify(snap) } catch { return { ok: false, reason: 'serialize', bytes: 0 } }
  const bytes = json.length
  const ok = store.set(SAVE_KEY, json)
  /* meta 单独存一份：开始面板要显示「上次存档在哪个维度、多少方块」，
   * 而为了读这几个字去解析几 MB 的主存档太亏。 */
  const metaSnap = { t: Date.now(), dim, mode, flat: flatWorld, blocks: countEdits() }
  try { store.set(META_KEY, JSON.stringify(metaSnap)) } catch { /* meta 失败不影响主存档 */ }
  /* 顺手推云端：D1 是持久真源，localStorage 只是缓存 + 离线层。
   * 异步 fire-and-forget——本地写盘结果才是 saveGame 的返回值。 */
  pushToCloud(snap)
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
  invalidateCloud()
  deleteCloudSave()                            // 异步删云端，失败静默
}

/* ---------------- 云同步（Cloudflare D1） ----------------
 * 浏览器不能直接连 D1（服务端绑定），所有落库都走 Pages Functions
 * （functions/api/save.js）。这里 localStorage 继续当「首跳读缓存 + 离线层」，
 * D1 是持久真源——大地图不再受 localStorage ~5MB 配额威胁，清数据也有备份。
 *
 * 身份 = 匿名 UUID（MVP）：首次运行生成一个存在 localStorage；换设备 / 清数据即失联
 * （档仍在 D1 但拿不回）——这是 MVP 已知取舍，「存档码」认领留作第二阶段。 */

const OWNER_KEY = 'voxel-craft:owner'
/* 别名只做展示缓存（真值在 D1）：离线时面板仍能显示「这份档叫什么」。 */
const ALIAS_KEY = 'voxel-craft:alias'

function cachedAlias() {
  try { return typeof localStorage !== 'undefined' ? (localStorage.getItem(ALIAS_KEY) || '') : '' } catch { return '' }
}
function cacheAlias(a) {
  try {
    if (typeof localStorage === 'undefined') return
    if (a) localStorage.setItem(ALIAS_KEY, a)
    else localStorage.removeItem(ALIAS_KEY)
  } catch { /* 隐私模式禁用 */ }
}

export function getOwner() {
  try {
    if (typeof localStorage !== 'undefined') {
      let o = localStorage.getItem(OWNER_KEY)
      if (!o) {
        o = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36)
        localStorage.setItem(OWNER_KEY, o)
      }
      return o
    }
  } catch { /* 隐私模式禁用 */ }
  return 'anon'                                   // node / 无 localStorage 兜底
}

/* 认领另一台设备的存档码（第二阶段「跨设备取回」的入口）。
 * 只接受 UUID 形态的字符，防止把任意字符串当 owner 写进请求头；
 * 换身份必须清掉增量基线，否则下一笔 diff 会拿旧 owner 的世界状态去算。 */
export function setOwner(code) {
  const c = String(code || '').trim()
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(c)) return false
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OWNER_KEY, c)
      cacheAlias('')                                // 换身份别把上一位 owner 的别名闪出来
      invalidateCloud()
      return true
    }
  } catch { /* 隐私模式禁用 */ }
  return false
}

/* 上次成功推到云端的 edits 快照（按维度分表的 Map）。
 * null = 云端还没有这份世界的基线，下次推送要把全部 edits 都发上去。 */
let lastPushed = null

/* 拉取 / 导入 / 开新世界后调用：让下次推送把当前内存状态完整重传，
 * 而不是拿过时基线算 diff（会漏掉大量改动）。 */
export function invalidateCloud() { lastPushed = null }

function snapshotEdits() {
  const out = []
  for (let d = 0; d < DIM_N; d++) out.push(new Map(dimEdits[d]))
  return out
}

/* 推一份快照到云端（异步、不阻塞、失败静默）。
 * 只发「相对上次推送改动过的格子」——数 MB 的世界也不会每 60 秒重传整体。 */
export function pushToCloud(snap) {
  if (typeof fetch === 'undefined') { lastPushed = snapshotEdits(); return }
  const cur = snapshotEdits()
  let delta = { added: [], removed: [] }
  try { delta = buildEditDelta(cur, lastPushed) } catch { /* diff 失败就发全量兜底 */ }
  lastPushed = cur

  const payload = {
    v: snap.v,
    seed: snap.seed, dim: snap.dim, flat: snap.flat, mode: snap.mode, time: snap.time,
    selected: snap.selected,
    player: snap.player,
    inv: snap.inv, slots: snap.slots,
    armor: snap.armor, ench: snap.ench, potions: snap.potions, chests: snap.chests,
    edits: delta,
  }
  fetch('/api/save', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner': getOwner() },
    body: JSON.stringify(payload),
  }).then((r) => {
    /* 失败必须清掉基线：否则这批增量永远不会被重发，云端会静默少几个格子。
     * 下次 pushToCloud 以 lastPushed=null 重算全量 diff 补上。 */
    if (!r.ok) { lastPushed = null; console.warn('[cloud] push failed', r.status) }
  }).catch((e) => {
    lastPushed = null                                     // 离线 / 抖动：本地缓存仍有效
    console.warn('[cloud] push failed', e)
  })
}

/* 从云端拉完整快照（异步）。无档或出错返回 null。 */
export async function pullFromCloud() {
  if (typeof fetch === 'undefined') return null
  try {
    const r = await fetch('/api/save', { headers: { 'x-owner': getOwner() } })
    if (!r.ok) return null
    const data = await r.json()
    return data && data.save ? data.save : null
  } catch { return null }
}

/* 云端是否有存档（异步，供开始面板门控）。返回 null 或 { has,t,dim,mode,flat,blocks }。 */
export async function cloudMeta() {
  if (typeof fetch === 'undefined') return null
  try {
    const r = await fetch('/api/save?meta=1', { headers: { 'x-owner': getOwner() } })
    /* 404 = 后端通、这个 owner 还没档；其它非 2xx / 网络异常 = 云端不可达。
     * 两者要分开，开始面板才能显示「尚无备份」而不是误报「离线」。 */
    if (r.status === 404) return { has: false }
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

/* 无本地档时回退云端：拉回 → 写本地缓存（之后离线读档也能用）→ applySave。 */
export async function loadFromCloud() {
  const d = await pullFromCloud()
  if (!d) return { ok: false, reason: 'none' }
  try {
    store.set(SAVE_KEY, JSON.stringify(d))
    let blocks = 0
    if (Array.isArray(d.edits)) for (const list of d.edits) if (Array.isArray(list)) blocks += list.length
    store.set(META_KEY, JSON.stringify({
      t: Number.isFinite(d.t) ? d.t : Date.now(), dim: d.dim | 0, mode: d.mode | 0, flat: !!d.flat, blocks,
    }))
  } catch { /* 缓存失败不影响云端读档 */ }
  invalidateCloud()
  return applySave(d)
}

/* 删云端存档（异步 fire-and-forget，配合 deleteSave）。 */
export function deleteCloudSave() {
  if (typeof fetch === 'undefined') return
  fetch('/api/save', { method: 'DELETE', headers: { 'x-owner': getOwner() } }).catch(() => {})
}

/* ---------------- 存档别名（好记的名字 ↔ UUID） ----------------
 * UUID 精确但难记；别名由玩家设置、绑在 D1 的 aliases 表上。
 * 换设备时输入别名 → 解析回 owner → 仍走同一套 loadFromCloud。
 * 别名**不参与存档主键**：saves / edits 永远只按 owner 存，改名不影响档。 */

/* 当前 owner 的别名。无别名返回 ''，断网时退回本地展示缓存。 */
export async function getAlias() {
  if (typeof fetch === 'undefined') return cachedAlias()
  try {
    const r = await fetch('/api/alias', { headers: { 'x-owner': getOwner() } })
    if (!r.ok) return cachedAlias()
    const d = await r.json()
    const a = d && d.alias ? String(d.alias) : ''
    cacheAlias(a)
    return a
  } catch { return cachedAlias() }
}

/* 绑定 / 改名。返回 {ok:true, alias} 或 {ok:false, reason:'taken'|'invalid'}；
 * 业务失败走 200 + body reason（不用 4xx，免得浏览器记控制台资源错误），
 * 所以这里必须把 body 交给 UI 解释，不能只看 r.ok。 */
export async function setAlias(name) {
  if (typeof fetch === 'undefined') return null
  try {
    const r = await fetch('/api/alias', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-owner': getOwner() },
      body: JSON.stringify({ name: String(name || '') }),
    })
    if (!r.ok) return null
    const d = await r.json()
    if (d && d.ok) cacheAlias(String(d.alias || ''))
    return d
  } catch { return null }
}

/* 按别名解析 owner（认领用）。没绑定返回 null。 */
export async function lookupAlias(name) {
  if (typeof fetch === 'undefined') return null
  try {
    const r = await fetch('/api/alias?name=' + encodeURIComponent(String(name || '').trim()), {
      headers: { 'x-owner': getOwner() },
    })
    if (!r.ok) return null
    const d = await r.json()
    return d && d.owner ? String(d.owner) : null
  } catch { return null }
}

/* 认领框的统一入口：存档码直接用，其余按别名查。
 * 先判 owner code 再判别名，避免一个 10 字符的纯字母别名被当成 UUID 写进 x-owner。 */
export async function resolveOwner(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (isOwnerCode(s)) return s
  if (!normalizeAlias(s)) return null
  return lookupAlias(s)
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
      const key = pair[0]
      const raw = +pair[1]
      /* ⚠ id 为 0 是**有意义的**，不能过滤掉。
       * 挖掉一格方块时 setBlock 走的是 `edits.set(k, 0)`（见 generate.js）——
       * 值 0 表示「这格被我挖成空气了」，不是「没有改动」。这里曾经写成
       * `if (id > 0)`，结果所有挖出来的沟读档后全部长回原样，而放上去的方块
       * 因为 id>0 反而活得好好的 —— 玩家看到的就是「我挖的沟没了」。
       * 只挡掉非法值：负数 / NaN / 超界 id / 非字符串键。 */
      if (typeof key !== 'string' || !Number.isFinite(raw) || raw < 0) continue
      const id = raw | 0
      if (id !== 0 && !isBlockId(id)) continue
      m.set(key, id)
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

  /* ---- 7b. 附魔铭刻 ----
   * 无条件调一次（老档没有这个字段就传 undefined）—— enchantRestore 内部
   * 会先清空再逐条校验，所以「没有附魔数据」等价于「一件都没刻」，而不是
   * 「保留上一次读档留下的词条」。少了这句，从有附魔的档切到无附魔的档，
   * 词条会跟着世界一起留下来 —— 那是跨存档的作弊。
   *
   * 校验（词条键存在 / 适用该装备 / 等级在 1..max）在 enchant.js 里做：
   * 存档是可以被玩家手改的文件，一条 sharp:999 就能把攻击力变成 999。 */
  enchantRestore(d.ench)

  /* ---- 7c. 药水 ----
   * 同样无条件调用：老档没有 potions 字段 → potionRestore(undefined) 清空，
   * 而不是「保留上一次读档喝剩的药水」。逐条校验在 potions.js 里做
   * （键存在 / 非即时型 / 时长夹到 dur）。 */
  potionRestore(d.potions)

  /* ---- 7d. 箱子内容 ----
   * 同样无条件调用：老档没有 chests 字段 → chestRestore(undefined) 清空。
   * 逐条校验在 chests.js 里做（种类键存在 / 物品 id 真实 / 数量为正 / 封顶 9999）——
   * 存档是玩家能手改的文件。 */
  chestRestore(d.chests)

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
  const r = applySave(d)
  if (r.ok) invalidateCloud()                 // 内存已是这份世界，下次推送以它为基线
  return r
}

/* ---------------- 存档 JSON 编解码（UI 已移除） ----------------
 * 云端 D1 上线后，「导出 / 导入 .json 文件」这组按钮已经从开始面板移除：
 * 存档真源在服务端，文件交换反而容易和云端版本分叉、还要玩家自己保管。
 *
 * 但下面两个纯函数**保留**：它们是存档 JSON 的唯一编解码入口，
 * .scratch/saveio、.scratch/savehole 的往返探针仍以它们验证字段级容错；
 * 也是将来若要做「离线文件备份」时唯一正确的起点。
 * 注意：应用侧不要再给它们接 UI —— 导入只写本地缓存、不会推云端。 */

/* 取存档 JSON 字符串。没档时退回内存快照。 */
export function exportSaveJson() {
  const raw = store.get(SAVE_KEY)
  if (raw) return raw
  try { return JSON.stringify(snapshot()) } catch { return null }
}

/* 校验并导入一份存档 JSON 文本。
 * 只做「能不能存进浏览器」级别的校验（JSON 合法 + 版本号认识），
 * 字段级的容错由 applySave 负责 —— 那边对每个字段都做了防御。
 * 导入即替换当前存档：读档由调用方决定（uiActions 里导入后立刻 loadNow）。 */
export function importSaveJson(text) {
  let d
  try { d = JSON.parse(text) } catch { return { ok: false, reason: 'parse' } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: 'parse' }
  if (d.v !== SAVE_VERSION) return { ok: false, reason: 'version' }
  const json = JSON.stringify(d)
  const ok = store.set(SAVE_KEY, json)
  if (!ok) return { ok: false, reason: 'quota' }
  /* meta 同步重建：开始面板摘要直接就能显示导入档的信息，
   * 不用等下一次 saveGame 覆盖。blocks 按 edits 表行数现算。 */
  let blocks = 0
  if (Array.isArray(d.edits)) for (const list of d.edits) if (Array.isArray(list)) blocks += list.length
  try {
    store.set(META_KEY, JSON.stringify({
      t: Number.isFinite(d.t) ? d.t : Date.now(),
      dim: d.dim | 0, mode: d.mode | 0, flat: !!d.flat, blocks,
    }))
  } catch { /* meta 失败不影响主存档 */ }
  invalidateCloud()                            // 整份世界被文件覆盖，下次推送重传全量
  return { ok: true, bytes: json.length }
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
