<script setup>
import { computed } from 'vue'
import { MODE, engine, ui } from '../engine.js'
import ItemSlot from './ui/ItemSlot.vue'

/* 底部物品栏 9 格。创造模式是固定调色板（无限方块），生存模式是自己的快捷栏。 */
const slots = computed(() => (engine.hotbarSlots ? engine.hotbarSlots() : []))

function titleOf(s) {
  return s.id
    ? s.name + (ui.mode === MODE.SURVIVAL ? ' ×' + s.count : '')
    : '空格子'
}
</script>

<template>
  <div class="hotbar">
    <ItemSlot
      v-for="s in slots" :key="s.i" variant="slot" :id="s.id" :name="s.name"
      :count="s.count" :key-label="String(s.i + 1)" :title="titleOf(s)" :on="s.on"
      @pick="engine.selectSlot(s.i)"
    />
  </div>
</template>

<style scoped>
.hotbar {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  gap: 7px;
  padding: 8px;
  border-radius: 16px;
  background: var(--panel);
  border: 1px solid var(--panel-brd);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .5);
}

@media (max-height: 520px) {
  .hotbar {
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    padding: 6px
  }
}

/* 窄屏（竖屏手机）：9 格按 48px 排会顶出屏幕，把间距和留白一起收紧 */
@media (max-width: 560px) {
  .hotbar {
    gap: 4px;
    padding: 5px;
    bottom: calc(6px + env(safe-area-inset-bottom, 0px));
    border-radius: 13px;
  }
}
</style>
