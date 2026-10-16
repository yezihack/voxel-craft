<script setup>
import { ui } from '../engine.js'
</script>

<template>
  <div class="cross" :class="{ hit: ui.crossHit }"><i /><i /><i /><i /></div>
</template>

<style scoped>
.cross {
  position: fixed;
  left: 50%;
  top: 50%;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: .9;
  transition: transform .08s ease-out;
}

.cross.hit {
  transform: translate(-50%, -50%) scale(1.28)
}

.cross i {
  position: absolute;
  background: #fff;
  box-shadow: 0 0 3px rgba(0, 0, 0, .9);
  border-radius: 1px
}

.cross i:nth-child(1) {
  left: 50%;
  top: 0;
  width: 2px;
  height: 8px;
  margin-left: -1px
}

.cross i:nth-child(2) {
  left: 50%;
  bottom: 0;
  width: 2px;
  height: 8px;
  margin-left: -1px
}

.cross i:nth-child(3) {
  top: 50%;
  left: 0;
  height: 2px;
  width: 8px;
  margin-top: -1px
}

.cross i:nth-child(4) {
  top: 50%;
  right: 0;
  height: 2px;
  width: 8px;
  margin-top: -1px
}
</style>
