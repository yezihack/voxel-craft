/* 界面状态中心。
 *
 * 引擎侧只往这里写，Vue 组件只读这里 —— 引擎里不再有任何 getElementById /
 * querySelector / onclick。所有原来「每帧改一次 classList / textContent」的地方
 * 都变成对 ui 上某个字段赋值。 */
import { reactive } from 'vue'

export const ui = reactive({
  /* ---- HUD ---- */
  stat: '---',                 // 左上角状态行：维度 / FPS / 区块 / 坐标…
  flyTag: '(关)',              // 帮助卡里「F 飞行」后面的状态

  /* ---- 准星 / 进度 ---- */
  crossHit: false,             // 准星指着方块 → 放大
  digOn: false, digPct: 0,     // 挖掘进度环
  bowOn: false, bowPct: 0,     // 弓蓄力条

  /* ---- 生存 ---- */
  survival: false,             // 生存模式（决定 body.survival 与生命条的显示）
  hurt: false,                 // 受伤红屏
  hp: 20, maxHp: 20,
  food: 20, maxFood: 20,
  air: 10, maxAir: 10,
  airVisible: false,           // 只有真的在水下才显示氧气行

  /* ---- 背包 / 合成 ---- */
  mode: 0,                     // MODE.*
  selected: 0,                 // 手持格号
  bagOpen: false,
  bagExpanded: false,          // 储物区展开全部 5 排

  /* ---- 世界 ---- */
  worldFlat: false,            // 世界类型：false = 经典起伏，true = 超平坦

  /* ---- 存档 ----
   * saveRev 是一个「版本号」：每次存 / 读 / 删档都 +1。
   * 组件里读 saveStatus() 时顺手读一下它，就能在存档变化后重算 ——
   * 否则 localStorage 变了但 ui 上没有任何响应式依赖，面板会一直显示旧摘要。 */
  saveRev: 0,

  /* ---- 弹层 ---- */
  veilVisible: true,           // 开始 / 暂停遮罩
  veilHint: '点击后会锁定鼠标，按 <b>Esc</b> 可以随时退出',
  deathVisible: false,
  deathMsg: '生命值归零',
  toastText: '',
  toastOn: false,

  /* ---- 其它 ---- */
  touch: false,                // 触屏环境（决定 body.touch 与触屏控件显示）
  fatal: null,                 // 致命错误（如不支持 WebGL）→ 整页提示
  tags: [],                    // AI 玩家头顶标签（语义部分，见 nametags.js）
})

/* 名字标签的屏幕投影坐标：每帧变、纯视觉、量级大，所以**不放进响应式**，
 * 由 nametags.js 交给 NameTags.vue 直接写 CSS 变量，避免每帧触发 diff。 */
export const tagPos = []
/* 每帧投影结果的回调，由 NameTags.vue 在 onMounted 时注册 */
let tagHook = null
export function setTagHook(fn) { tagHook = fn }
export function applyTagPos() { if (tagHook) tagHook(tagPos) }

let toastTimer = null
export function toast(msg, ms = 1800) {
  ui.toastText = msg
  ui.toastOn = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { ui.toastOn = false }, ms)
}

export function setFatal(msg) { ui.fatal = msg }
