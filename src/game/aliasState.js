/* 本机别名档案 —— 「这台浏览器之前用哪个名字存过档」。
 *
 * 为什么要有它（与 save.js 的 cachedAlias 有何不同）：
 *   save.js 的 `voxel-craft:alias` 只是**展示缓存**，内容是当前 owner 在 D1 上
 *   的别名；查不到就退化成空串，而且 setOwner 换身份时会被清掉。
 *   本模块记的是**本机历史**：玩家在这台机器上亲手设过哪个别名、那次设置
 *   属于哪个 owner、什么时候设的。
 *
 *   两者回答的是不同问题：
 *     cachedAlias → 「我现在这份档叫什么」（随身份变）
 *     aliasState  → 「这台机器上我用过什么名字」（不随身份变）
 *
 * 为什么要单独存 owner：
 *   别名是玩家自己起的、当作存档钥匙用的东西，跟身份 UUID 是两回事。
 *   存下「别名 + 它绑的 owner」之后，即使本机身份后来换过（认领了别人的档），
 *   仍然能换回原 owner，把那份存档取回来 —— 只存别名文本做不到这一点。
 *
 * 存一份在浏览器上是刻意的：别名全局唯一（后端 aliases 表判重），
 * 「别名 + owner」足以在换设备时反查回存档。
 *
 * 纯函数 + 无依赖：浏览器与 node 探针都能直接 import。 */

/* 档案键。与 save.js 的 `voxel-craft:alias` 分开，避免两套语义互相覆盖。 */
export const ALIAS_STATE_KEY = 'voxel-craft:alias-state'

/* 提示状态键：记「玩家已经就这一类提示表过态」。
 * mode = 'resume' 见过「继续上次存档」并拒绝过 → 别再问同一份存档
 * mode = 'setup'  见过「给存档起名字」并拒绝过 → 别再问 */
export const ALIAS_PROMPT_KEY = 'voxel-craft:alias-prompt'

/* StartVeil.vue 的行内别名引导用的键。这里只做**抑制**（写 '1'），
 * 不读它的值 —— 那边有同名字面量，两处各管一头，不互相依赖。
 * ⚠ 写 '1' 的时机必须在 StartVeil 的 setup() 之前（它只在 setup 时读一次），
 *   所以 AliasResume 要挂在 App.vue 的 <StartVeil /> **之前**。 */
export const ALIAS_GUIDE_KEY = 'voxel-craft:alias-guide'

/* ---------------- 本机别名档案 ---------------- */

/* 档案结构：{ alias, owner, at }
 *   alias —— 玩家设的名字（原样大小写，显示用）
 *   owner —— 设置那一刻的 owner UUID（恢复存档的钥匙）
 *   at    —— 设置时间戳（毫秒），用于「上次存于…」这类展示与排序 */
function emptyState() {
  return { alias: '', owner: '', at: 0 }
}

/* 读本机档案。数据损坏 / 被手改 / 隐私模式 → 一律退化成空档案，
 * 绝不抛异常 —— 这条路径在启动时一定会跑，抛错等于白屏。 */
export function readAliasState() {
  try {
    if (typeof localStorage === 'undefined') return emptyState()
    const raw = localStorage.getItem(ALIAS_STATE_KEY)
    if (!raw) return emptyState()
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return emptyState()
    const alias = typeof o.alias === 'string' ? o.alias.trim() : ''
    const owner = typeof o.owner === 'string' ? o.owner.trim() : ''
    const at = Number.isFinite(o.at) ? o.at : 0
    /* 别名与 owner 缺一不可：只有别名没法反查存档，只有 owner 等于没设过。 */
    if (!alias || !owner) return emptyState()
    return { alias, owner, at }
  } catch {
    return emptyState()
  }
}

/* 写本机档案。owner 为空 → 视为清空（换身份时不该留旧档案指向错 owner）。 */
export function writeAliasState(alias, owner, at) {
  try {
    if (typeof localStorage === 'undefined') return emptyState()
    const a = String(alias == null ? '' : alias).trim()
    const o = String(owner == null ? '' : owner).trim()
    if (!a || !o) return clearAliasState()
    const st = { alias: a, owner: o, at: Number.isFinite(at) ? at : Date.now() }
    localStorage.setItem(ALIAS_STATE_KEY, JSON.stringify(st))
    return st
  } catch {
    return emptyState()
  }
}

/* 清掉本机档案（玩家主动删档、或换身份后不想再被旧档案引导）。 */
export function clearAliasState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ALIAS_STATE_KEY)
  } catch { /* 隐私模式禁用 */ }
  return emptyState()
}

/* 这台机器上**是否设置过**别名。注意口径：查的是本机档案，
 * 不是「云端当前 owner 有没有别名」—— 后者在断网 / 换设备时恒为无，
 * 会把老玩家误判成新玩家。 */
export function hasAliasState() {
  const st = readAliasState()
  return !!(st.alias && st.owner)
}

/* ---------------- 提示状态 ---------------- */

/* 读提示状态：{ mode, alias, at } 或 null。 */
export function readAliasPrompt() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(ALIAS_PROMPT_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || !o.mode) return null
    return { mode: String(o.mode), alias: String(o.alias || ''), at: Number.isFinite(o.at) ? o.at : 0 }
  } catch {
    return null
  }
}

/* 记提示状态：玩家就这一类提示拒绝过，别再弹。 */
export function writeAliasPrompt(mode, alias) {
  try {
    if (typeof localStorage === 'undefined') return null
    const p = { mode: String(mode || ''), alias: String(alias || ''), at: Date.now() }
    if (!p.mode) return null
    localStorage.setItem(ALIAS_PROMPT_KEY, JSON.stringify(p))
    return p
  } catch {
    return null
  }
}

/* 清掉提示状态（玩家后来又主动设了别名 → 值得再问一次）。 */
export function clearAliasPrompt() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ALIAS_PROMPT_KEY)
  } catch { /* 隐私模式禁用 */ }
  return null
}

/* ---------------- 抑制 StartVeil 的行内引导 ---------------- */

/* StartVeil 的行内引导是否已被玩家拒绝过。
 * ⚠ 它只在 setup() 里读一次 —— 所以要读必须在它 setup 之前。 */
export function readInlineGuideDismissed() {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(ALIAS_GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

/* 写 StartVeil 的引导标记，让那边不再显示行内提示。
 * 必须在 StartVeil 的 setup() 之前调用 —— 它只在 setup 时读一次，
 * 之后再写就晚了（ref 已经初始化）。 */
export function suppressInlineGuide() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ALIAS_GUIDE_KEY, '1')
  } catch { /* 隐私模式禁用 */ }
}
