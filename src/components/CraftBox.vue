<script setup>
import { computed } from 'vue'
import { engine } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'
import RecipeBook from './RecipeBook.vue'

/* 3×3 合成台 + 结果格 + 右边的配方书。只在生存模式显示。 */
const slots = computed(() => (engine.craftSlots ? [...engine.craftSlots] : []))
const result = computed(() => (engine.craftResult ? engine.craftResult() : null))

const slotTitle = (id) => (id
  ? engine.defName(id) + '（点一下放回背包）'
  : '合成格 · 点背包里的格子放材料')
const outTitle = computed(() => (result.value
  ? '取走 ' + engine.defName(result.value.out) + ' ×' + result.value.n
  : '把材料按配方摆进左边的九宫格'))
</script>

<template>
  <div class="craftbox">
    <div class="craftleft">
      <div class="craftgrid">
        <div
          v-for="(id, i) in slots" :key="i" class="cslot" :class="{ filled: !!id }"
          :title="slotTitle(id)" @click="engine.clearCraftSlot(i)"
        >
          <template v-if="id">
            <ItemIcon :id="id" />
            <span class="cnt">1</span>
          </template>
        </div>
      </div>
      <div class="craftarrow">➜</div>
      <div
        class="craftout" :class="{ can: !!result }" :title="outTitle"
        @click="engine.takeCraftResult()"
      >
        <template v-if="result">
          <ItemIcon :id="result.out" />
          <span class="cnt">{{ result.n }}</span>
        </template>
        <span v-else class="none">?</span>
      </div>
    </div>
    <div class="craftright">
      <div class="crafthead">
        <span>配方书</span>
        <button class="craftfill" @click="engine.clearCraftAll()">清空合成格</button>
      </div>
      <RecipeBook />
    </div>
  </div>
</template>

<style scoped>
.craftbox {
  display: flex;
  gap: 18px;
  margin-bottom: 14px;
  align-items: flex-start;
}

.craftleft {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.craftgrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.cslot {
  --ic: 28px;
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 9px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .12);
  background: rgba(255, 255, 255, .05);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .1s, border-color .1s, background .1s;
}

.cslot:hover {
  border-color: var(--accent);
  transform: translateY(-2px)
}

.cslot.filled {
  border-color: rgba(67, 224, 255, .5);
  background: rgba(67, 224, 255, .10)
}

.cslot .cnt {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.craftarrow {
  color: var(--dim);
  font-size: 19px
}

.craftout {
  --ic: 38px;
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 12px;
  cursor: pointer;
  border: 1.5px dashed rgba(94, 224, 138, .5);
  background: rgba(94, 224, 138, .08);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .1s, border-color .1s, background .1s;
}

.craftout.can {
  border-style: solid;
  border-color: var(--ok);
  background: rgba(94, 224, 138, .20);
  box-shadow: 0 0 16px rgba(94, 224, 138, .28)
}

.craftout.can:hover {
  transform: scale(1.06)
}

.craftout .cnt {
  position: absolute;
  right: 4px;
  bottom: 3px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.craftout .none {
  color: var(--dim);
  font-size: 20px
}

.craftright {
  flex: 1 1 auto;
  min-width: 0
}

.crafthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin-bottom: 6px;
  white-space: nowrap;
}

.craftfill {
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.craftfill:hover {
  border-color: var(--accent);
  color: var(--txt)
}
</style>
