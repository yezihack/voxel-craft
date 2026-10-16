<script setup>
import { engine, ui } from '../engine.js'

/* 死亡界面。只做三件事：盖一层红色暗幕、显示死因、给一个重生按钮。
 * 显示与否由 ui.deathVisible 决定（引擎在 onDeath 钩子里置位）。 */
</script>

<template>
  <div class="death" :class="{ show: ui.deathVisible }">
    <div class="panel">
      <h1>你倒下了</h1>
      <div class="tagline">{{ ui.deathMsg }}</div>
      <button class="go" @click="engine.respawnAndStart()">重生</button>
    </div>
  </div>
</template>

<style scoped>
.death {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(760px 500px at 50% 42%, rgba(214, 34, 58, .24), transparent 66%), rgba(12, 2, 5, .88);
  backdrop-filter: blur(7px);
}

.death.show {
  display: flex
}

/* 标题在开始面板的蓝紫渐变上换成红粉渐变 */
.death .panel h1 {
  background: linear-gradient(135deg, #ff8a9b, #c0304a);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
</style>
