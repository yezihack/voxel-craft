<script setup>
import { computed, ref, watch } from 'vue'
import { engine, ui } from '../engine.js'
import { toast } from '../game/uiState.js'
import { normalizeAlias } from '../game/aliasName.js'
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
 * 身份 = 匿名 UUID（存档码，精确但难记）+ 玩家自选别名（好记，绑在 D1）。
 * 两者指向同一个 owner；saves / edits 永远只按 owner 存，别名不参与主键。
 *
 * ⚠ 时序：StartVeil 比 App.onMounted 更早挂载，首帧 engine.cloudMeta
 * 还是 NOT_READY_KEYS 的 noop（返回 null）。必须等 ui.engineReady 再查，
 * 否则云端有档也永远不会出现「从云端继续」。 */
const cloudMeta = ref(null)         // 有档时 { has,t,dim,mode,flat,blocks }，否则 null
const cloudState = ref('checking')  // checking | empty | ok | offline
const ownerCode = ref('')
const aliasName = ref('')
const aliasOpen = ref(false)
const aliasInput = ref('')
const aliasBusy = ref(false)
const claimOpen = ref(false)
const claimCode = ref('')
const claimBusy = ref(false)

/* 首次引导：没设过别名时提示一次，玩家点「暂不」就永久收起。
 * 离线 / 还在检查时不提示 —— 那两种状态下别名根本设不上，提示了是空头支票。
 * 之后仍可随时点云端行的「设置别名」按钮进入。 */
const GUIDE_KEY = 'voxel-craft:alias-guide'
function readGuide() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(GUIDE_KEY) === '1' } catch { return false }
}
const guideDismissed = ref(readGuide())
function dismissGuide() {
  guideDismissed.value = true
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(GUIDE_KEY, '1') } catch { /* 隐私模式 */ }
}
const showGuide = computed(() => ui.engineReady && !aliasName.value && !guideDismissed.value
  && cloudState.value !== 'checking' && cloudState.value !== 'offline')

const cloudLabel = computed(() => {
  if (cloudState.value === 'checking') return '正在连接云端…'
  if (cloudState.value === 'offline') return '云端暂不可达 · 离线可玩'
  if (cloudState.value === 'ok' && cloudMeta.value) return `云端已同步 · ${cloudMeta.value.blocks} 格改动`
  return '云端已连接 · 尚无备份'
})

async function refreshCloud() {
  if (!ui.engineReady || !engine.cloudMeta) return null
  if (engine.getOwner) ownerCode.value = engine.getOwner() || ''
  let m = null
  try { m = await engine.cloudMeta() } catch { m = null }
  cloudMeta.value = m && m.has ? m : null
  cloudState.value = m && m.has ? 'ok' : (m && m.has === false ? 'empty' : 'offline')
  /* 别名跟着 owner 变：认领到别人的档之后要显示那份档的别名。 */
  if (engine.getAlias) {
    try { aliasName.value = (await engine.getAlias()) || '' } catch { /* 保留上次值 */ }
  }
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

/* 设置 / 修改别名。校验规则与后端共用 aliasName.js，不会出现
 * 「面板说合法、点保存被拒」的规则漂移。 */
function openAlias() {
  aliasOpen.value = true
  claimOpen.value = false
  aliasInput.value = aliasName.value || ''
}
async function saveAlias() {
  if (aliasBusy.value) return
  const name = (aliasInput.value || '').trim()
  if (!normalizeAlias(name)) {
    toast('⚠ 别名 2–20 字，可用中文 / 字母 / 数字 / _ / -')
    return
  }
  aliasBusy.value = true
  const r = engine.setAlias ? await engine.setAlias(name) : null
  aliasBusy.value = false
  if (r && r.ok) {
    aliasName.value = String(r.alias || name)
    aliasOpen.value = false
    guideDismissed.value = true
    toast('✓ 别名已设置，换设备输入它就能找回存档')
  } else if (r && r.reason === 'taken') {
    toast('⚠ 这个别名已被占用，换一个试试')
  } else if (r && r.reason === 'invalid') {
    toast('⚠ 别名格式不对')
  } else {
    toast('⚠ 设置失败，请检查网络')
  }
}

/* 认领：输入别名或存档码 → 解析成 owner → 换身份 → 查云端 → 载入并进游戏。
 * 没档则还原身份，避免把当前世界误推到别人的空档位上。 */
async function doClaim() {
  const input = (claimCode.value || '').trim()
  if (!input || claimBusy.value) return
  const prev = ownerCode.value
  claimBusy.value = true
  let owner = null
  if (engine.resolveOwner) {
    try { owner = await engine.resolveOwner(input) } catch { owner = null }
  }
  if (!owner) {
    claimBusy.value = false
    toast('⚠ 找不到这个别名或存档码')
    return
  }
  if (!engine.setOwner || !engine.setOwner(owner)) {
    claimBusy.value = false
    toast('⚠ 存档码格式不对')
    return
  }
  const m = await refreshCloud()
  if (!m || !m.has) {
    if (prev) engine.setOwner(prev)
    await refreshCloud()
    claimBusy.value = false
    toast('⚠ 这个别名 / 存档码没有云端存档')
    return
  }
  claimOpen.value = false
  const r = await engine.loadFromCloud()
  claimBusy.value = false
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

      <!-- 云端身份：状态 + 别名 + 认领。存档码弱化到第二行 ——
           日常用别名，UUID 只在需要精确指定时才用。 -->
      <div class="cloudrow">
        <span class="cloudstat" :class="cloudState">☁️ {{ cloudLabel }}</span>
        <button
          class="tagbtn" :class="{ unset: !aliasName }"
          :title="aliasName ? '点击修改别名' : '给这份存档起个好记的名字'"
          @click="openAlias"
        >🏷 {{ aliasName || '设置别名' }}</button>
        <button class="codebtn" @click="claimOpen = !claimOpen; aliasOpen = false">认领</button>
      </div>
      <div class="idrow">
        <span class="idlabel">存档码</span>
        <button class="idcode" :title="ownerCode || '存档码'" @click="copyOwner"><code>{{ ownerCode || '——' }}</code> ⧉</button>
      </div>

      <!-- 第一次使用：引导设置别名。可「暂不」，之后仍能从上面的按钮进入。 -->
      <div v-if="showGuide" class="aliasguide">
        <span class="guidetext">💡 给存档起个好记的名字，换设备时输入别名就能找回，不用抄一长串存档码</span>
        <button class="guidebtn" @click="openAlias">去设置</button>
        <button class="guidebtn ghost" @click="dismissGuide">暂不</button>
      </div>
      <div v-if="aliasOpen" class="claimrow">
        <input
          v-model="aliasInput" type="text" maxlength="20" spellcheck="false"
          placeholder="2–20 字：中文 / 字母 / 数字 / _ / -" @keyup.enter="saveAlias"
        >
        <button :disabled="aliasBusy" @click="saveAlias">保存</button>
        <button class="ghost" @click="aliasOpen = false">取消</button>
      </div>
      <div v-if="claimOpen" class="claimrow">
        <input v-model="claimCode" type="text" spellcheck="false" placeholder="输入别名或存档码" @keyup.enter="doClaim">
        <button :disabled="claimBusy" @click="doClaim">载入</button>
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

/* ---------- 云端身份：状态 / 别名 / 存档码 ---------- */
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

/* 别名 chip：已设置用主题色实心，未设置用虚线框当引导入口 */
.tagbtn {
  flex: 0 0 auto;
  max-width: 38%;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(67, 224, 255, .48);
  background: rgba(67, 224, 255, .13);
  color: var(--accent);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tagbtn.unset {
  border-style: dashed;
  border-color: rgba(255, 255, 255, .30);
  background: rgba(255, 255, 255, .04);
  color: var(--dim);
  font-weight: 400;
}

.tagbtn:hover { border-color: var(--accent); color: var(--accent) }

.codebtn {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .04);
  color: var(--txt);
  font: inherit;
  font-size: 10.5px;
  white-space: nowrap;
}

.codebtn:hover {
  background: rgba(255, 255, 255, .10);
  border-color: rgba(255, 255, 255, .35)
}

/* 存档码单独一行，弱化但仍可点复制 / 长按选中（剪贴板被拒时的退路） */
.idrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--dim);
}

.idlabel { flex: 0 0 auto; opacity: .8 }

.idcode {
  flex: 1;
  min-width: 0;
  padding: 4px 9px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(0, 0, 0, .18);
  color: var(--dim);
  font: inherit;
  font-size: 10px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.idcode code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10px;
  letter-spacing: .2px;
}

.idcode:hover { color: var(--txt); border-color: rgba(255, 255, 255, .30) }

/* 首次引导条：只占一行，不抢「开始游戏」的视觉 */
.aliasguide {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px dashed rgba(126, 200, 80, .36);
  background: rgba(126, 200, 80, .06);
  text-align: left;
  font-size: 10.5px;
  color: rgba(255, 255, 255, .72);
}

.guidetext { flex: 1; min-width: 0; line-height: 1.45 }

.guidebtn {
  flex: 0 0 auto;
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
  border: 1px solid rgba(126, 200, 80, .45);
  background: rgba(126, 200, 80, .14);
  color: #b6e59a;
  font: inherit;
  font-size: 10.5px;
}

.guidebtn.ghost {
  border-color: rgba(255, 255, 255, .18);
  background: transparent;
  color: var(--dim);
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
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  border: 1.5px solid rgba(67, 224, 255, .42);
  background: rgba(67, 224, 255, .10);
  color: var(--accent);
  font: inherit;
  font-size: 11px;
}

.claimrow button:disabled { opacity: .55; cursor: default }

.claimrow button.ghost {
  border-color: rgba(255, 255, 255, .16);
  background: transparent;
  color: var(--dim);
}

@media (max-width: 820px) {
  .keys {
    grid-template-columns: 1fr
  }
}

/* 手机窄屏：别名 chip 让位，状态文字优先；存档码整行可省略（title 里有全串） */
@media (max-width: 480px) {
  .tagbtn { max-width: 34% }
  .aliasguide { flex-wrap: wrap }
  .guidetext { flex-basis: 100% }
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
