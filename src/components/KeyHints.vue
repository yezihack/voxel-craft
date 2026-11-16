<script setup>
import { computed } from 'vue'
import { ui, hideKeyHints } from '../engine.js'
import { KEY_HINTS, TOUCH_HINTS } from '../data/keyHints.js'

/* 游戏内左上角的「快捷键速查表」。
 *
 * 什么时候出现：进游戏时（设置里开着）。这是给新玩家的上手提醒，
 * 12 秒后自己收起 —— 游戏内不放常驻文字 HUD，一直挂在左上角会挡视野。
 * 想再看就按 H（桌面）；手机上点右上角的 ×。
 *
 * 为什么整块是 pointer-events:none：进游戏后鼠标是**锁**着的，
 * 指针锁定期间所有鼠标事件都发到画布上，DOM 按钮根本点不到 ——
 * 挂一个看起来能点、实际点不动的 × 比没有更糟。桌面端的收起动作
 * 走键盘 H；只有触屏（不锁指针）才给一个真能点的 ×。
 *
 * 键位表本身走 CSS 网格两列排布：一条一条竖着列十三行太长，
 * 两列七行一眼扫得完。 */
const hints = computed(() => (ui.touch ? TOUCH_HINTS : KEY_HINTS))
</script>

<template>
  <Transition name="kh">
    <div v-if="ui.keyHintsOn && !ui.veilVisible" class="keyhints" :class="{ touch: ui.touch }">
      <div class="khhead">
        <span class="khtitle">⌨ 快捷键</span>
        <!-- 触屏没有 H 键，只能靠这个 ×。桌面端不显示（点不到，见上方注释）。 -->
        <button v-if="ui.touch" class="khclose" title="收起" @click="hideKeyHints()">×</button>
        <span v-else class="khhint">按 H 收起</span>
      </div>
      <div class="khgrid">
        <div v-for="(k, i) in hints" :key="i" class="khrow">
          <kbd>{{ k.key }}</kbd><span>{{ k.text }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.keyhints {
  position: fixed;
  left: calc(14px + env(safe-area-inset-left, 0px));
  top: calc(14px + env(safe-area-inset-top, 0px));
  z-index: 11;
  pointer-events: none;
  padding: 10px 12px 11px;
  border-radius: 13px;
  background: var(--panel);
  border: 1px solid var(--panel-brd);
  backdrop-filter: blur(10px);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .45);
  max-width: 340px;
}

/* 触屏：左上角被生命 / 饥饿条占了（挪到 top:52px），
 * 这块表往下让一让，别压在心形上。 */
.keyhints.touch {
  top: calc(104px + env(safe-area-inset-top, 0px));
}

.khhead {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.khtitle {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .4px;
  color: var(--accent);
}

.khhint {
  font-size: 10.5px;
  color: var(--dim);
}

.khclose {
  margin-left: auto;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .06);
  color: var(--dim);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
}

.khclose:active {
  background: rgba(255, 255, 255, .18);
  color: var(--txt);
}

.khgrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 14px;
}

.khrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--dim);
  white-space: nowrap;
}

.khrow kbd {
  flex: 0 0 auto;
  min-width: 30px;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .07);
  color: var(--txt);
  font: 600 10px/1.5 ui-monospace, Consolas, monospace;
  text-align: center;
}

/* 窄屏（手机竖屏）：两列太宽，压成单列。 */
@media (max-width: 420px) {
  .khgrid {
    grid-template-columns: 1fr;
  }
}

/* 入场 / 出场：淡入 + 轻微下沉，别闪一下硬切。 */
.kh-enter-active,
.kh-leave-active {
  transition: opacity .22s, transform .22s;
}

.kh-enter-from,
.kh-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
