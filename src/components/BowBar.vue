<script setup>
import { ui } from '../engine.js'
</script>

<template>
  <div class="bowbar" :class="{ on: ui.bowOn }">
    <i :style="{ width: `calc(${ui.bowPct} * 1%)` }" />
  </div>
</template>

<style scoped>
.bowbar {
  position: fixed;
  left: 50%;
  top: calc(50% + 34px);
  width: 76px;
  height: 6px;
  margin-left: -38px;
  border-radius: 3px;
  background: rgba(255, 255, 255, .16);
  opacity: 0;
  transition: opacity .12s;
  pointer-events: none;
  z-index: 13;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .35);
}

.bowbar.on {
  opacity: 1
}

.bowbar i {
  display: block;
  height: 100%;
  width: calc(var(--p, 0) * 1%);
  background: linear-gradient(90deg, #ffe08a, #ff9f43);
  border-radius: 3px;
}
</style>
