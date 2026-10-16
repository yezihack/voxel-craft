<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { engine, initEngine, ui } from './engine.js'
import BagPanel from './components/BagPanel.vue'
import BowBar from './components/BowBar.vue'
import Crosshair from './components/Crosshair.vue'
import DeathScreen from './components/DeathScreen.vue'
import DigRing from './components/DigRing.vue'
import FatalNotice from './components/FatalNotice.vue'
import GameCanvas from './components/GameCanvas.vue'
import HotBar from './components/HotBar.vue'
import HudPanel from './components/HudPanel.vue'
import HurtFlash from './components/HurtFlash.vue'
import IconDefs from './components/IconDefs.vue'
import NameTags from './components/NameTags.vue'
import StartVeil from './components/StartVeil.vue'
import Toast from './components/Toast.vue'
import TouchControls from './components/TouchControls.vue'
import Vitals from './components/Vitals.vue'

/* 触屏判定。原 HTML 在输入段里做这件事并给 body 挂 .touch；
 * 这里只记一个 ui.touch —— 触屏控件的显隐、开始遮罩的点击行为都读它，
 * 不再需要 body 上的类名（同理 body.survival 也换成了 ui.survival）。 */
ui.touch = 'ontouchstart' in window && matchMedia('(pointer:coarse)').matches

const game = ref(null)

/* 引擎必须等画布真的进 DOM 之后再拉起来：
 * renderer.js 在模块顶层就要 canvas 建 WebGL 上下文，模块一被求值就晚了。
 * 所以先 setCanvas（在 initEngine 里做），再 await import()。 */
onMounted(async () => {
  await nextTick()
  try {
    await initEngine(game.value.canvasEl)
  } catch (err) {
    /* 不支持 WebGL 时 renderer.js 会先置 ui.fatal 再抛错，
     * 这里吞掉即可 —— 页面上会显示 FatalNotice。 */
    console.error(err)
  }
})
</script>

<template>
  <GameCanvas ref="game" />
  <IconDefs />
  <Crosshair />
  <DigRing />
  <BowBar />
  <HurtFlash />
  <NameTags />
  <HudPanel />
  <Vitals />
  <HotBar />
  <BagPanel />
  <DeathScreen />
  <Toast />
  <TouchControls />
  <StartVeil />
  <FatalNotice v-if="ui.fatal" :msg="ui.fatal" />
</template>
