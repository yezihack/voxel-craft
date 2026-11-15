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
