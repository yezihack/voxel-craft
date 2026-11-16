/* 界面状态中心。
 *
 * 引擎侧只往这里写，Vue 组件只读这里 —— 引擎里不再有任何 getElementById /
 * querySelector / onclick。所有原来「每帧改一次 classList / textContent」的地方
 * 都变成对 ui 上某个字段赋值。 */
import { reactive } from 'vue'

export const ui = reactive({
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

  /* ---- 药水 ----
   * 正在生效的效果，供 HUD 画圆环倒计时。
   * 每项 { key, color:[r,g,b], kind:'buff'|'debuff', pct:0..1 }。
   * 这里只放「界面要画什么」，真实计时住在 potions.js。 */
  potions: [],

  /* ---- 背包 / 合成 ---- */
  mode: 0,                     // MODE.*
  selected: 0,                 // 手持格号
  bagOpen: false,
  bagExpanded: false,          // 储物区展开全部 5 排

  /* ---- 附魔台 ----
   * enchantOpen   : 台面是否打开（和 bagOpen 互斥，见 uiActions 的 openEnchant）
   * enchantTarget : 当前摆在台面上的装备 id（0 = 还没放东西）
   * 词条等级本身**不放这里** —— 它属于世界状态（存档要存），住在 enchant.js
   * 的 ench 里；这里只放「界面此刻在看什么」，和 selected / bagExpanded 同一层级。 */
  enchantOpen: false,
  enchantTarget: 0,

  /* ---- 箱子 ----
   * chestOpen : 箱面是否打开
   * chestPos  : 打开的是哪只箱子 { dim, x, y, z, type, name, slots }
   * chestItems: 箱子里的东西（{ 物品id: 数量 }），与 chests.js 的容器同步
   * 容器内容本身住在 chests.js（世界状态，存档要存）；
   * 这里只放「界面此刻在看什么」，与 enchantTarget 同一层级。 */
  chestOpen: false,
  chestPos: null,
  chestItems: {},

  /* ---- 世界 ---- */
  worldFlat: false,            // 世界类型：false = 经典起伏，true = 超平坦

  /* ---- 引擎就绪 ----
   * 引擎是动态 import 的，而开始面板比 App.onMounted 更早挂载 ——
   * 首帧读 engine.xxx 拿到的是 NOT_READY_KEYS 的 noop 占位。
   * initEngine 里 Object.assign 之后置 true，组件靠它重算摘要 / 重发云端检查，
   * 否则「继续上次存档」和「从云端继续」都不会出现。 */
  engineReady: false,

  /* ---- 存档 ----
   * saveRev 是一个「版本号」：每次存 / 读 / 删档都 +1。
   * 组件里读 saveStatus() 时顺手读一下它，就能在存档变化后重算 ——
   * 否则 localStorage 变了但 ui 上没有任何响应式依赖，面板会一直显示旧摘要。 */
  saveRev: 0,

  /* ---- 弹层 ---- */
  veilVisible: true,           // 开始 / 暂停遮罩
  started: false,              // 是否已经进过一次游戏（决定暂停面板是否给「保存」按钮）
  veilHint: '点击后会锁定鼠标，按 <b>Esc</b> 可以随时退出',
  deathVisible: false,
  deathMsg: '生命值归零',
  toastText: '',
  toastOn: false,

  /* ---- 快捷键说明面板 ----
   * 进游戏时（设置里开着）在左上角弹一张按键表，H 键随时开关。
   * 12 秒后自动收起 —— 它是「新手上路提醒」，不是常驻 HUD，
   * 一直挂在左上角会挡住视野（游戏内不放常驻文字 HUD）。 */
  keyHintsOn: false,
  /* 开关刚被打开、还没兑现的那一次「进游戏就弹」。
   * 为什么需要它：速查表只在**第一次**进游戏时自动弹（暂停后恢复、
   * 关背包这些都走同一条 startGame，每次都弹就成了噪音）。
   * 但玩家可能是在暂停面板里才把开关打开的 —— 那时游戏已经进过一次，
   * 光靠「第一次」这个条件，他这一局就再也等不到那张表了。
   * 这个标记把这个缺口补上：开关打开后，下一次 startGame 兑现一次。 */
  keyHintsPending: false,

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

/* ---------------- 快捷键说明面板 ----------------
 * 进游戏时在左上角弹一张按键速查表，H 键随时开关。
 *
 * 自动弹出的那张会自己在 12 秒后收起：它是「新手上路提醒」，
 * 不是常驻 HUD —— 游戏内不放常驻文字 HUD，一直挂在左上角会挡视野。
 * 手动按 H 弹出来的那张不自动收起，由玩家自己按 H 关掉。
 *
 * 定时器住在状态中心（和 toast 一样），组件只读 ui.keyHintsOn。 */
export const KEY_HINTS_AUTO_HIDE_MS = 12000
let keyHintsTimer = null

export function showKeyHints(autoHide = false) {
  clearTimeout(keyHintsTimer)
  keyHintsTimer = null
  ui.keyHintsOn = true
  if (autoHide) {
    keyHintsTimer = setTimeout(() => { ui.keyHintsOn = false }, KEY_HINTS_AUTO_HIDE_MS)
  }
}

export function hideKeyHints() {
  clearTimeout(keyHintsTimer)
  keyHintsTimer = null
  ui.keyHintsOn = false
}

/* H 键：开 → 关，关 → 开。开着时先关掉（清掉自动收起的定时器），
 * 关着时弹一张不会自己消失的（玩家主动要看，就别抢他的时间）。 */
export function toggleKeyHints() {
  if (ui.keyHintsOn) hideKeyHints()
  else showKeyHints(false)
}

/* 设置里的开关被打开时调用：把「下次进游戏就弹」这个承诺记下来。
 * 这样即使玩家是在暂停面板里开的开关，下一次 startGame 也会兑现。 */
export function requestKeyHints() {
  ui.keyHintsPending = true
}

/* 设置里的开关被关掉时调用：既收掉当前这张表，也撤掉那个承诺。
 * 「关闭」必须彻底 —— 留着 pending 的话，下次进游戏照样弹，
 * 玩家会觉得开关没生效。 */
export function cancelKeyHints() {
  ui.keyHintsPending = false
  hideKeyHints()
}

export function setFatal(msg) { ui.fatal = msg }
