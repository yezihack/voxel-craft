/* 盔甲：四个槽位、护甲点数、减伤比例。
 *
 * 这一节是**纯逻辑 + 一份响应式槽位表**：不碰 DOM、不碰 WebGL、不碰背包。
 * 背包的扣减 / 退回由 uiActions.js 负责（那边才认识 inv）——
 * 这样 survival.js 可以直接 `import { armorReduction }` 而不会和
 * survival ↔ armor 成环（armor 只依赖 config，config 是叶模块）。
 *
 * 数值口径：
 *   每点护甲抵 3.2% 伤害，24 点（星陨整套）≈ 76.8%，封顶 72%。
 *   为什么封顶：不封的话星陨套能挡掉 3/4 以上的伤害，配合「吃东西回血」
 *   会让生存模式彻底失去压力 —— 那是「无敌」不是「变强」。
 *   为什么不是线性叠到 80%（Minecraft 那套）：本作的伤害基数小（僵尸 3 点），
 *   80% 减伤之后每击只剩 1 点，血条纹丝不动，反馈感反而变差。
 */
import { reactive } from 'vue'
import { ARMOR_OF, ARMOR_PARTS } from './config.js'

/* 四个槽位：id → 0 表示空。顺序固定为 ARMOR_PARTS（头 / 胸 / 腿 / 脚）。 */
export const armorSlots = reactive({ head: 0, chest: 0, legs: 0, feet: 0 })

export const ARMOR_PER_POINT = 0.032   // 每点护甲的减伤比例
export const ARMOR_MAX_RED = 0.72      // 减伤上限
export const ARMOR_MAX_POINTS = 24     // 单件最高 9 + 4 + 7 + 4 = 24（星陨整套）

/* 当前穿着的护甲总点数 */
export function armorPoints() {
  let n = 0
  for (const part of ARMOR_PARTS) {
    const a = ARMOR_OF[armorSlots[part]]
    if (a) n += a.pts
  }
  return n
}

/* 当前减伤比例（0 ~ ARMOR_MAX_RED）。没穿 = 0，调用方可以直接乘。 */
export function armorReduction() {
  const red = armorPoints() * ARMOR_PER_POINT
  return red > ARMOR_MAX_RED ? ARMOR_MAX_RED : red
}

/* 某个槽现在穿着什么（0 = 空） */
export const armorAt = (part) => armorSlots[part] | 0

/* 直接写入某个槽（**不碰背包**）。空 id 等价于脱下。
 * 返回被替换下来的那一件（0 = 原本就空），交给调用方决定退到哪。 */
export function setArmorPiece(part, id) {
  if (ARMOR_PARTS.indexOf(part) < 0) return 0
  const old = armorSlots[part] | 0
  armorSlots[part] = id | 0
  return old
}

/* 全部脱掉（读档 / 换世界时用）。返回脱下的一览，供调用方退背包。 */
export function clearArmor() {
  const out = []
  for (const part of ARMOR_PARTS) {
    const id = armorSlots[part] | 0
    if (id) { out.push(id); armorSlots[part] = 0 }
  }
  return out
}

/* 一件护甲穿在哪个槽（非护甲返回 null） */
export const armorPartOf = (id) => {
  const a = ARMOR_OF[id]
  return a ? a.part : null
}

/* 存档用的紧凑快照：{ head, chest, legs, feet } → [id, id, id, id] */
export const armorSnapshot = () => ARMOR_PARTS.map((p) => armorSlots[p] | 0)
export function armorRestore(list) {
  if (!Array.isArray(list)) return
  ARMOR_PARTS.forEach((part, i) => { armorSlots[part] = list[i] | 0 })
}
