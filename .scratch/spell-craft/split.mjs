/* 从 HEAD 精确构造「只含拼写线」的三个混合文件内容。
 *
 * 背景：工作区里拼写面板的修复和并行会话的箱子系统**叠在同一批文件上**，
 * 直接 `git add` 会把别人的半成品一起提交。这三个文件只有部分 hunk 属于拼写线，
 * 所以从 HEAD 的 blob 出发、按锚点施加拼写 hunk，再用
 * `git hash-object -w` + `git update-index --cacheinfo` 写进暂存区；
 * 工作区文件保持原样，箱子系统仍是未提交状态。
 *
 * 用法：仓库根目录执行 `node .scratch/spell-craft/split.mjs`，
 * 随后执行同目录 split.sh 里的 hash-object / update-index 命令。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, '.scratch/spell-craft/staging')
mkdirSync(OUT, { recursive: true })

const head = (p) => execFileSync('git', ['show', 'HEAD:' + p], { encoding: 'utf8', maxBuffer: 1 << 24 })
const rep = (s, from, to, tag) => {
  if (!s.includes(from)) throw new Error('锚点未命中: ' + tag)
  if (s.split(from).length !== 2) throw new Error('锚点不唯一: ' + tag)
  return s.replace(from, to)
}
const emit = (p, s) => {
  const f = join(OUT, p.replaceAll('/', '__'))
  writeFileSync(f, s)
  console.log(f)
}

/* ---- engine.js：只登记拼写面板的 3 个 noop 占位，不登记箱子的 6 个 ---- */
let s = head('src/engine.js')
s = rep(s,
  "  'openEnchant', 'closeEnchant', 'enchantPickItem', 'enchantInscribe',\n]",
  "  'openEnchant', 'closeEnchant', 'enchantPickItem', 'enchantInscribe',\n" +
  "  /* 拼写面板：字母盘 / 词表 / 退一格，开始面板第一帧就可能点到。 */\n" +
  "  'placeGlyph', 'pickSpellEntry', 'undoGlyph',\n]",
  'engine.NOT_READY_KEYS')
emit('src/engine.js', s)

/* ---- index.js：只导出拼写面板接口，不导出箱子动作 ---- */
s = head('src/game/index.js')
s = rep(s,
  "export { MODE } from './state.js'\n",
  "export { MODE } from './state.js'\n" +
  "\n" +
  "/* 拼写面板：词表数据 + 字母盘 / 选词自动摆料。\n" +
  " * spellPanel.js 不经过 uiActions.js，避免把 actions / chests / mobs 那一大圈\n" +
  " * 依赖再拉进合成台的静态模块图。 */\n" +
  "export { spellBookEntries } from './spell.js'\n" +
  "export { GLYPH_PAD, pickSpellEntry, placeGlyph, undoGlyph } from './spellPanel.js'\n",
  'index.exports')
emit('src/game/index.js', s)

/* ---- crafting.js：字块不占背包账的三个 hunk，不含箱子配方 ---- */
s = head('src/game/crafting.js')
s = rep(s,
  "import { D, G, H, I, W, defName } from './config.js'",
  "import { D, G, H, I, W, defName, isGlyphBlock } from './config.js'",
  'crafting.import')
s = rep(s,
  "/* 清空合成格 —— 材料退回背包（背包满也照样退，东西不会凭空消失）。 */\n" +
  "export function clearCraft(toInv = true) {\n" +
  "  for (let i = 0; i < CRAFT_N; i++) {\n" +
  "    const id = craftSlots[i];\n" +
  "    if (!id) continue;\n" +
  "    if (toInv) invAdd(id, 1);",
  "/* 清空合成格 —— 材料退回背包（背包满也照样退，东西不会凭空消失）。\n" +
  " *\n" +
  " * ⚠ 字块例外：它是**学习材料，不占背包账**（拼写面板直接往合成台里供字块，\n" +
  " *   没从 inv 扣过）。退回去等于凭空造方块，生存模式还能拿去摆着玩。\n" +
  " *   判据统一走 config.isGlyphBlock，别在 UI 里各自记一套 id 范围。 */\n" +
  "export function clearCraft(toInv = true) {\n" +
  "  for (let i = 0; i < CRAFT_N; i++) {\n" +
  "    const id = craftSlots[i];\n" +
  "    if (!id) continue;\n" +
  "    if (toInv && !isGlyphBlock(id)) invAdd(id, 1);",
  'crafting.clearCraft')
s = rep(s,
  "/* 清掉合成格里第 i 个，材料退回背包 */\n" +
  "export function craftClearAt(i) {\n" +
  "  const id = craftSlots[i];\n" +
  "  if (!id) return false;\n" +
  "  craftSlots[i] = 0;\n" +
  "  invTake(id, 0);",
  "/* 清掉合成格里第 i 个，材料退回背包（字块不占背包账，见 clearCraft）。 */\n" +
  "export function craftClearAt(i) {\n" +
  "  const id = craftSlots[i];\n" +
  "  if (!id) return false;\n" +
  "  craftSlots[i] = 0;\n" +
  "  if (isGlyphBlock(id)) return true;\n" +
  "  invTake(id, 0);",
  'crafting.craftClearAt')
emit('src/game/crafting.js', s)
