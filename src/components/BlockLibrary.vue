<script setup>
import { computed } from 'vue'
import { engine } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'

/* 创造模式的方块库：全部可放置方块，点一下就进当前选中的格子。
 * 工具 / 武器 / 弹药不是可放置方块，得单独补一栏 —— 否则创造模式里根本
 * 拿不到镐子和剑，也没法试手持显示。 */
const placeable = computed(() => (engine.allPlaceableIds ? engine.allPlaceableIds() : []))
const items = computed(() => (engine.allItemIds ? engine.allItemIds() : []))
const cur = computed(() => (engine.heldId ? engine.heldId() : 0))

const tip = (id) => engine.defName(id) + engine.itemTip(id)
</script>

<template>
  <div class="baggrid">
    <div
      v-for="id in placeable" :key="id" class="bg-item" :class="{ sel: id === cur }"
      :title="tip(id)" @click="engine.pickLibraryItem(id)"
    >
      <ItemIcon :id="id" />
      <span>{{ engine.defName(id) }}</span>
    </div>
    <div class="libsep">工具 · 武器 · 物品</div>
    <div
      v-for="id in items" :key="'i' + id" class="bg-item" :class="{ sel: id === cur }"
      :title="tip(id)" @click="engine.pickLibraryItem(id)"
    >
      <ItemIcon :id="id" />
      <span>{{ engine.defName(id) }}</span>
    </div>
  </div>
</template>

<style scoped>
.baggrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
}

.libsep {
  grid-column: 1/-1;
  font-size: 10.5px;
  letter-spacing: .6px;
  color: var(--dim);
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, .08);
}

.bg-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 9px 4px;
  border-radius: 11px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .04);
  font-size: 10.5px;
  color: var(--dim);
  transition: transform .1s, border-color .1s, color .1s;
}

.bg-item:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  color: var(--txt)
}

.bg-item.sel {
  border-color: var(--ok);
  background: rgba(94, 224, 138, .10)
}

@media (max-width: 820px) {
  .baggrid {
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr))
  }
}
</style>
