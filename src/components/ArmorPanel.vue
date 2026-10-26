<script setup>
import { computed } from 'vue'
import { engine } from '../engine.js'
import ItemSlot from './ui/ItemSlot.vue'

/* 盔甲四槽（头 / 胸 / 腿 / 脚）。
 *
 * 交互只有两条，刻意不做拖拽：
 *   · 点背包里的护甲 → 穿到它对应的槽（旧的自动退回背包）
 *   · 点这里的槽     → 脱下来回背包
 * 拖拽在触屏上没有可靠的实现（本项目连鼠标拖拽都没做），
 * 而「点一下」在两种设备上都成立。
 *
 * 依赖说明：armorSlotsView() 内部读 armorSlots（reactive），
 * 所以 computed 会自然追踪到「穿了/脱了」；不需要额外的版本号。 */
const slots = computed(() => (engine.armorSlotsView ? engine.armorSlotsView() : []))
const sum = computed(() => (engine.armorSummary ? engine.armorSummary() : { pts: 0, pct: 0 }))

function tipOf(s) {
  return s.id
    ? `${s.name}（${s.label} · 护甲 +${s.pts}）· 点一下脱下`
    : `${s.label}：空 · 在背包里点一件护甲穿上`
}
</script>

<template>
  <div class="armorwrap">
    <div class="armorlab">
      盔甲 · 点背包里的护甲穿上，点槽位脱下
      <span class="armorstat" :class="{ has: sum.pts > 0 }">
        护甲 {{ sum.pts }} · 减伤 {{ sum.pct }}%
      </span>
    </div>
    <div class="armorgrid">
      <ItemSlot
        v-for="s in slots" :key="s.part" variant="islot"
        :id="s.id" :name="s.name" :count="0"
        :title="tipOf(s)"
        @pick="engine.unequipArmorSlot(s.part)"
      />
    </div>
  </div>
</template>

<style scoped>
.armorwrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.armorlab {
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin: 2px 0 0;
}

.armorstat {
  float: right;
  color: var(--dim);
  letter-spacing: 0;
}

/* 穿了甲就把数字点亮 —— 一眼能看出「当前到底有没有防护」 */
.armorstat.has {
  color: var(--accent);
  font-weight: 600;
}

/* 四格，和背包同一套格子尺寸；用 4 列固定宽而不是 1fr，
 * 否则会被拉成四个超宽方块，看着像另一套 UI */
.armorgrid {
  display: grid;
  grid-template-columns: repeat(4, 92px);
  gap: 6px;
}

@media (max-width: 820px) {
  .armorgrid {
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
  }
}
</style>
