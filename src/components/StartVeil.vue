<script setup>
import { computed, ref } from 'vue'
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

/* ---------- 存档文件导出 / 导入 ----------
 * localStorage 会被「清理浏览器数据」或 iOS 的存储回收整份抹掉，
 * 光存在浏览器里就是丢档风险。导出成文件后档在玩家手里；
 * 导入 = 用文件覆盖浏览器存档并立即读进世界。 */
const fileEl = ref(null)

function pickFile() {
  fileEl.value?.click()
}

async function onFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''        // 同一个文件选第二次也要触发 change，必须清空
  if (f) await engine.importSaveFile(f)
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
      <div v-if="ui.touch" class="keys">
        <div><b>左摇杆</b> 走路</div>
        <div><b>滑动画面</b> 转视角</div>
        <div><b>挖 / 放</b> 右下两个大按钮</div>
        <div><b>背包 / 模式 / 飞行 / 菜单</b> 右上</div>
      </div>
      <div v-else class="keys">
        <div v-for="(k, i) in VEIL_KEYS" :key="i"><kbd>{{ k.key }}</kbd> {{ k.text }}</div>
      </div>
      <button class="go" @click="tryStart">开始游戏</button>

      <!-- 存档区：有档就显示摘要 + 继续 / 删档，没档就提示快捷键 -->
      <div v-if="save" class="saverow">
        <button class="savebtn" @click="continueSave">
          📂 继续上次存档
          <span class="savemeta">{{ save.when }} · {{ save.dimName }} · {{ save.modeName }} · {{ save.blocks }} 格改动</span>
        </button>
        <button class="wiped" title="删除存档并重新开始" @click="startNew">🗑</button>
      </div>
      <div v-else-if="ui.touch" class="savenone">还没有存档 —— 进入游戏后点右上「菜单」可随时保存</div>
      <div v-else class="savenone">还没有存档 —— 进入游戏后按 <kbd>F5</kbd> 保存，<kbd>F9</kbd> 读取</div>

      <!-- 手动存档：桌面端有 F5，触屏没有键盘，必须给一个按钮，
       * 否则手机上只能等 60 秒一次的自动存档。 -->
      <div v-if="ui.started" class="saverow">
        <button class="savebtn" @click="engine.saveNow(true)">
          💾 保存进度
          <span class="savemeta">手动存一份，下次从这里继续</span>
        </button>
      </div>

      <!-- 存档文件导入 / 导出：浏览器存储会被清空或回收，档得能落到玩家手里 -->
      <div class="saverow">
        <button class="iobtn" @click="engine.exportSave()">
          ⬇ 导出存档
          <span class="savemeta">下载 .json 文件，防清浏览器数据丢档</span>
        </button>
        <button class="iobtn" @click="pickFile">
          ⬆ 导入存档
          <span class="savemeta">选择导出的 .json，导入后直接进入该世界</span>
        </button>
        <input ref="fileEl" type="file" accept=".json,application/json" hidden @change="onFile">
      </div>

      <!-- 宣传页入口：访客最先想知道的「这游戏长什么样」。
       * 跳走之前先静默存一次 —— 自动存档是 60 秒一次，不能保证此刻最新。 -->
      <a class="promolink" href="/intro.html" @click="engine.saveNow(false)">
        <span>✦ 宣传页 · 实机演示</span>
        <span class="savemeta">录屏、截图与素材库</span>
      </a>

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

.keys b {
  color: var(--accent);
  font-weight: 600
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

/* 导入 / 导出：比「继续存档」低一档的次要操作，用中性描边 ——
 * 不抢主路径的视觉，但两枚等宽并排，触屏上也是舒适的热区 */
.iobtn {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 14px;
  border-radius: 11px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .04);
  color: var(--txt);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  transition: background .12s, border-color .12s;
}

.iobtn:hover {
  background: rgba(255, 255, 255, .10);
  border-color: rgba(255, 255, 255, .35)
}

.iobtn .savemeta {
  font-size: 10px
}

/* 宣传页入口：比存档操作更轻，用主题绿的细描边 —— 它是「了解」而不是「操作」 */
.promolink {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 10px;
  padding: 9px 14px;
  border-radius: 11px;
  text-decoration: none;
  font-size: 12.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, .84);
  border: 1.5px solid rgba(126, 200, 80, .26);
  background: rgba(126, 200, 80, .06);
  transition: background .12s, border-color .12s;
}

.promolink:hover {
  background: rgba(126, 200, 80, .13);
  border-color: rgba(126, 200, 80, .5)
}

.promolink .savemeta {
  font-size: 10px;
  font-weight: 400;
  opacity: .72
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

/* 矮屏（手机横屏）：按键表 / 说明再收一档，配合 .panel 的滚动保证一屏看得完 */
@media (max-height: 560px) {
  .keys {
    gap: 4px 12px;
    font-size: 11.5px;
    margin-bottom: 12px;
  }

  .modes,
  .worlds {
    margin-bottom: 10px
  }

  .mode {
    padding: 7px 14px;
    font-size: 12px
  }
}
</style>
