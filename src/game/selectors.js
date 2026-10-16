/* 界面用的派生数据。
 * 原来写在「界面」段里的 allPlaceableIds / allItemIds / usedStore 等，
 * 以及 refreshHotbar / renderInv 每次渲染前偷偷做的 pruneSlots()，
 * 都收成这里的纯函数，供组件的 computed 调用。
 *
 * 注意这里读的是 **ui.mode / ui.selected**（响应式）而不是 state.js 里的
 * mode / selected —— 后者是给引擎读的普通模块变量，改了不会触发重渲染。 */
import { BLOCKS, HOTBAR, ITEMS, defName } from './config.js'
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
