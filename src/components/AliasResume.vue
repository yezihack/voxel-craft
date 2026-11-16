<script setup>
/* 别名弹窗：进游戏前问一句「接着上次的档，还是先起个名字」。
 *
 * 为什么独立成一个组件，而不是塞进 StartVeil：
 *   StartVeil 已经是开始 / 暂停遮罩；而且这个弹窗有**自己的生命周期** ——
 *   它只在「引擎就绪后、玩家还没进游戏」这个窗口里出现一次，之后不再出现。
 *   独立组件管这个窗口最干净，也不会让那块面板继续膨胀。
 *
 * 两种面孔（按「这台机器上有没有设过别名」分）：
 *   ① 设过 → 问「要不要加载这份存档」。加载 = 换回该别名绑定的 owner，
 *      再读本机档 / 云端档。
 *   ② 没设过 → 引导起一个名字，并说清它值在哪：进度会自动同步到云端，
 *      换设备时输入这个名字就能把档找回来。
 *
 * ⚠ 与 StartVeil 的分工：那边有一个行内的「首次引导」提示，讲的是同一件事。
 *   本组件在 setup 阶段就 suppressInlineGuide() 把那边的行内提示压掉 ——
 *   **必须在 StartVeil 的 setup() 之前执行**（它只在 setup 时读一次引导标记），
 *   所以 App.vue 里 <AliasResume /> 要排在 <StartVeil /> 前面。
 *   引导语因此只有这一处，不会两处同时冒出来。
 *
 * ---------- 什么时候弹 / 什么时候不弹 ----------
 * 「先不用」之后还弹不弹？分两种情况，差别在于**面板上有没有等价的入口**：
 *
 *   身份一致（owner 没换过）→ 面板上有「继续上次存档 / 从云端继续」按钮，
 *     走的是同一条路。玩家既然拒绝过一次，就别再弹了 —— 记一次，
 *     除非他后来换了别名。
 *
 *   身份已换（认领过别人的档）→ 面板上那两个按钮指的是**别人的**档，
 *     玩家想回自己那份只能靠这个弹窗换回原 owner。此时必须每次都弹，
 *     否则他自己的档就再也找不回来了。
 *
 * 这条区分是跨设备找回能不能落地的关键：弹窗在「身份已换」时是**唯一**通路。 */
import { computed, ref, watch } from 'vue'
import { engine, ui } from '../engine.js'
import { toast } from '../game/uiState.js'
import { normalizeAlias } from '../game/aliasName.js'
import {
  hasAliasState, readAliasPrompt, readAliasState, readInlineGuideDismissed,
  suppressInlineGuide, writeAliasPrompt,
} from '../game/aliasState.js'

/* 引导标记：读一次就别再弹「起个名字」了（沿用 StartVeil 那套语义）。
 * 先读后写 —— StartVeil 的 setup() 只在初始化时读一次这个键。 */
const setupDismissed = (readAliasPrompt() || {}).mode === 'setup'
const guideWasDismissed = readInlineGuideDismissed()
suppressInlineGuide()

/* 弹窗状态：null = 不显示；'resume' = 问要不要加载；'setup' = 引导设别名 */
const kind = ref(null)
const st = ref(null)               // 本机别名档案 { alias, owner, at }
const busy = ref(false)
const cloudState = ref('checking') // checking | ok | none | offline | switch
const localStatus = ref(null)      // 本机 localStorage 档摘要
const aliasInput = ref('')

/* 只在「引擎就绪后、玩家还没进游戏」时显示。
 * ui.started 进过游戏就为 true —— 暂停时不会再冒出来（那是开始面板的事）。 */
const show = () => kind.value !== null && !ui.started

/* 本机身份与别名绑定的 owner 是否一致。
 *   一致 → 这台机器上的存档就是它那份，读本机档即可（最快、离线可用）。
 *   不一致 → 玩家认领过别人的档，身份已被换掉。必须先换回原 owner 才拉得到。 */
function ownerMatches() {
  if (!st.value) return false
  try { return !!(engine.getOwner && engine.getOwner() === st.value.owner) } catch { return false }
}

/* 引擎就绪后才判断 —— 这时要能查云端、换身份、读档。 */
watch(() => ui.engineReady, async (ready) => {
  if (!ready || kind.value) return

  /* ① 本机设过别名 → 问要不要加载。 */
  if (hasAliasState()) {
    st.value = readAliasState()
    /* 身份一致且玩家拒绝过一次 → 不再打扰（面板上有等价入口）。
     * 身份已换 → 每次都弹：这是玩家回自己那份档的唯一通路。 */
    const p = readAliasPrompt()
    const refused = !!(p && p.mode === 'resume' && p.alias === st.value.alias)
    if (refused && ownerMatches()) return
    await probe()
    kind.value = 'resume'
    return
  }

  /* ② 从没设过别名 → 引导。已经明确拒绝过就别再问。 */
  if (setupDismissed || guideWasDismissed) return
  kind.value = 'setup'
}, { immediate: true })

/* 摸清这份档现在能从哪里拿到：本地缓存 / 云端 / 都没有。 */
async function probe() {
  cloudState.value = 'checking'
  localStatus.value = null
  try {
    if (!ownerMatches()) {
      /* 身份不一致 → 云端按 owner 存，当前 owner 查不到那份档，
       * 查了也是白查（查的是当前 owner 的）。直接标成「需切换」。 */
      cloudState.value = 'switch'
      return
    }
    /* 本机档只在身份一致时才有意义：身份不一致时 localStorage 里存的是
     * 「上一个身份」的存档，读它会得到别人的世界。 */
    if (engine.saveStatus) localStatus.value = engine.saveStatus()
    const m = engine.cloudMeta ? await engine.cloudMeta() : null
    if (!m) { cloudState.value = 'offline'; return }
    cloudState.value = m.has ? 'ok' : 'none'
  } catch {
    cloudState.value = 'offline'
  }
}

/* 真的没东西可加载吗？
 *
 * 玩家设了别名却一局都没玩过（本机没档、云端也没档）时，问「要不要加载」
 * 是骗人的 —— 点了只会得到一句「没找到这份存档」。这种局面改成如实告知，
 * 把按钮从「加载」换成「知道了」。
 *
 * ⚠ 只有**确定**没有才算：云端不可达（offline）时我们不知道云端有没有，
 *   那就按「可能有」处理，照常给加载按钮 —— 离线时本机档才是主力。 */
const nothingToLoad = computed(() =>
  kind.value === 'resume' && !localStatus.value && cloudState.value === 'none')

/* ---------------- 动作 ---------------- */

/* 加载这份存档。
 *
 * 两条路，取决于身份是否要换：
 *   身份一致 → 先读本机档（有就读，秒开）；没有再回落云端。
 *   身份要换 → 只能走云端：换 owner 之后 localStorage 里那份是「别人的世界」，
 *              读它等于把别人的存档加载进来。
 * 拉不到就把身份换回原值，绝不把玩家留在一个空档位上。 */
async function resume() {
  if (busy.value || !st.value) return
  busy.value = true
  const s = st.value
  const prevOwner = (engine.getOwner && engine.getOwner()) || ''
  const switching = prevOwner !== s.owner
  try {
    if (switching) {
      if (!engine.setOwner || !engine.setOwner(s.owner)) {
        toast('⚠ 切换到该别名的存档失败')
        busy.value = false
        return
      }
    }
    let ok = false
    if (!switching && localStatus.value && engine.loadNow) {
      const r = engine.loadNow()
      ok = !!(r && r.ok)
    }
    if (!ok && engine.loadFromCloud) {
      const r = await engine.loadFromCloud()
      ok = !!(r && r.ok)
    }
    if (!ok) {
      if (switching && prevOwner && engine.setOwner) engine.setOwner(prevOwner)
      toast('⚠ 没找到这份存档')
      busy.value = false
      kind.value = null
      return
    }
    kind.value = null
    ui.saveRev++
    toast(`✓ 已载入「${s.alias}」的存档`)
    engine.startGame(!ui.touch)
  } catch {
    if (switching && prevOwner && engine.setOwner) engine.setOwner(prevOwner)
    toast('⚠ 载入失败，请检查网络')
  }
  busy.value = false
}

/* 设一个别名。成功后由 save.js 统一写入本机档案（那边是唯一入口），
 * 所以这里不用自己写 —— 换任何入口设别名都会记上。 */
async function saveAlias() {
  if (busy.value) return
  const name = (aliasInput.value || '').trim()
  if (!normalizeAlias(name)) {
    toast('⚠ 别名 2–20 字，可用中文 / 字母 / 数字 / _ / -')
    return
  }
  busy.value = true
  const r = engine.setAlias ? await engine.setAlias(name) : null
  busy.value = false
  if (r && r.ok) {
    kind.value = null
    toast('✓ 别名已设置，换设备输入它就能找回存档')
  } else if (r && r.reason === 'taken') {
    toast('⚠ 这个别名已被占用 —— 若那是你另一台设备的档，用「认领」输入它即可取回')
  } else if (r && r.reason === 'invalid') {
    toast('⚠ 别名格式不对')
  } else {
    toast('⚠ 设置失败，请检查网络')
  }
}

/* 明确拒绝 → 记下来，别每次进游戏都问。
 * 但身份已换时（弹窗是回自己档的唯一通路）不记 —— 下次还得弹。 */
function dismiss() {
  if (kind.value === 'resume') {
    if (ownerMatches()) writeAliasPrompt('resume', st.value ? st.value.alias : '')
  } else {
    writeAliasPrompt('setup', '')
  }
  kind.value = null
}
</script>

<template>
  <div v-if="show()" class="aliasdlg">
    <div class="panel">
      <!-- ① 这台机器设过别名：问要不要接着玩 -->
      <template v-if="kind === 'resume'">
        <h1>🏷 继续上次存档？</h1>
        <div class="tagline">
          这台设备上设置过存档别名「<b>{{ st && st.alias }}</b>」
        </div>
        <div class="resumeinfo">
          <span v-if="localStatus" class="ok">
            本机存档 · {{ localStatus.when }} · {{ localStatus.blocks }} 格改动
          </span>
          <span v-else-if="cloudState === 'ok'" class="ok">云端有这份档</span>
          <span v-else-if="cloudState === 'switch'" class="warn">
            当前身份已换过，载入时会切回该别名绑定的账号
          </span>
          <span v-else-if="cloudState === 'offline'" class="warn">云端暂不可达</span>
          <span v-else-if="nothingToLoad" class="dim">还没找到这份存档的内容</span>
          <span v-else class="dim">正在查询…</span>
        </div>
        <div class="btnrow">
          <!-- 没东西可加载时别给一个必然失败的按钮 -->
          <button v-if="!nothingToLoad" class="go" :disabled="busy" @click="resume">
            {{ busy ? '载入中…' : '加载这份存档' }}
          </button>
          <button class="ghost" @click="dismiss">{{ nothingToLoad ? '知道了' : '先不用' }}</button>
        </div>
        <div class="foot">
          <template v-if="nothingToLoad">
            别名已经设好，但这个账号下还没有存档内容。玩一局之后进度会自动同步到云端。
          </template>
          <template v-else>
            不加载也能正常开新档；别名与存档码在下面的面板里随时能改。
          </template>
        </div>
      </template>

      <!-- ② 从没设过别名：引导，并说清设了有什么用 -->
      <template v-else-if="kind === 'setup'">
        <h1>🏷 给存档起个名字</h1>
        <div class="tagline">
          设好别名，进度会自动同步到云端<br>换设备时输入这个名字就能把档找回来
        </div>
        <div class="inputrow">
          <input
            v-model="aliasInput" type="text" maxlength="20" spellcheck="false"
            placeholder="2–20 字：中文 / 字母 / 数字 / _ / -" @keyup.enter="saveAlias"
          >
        </div>
        <div class="btnrow">
          <button class="go" :disabled="busy" @click="saveAlias">{{ busy ? '保存中…' : '保存别名' }}</button>
          <button class="ghost" @click="dismiss">以后再说</button>
        </div>
        <div class="foot">别名全局唯一。忘了也没关系，面板里始终能看到存档码。</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 盖在开始遮罩（z-index 20）之上、致命错误（100）之下。
 * 用 45：比死亡界面(40)高一点，但别压过致命错误提示。 */
.aliasdlg {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 13, .74);
  backdrop-filter: blur(5px);
}

.aliasdlg .panel {
  width: min(460px, 92vw);
  padding: 26px 28px;
}

.aliasdlg h1 {
  font-size: 22px;
  margin-bottom: 8px;
}

.tagline {
  color: var(--dim);
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 16px;
}

.tagline b {
  color: var(--accent);
  font-weight: 600;
}

.resumeinfo {
  font-size: 12px;
  color: var(--dim);
  margin-bottom: 18px;
  min-height: 17px;
}

.resumeinfo .ok { color: var(--ok); }
.resumeinfo .warn { color: var(--warn); }
.resumeinfo .dim { color: var(--dim); }

.inputrow {
  margin-bottom: 16px;
}

.inputrow input {
  width: 100%;
  padding: 11px 13px;
  border-radius: 11px;
  border: 1.5px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .06);
  color: var(--txt);
  font-size: 14px;
  font-family: inherit;
  outline: none;
}

.inputrow input:focus {
  border-color: var(--accent);
}

.btnrow {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}

.btnrow .go {
  padding: 11px 26px;
  font-size: 14px;
}

.btnrow .go:disabled {
  opacity: .55;
  cursor: default;
  transform: none;
}

.ghost {
  padding: 11px 18px;
  border-radius: 13px;
  border: 1.5px solid rgba(255, 255, 255, .16);
  background: transparent;
  color: var(--dim);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

.ghost:hover {
  color: var(--txt);
  border-color: rgba(255, 255, 255, .32);
}

.foot {
  margin-top: 16px;
  font-size: 11px;
  color: var(--dim);
  line-height: 1.5;
}

/* 矮屏：整块面板收一档，保证一屏能看完 */
@media (max-height: 560px) {
  .aliasdlg .panel { padding: 16px 18px; }
  .aliasdlg h1 { font-size: 19px; }
  .tagline { font-size: 11.5px; margin-bottom: 10px; }
  .btnrow .go, .ghost { padding: 9px 20px; font-size: 13px; }
}
</style>
