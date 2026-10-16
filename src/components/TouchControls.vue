<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { engine, ui } from '../engine.js'

/* 触屏控件：左摇杆走路、右摇杆转头、右下四个按钮。
 *
 * 语义状态（走 / 跳 / 潜行 / 视角增量）走 engine.setStick / setLook / setInputKey，
 * 引擎主循环每帧读它们。摇杆小圆点的高频位移量级小、纯视觉，直接写 DOM，
 * 不进响应式 diff —— 拖拽期间一次重渲染都不触发。
 *
 * 只在触屏环境渲染（ui.touch 在 App 启动时就判好了），所以不需要
 * 原来那套 .touch{display:none} / body.touch .touch{display:block} 开关。 */

const stickEl = ref(null)
const stickKnob = ref(null)
const lookEl = ref(null)
const lookKnob = ref(null)

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
  if (!ui.touch || !stickEl.value || !lookEl.value) return
  unbind = [
    bindStick(stickEl.value, stickKnob.value, (x, y) => engine.setStick(x, y), () => engine.setStick(0, 0)),
    bindStick(lookEl.value, lookKnob.value, (x, y) => engine.setLook(x, y), () => engine.setLook(0, 0)),
  ]
}
onMounted(bind)
watch(() => ui.touch, bind, { flush: 'post' })
onBeforeUnmount(() => unbind.forEach((fn) => fn()))

/* 按钮：按下置位、抬起复位。按住不放就是一直有效（跳 / 潜行都是持续量）。 */
function press(key, val, e) {
  if (val && e) e.preventDefault()
  engine.setInputKey(key, val)
}
</script>

<template>
  <div v-if="ui.touch" class="touchctl">
    <div ref="stickEl" class="stick"><div ref="stickKnob" class="knob" /></div>
    <div ref="lookEl" class="joy2"><div ref="lookKnob" class="knob" /></div>
    <div class="tbtns">
      <button class="tb" @touchstart="press('jump', true, $event)" @touchend="press('jump', false)">↑</button>
      <button class="tb" @touchstart="press('shift', true, $event)" @touchend="press('shift', false)">↓</button>
      <button class="tb wide" @click="engine.toggleFly()">飞行</button>
      <button class="tb wide" @touchstart="press('jump', true, $event)" @touchend="press('jump', false)">跳</button>
    </div>
  </div>
</template>

<style scoped>
.stick {
  position: fixed;
  left: 22px;
  bottom: 96px;
  width: 118px;
  height: 118px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .07);
  border: 1px solid rgba(255, 255, 255, .16);
  z-index: 10;
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

.joy2 {
  position: fixed;
  right: 20px;
  bottom: 300px;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .06);
  border: 1px solid rgba(255, 255, 255, .14);
  z-index: 10;
}

.joy2 .knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 42px;
  height: 42px;
  margin: -21px 0 0 -21px;
  border-radius: 50%;
  background: linear-gradient(160deg, rgba(255, 255, 255, .5), rgba(255, 255, 255, .25));
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4);
}

.tbtns {
  position: fixed;
  right: 20px;
  bottom: 100px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
  z-index: 10;
}

.tb {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .18);
  background: rgba(255, 255, 255, .09);
  color: var(--txt);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.tb:active {
  background: rgba(255, 255, 255, .22)
}

.tb.wide {
  width: auto;
  padding: 0 16px;
  border-radius: 14px;
  height: 44px
}
</style>
