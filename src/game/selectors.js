/* 界面用的派生数据。
 * 原来写在「界面」段里的 allPlaceableIds / allItemIds / usedStore 等，
 * 以及 refreshHotbar / renderInv 每次渲染前偷偷做的 pruneSlots()，
 * 都收成这里的纯函数，供组件的 computed 调用。
 *
 * 注意这里读的是 **ui.mode / ui.selected**（响应式）而不是 state.js 里的
 * mode / selected —— 后者是给引擎读的普通模块变量，改了不会触发重渲染。 */
import { BLOCKS, HOTBAR, ITEMS, ARMOR_OF, ARMOR_PARTS, ARMOR_PART_NAME, defName } from './config.js'
import { armorAt, armorPoints, armorReduction } from './armor.js'
import { enchantCount, enchantOffers, enchantSummary, isEnchantable } from './enchant.js'
import { HOTBAR_N, SLOT_N, STORE_N, invCount, invSlots, pruneSlots } from './survival.js'
import { MODE } from './state.js'
import { ui } from './uiState.js'

export const allPlaceableIds = () => BLOCKS.map((b, i) => (b ? i : 0)).filter((i) => i > 0)
export const allItemIds = () => Object.keys(ITEMS).map(Number).sort((a, b) => a - b)

/* 储物区已占用的格数（只算储物，不含快捷栏） */
export function usedStore() {
  let n = 0
  for (let i = HOTBAR_N; i < SLOT_N; i++) if (invSlots[i]) n++
  return n
}
export const totalStore = () => STORE_N
export const isSurvival = () => ui.mode === MODE.SURVIVAL

/* 底部快捷栏 9 格。
 * 创造模式显示固定调色板（无限，不显示数量），生存模式显示自己的快捷栏。 */
export function hotbarSlots() {
  pruneSlots()
  const surv = isSurvival()
  const slots = surv ? invSlots : HOTBAR
  const out = []
  for (let i = 0; i < HOTBAR_N; i++) {
    const id = slots[i] | 0
    out.push({
      i,
      id,
      name: id ? defName(id) : '',
      count: surv && id ? invCount(id) : 0,
      on: i === ui.selected,
      void: !id,
    })
  }
  return out
}

/* 背包 54 格：前 HOTBAR_N 个是快捷格，后面是储物格 */
export function invSlotsView() {
  pruneSlots()
  const out = []
  for (let i = 0; i < SLOT_N; i++) {
    const id = invSlots[i] | 0
    out.push({
      i,
      id,
      name: id ? defName(id) : '',
      count: id ? invCount(id) : 0,
      hot: i < HOTBAR_N,
      on: i < HOTBAR_N && i === ui.selected,
      void: !id,
    })
  }
  return out
}

/* 背包面板标题下的说明文案（原 renderBag 里拼的字符串） */
export function bagSubtitle() {
  return isSurvival()
    ? '快捷 9 格（1-9 键切换）+ 储物 ' + STORE_N + ' 格 = ' + SLOT_N +
      ' 格 · 点储物格与当前快捷格对调 · 拖到合成格可当材料'
    : '点击任意方块放入当前选中的格子（方块 ' + allPlaceableIds().length +
      ' 种 + 工具武器物品 ' + allItemIds().length + ' 种）'
}

/* 盔甲四槽的视图（背包面板左侧那一列）。
 * 空槽也返回 —— 得让人看得见「这里还能穿什么」，而不是穿了才出现。
 * 顺序固定为 ARMOR_PARTS（头 / 胸 / 腿 / 脚），和经典那套一致。 */
export function armorSlotsView() {
  return ARMOR_PARTS.map((part) => {
    const id = armorAt(part)
    const a = ARMOR_OF[id]
    return {
      part,
      label: ARMOR_PART_NAME[part],
      id,
      name: id ? defName(id) : '',
      pts: a ? a.pts : 0,
      empty: !id,
    }
  })
}

/* 护甲总览：点数 + 减伤百分比（HUD 与面板共用） */
export function armorSummary() {
  const pts = armorPoints()
  const red = armorReduction()
  return { pts, red, pct: Math.round(red * 100) }
}

/* ---------------- 附魔台 ----------------
 * 可上台的装备列表。
 *   生存模式：只列背包里**真有的**（同一 id 只出现一次，数量单独显示）——
 *             列一堆自己没有的装备，点上去也刻不了，纯属噪声。
 *   创造模式：列全部可附魔物品。那边没有背包账，按「有的」列等于什么都不列。
 *
 * ⚠ 用 Set 去重是必要的：invSlots 里同一个 id 只会占一格（见 survival.js），
 *   但快捷栏 / 储物格对调的历史残留可能留下重复，去重后界面永远只出一行。 */
export function enchantTargetsView() {
  const surv = isSurvival()
  const ids = surv
    ? [...new Set(invSlots.filter((id) => id && isEnchantable(id)))]
    : allItemIds().filter((id) => isEnchantable(id))
  const cur = ui.enchantTarget | 0
  return ids.map((id) => ({
    id,
    name: defName(id),
    count: surv ? invCount(id) : 0,
    on: id === cur,
    n: enchantCount(id),
    summary: enchantSummary(id),
  }))
}

/* 台面上那件装备的词条一览。
 * 每一项都带 `can`（现在能不能刻）与逐项材料状态 —— 界面据此把按钮置灰、
 * 把缺的材料标红，玩家不用自己心算。 */
export function enchantOffersView() {
  const id = ui.enchantTarget | 0
  if (!id) return []
  const list = enchantOffers(id)
  if (!list) return []
  const surv = isSurvival()
  return list.map((o) => {
    const cost = o.cost.map((c) => {
      const have = surv ? invCount(c.id) : c.n
      return { id: c.id, n: c.n, name: defName(c.id), have, ok: have >= c.n }
    })
    return {
      ...o,
      cost,
      can: !o.maxed && cost.every((c) => c.ok),
    }
  })
}

/* 台面标题栏：摆着哪件、已经刻了什么 */
export function enchantTargetView() {
  const id = ui.enchantTarget | 0
  if (!id) return null
  return { id, name: defName(id), summary: enchantSummary(id), n: enchantCount(id) }
}
