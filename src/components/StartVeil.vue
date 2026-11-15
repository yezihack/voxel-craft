<script setup>
import { computed, ref, watch } from 'vue'
import { engine, ui } from '../engine.js'
import { toast } from '../game/uiState.js'
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
 * 不挂一个版本号的话面板会一直显示上一次的摘要（见 uiState 的注释）。
 * 还要挂 ui.engineReady：首帧 engine.saveStatus 是 NOT_READY 占位（返回 null），
 * 引擎就绪后不重算的话，明明有本地档也会一直显示「还没有存档」。 */
const save = computed(() => {
  ui.saveRev
  ui.engineReady
  return engine.saveStatus ? engine.saveStatus() : null
})

/* 「继续上次存档」：读档 → 立刻进游戏。
 * 顺序必须是「先读再 start」，反过来的话指针锁定会先拿到、
 * 而 applySave 里的 initChunks 又把区块全标脏，第一帧会闪一下空世界。 */
function continueSave() {
  if (save.value) {
    const r = engine.loadNow()
    if (r && r.ok) engine.startGame(!ui.touch)
  } else if (cloudMeta.value) {
    /* 本地没档、云端有档：拉回云端存档再进游戏。
     * loadFromCloud 是异步的，这里 then 后再 start（顺序同 loadNow：先读再 start）。 */
    cloudMeta.value = null
    engine.loadFromCloud().then((r) => {
      if (r && r.ok) { ui.saveRev++; engine.startGame(!ui.touch) }
      else toast('⚠ 从云端读取失败，请检查网络')
    })
  }
}

/* ---------------- 云端存档（Cloudflare D1） ----------------
 * 匿名 UUID 是「无感」身份：不登录、不显示，档跟着这台浏览器走。
 * 但完全不可见就没法验证云同步、也没法换设备取回 —— 所以这里把存档码
 * 显式露出来，并允许粘贴另一台设备的码认领云端存档。
 *
 * ⚠ 时序：StartVeil 比 App.onMounted 更早挂载，首帧 engine.cloudMeta
 * 还是 NOT_READY_KEYS 的 noop（返回 null）。必须等 ui.engineReady 再查，
 * 否则云端有档也永远不会出现「从云端继续」。 */
const cloudMeta = ref(null)         // 有档时 { has,t,dim,mode,flat,blocks }，否则 null
const cloudState = ref('checking')  // checking | empty | ok | offline
const ownerCode = ref('')
const claimOpen = ref(false)
const claimCode = ref('')

const cloudLabel = computed(() => {
  if (cloudState.value === 'checking') return '正在连接云端…'
  if (cloudState.value === 'offline') return '云端暂不可达（离线仍可玩）'
  if (cloudState.value === 'ok' && cloudMeta.value) return `云端已同步 · ${cloudMeta.value.blocks} 格改动`
  return '云端已连接 · 尚无备份（保存一次即可）'
})

async function refreshCloud() {
  if (!ui.engineReady || !engine.cloudMeta) return null
  if (engine.getOwner) ownerCode.value = engine.getOwner() || ''
  let m = null
  try { m = await engine.cloudMeta() } catch { m = null }
  cloudMeta.value = m && m.has ? m : null
  cloudState.value = m && m.has ? 'ok' : (m && m.has === false ? 'empty' : 'offline')
  return m
}

/* 引擎一就绪就查；之后每次存 / 读 / 删档（saveRev 变化）再查一次。
 * 延迟 900ms 是等 saveGame 里 fire-and-forget 的 PUT 真正落库。 */
watch(() => ui.engineReady, () => { refreshCloud() }, { immediate: true })
let cloudTimer = null
watch(() => ui.saveRev, () => {
  clearTimeout(cloudTimer)
  cloudTimer = setTimeout(refreshCloud, 900)
})

async function copyOwner() {
  if (!ownerCode.value) return
  try {
    await navigator.clipboard.writeText(ownerCode.value)
    toast('✓ 存档码已复制，另一台设备粘贴即可认领')
  } catch { toast('请长按存档码手动复制') }
}

/* 认领：换 owner → 查云端 → 有档就直接载入并进游戏；没档则还原身份，
 * 避免把当前世界误推到别人的空档位上。 */
async function doClaim() {
  const code = (claimCode.value || '').trim()
  if (!code) return
  const prev = ownerCode.value
  if (!engine.setOwner || !engine.setOwner(code)) { toast('⚠ 存档码格式不对'); return }
  const m = await refreshCloud()
  if (!m || !m.has) {
    if (prev) engine.setOwner(prev)
    await refreshCloud()
    toast('⚠ 这个存档码没有云端存档')
    return
  }
  claimOpen.value = false
  const r = await engine.loadFromCloud()
  if (r && r.ok) {
    ui.saveRev++
    toast('✓ 已从云端载入存档')
    engine.startGame(!ui.touch)
  } else {
    toast('⚠ 云端存档读取失败')
  }
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
      <div v-if="save || cloudMeta" class="saverow">
        <button class="savebtn" @click="continueSave">
          <template v-if="save">📂 继续上次存档
            <span class="savemeta">{{ save.when }} · {{ save.dimName }} · {{ save.modeName }} · {{ save.blocks }} 格改动</span>
          </template>
          <template v-else>☁️ 从云端继续
            <span class="savemeta">云端存档 · {{ cloudMeta.blocks }} 格改动</span>
          </template>
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

      <!-- 云端存档状态 + 存档码：匿名 UUID 默认完全不可见，这里显式暴露，
           既能验证 D1 是否真的在同步，也能抄到另一台设备认领。 -->
      <div class="cloudrow">
        <span class="cloudstat" :class="cloudState">☁️ {{ cloudLabel }}</span>
        <button class="codebtn" :title="ownerCode || '存档码'" @click="copyOwner"><code>{{ ownerCode || '——' }}</code> ⧉</button>
        <button class="codebtn" @click="claimOpen = !claimOpen">认领</button>
      </div>
      <div v-if="claimOpen" class="claimrow">
        <input v-model="claimCode" type="text" spellcheck="false" placeholder="粘贴另一台设备的存档码" @keyup.enter="doClaim">
        <button @click="doClaim">载入</button>
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

/* ---------- 云端存档 / 存档码 ----------
 * 一行里塞下「状态 + 完整 UUID + 认领」，不能再多占纵向空间 ——
 * 面板在手机上本来就接近一屏高度。 */
.cloudrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--dim);
}

.cloudstat {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cloudstat.ok { color: #8fdd7a }
.cloudstat.offline { color: #f0a37e }
.cloudstat.checking { opacity: .75 }

/* 存档码整串可点复制，也允许长按选中（剪贴板 API 被拒时的退路） */
.codebtn {
  flex: 0 0 auto;
  max-width: 52%;
  padding: 5px 9px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .04);
  color: var(--txt);
  font: inherit;
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.codebtn code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10px;
}

.codebtn:hover {
  background: rgba(255, 255, 255, .10);
  border-color: rgba(255, 255, 255, .35)
}

.claimrow {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.claimrow input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1.5px solid rgba(67, 224, 255, .32);
  background: rgba(0, 0, 0, .22);
  color: var(--txt);
  font: inherit;
  font-size: 11px;
}

.claimrow button {
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(67, 224, 255, .42);
  background: rgba(67, 224, 255, .10);
  color: var(--accent);
  font: inherit;
  font-size: 11px;
}

@media (max-width: 820px) {
  .keys {
    grid-template-columns: 1fr
  }

  /* 窄屏优先保证状态可读，UUID 让位给省略号（title 里仍是完整码） */
  .codebtn {
    max-width: 38%
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
