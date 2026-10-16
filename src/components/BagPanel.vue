<script setup>
import { computed } from 'vue'
import { MODE, engine, ui } from '../engine.js'
import BlockLibrary from './BlockLibrary.vue'
import CraftBox from './CraftBox.vue'
import InventoryPanel from './InventoryPanel.vue'

/* 方块库（创造）/ 背包（生存）。同一个面板，按模式换内容：
 *   生存 → 标题「背包」+ 合成台 + 54 格背包
 *   创造 → 标题「方块库」+ 全部方块与物品 */
const surv = computed(() => ui.mode === MODE.SURVIVAL)
const title = computed(() => (surv.value ? '背包' : '方块库'))
const sub = computed(() => (engine.bagSubtitle ? engine.bagSubtitle() : ''))
</script>

<template>
  <div v-show="ui.bagOpen" class="bag" @click.self="engine.closeBag()">
    <div class="bagpanel">
      <h2>{{ title }}</h2>
      <div class="sub">{{ sub }}</div>
      <CraftBox v-if="surv" />
      <InventoryPanel v-if="surv" />
      <BlockLibrary v-else />
    </div>
  </div>
</template>

<style scoped>
.bag {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 13, .74);
  backdrop-filter: blur(6px);
}

.bagpanel {
  width: min(880px, 94vw);
  max-height: 84vh;
  overflow: auto;
  border-radius: 20px;
  padding: 20px 22px;
  background: linear-gradient(160deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .02));
  border: 1px solid var(--panel-brd);
  box-shadow: 0 30px 90px rgba(0, 0, 0, .72);
}

.bagpanel h2 {
  margin: 0 0 3px;
  font-size: 17px;
  color: var(--accent)
}

.bagpanel .sub {
  color: var(--dim);
  font-size: 11.5px;
  margin-bottom: 14px
}
</style>
