/* 药水效果：状态、计时与查询。
 *
 * 设计原则与 enchant.js 一致：**只依赖 config.js**（把「急迫」注入 toolSpeedOn），
 * 不碰 DOM / WebGL / player / survival —— 这样无头测试能直接驱动，
 * 也不会形成 survival → potions → survival 的环。
 *
 * 效果分两类：
 *   · instant  ：喝下去立刻结算（治疗），不进 active 列表
 *   · 持续型   ：进 active 列表，按秒递减；同一种药水重复喝只刷新时长、不叠层
 *
 * 所有查询函数都是「有就返回加成、没有就返回中性值」，
 * 调用方（player / survival / mobs / loop）不需要先判断有没有药水。 */

import { ITEMS, setPotionHasteReader } from './config.js'

/* ---------------- 效果表 ----------------
 * color 同时用于：物品图标液体色、HUD 圆点色、饮用粒子色。
 * dur 是持续时间（秒）；instant 为真时不看 dur。
 * kind 只影响 HUD 的描边（buff 亮边 / debuff 红边）。 */
export const POTION_DEFS = {
  heal:     { name: '治疗',   color: [236,  96, 110], instant: true, heal: 6, kind: 'buff',   desc: '立即回复 6 点生命' },
  speed:    { name: '迅捷',   color: [126, 214, 236], dur: 45, kind: 'buff',   desc: '移动速度 +45%' },
  jump:     { name: '跳跃',   color: [150, 232, 120], dur: 40, kind: 'buff',   desc: '跳跃高度提升' },
  strength: { name: '力量',   color: [236, 132,  76], dur: 40, kind: 'buff',   desc: '近战伤害 +3' },
  resist:   { name: '抗性',   color: [198, 208, 226], dur: 40, kind: 'buff',   desc: '受到伤害 -35%' },
  regen:    { name: '再生',   color: [240, 130, 170], dur: 25, kind: 'buff',   desc: '每秒回复 1 点生命' },
  night:    { name: '夜视',   color: [248, 220, 108], dur: 90, kind: 'buff',   desc: '黑暗中也看得清' },
  water:    { name: '水肺',   color: [ 92, 168, 236], dur: 90, kind: 'buff',   desc: '水下不消耗氧气' },
  fire:     { name: '抗火',   color: [240, 150,  70], dur: 60, kind: 'buff',   desc: '免疫岩浆灼烧' },
  haste:    { name: '急迫',   color: [214, 200, 120], dur: 45, kind: 'buff',   desc: '挖掘速度 ×2' },
  poison:   { name: '剧毒',   color: [136, 196,  92], dur: 14, kind: 'debuff', desc: '每秒损失 1 点生命' },
  slow:     { name: '缓慢',   color: [130, 140, 170], dur: 16, kind: 'debuff', desc: '移动速度 -40%' },
}

/* 正在生效的持续型药水：[{ key, t（剩余秒）, dur（总时长） }]。
 * 用数组而不是 Map：同屏最多十来个，遍历比建表更划算，
 * 也方便 HUD 按「喝下的顺序」稳定排列。 */
const active = []

/* 喝一瓶。返回 { ok, instantHeal } —— instantHeal 由调用方结算（heal 住在 survival）。
 * 同种药水重复喝取「较长的剩余时间」，不叠层：
 * 叠层会让「连喝五瓶迅捷」变成五倍速，那不是药水，是作弊。 */
export function applyPotion(key) {
  const d = POTION_DEFS[key]
  if (!d) return { ok: false, instantHeal: 0 }
  if (d.instant) return { ok: true, instantHeal: d.heal || 0 }
  const cur = active.find((e) => e.key === key)
  if (cur) {
    cur.t = Math.max(cur.t, d.dur)
    cur.dur = d.dur
  } else {
    active.push({ key, t: d.dur, dur: d.dur })
  }
  return { ok: true, instantHeal: 0 }
}

/* 每帧推进（由 survival.updateSurvival 调用 —— 药水只在生存模式有意义）。 */
export function tickPotions(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    active[i].t -= dt
    if (active[i].t <= 0) active.splice(i, 1)
  }
}

export const hasPotion = (key) => active.some((e) => e.key === key)
export const potionActive = () => active.slice()
export function clearPotions() { active.length = 0 }

/* ---------------- 查询：全部返回中性值，调用方直接乘/加 ---------------- */
export function potionSpeedMul() {
  let m = 1
  if (hasPotion('speed')) m *= 1.45
  if (hasPotion('slow')) m *= 0.60
  return m
}
export const potionJumpMul = () => (hasPotion('jump') ? 1.32 : 1)
export const potionStrengthBonus = () => (hasPotion('strength') ? 3 : 0)
export const potionResist = () => (hasPotion('resist') ? 0.35 : 0)
export const potionRegenPerSec = () => (hasPotion('regen') ? 1 : 0)
export const potionPoisonPerSec = () => (hasPotion('poison') ? 1 : 0)
export const potionNightVision = () => hasPotion('night')
export const potionWaterBreath = () => hasPotion('water')
export const potionFireResist = () => hasPotion('fire')
export const potionHasteMul = () => (hasPotion('haste') ? 2 : 1)

/* ---------------- 存档 ----------------
 * 只存 [key, 剩余秒]。读档时逐条校验（键存在 / 不是即时型 / 时长合法且夹到 dur），
 * 存档是玩家能手改的文件，一条 ["speed", 999999] 就是永久加速。 */
export function potionSnapshot() {
  return active.map((e) => [e.key, Math.round(e.t * 10) / 10])
}
export function potionRestore(list) {
  active.length = 0
  if (!Array.isArray(list)) return
  for (const pair of list) {
    if (!Array.isArray(pair)) continue
    const key = pair[0]
    const t = +pair[1]
    const d = POTION_DEFS[key]
    if (!d || d.instant || !Number.isFinite(t) || t <= 0) continue
    active.push({ key, t: Math.min(t, d.dur), dur: d.dur })
  }
}

/* ---------------- 载入期校验 ----------------
 * 「物品上写的 potion 键」必须真的存在于效果表 —— 写错了就是「右键没反应、
 * 也不报错」，和刷怪蛋 / 傀儡核心是同一类最难查的坏法，所以在载入期拦下来。 */
for (const k in ITEMS) {
  const key = ITEMS[k].potion
  if (key && !POTION_DEFS[key])
    throw new Error('药水物品「' + ITEMS[k].name + '」指向不存在的效果: ' + key)
}

/* 把「急迫」接进 config.toolSpeedOn（那边不能反向 import 本模块）。
 * 必须在本模块末尾调用一次 —— 这也是「potions.js 一定要被求值」的保证：
 * actions.js 会 import 本模块，所以只要引擎起来就一定生效。 */
setPotionHasteReader(potionHasteMul)
