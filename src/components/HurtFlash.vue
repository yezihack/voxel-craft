<script setup>
import { ui } from '../engine.js'
</script>

<template>
  <div class="hurt" :class="{ on: ui.hurt }" />
</template>

<style scoped>
.hurt {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 14;
  opacity: 0;
  transition: opacity .22s ease-out;
  background: radial-gradient(circle at 50% 50%, transparent 38%, rgba(196, 22, 44, .62) 100%);
}

.hurt.on {
  opacity: 1;
  transition: opacity .04s
}
</style>
