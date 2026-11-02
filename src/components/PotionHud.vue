<script setup>
import { ui } from '../engine.js'

/* 药水状态 HUD：只画图形，不写文字（遵守「游戏内不放常驻文字 HUD」的约定）。
 * 每个效果一个圆环：
 *   · 外圈 conic-gradient 表示剩余时间比例
 *   · 内圈深色底 + 彩色圆点表示是哪种药水（颜色来自 potions.js）
 *   · 负面效果的外圈底色偏红，一眼区分增益 / 减益
 * 名称只放在 title 里（鼠标悬停可见），触屏靠颜色与位置识别。 */
</script>

<template>
  <div v-if="ui.survival && ui.potions.length" class="potion-hud" :class="{ touch: ui.touch }">
    <div
      v-for="p in ui.potions"
      :key="p.key"
      class="chip"
      :class="p.kind"
      :title="p.name"
      :style="{
        '--c': `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`,
        '--deg': (p.pct * 360) + 'deg',
      }"
    >
      <span class="core"><span class="dot"></span></span>
    </div>
  </div>
</template>

<style scoped>
.potion-hud {
  position: fixed;
  right: 14px;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 12;
  pointer-events: none;
}

.chip {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  padding: 3px;
  background: conic-gradient(var(--c) var(--deg), rgba(255, 255, 255, .14) 0);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .5);
}

/* 负面效果：剩余时间那一段改成偏红，和增益区分开 */
.chip.debuff {
  background: conic-gradient(var(--c) var(--deg), rgba(255, 110, 110, .22) 0);
}

.core {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #141a26;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 7px var(--c);
}

/* 触屏：右上系统栏在 top 10 / 高 34，HUD 让到 56 以下；尺寸也缩一点 */
.potion-hud.touch {
  top: calc(56px + env(safe-area-inset-top, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  gap: 5px;
}

.potion-hud.touch .chip {
  width: 22px;
  height: 22px;
  padding: 2px;
}

.potion-hud.touch .dot {
  width: 8px;
  height: 8px;
}
</style>
