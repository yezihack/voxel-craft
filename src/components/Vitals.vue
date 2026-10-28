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
  <div v-if="ui.survival" class="vitals" :class="{ touch: ui.touch }">
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

/* 触屏：底部整条都是拇指区 —— 左边摇杆、右边 2×2 动作区，两者底边都在
 * 100px 处，而生命条原来也在 100px，结果 10 颗心正好横穿摇杆和「挖 / 放」，
 * 把按钮压在下面。竖屏更惨：中间只剩几十像素，放哪都压。
 * 所以触屏一律挪到左上角 —— 与右上的系统栏对称，两边都碰不到手指。
 * top 让到 52px：360 宽屏时系统栏（210px 宽，右对齐）会一直伸到 x=138，
 * 而 10 颗心到 x=149，压在 10px 那一档上就会撞，下移一行彻底分开。 */
.vitals.touch {
  left: calc(10px + env(safe-area-inset-left, 0px));
  top: calc(52px + env(safe-area-inset-top, 0px));
  bottom: auto;
  transform: none;
  align-items: flex-start;
  gap: 2px;
}

/* 10 颗心按 16px 排是 178px，占窄屏一半，缩到 13px */
.vitals.touch .row {
  height: 13px;
  gap: 1px;
}

.vitals.touch svg {
  width: 13px;
  height: 13px;
}

.vitals.touch .airRow svg {
  width: 11px;
  height: 11px;
}
</style>
