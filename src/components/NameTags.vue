<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { setTagHook, ui } from '../engine.js'

/* AI 玩家头顶名字标签。
 *
 * 整层是 pointer-events:none，绝不吃鼠标事件 —— 标签压在准星上时左键照样能
 * 挖/打，不然被标签挡住的地方就变成「点不动」的禁区。
 *
 * 这里走的是「混合策略」：名字 / 血量 / 说话内容这类语义变化走响应式模板；
 * 而每帧都要变的投影坐标量级大且纯视觉，由下面的 apply() 直接写 CSS 变量，
 * 不进 diff。元素引用通过 ref 回调收集成一张 Map。 */
const els = new Map()

function bind(id, el) {
  if (el) els.set(id, el)
  else els.delete(id)
}

function apply(list) {
  for (const p of list) {
    const el = els.get(p.id)
    if (!el) continue
    el.style.setProperty('--tx', p.tx + 'px')
    el.style.setProperty('--ty', p.ty + 'px')
    el.style.setProperty('--sc', p.sc)
    el.style.setProperty('--op', p.op)
  }
}

onMounted(() => setTagHook(apply))
onBeforeUnmount(() => setTagHook(null))

const hpColor = (pct) => (pct > 55 ? '#6ad06a' : pct > 25 ? '#e2c14a' : '#d8564e')
</script>

<template>
  <div class="nametags">
    <div v-for="t in ui.tags" :key="t.id" :ref="(el) => bind(t.id, el)" class="nametag">
      <s v-if="t.speak">{{ t.speak }}</s>
      <span>{{ t.name }}</span>
      <i><b :style="{ width: t.hpPct + '%', background: hpColor(t.hpPct) }" /></i>
    </div>
  </div>
</template>

<style scoped>
.nametags {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 13;
  overflow: hidden;
}

.nametag {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform, opacity;
  transform: translate(-50%, -100%) translate(var(--tx, 0px), var(--ty, 0px)) scale(var(--sc, 1));
  opacity: var(--op, 1);
  white-space: nowrap;
  padding: 1px 7px;
  border-radius: 9px;
  background: rgba(10, 12, 18, .52);
  border: 1px solid rgba(255, 255, 255, .14);
  font: 600 11.5px/1.5 inherit;
  color: #eef2f8;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .8);
  letter-spacing: .2px;
}

/* 血条：贴在名字下面一条 1px 高的细线，颜色随血量红→绿 */
.nametag i {
  display: block;
  height: 2px;
  margin-top: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, .18);
  overflow: hidden;
}

.nametag i b {
  display: block;
  height: 100%;
  background: #6ad06a;
  border-radius: 1px;
  transition: width .18s linear
}

/* 说话气泡：出现在名字上面 */
.nametag s {
  display: block;
  text-decoration: none;
  margin-bottom: 2px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(240, 244, 252, .92);
  color: #1c2230;
  font-weight: 500;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
