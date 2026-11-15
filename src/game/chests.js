/* 箱子：容器方块的数据模型 + 战利品。
 *
 * 「箱子」这件事有两层，别混在一起：
 *   ① 方块本身 —— 贴图、硬度、掉落、能不能放，定义在 config.js 的 BLOCKS 里。
 *   ② 容器内容 —— 每个世界里每只箱子装着什么，是**状态**，不是地形。
 *
 * ⚠ 为什么内容不进地形覆盖层（edits）：
 *   edits 存的是「这格是哪个方块 id」，是**标量**；箱子里装的是一堆物品，
 *   一个格子装不下。而且箱子会**被搬走**（挖了带不走、拆了内容得留下），
 *   内容跟着方块走会导致「箱子被挖 → 内容随方块消失 → 白送玩家一个空箱子」。
 *   所以内容单独存一份，键是「维度 + 坐标」，与方块 id 无关。
 *
 * ⚠ 同种箱子不叠层的问题在箱子这里不存在（每只箱子是独立容器），
 *   但**同一个箱子被反复开**必须拿到同一份内容 —— 所以第一次打开时
 *   惰性生成战利品并缓存进 containers，之后读缓存。
 *
 * 依赖方向：本模块只依赖 config.js（方块表 / 物品表）与 math.js（hash2），
 * 不碰 DOM / GL / 背包。背包的存取由 uiActions.js 负责（那边才认识 inv）。
 */

import { BLOCKS, I, ITEMS } from './config.js'
import { hash2 } from './math.js'

/* ---------------- 箱子类型表 ----------------
 * 每个箱子种类：
 *   name   显示名
 *   slots  容量（格数）
 *   loot   战利品池：[[物品id, 权重, 最少数量, 最多数量], …]
 *   hard   挖掘硬度（秒）—— 越贵的箱子越难拆，防止「随手一挖把宝贝弄丢」
 *
 * ⚠ 容量用「格数」而不是「堆数」：一格 = 一个物品 id 的一组数量。
 *   与背包一致（背包也是 id → 数量的映射），玩家不用学第二套规则。
 *
 * 战利品池的设计原则：**越贵的箱子，给的东西越值钱**，但**都是游戏里
 * 真实存在、拿得到的东西**，不凭空造道具。 */

export const CHEST_TYPES = {
  /* 木箱：入门级，村庄和普通遗迹里最常见 */
  wood: {
    name: '木箱', slots: 9, hard: 0.8, block: '木箱',
    loot: [
      [I.PLANK, 30, 4, 12], [I.LOG, 18, 1, 4], [I.STICK, 14, 2, 6],
      [200, 10, 1, 3], [I.COBBLE, 12, 4, 12], [I.COAL, 8, 1, 4],
      [I.SAND, 8, 2, 8], [I.GLASS, 5, 1, 3], [I.BONE, 6, 1, 3],
      [I.ARROW, 8, 2, 8], [I.SLIMEBALL, 5, 1, 3], [I.WOOL, 7, 1, 4],
    ],
  },
  /* 铁箱：中级，废弃矿井与铁匠铺附近 */
  iron: {
    name: '铁箱', slots: 18, hard: 1.8, block: '铁箱',
    loot: [
      [I.IRON, 22, 1, 5], [I.GOLD, 14, 1, 3], [I.DIAMOND, 9, 1, 2],
      [I.REDSTONE, 12, 2, 6], [I.QUARTZ, 10, 1, 4], [I.CLAY, 6, 2, 6],
      [I.PICK_IRON, 6, 1, 1], [I.SWORD_IRON, 4, 1, 1], [I.SHIELD_IRON, 4, 1, 1],
      [I.BREAD, 8, 1, 3], [I.GUNPOWDER, 7, 1, 4], [I.SPIDER_EYE, 6, 1, 3],
      [I.BOTTLE, 5, 1, 3],
    ],
  },
  /* 宝箱（黄金）：高级，沙漠神殿与遗迹深处 */
  gold: {
    name: '宝箱', slots: 27, hard: 3.0, block: '金箱',
    loot: [
      [I.GOLD, 20, 2, 6], [I.DIAMOND, 16, 2, 5], [I.EMERALD, 10, 1, 3],
      [I.PICK_DIAMOND, 8, 1, 1], [I.SWORD_DIAMOND, 7, 1, 1],
      [I.PICK_GOLD, 6, 1, 1], [I.SWORD_GOLD, 5, 1, 1],
      [I.HELM_DIAMOND, 6, 1, 1], [I.CHEST_DIAMOND, 5, 1, 1],
      [I.LEGS_DIAMOND, 5, 1, 1], [I.BOOTS_DIAMOND, 5, 1, 1],
      [I.POTION_HEAL, 8, 1, 2], [I.POTION_SPEED, 7, 1, 2],
      [I.POTION_STRENGTH, 6, 1, 2], [I.POTION_REGEN, 5, 1, 1],
      [I.ENDER_PEARL, 6, 1, 2], [I.NETHER_STAR, 3, 1, 1],
    ],
  },
  /* 末影箱：顶级，末地与 Boss 战利品 */
  ender: {
    name: '末影箱', slots: 36, hard: 5.0, block: '末影箱',
    loot: [
      [I.ENDER_PEARL, 18, 2, 6], [I.NETHER_STAR, 12, 1, 2],
      [I.DIAMOND, 14, 3, 8], [I.EMERALD, 12, 2, 6],
      [I.DRAGON_SCALE, 10, 1, 3], [I.WITHER_BONE, 10, 1, 3],
      [I.GUARDIAN_CORE, 8, 1, 2], [I.SWORD_STARFALL, 6, 1, 1],
      [I.PICK_STARFALL, 6, 1, 1], [I.AXE_STARFALL, 5, 1, 1],
      [I.STAFF_WITHER, 4, 1, 1],
      [I.HELM_STARFALL, 5, 1, 1], [I.CHEST_STARFALL, 4, 1, 1],
      [I.LEGS_STARFALL, 4, 1, 1], [I.BOOTS_STARFALL, 4, 1, 1],
      [I.POTION_NIGHT, 8, 1, 2], [I.POTION_FIRE, 7, 1, 2],
      [I.POTION_HASTE, 6, 1, 2],
    ],
  },
}

/* 箱子方块 id → 箱子种类键。
 * 由 config.js 的 BLOCKS 表反查：凡是名字在 CHEST_TYPES 里的方块就是箱子。 */
export const CHEST_BLOCK = {};      // 方块 id → 种类键
export const CHEST_OF_BLOCK = {};   // 种类键 → 方块 id
for (const key in CHEST_TYPES) {
  const t = CHEST_TYPES[key]
  const id = BLOCKS.findIndex((b) => b && b.name === t.block);
  if (id <= 0) continue;
  CHEST_BLOCK[id] = key
  CHEST_OF_BLOCK[key] = id
}

/* 是不是箱子方块 */
export const isChestBlock = (id) => CHEST_BLOCK[id] !== undefined;

/* ---------------- 容器内容存储 ----------------
 * 键：'维度:坐标'。跨维度同坐标是**不同**的箱子（8 个维度各自一份），
 * 所以维度号必须进键 —— 否则在末地把东西放进箱子，回主世界会看到同样的东西。
 *
 * 值：{ type: 种类键, items: { 物品id: 数量 } }
 * items 用普通对象而不是 Map：存档要 JSON.stringify，
 * Map 直接 stringify 会变成 {}（这是本项目已经踩过的坑）。 */

const containers = new Map()

export const chestKey = (dim, x, y, z) => dim + ':' + x + ',' + y + ',' + z

export function getContainer(dim, x, y, z) {
  return containers.get(chestKey(dim, x, y, z))
}

export function setContainer(dim, x, y, z, data) {
  containers.set(chestKey(dim, x, y, z), data)
}

export function deleteContainer(dim, x, y, z) {
  containers.delete(chestKey(dim, x, y, z))
}

export const containerCount = () => containers.size
export const clearContainers = () => containers.clear()

/* ---------------- 战利品生成 ----------------
 * 用坐标做随机源（hash2），保证**同一个箱子的内容在重新读档后不变** ——
 * 否则读一次档箱子里的东西就换一批，玩家会以为自己记错了。
 *
 * 维度也参与种子：不同维度的同坐标箱子内容不同。 */

function pickLoot(entries, seed) {
  /* 按权重挑一项。权重为 0 的条目直接跳过（占位，保持 id 完整）。 */
  let total = 0
  for (const e of entries) total += e[1]
  if (total <= 0) return null
  let r = hash2(seed, 1, 7919) * total
  for (const e of entries) {
    if (e[1] <= 0) continue
    r -= e[1]
    if (r <= 0) return e
  }
  return entries[entries.length - 1]
}

/* 生成一箱战利品。返回 { 物品id: 数量 }。
 * 数量在 [最少, 最多] 之间，由种子决定 —— 同样是确定性的。 */
export function rollLoot(typeKey, dim, x, y, z, seed) {
  const t = CHEST_TYPES[typeKey]
  const out = {}
  if (!t) return out
  /* ⚠ seed 必须先 |0 归零：直接加进表达式的话，undefined 会把整个和
   *   污染成 NaN，NaN|0 = 0 —— 全世界的箱子战利品一模一样。 */
  const base = (dim * 7919 + x * 131 + y * 17 + z * 37 + (seed | 0)) | 0
  /* 填充的格数在容量的 40%~85% 之间，空箱子不好玩，满箱子没惊喜。 */
  const fills = Math.max(1, Math.round(t.slots * (0.4 + hash2(base, 3, 104729) * 0.45)))
  for (let i = 0; i < fills; i++) {
    const e = pickLoot(t.loot, base + i * 131)
    if (!e) continue
    const id = e[0]
    /* ⚠ 方块**也是**能进背包的东西（挖到的圆石就是方块 id，见 survival.inv）。
     *   早先只查 ITEMS[id]，结果 1~199 的方块全被过滤掉 ——
     *   木箱里只剩几件物品，方块类战利品（圆石 / 沙子 / 玻璃）一个都出不来。
     *   判合法要「方块或物品都算」。 */
    if (!id || (!ITEMS[id] && !BLOCKS[id])) continue
    const lo = e[2] || 1, hi = e[3] === undefined ? lo : e[3]
    const n = lo + Math.floor(hash2(base + i, 5, 15485863) * (hi - lo + 1))
    if (n <= 0) continue
    out[id] = (out[id] || 0) + n
  }
  return out
}

/* ---------------- 打开 / 关闭箱子 ---------------- */

/* 打开一只箱子：没有内容就先生成一份战利品。
 * 返回 { type, items, name, slots } —— 界面直接照这个画。 */
export function openChest(dim, x, y, z, blockId, seed) {
  const key = chestKey(dim, x, y, z)
  let c = containers.get(key)
  if (!c) {
    const type = CHEST_BLOCK[blockId]
    if (!type) return null
    c = { type, items: rollLoot(type, dim, x, y, z, seed) }
    containers.set(key, c)
  }
  const t = CHEST_TYPES[c.type]
  return {
    key,
    type: c.type,
    name: t ? t.name : '箱子',
    slots: t ? t.slots : 9,
    items: { ...c.items },
  }
}

/* 把内容写回容器（界面里取走 / 放回东西后调用）。 */
export function writeChest(dim, x, y, z, items) {
  const key = chestKey(dim, x, y, z)
  const c = containers.get(key)
  if (!c) return false
  c.items = { ...items }
  return true
}

/* 箱子被挖掉时：内容返回给调用方（由它散落到地上 / 进背包），
 * 容器记录同时删掉 —— 留着的话玩家在同一坐标再放一个箱子，
 * 会看到旧箱子里的东西，凭空多出一份。 */
export function takeChestContents(dim, x, y, z) {
  const key = chestKey(dim, x, y, z)
  const c = containers.get(key)
  containers.delete(key)
  return c ? { ...c.items } : null
}

/* ---------------- 存档 ---------------- */

/* 序列化成可 JSON 化的结构：[[键, 种类键, {物品id: 数量}], …] */
export function chestSnapshot() {
  const out = []
  for (const [key, c] of containers) out.push([key, c.type, { ...c.items }])
  return out
}

/* 从存档恢复。**逐条校验**：
 *   · 键格式对不对（'维度:x,y,z'）
 *   · 种类键在 CHEST_TYPES 里（玩家能手改存档，塞个不存在的种类会炸）
 *   · 物品 id 必须是真实存在的物品（0 / 负数 / 不存在的 id 一律挡掉）
 *   · 数量必须是正整数
 * 存档是玩家能手改的文件，不校验就是送钱。 */
export function chestRestore(list) {
  containers.clear()
  if (!Array.isArray(list)) return
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 3) continue
    const key = row[0], type = row[1], items = row[2]
    if (typeof key !== 'string' || !CHEST_TYPES[type]) continue
    if (!items || typeof items !== 'object' || Array.isArray(items)) continue
    const clean = {}
    let any = false
    for (const k in items) {
      const id = +k, n = items[k] | 0
      if (!Number.isFinite(id) || id <= 0) continue
      /* 方块也能进箱子（圆石、木板…），所以两种表都要认。
       * 只认 ITEMS 的话，读档后箱子里的方块会**整批消失**。 */
      if (!ITEMS[id] && !BLOCKS[id]) continue
      if (n <= 0) continue
      clean[id] = Math.min(n, 9999)                // 数量封顶，防手改出 1e9
      any = true
    }
    if (!any) continue
    containers.set(key, { type, items: clean })
  }
}
