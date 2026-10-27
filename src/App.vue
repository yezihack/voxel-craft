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
import HurtFlash from './components/HurtFlash.vue'
import IconDefs from './components/IconDefs.vue'
import NameTags from './components/NameTags.vue'
import StartVeil from './components/StartVeil.vue'
import Toast from './components/Toast.vue'
import TouchControls from './components/TouchControls.vue'
import Vitals from './components/Vitals.vue'

/* 触屏判定。原 HTML 在输入段里做这件事并给 body 挂 .touch；
 * 这里只记一个 ui.touch —— 触屏控件的显隐、开始遮罩的点击行为都读它，
 * 不再需要 body 上的类名（同理 body.survival 也换成了 ui.survival）。
 *
 * 判据是「粗指针 + 真的有触摸点」：只看 ontouchstart 会把带触摸屏的
 * Windows 笔记本也判成手机，那类设备有鼠标，冒出一套摇杆反而碍事。 */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
ui.touch = coarse && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
/* 首屏提示语要在引擎拉起之前就对上设备 —— boot() 会覆盖它，
 * 但地形生成要几秒，那段时间显示的仍是这里的默认值。 */
if (ui.touch) ui.veilHint = '触屏操作：左摇杆走路，滑动画面转视角'

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
  <Vitals />
  <HotBar />
  <BagPanel />
  <DeathScreen />
  <Toast />
  <TouchControls />
  <StartVeil />
  <FatalNotice v-if="ui.fatal" :msg="ui.fatal" />
</template>
