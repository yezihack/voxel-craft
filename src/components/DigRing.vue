<script setup>
import { ui } from '../engine.js'
</script>

<template>
  <div class="digring" :class="{ on: ui.digOn }" :style="{ '--p': ui.digPct }" />
</template>

<style scoped>
.digring {
  position: fixed;
  left: 50%;
  top: 50%;
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
  pointer-events: none;
  z-index: 13;
  border-radius: 50%;
  opacity: 0;
  transition: opacity .1s;
  background: conic-gradient(rgba(255, 255, 255, .95) calc(var(--p, 0) * 1%), rgba(255, 255, 255, .13) 0);
  -webkit-mask: radial-gradient(circle, transparent 0 62%, #000 63%);
  mask: radial-gradient(circle, transparent 0 62%, #000 63%);
}

.digring.on {
  opacity: 1
}
</style>
