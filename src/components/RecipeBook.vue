<script setup>
import { computed } from 'vue'
import { MODE, engine, ui } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'

/* 配方书。每一条点一下就自动摆料；材料不够的条目变灰并在 tooltip 里标出缺什么。 */
const entries = computed(() => {
  if (!engine.recipeBookEntries) return []
  return engine.recipeBookEntries().map((e) => {
    const miss = ui.mode === MODE.SURVIVAL ? engine.recipeMissing(e) : []
    const mats = e.need.length
      ? [...new Set(e.need)].map((id) => engine.defName(id)).join(' + ')
      : '任意'
    return {
      entry: e,
      out: e.out,
      n: e.n,
      canMake: miss.length === 0,
      title: engine.defName(e.out) + ' ×' + e.n + '　材料：' + mats +
        (miss.length ? '　（缺：' + miss.map((m) => m[0] + '×' + m[2]).join('、') + '）' : ''),
    }
  })
})
</script>

<template>
  <div class="booklist">
    <div
      v-for="(it, i) in entries" :key="i" class="bk" :class="{ no: !it.canMake }"
      :title="it.title" @click="engine.pickRecipe(it.entry)"
    >
      <ItemIcon :id="it.out" />
      <span v-if="it.n > 1" class="cnt">{{ it.n }}</span>
    </div>
  </div>
</template>

<style scoped>
.booklist {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
  gap: 6px;
  max-height: 176px;
  overflow: auto;
  padding-right: 2px;
}

.bk {
  --ic: 30px;
  position: relative;
  height: 52px;
  border-radius: 9px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .04);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .1s, border-color .1s;
}

.bk:hover {
  border-color: var(--accent);
  transform: translateY(-2px)
}

.bk.no {
  opacity: .36;
  cursor: not-allowed
}

.bk .cnt {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 9.5px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}
</style>
