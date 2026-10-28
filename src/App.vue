<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { engine, initEngine, setFatal, ui } from './engine.js'
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
 * 判据：「有触摸能力」+「粗指针 或 窄屏」。
 *   · 只看 ontouchstart 会把带触摸屏的 Windows 笔记本判成手机（有鼠标，
 *     冒出一套摇杆反而碍事）—— 所以要粗指针这个条件；
 *   · 但反过来只认 `pointer: coarse` 也不行：部分安卓浏览器 / 内置 WebView
 *     （微信、UC、夸克）不上报 coarse，于是手机被当成桌面 —— 表现为
 *     开始面板显示键盘说明、点「开始游戏」去请求指针锁定、失败后
 *     pointerlockerror 又把游戏暂停回面板。玩家看到的就是「一进游戏就闪退」。
 *     加一条 `innerWidth <= 900` 兜住这批设备：宽屏 + 精确指针的笔记本
 *     仍然走桌面分支。 */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const touchy = navigator.maxTouchPoints > 0 || 'ontouchstart' in window
ui.touch = touchy && (coarse || innerWidth <= 900)
/* 首屏提示语要在引擎拉起之前就对上设备 —— boot() 会覆盖它，
 * 但地形生成要几秒，那段时间显示的仍是这里的默认值。 */
if (ui.touch) ui.veilHint = '触屏操作：左摇杆走路，滑动画面转视角'

const game = ref(null)

/* 全局兜底：主循环或事件回调里抛出的未捕获异常不会让页面白屏，
 * 但会让游戏「定在原地」（每帧都炸一次，画面不再更新）—— 玩家看到的就是
 * 卡死 / 黑屏，只能算作闪退。把错误显示出来，至少能截图反馈是什么炸了。
 * 只显示第一条：每帧都抛的异常会在几秒内灌满整个数组。 */
function fatal(err) {
  if (ui.fatal) return
  const msg = String((err && err.message) || err || '未知错误')
  setFatal('游戏出错了：' + msg.slice(0, 180)
    + '\n\n刷新页面可重试（进度每 60 秒自动存一次，也可以在菜单里手动存）')
}
window.addEventListener('error', (e) => fatal(e.error || e.message))
window.addEventListener('unhandledrejection', (e) => fatal(e.reason))

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
