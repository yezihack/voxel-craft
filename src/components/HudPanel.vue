<script setup>
import { ui } from '../engine.js'
import { HELP_LINES } from '../data/helpKeys.js'
import HudCard from './HudCard.vue'

/* 左上角 HUD：状态卡（维度 / FPS / 区块 / 坐标…）+ 帮助卡。
 * 帮助卡的九行说明来自 data/helpKeys.js，按片段渲染 kbd / b / 飞行状态。 */
const isKbd = (p) => 'k' in p
const isBold = (p) => 'b' in p
const isFlyTag = (p) => p.tag === 'fly'
</script>

<template>
  <div class="hud">
    <HudCard title="⛏️ 方块世界">
      <div class="dim">{{ ui.stat }}</div>
    </HudCard>
    <HudCard>
      <div v-for="(line, i) in HELP_LINES" :key="i">
        <template v-for="(p, j) in line" :key="j">
          <kbd v-if="isKbd(p)">{{ p.k }}</kbd>
          <b v-else-if="isBold(p)">{{ p.b }}</b>
          <span v-else-if="isFlyTag(p)" class="dim">{{ ui.flyTag }}</span>
          <template v-else>{{ p.t }}</template>
        </template>
      </div>
    </HudCard>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  left: 14px;
  top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  line-height: 1.55;
  pointer-events: none;
}
</style>
