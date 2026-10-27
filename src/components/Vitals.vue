<script setup>
import { computed } from 'vue'
import { ui } from '../engine.js'
import VitalIcon from './VitalIcon.vue'

/* 生存状态：氧气 / 生命 / 饥饿。
 * 生命 = 10 颗心（每颗 2 点），饥饿 = 10 个鸡腿，氧气按气泡数显示，
 * 且只有真的在水下才出现。 */
const hearts = computed(() => {
  const out = []
  for (let i = 0; i < ui.maxHp / 2; i++) {
    const v = ui.hp - i * 2
    out.push(v >= 2 ? 'full' : v >= 1 ? 'half' : '')
  }
  return out
})

const foods = computed(() => {
  const out = []
  for (let i = 0; i < ui.maxFood / 2; i++) {
    const v = ui.food - i * 2
    out.push(v >= 2 ? 'full' : v >= 1 ? 'half' : '')
  }
  return out
})

const bubbles = computed(() => {
  const n = Math.ceil(ui.air)
  const out = []
  for (let i = 0; i < ui.maxAir; i++) out.push(i < n ? 'bub' : 'bub off')
  return out
})
</script>

<template>
  <div v-if="ui.survival" class="vitals">
    <div v-show="ui.airVisible" class="row airRow">
      <VitalIcon v-for="(c, i) in bubbles" :key="`a${i}`" id="icBub" :cls="c" />
    </div>
    <div class="row hearts">
      <VitalIcon v-for="(c, i) in hearts" :key="`h${i}`" id="icHeart" :cls="c" />
    </div>
    <div class="row foodRow">
      <VitalIcon v-for="(c, i) in foods" :key="`f${i}`" id="icMeat" :cls="c" />
    </div>
  </div>
</template>

<style scoped>
.vitals {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
  pointer-events: none;
  z-index: 12;
}

.row {
  display: flex;
  gap: 2px;
  height: 16px;
  align-items: center;
}

svg {
  width: 16px;
  height: 16px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .7));
}

.hearts svg {
  fill: #39404f
}

.hearts svg.full {
  fill: #ff4d63
}

.hearts svg.half {
  fill: url(#halfHeart)
}

.foodRow svg {
  fill: #3a4152
}

.foodRow svg.full {
  fill: #e8a35c
}

.foodRow svg.half {
  fill: url(#halfFood)
}

.airRow svg {
  width: 13px;
  height: 13px
}

.bub {
  fill: #bfe6ff;
  stroke: rgba(0, 0, 0, .35);
  stroke-width: 1
}

.bub.off {
  fill: none;
  stroke: rgba(255, 255, 255, .55);
  stroke-width: 1.8
}

@media (max-width: 820px) {
  .vitals {
    bottom: 72px
  }
}

/* 触屏：底部被 9 格快捷栏占着，生命条要再抬高一档才不会压在上面。
 * 100px 是按「大屏平板」算的（那边快捷栏 58px 格，整体高 78、占到底部 96）。 */
@media (pointer: coarse) {
  .vitals {
    bottom: 100px
  }
}
</style>
