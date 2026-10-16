<script setup>
import { computed } from 'vue'
import { engine, ui } from '../engine.js'
import ItemSlot from './ui/ItemSlot.vue'

/* 生存模式的 54 格：第一排是快捷栏（带 1-9 键位号），下面五排是储物。
 * 空的储物格也画出来 —— 得让人看得见「还有多少地方能放」。
 *
 * 储物排太多会顶出面板可视区，所以默认只铺开前两排，剩下的由
 * 「展开背包全部格子」按钮控制；折叠状态存在 ui.bagExpanded 里，
 * 关掉面板再开还是上次的选择。 */
const all = computed(() => (engine.invSlotsView ? engine.invSlotsView() : []))
const ROW = computed(() => engine.HOTBAR_N || 9)

const hotRow = computed(() => all.value.filter((s) => s.hot))
const stashRows = computed(() => {
  const rows = []
  const rest = all.value.filter((s) => !s.hot)
  for (let i = 0; i < rest.length; i += ROW.value) rows.push(rest.slice(i, i + ROW.value))
  return rows
})
const shown = computed(() => (ui.bagExpanded ? stashRows.value.length : Math.min(2, stashRows.value.length)))
const hiddenRows = computed(() => stashRows.value.length - shown.value)

const used = computed(() => (engine.usedStore ? engine.usedStore() : 0))
const total = computed(() => (engine.totalStore ? engine.totalStore() : 45))

const moreLabel = computed(() => (ui.bagExpanded
  ? '收起背包（只看前 2 排）'
  : `展开背包全部格子（还有 ${hiddenRows.value} 排 · 共 ${all.value.length} 格）`))

function titleOf(s) {
  return s.id
    ? s.name + ' ×' + s.count + engine.itemTip(s.id) + (s.hot ? `（快捷格 ${s.i + 1}）` : '')
    : '空格子'
}
</script>

<template>
  <div class="invwrap">
    <div class="invlab">快捷栏 · 1-9 键选中</div>
    <div class="invgrid hotrow">
      <ItemSlot
        v-for="s in hotRow" :key="s.i" variant="islot" :id="s.id" :name="s.name"
        :count="s.count" :key-label="String(s.i + 1)" :title="titleOf(s)" :on="s.on"
        @pick="engine.clickInvSlot(s.i)"
      />
    </div>
    <div class="invlab">
      储物 · 点一下与当前快捷格对调
      <span class="bagcount">已用 {{ used }}/{{ total }}</span>
    </div>
    <div
      v-for="(row, r) in stashRows" :key="r" v-show="r < shown" class="invgrid stashrow"
    >
      <ItemSlot
        v-for="s in row" :key="s.i" variant="islot" :id="s.id" :name="s.name"
        :count="s.count" :title="titleOf(s)" @pick="engine.clickInvSlot(s.i)"
      />
    </div>
    <button class="invmore" @click="engine.toggleBagExpand()">{{ moreLabel }}</button>
  </div>
</template>

<style scoped>
.invwrap {
  display: flex;
  flex-direction: column;
  gap: 6px
}

.invlab {
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin: 2px 0 0;
}

.bagcount {
  float: right;
  color: var(--accent);
  letter-spacing: 0
}

.invgrid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px;
}

.invgrid.hotrow {
  margin-bottom: 4px
}

.invgrid.stashrow {
  margin-top: 6px
}

/* 「展开背包全部格子」按钮 —— 排在储物格下面，虚线框，跟格子区分开 */
.invmore {
  margin-top: 10px;
  padding: 8px 12px;
  width: 100%;
  border-radius: 10px;
  cursor: pointer;
  border: 1.5px dashed rgba(67, 224, 255, .42);
  background: rgba(67, 224, 255, .07);
  color: var(--accent);
  font: inherit;
  font-size: 11.5px;
  letter-spacing: .4px;
  transition: background .12s, border-color .12s;
}

.invmore:hover {
  background: rgba(67, 224, 255, .16);
  border-color: var(--accent)
}

/* 手机竖屏 9 列太挤，背包改 6 列 */
@media (max-width: 820px) {
  .invgrid {
    grid-template-columns: repeat(6, 1fr);
    gap: 5px
  }
}
</style>
