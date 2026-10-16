<script setup>
import { ui } from '../engine.js'
</script>

<template>
  <div class="toast" :class="{ show: ui.toastOn }">{{ ui.toastText }}</div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  top: 74px;
  transform: translateX(-50%) translateY(-8px);
  z-index: 26;
  pointer-events: none;
  padding: 8px 16px;
  border-radius: 11px;
  font-size: 12.5px;
  background: var(--panel);
  border: 1px solid var(--panel-brd);
  backdrop-filter: blur(10px);
  opacity: 0;
  transition: opacity .22s, transform .22s;
}

.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0)
}
</style>
