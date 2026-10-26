<script setup>
import { computed } from 'vue'
import { engine, ui } from '../engine.js'
import { MODES } from '../data/modes.js'
import { VEIL_KEYS } from '../data/veilKeys.js'
import { WORLDS } from '../data/worlds.js'

/* 开始 / 暂停遮罩。同一个面板兼两职：
 *   · 首次进入 → 标题「方块世界」+ 模式选择 + 按键表 + 开始按钮
 *   · Esc 暂停  → 同一张脸，只把提示语换成「已暂停」
 * 显示与否只看 ui.veilVisible，不再有 classList.add('hide')。
 *
 * 点空白处 / 面板本身 / 提示文字都能进游戏（原 HTML 就是这么判的：
 * target 是 #veil、.panel 或 #veilHint 才触发，点按钮走按钮自己的逻辑）。
 * 触屏没有指针锁定，直接 startGame(false)。 */
function tryStart() {
  engine.startGame(!ui.touch)
}

/* 存档摘要。依赖 ui.saveRev —— localStorage 变了但 ui 上没有响应式依赖，
 * 不挂一个版本号的话面板会一直显示上一次的摘要（见 uiState 的注释）。 */
const save = computed(() => {
  ui.saveRev
  return engine.saveStatus ? engine.saveStatus() : null
})

/* 「继续上次存档」：读档 → 立刻进游戏。
 * 顺序必须是「先读再 start」，反过来的话指针锁定会先拿到、
 * 而 applySave 里的 initChunks 又把区块全标脏，第一帧会闪一下空世界。 */
function continueSave() {
  const r = engine.loadNow()
  if (r && r.ok) engine.startGame(!ui.touch)
}

function startNew() {
  if (typeof window !== 'undefined' && window.confirm
      && !window.confirm('删除当前存档并重新开始？这个操作无法撤销。')) return
  engine.newWorld()
}
</script>

<template>
  <div class="veil" :class="{ hide: !ui.veilVisible }" @click.self="tryStart">
    <div class="panel" @click.self="tryStart">
      <h1>方块世界</h1>
      <div class="tagline">手写 WebGL 体素引擎 · 无外部依赖 · 离线可玩</div>
      <div class="modes">
        <button
          v-for="m in MODES" :key="m.id" class="mode" :class="{ on: ui.mode === m.id }"
          :data-mode="m.id" @click="engine.pickMode(m.id)"
        >{{ m.label }}</button>
      </div>
      <div class="worlds">
        <span class="wlabel">世界</span>
        <button
          v-for="w in WORLDS" :key="w.id" class="mode" :class="{ on: ui.worldFlat === w.flat }"
          @click="engine.pickWorldType(w.flat)"
        >{{ w.label }}</button>
      </div>
      <div class="keys">
        <div v-for="(k, i) in VEIL_KEYS" :key="i"><kbd>{{ k.key }}</kbd> {{ k.text }}</div>
      </div>
      <button class="go" @click="engine.startGame(true)">开始游戏</button>

      <!-- 存档区：有档就显示摘要 + 继续 / 删档，没档就提示快捷键 -->
      <div v-if="save" class="saverow">
        <button class="savebtn" @click="continueSave">
          📂 继续上次存档
          <span class="savemeta">{{ save.when }} · {{ save.dimName }} · {{ save.modeName }} · {{ save.blocks }} 格改动</span>
        </button>
        <button class="wiped" title="删除存档并重新开始" @click="startNew">🗑</button>
      </div>
      <div v-else class="savenone">还没有存档 —— 进入游戏后按 <kbd>F5</kbd> 保存，<kbd>F9</kbd> 读取</div>

      <div class="hint" @click.self="tryStart" v-html="ui.veilHint" />
    </div>
  </div>
</template>

<style scoped>
.veil {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(900px 600px at 50% 30%, rgba(67, 224, 255, .10), transparent 60%), rgba(4, 7, 13, .86);
  backdrop-filter: blur(6px);
  z-index: 20;
}

.veil.hide {
  display: none
}

.keys {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 16px;
  text-align: left;
  font-size: 12.5px;
  color: var(--dim);
  margin-bottom: 22px;
}

.keys div {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ---------- 模式选择器 ---------- */
.modes {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 18px;
}

.mode {
  padding: 9px 18px;
  border-radius: 11px;
  border: 1.5px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: .15s;
}

.mode:hover {
  color: var(--txt);
  border-color: rgba(255, 255, 255, .3)
}

.mode.on {
  color: #04121a;
  background: linear-gradient(135deg, #43e0ff, #7dd3fc);
  border-color: transparent;
  font-weight: 600
}

/* 生存 / 旁观选中时换一套配色，一眼能看出当前是哪个模式 */
.mode[data-mode="1"].on {
  background: linear-gradient(135deg, #ffc061, #ff7a59);
  color: #240c02
}

/* ---------- 世界类型 ---------- */
.worlds {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.wlabel {
  font-size: 11.5px;
  letter-spacing: .6px;
  color: var(--dim)
}

.mode[data-mode="2"].on {
  background: linear-gradient(135deg, #8be0d4, #5aa8e8);
  color: #06222a
}

/* ---------- 存档区 ---------- */
.saverow {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: stretch;
}

/* 主按钮：虚线框 + 副标题（时间 / 维度 / 改动格数），
 * 和「开始游戏」的实心主按钮区分开 —— 它是「另一条路」，不是主路径。 */
.savebtn {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 14px;
  border-radius: 11px;
  cursor: pointer;
  border: 1.5px dashed rgba(67, 224, 255, .42);
  background: rgba(67, 224, 255, .07);
  color: var(--accent);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  transition: background .12s, border-color .12s;
}

.savebtn:hover {
  background: rgba(67, 224, 255, .17);
  border-color: var(--accent)
}

.savemeta {
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: 0;
}

/* 删档：只放一个图标，红色描边，悬停才变亮 —— 危险动作不该太显眼 */
.wiped {
  width: 42px;
  border-radius: 11px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 110, 100, .30);
  background: rgba(255, 110, 100, .06);
  color: rgba(255, 150, 140, .8);
  font-size: 15px;
  transition: background .12s, border-color .12s;
}

.wiped:hover {
  background: rgba(255, 110, 100, .18);
  border-color: rgba(255, 110, 100, .75);
  color: #ffb3ab
}

.savenone {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: .2px;
}

.savenone kbd {
  margin: 0 2px
}

@media (max-width: 820px) {
  .keys {
    grid-template-columns: 1fr
  }
}
</style>
