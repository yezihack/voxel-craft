/* 附魔台：词条表 + 铭刻状态。
 *
 * ============================ 为什么是「按种类铭刻」 ============================
 * 本作的背包是一张 `id → 数量` 的 Map（见 survival.js），**没有单件物品的身份**：
 * 两把钻石剑在内存里就是同一个数字 226，既没有耐久也没有自定义名字。
 * 如果硬要做「给这一把剑附魔」，就得给每一格物品加实例对象，改动会顺着
 * invSlots / 存档 / 合成格 / 盔甲槽 / 快捷栏一路铺开 —— 收益远小于风险。
 *
 * 所以这里把规则定成：**铭刻记在「装备种类」上，同类装备共享**。
 * 这不是妥协的糊法，而是和这个世界的物品模型一致的表述 —— 世界里本来就只有
 * 「钻石剑」这一种东西。界面上也照实说明，玩家换一把新剑不用重刻，是便利而不是漏洞。
 *
 * ============================ 依赖方向 ============================
 * 本模块只依赖 config.js（叶模块），**不碰** inv / DOM / WebGL —— 于是
 *   armor.js → enchant.js → config.js
 *   survival.js → enchant.js
 *   mobs.js → enchant.js
 * 三条边都不会成环。唯独 config.js 自己要用（attackDamage / toolSpeedOn），
 * 那是反向边，只能走依赖注入：config 里留一个 enchantLevel 占位，
 * 由本模块在文件末尾 setEnchantReader() 装上去（和 readHeldId 同一个套路）。
 *
 * ⚠ 这也意味着 **本模块必须被求值一次**，否则注入不上去、所有词条静默失效。
 *   保证来自两处：index.js 导出它、uiActions.js 引它。改 import 图时别把这两条都删了。
 */
import { reactive } from 'vue'
import { ARMOR_OF, I, SHIELD_OF, TOOL_OF, setEnchantReader, setEnchantSummaryReader } from './config.js'

/* ============================== 词条表 ==============================
 * 每条词条的元数据只有六样：
 *   name  中文名
 *   tag   两字以内的短标签（界面上的小方块）
 *   hue   界面配色（RGB），纯显示用
 *   max   等级上限
 *   cost  每一级的材料；第 n 级要 n 份（见 costOf）
 *   fits  哪些物品能被铭刻 —— 这是唯一的适用判定来源
 *   desc  第 lv 级的效果文案（界面直接显示，不另写一份）
 *
 * 八条词条刻意**一一对应到世界里已有的八套机制**，没有一条是「只加个数字好看」：
 *   锋利 → attackDamage()      效率 → toolSpeedOn()
 *   守护 → armorPoints()       轻羽 → 摔落伤害
 *   吸血 → 击杀回血            幸运 → 方块掉落
 *   弓术 → 箭的伤害            坚守 → 盾牌格挡比例
 * 这样「铭刻」才是可感知的，而不是面板上的自嗨。 */
const kindOf = (id) => {
  const t = TOOL_OF[id]
  return t ? t.kind : ''
}
const isArmorPart = (id, part) => {
  const a = ARMOR_OF[id]
  return !!a && a.part === part
}

export const ENCH = {
  sharp: {
    name: '锋利', tag: '攻', hue: [232, 96, 84], max: 3,
    cost: [{ id: I.REDSTONE, n: 2 }, { id: I.IRON, n: 1 }],
    fits: (id) => kindOf(id) === 'sword' || kindOf(id) === 'axe',
    desc: (lv) => `近战伤害 +${lv}`,
  },
  eff: {
    name: '效率', tag: '速', hue: [236, 186, 72], max: 3,
    cost: [{ id: I.REDSTONE, n: 2 }, { id: I.GOLD, n: 1 }],
    fits: (id) => ['pick', 'axe', 'shovel'].indexOf(kindOf(id)) >= 0,
    /* 倍率是**乘算**：钻石镐 ×8 → 效率 III ×2.5 → ×20。
     * 用加算的话星陨镐(16) 加成 16+1.5 几乎看不出变化，越好的工具词条越没意义。 */
    desc: (lv) => `对口挖掘 ×${(1 + 0.5 * lv).toFixed(1)}`,
  },
  ward: {
    name: '守护', tag: '护', hue: [110, 178, 236], max: 3,
    cost: [{ id: I.IRON, n: 2 }, { id: I.QUARTZ, n: 1 }],
    fits: (id) => !!ARMOR_OF[id],
    desc: (lv) => `护甲 +${lv * 2} 点`,
  },
  feather: {
    name: '轻羽', tag: '羽', hue: [196, 220, 236], max: 2,
    cost: [{ id: I.LEAF, n: 4 }, { id: I.WOOL, n: 1 }],
    fits: (id) => isArmorPart(id, 'feet'),
    desc: (lv) => `安全落高 +${(1.2 * lv).toFixed(1)} 格`,
  },
  leech: {
    name: '吸血', tag: '吸', hue: [196, 66, 92], max: 2,
    cost: [{ id: I.BONE, n: 2 }, { id: I.REDSTONE, n: 2 }],
    fits: (id) => kindOf(id) === 'sword',
    desc: (lv) => `击杀回 ${lv * 2} 点血`,
  },
  fortune: {
    name: '幸运', tag: '运', hue: [124, 200, 122], max: 2,
    cost: [{ id: I.GOLD, n: 2 }, { id: I.DIAMOND, n: 1 }],
    fits: (id) => kindOf(id) === 'pick',
    desc: (lv) => `挖方块 ${Math.round(30 * lv)}% 额外掉一份`,
  },
  power: {
    name: '弓术', tag: '弓', hue: [186, 142, 84], max: 2,
    cost: [{ id: I.STICK, n: 4 }, { id: I.GUNPOWDER, n: 1 }],
    fits: (id) => id === I.BOW,
    desc: (lv) => `箭矢伤害 +${lv}`,
  },
  bulwark: {
    name: '坚守', tag: '盾', hue: [176, 184, 198], max: 2,
    cost: [{ id: I.IRON, n: 2 }, { id: I.PLANK, n: 2 }],
    fits: (id) => !!SHIELD_OF[id],
    desc: (lv) => `格挡比例 +${Math.round(8 * lv)}%`,
  },
}
/* 固定顺序：界面按这个顺序列词条，不依赖对象的键序（虽然现代引擎保序，
 * 但存档里的顺序不可信，显式一张表最省事）。 */
export const ENCH_KEYS = Object.keys(ENCH)

/* ============================== 铭刻状态 ==============================
 * 结构：{ [物品 id]: { [词条键]: 等级 } }，直接就是存档里的形状 ——
 * 不做任何转换，读写两边不会分叉。
 *
 * 用 reactive 是因为面板要跟着变；键是动态加的，Vue 3 的 Proxy 天然支持。 */
export const ench = reactive({})

const EMPTY = Object.freeze({})

/* 某件（种）装备的词条等级；没有就是 0。
 * 这个函数是**热路径**：attackDamage / toolSpeedOn / armorPoints 每帧都可能调，
 * 所以刻意写得极短（一次属性读 + 一次位或），不做任何对象创建。 */
export function enchantLevel(id, key) {
  const m = ench[id | 0]
  return m ? (m[key] | 0) : 0
}
/* 某件装备的全部词条（只读视图；没有时返回同一个冻结空对象，避免每帧新建） */
export const enchantOf = (id) => ench[id | 0] || EMPTY

/* 这件装备能不能上附魔台：只要有一条词条适用就行 */
export const isEnchantable = (id) => {
  if (!id) return false
  for (const k of ENCH_KEYS) if (ENCH[k].fits(id)) return true
  return false
}

/* 第 next 级要多少材料。第 n 级 = 基础量 × n —— 越往上越贵，
 * 让「先铺满 I 级」和「把一把剑堆到 III」成为两种不同的花法。 */
export function costOf(key, next) {
  const e = ENCH[key]
  if (!e) return []
  return e.cost.map((c) => ({ id: c.id, n: c.n * next }))
}

/* 某件装备当前可铭刻/可升级的词条一览（纯规则，不含背包够不够）。
 * 返回 null 表示这件装备根本不能上附魔台。 */
export function enchantOffers(id) {
  if (!isEnchantable(id)) return null
  const out = []
  for (const key of ENCH_KEYS) {
    const e = ENCH[key]
    if (!e.fits(id)) continue
    const lv = enchantLevel(id, key)
    const maxed = lv >= e.max
    out.push({
      key,
      name: e.name,
      tag: e.tag,
      hue: e.hue,
      level: lv,
      max: e.max,
      maxed,
      next: maxed ? lv : lv + 1,
      cost: maxed ? [] : costOf(key, lv + 1),
      desc: e.desc(maxed ? lv : lv + 1),
      now: lv ? e.desc(lv) : '',
    })
  }
  return out
}

/* 铭刻一级。**不扣材料** —— 材料账在 uiActions.js（那边才认识 inv），
 * 这里只做「等级 +1」这一件纯状态变更，方便无头测试直接驱动。
 * 返回 { ok, level } 或 { ok:false, reason }。 */
export function inscribe(id, key) {
  const e = ENCH[key]
  if (!e || !e.fits(id)) return { ok: false, reason: 'fit' }
  const lv = enchantLevel(id, key)
  if (lv >= e.max) return { ok: false, reason: 'max' }
  const cur = ench[id | 0]
  if (cur) cur[key] = lv + 1
  else ench[id | 0] = { [key]: lv + 1 }
  return { ok: true, level: lv + 1 }
}

/* 这件装备上已铭刻的词条条数（界面上的「N 条」） */
export function enchantCount(id) {
  const m = ench[id | 0]
  if (!m) return 0
  let n = 0
  for (const k of ENCH_KEYS) if (m[k]) n++
  return n
}

/* 一段紧凑的摘要文案，给提示条 / 物品提示用：「锋利 II · 吸血 I」 */
export function enchantSummary(id) {
  const m = ench[id | 0]
  if (!m) return ''
  const parts = []
  for (const k of ENCH_KEYS) {
    const lv = m[k] | 0
    if (lv) parts.push(ENCH[k].name + ' ' + 'I'.repeat(Math.min(3, lv)))
  }
  return parts.join(' · ')
}

/* ============================== 存档 ==============================
 * 快照直接就是 ench 的形状（深两层的普通对象），恢复时**逐条校验**：
 * 词条键得存在、得适用这件装备、等级得在 1..max 之内。
 *
 * 为什么要校验而不是照抄：存档是可以被玩家手改的文件（导入功能就是为它开的门），
 * 一条 `{ 226: { sharp: 999 } }` 会让攻击伤害变成 999 —— 校验是唯一便宜的护栏。
 * 同理 id 必须是**可附魔的物品**，否则会往 ench 里塞一堆没人读的垃圾键。 */
export function enchantSnapshot() {
  const out = {}
  for (const k in ench) {
    const m = ench[k]
    if (!m) continue
    const copy = {}
    let any = false
    for (const key of ENCH_KEYS) {
      const lv = m[key] | 0
      if (lv > 0) { copy[key] = Math.min(lv, ENCH[key].max); any = true }
    }
    if (any) out[k] = copy
  }
  return out
}

export function enchantRestore(data) {
  for (const k of Object.keys(ench)) delete ench[k]
  if (!data || typeof data !== 'object') return
  for (const k in data) {
    const id = +k
    if (!isEnchantable(id)) continue
    const src = data[k]
    if (!src || typeof src !== 'object') continue
    const dst = {}
    let any = false
    for (const key of ENCH_KEYS) {
      if (!ENCH[key].fits(id)) continue
      const lv = Math.floor(+src[key] || 0)
      if (lv > 0) { dst[key] = Math.min(lv, ENCH[key].max); any = true }
    }
    if (any) ench[id] = dst
  }
}

/* 清空（换世界 / 读档前）。 */
export function clearEnch() {
  for (const k of Object.keys(ench)) delete ench[k]
}

/* ============================== 注入 ==============================
 * 放在文件末尾：此时 ENCH / ench 都已就位，config.js 那边拿到的是一个
 * 可以立刻调用的真函数。
 *   ① enchantLevel      → attackDamage / toolSpeedOn 读等级
 *   ② enchantSummaryOf  → itemTip 在物品提示尾巴上加「✦ 锋利 II」 */
setEnchantReader(enchantLevel)
setEnchantSummaryReader(enchantSummary)
