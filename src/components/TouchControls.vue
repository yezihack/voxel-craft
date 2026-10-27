<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { engine, ui } from '../engine.js'

/* 触屏控件：左摇杆走路、右下按钮挖 / 放 / 跳 / 潜、右上系统按钮。
 *
 * 视角转动不在这里 —— 直接在画布上滑动即可（见 input.js 的 touchmove）。
 * 早先版本用第二个摇杆转头，实际体验是「拇指要先找准圆心才敢动」，
 * 远不如「哪儿都能滑」来得直接，所以砍掉了。
 *
 * 挖掘 / 放置从「长按画布」改成了两个独立按钮：手势分不清拖拽与长按，
 * 想转头经常会挖出一个坑。按钮的语义与鼠标左右键逐条对齐
 * （touchMine / touchPlace 里维护 breakHeld / placeHeld），
 * 所以弓蓄力、盾牌格挡、连发铺路这些复用逻辑不用各写一套。
 *
 * 摇杆小圆点的高频位移量级小、纯视觉，直接写 DOM，不进响应式 diff。 */

const stickEl = ref(null)
const stickKnob = ref(null)

/* 只在「真的在玩」时出现：背包 / 遮罩 / 死亡面板打开时收起来，
 * 否则按钮会浮在面板上，还会把已经松开的手指状态留在引擎里。 */
const show = computed(() => ui.touch && !ui.bagOpen && !ui.veilVisible && !ui.deathVisible)

/* 单指摇杆：按下定圆心，拖动算偏移，超出半径就钳在圆上。
 * 归一化后交给回调（-1..1），小圆点直接跟手指走。 */
function bindStick(el, knob, onMove, onEnd) {
  let id = null, cx = 0, cy = 0
  const R = () => el.clientWidth * 0.36

  const onStart = (e) => {
    const t = e.changedTouches[0]
    id = t.identifier
    const r = el.getBoundingClientRect()
    cx = r.left + r.width / 2
    cy = r.top + r.height / 2
    e.preventDefault()
  }
  const onMoveEvt = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue
      const r = R()
      let dx = t.clientX - cx, dy = t.clientY - cy
      const d = Math.hypot(dx, dy)
      if (d > r) { dx = dx / d * r; dy = dy / d * r }
      knob.style.transform = `translate(${dx}px,${dy}px)`
      onMove(dx / r, dy / r)
      e.preventDefault()
    }
  }
  const onEndEvt = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue
      id = null
      knob.style.transform = ''
      onEnd()
    }
  }

  el.addEventListener('touchstart', onStart, { passive: false })
  el.addEventListener('touchmove', onMoveEvt, { passive: false })
  el.addEventListener('touchend', onEndEvt)
  el.addEventListener('touchcancel', onEndEvt)

  return () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMoveEvt)
    el.removeEventListener('touchend', onEndEvt)
    el.removeEventListener('touchcancel', onEndEvt)
  }
}

let unbind = []
/* 摇杆的监听挂在真实元素上，而元素只在触屏环境才渲染（v-if）。
 * 所以绑定时要先确认元素在 —— 非触屏下这里是空转，不是错误。 */
function bind() {
  unbind.forEach((fn) => fn())
  unbind = []
  if (!show.value || !stickEl.value) return
  unbind = [bindStick(stickEl.value, stickKnob.value,
    (x, y) => engine.setStick(x, y), () => engine.setStick(0, 0))]
}
onMounted(bind)
watch(show, bind, { flush: 'post' })
onBeforeUnmount(() => unbind.forEach((fn) => fn()))

/* 面板一打开就把所有「按住类」状态清干净。
 * 手指还压在按钮上时被遮罩抢走焦点，touchend 可能永远不来，
 * 结果就是关掉背包回到游戏，人还在自动往前走 / 一直挖。 */
watch(show, (v) => {
  if (v) return
  engine.setStick(0, 0)
  engine.setLook(0, 0)
  engine.touchMine(false)
  engine.touchPlace(false)
  engine.setInputKey('jump', false)
  engine.setInputKey('shift', false)
})

/* 按钮：按下置位、抬起复位。按住不放就是一直有效（跳 / 潜都是持续量）。 */
function press(key, val, e) {
  if (val && e) e.preventDefault()
  engine.setInputKey(key, val)
}
function mine(on, e) { if (e) e.preventDefault(); engine.touchMine(on) }
function place(on, e) { if (e) e.preventDefault(); engine.touchPlace(on) }
</script>

<template>
  <div v-if="show" class="touchctl">
    <div ref="stickEl" class="stick"><div ref="stickKnob" class="knob" /></div>

    <!-- 右上：不常用的系统按钮。放在顶部是为了不占拇指的活动区。
         「菜单」就是暂停面板 —— 触屏没有 Esc，存档 / 读档 / 换模式都在那里面。 -->
    <div class="sysrow">
      <button class="tb sys" @click="engine.toggleBag()">背包</button>
      <button class="tb sys" @click="engine.cycleMode()">模式</button>
      <button class="tb sys" @click="engine.toggleFly()">飞行</button>
      <button class="tb sys" @click="engine.pauseGame()">菜单</button>
    </div>

    <!-- 右下：2×2 动作区。上排跳 / 潜，下排挖 / 放（主色） -->
    <div class="pad">
      <button
        class="tb" @touchstart="press('jump', true, $event)"
        @touchend="press('jump', false)" @touchcancel="press('jump', false)"
      >跳</button>
      <button
        class="tb" @touchstart="press('shift', true, $event)"
        @touchend="press('shift', false)" @touchcancel="press('shift', false)"
      >潜</button>
      <button
        class="tb act" @touchstart="mine(true, $event)"
        @touchend="mine(false)" @touchcancel="mine(false)"
      >挖</button>
      <button
        class="tb act" @touchstart="place(true, $event)"
        @touchend="place(false)" @touchcancel="place(false)"
      >放</button>
    </div>
  </div>
</template>

<style scoped>
/* 整个控件层不吃事件 —— 只有具体按钮和摇杆自己接管，
 * 中间的空地留给画布滑动转视角。 */
.touchctl {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 14;
  user-select: none;
  -webkit-user-select: none;
}

.stick {
  position: fixed;
  left: calc(18px + env(safe-area-inset-left, 0px));
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  width: 118px;
  height: 118px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .07);
  border: 1px solid rgba(255, 255, 255, .16);
  pointer-events: auto;
  touch-action: none;
}

.stick .knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border-radius: 50%;
  background: linear-gradient(160deg, rgba(255, 255, 255, .55), rgba(255, 255, 255, .28));
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4);
}

/* 2×2 动作区：上排跳 / 潜，下排挖 / 放。
 * 四颗一样大（68px）—— 拇指落点不需要先分辨大小，靠颜色区分功能就够，
 * 大小不一会让人下意识去找「大的那个」，反而慢。 */
.pad {
  position: fixed;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-columns: 68px 68px;
  grid-template-rows: 68px 68px;
  gap: 10px;
  pointer-events: auto;
}

.tb {
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .20);
  background: rgba(255, 255, 255, .10);
  color: var(--txt);
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  backdrop-filter: blur(8px);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: background .08s, transform .08s;
}

.tb:active {
  background: rgba(255, 255, 255, .28);
  transform: scale(.94)
}

/* 挖 / 放：主色描边，和跳 / 潜拉开层次 */
.tb.act {
  background: rgba(67, 224, 255, .16);
  border-color: rgba(67, 224, 255, .38);
}

.tb.act:active {
  background: rgba(67, 224, 255, .42)
}

.sysrow {
  position: fixed;
  right: calc(12px + env(safe-area-inset-right, 0px));
  top: calc(10px + env(safe-area-inset-top, 0px));
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.tb.sys {
  width: auto;
  height: 34px;
  padding: 0 11px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(255, 255, 255, .08);
}

/* 矮屏（手机横屏）：整块收一点，别把画面中间也吃掉 */
@media (max-height: 420px) {
  .stick {
    width: 104px;
    height: 104px;
    bottom: calc(78px + env(safe-area-inset-bottom, 0px));
  }

  .pad {
    grid-template-columns: 60px 60px;
    grid-template-rows: 60px 60px;
    gap: 8px;
    bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  }

  .tb {
    font-size: 14px
  }
}
</style>
