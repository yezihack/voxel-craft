/* 拼写面板动作：把字块摆进 3×3 合成台。
 *
 * 存在的理由：拼写的数据层（spell.js）与结果层（crafting.js 的 craftResult /
 * doCraft）早就有了，但**没有一条把字块放进合成台的路径** —— 背包点击只做
 * 「选中 / 对调」，配方书只列 RECIPES，于是拼词在任何模式下都不可达。
 *
 * 设计口径（用户确认）：字块是**学习材料，不占背包账**。
 *   · 放料直接写 craftSlots，不走 craftPlace（那个会查 invCount 并 invTake）；
 *   · 退回 / 清空的 invAdd 由 crafting.js 的 isGlyphBlock 守卫挡掉，这里不重复记；
 *   · 拼词本身仍走 uiActions.takeCraftResult() → doCraft() 的既有路径。
 *
 * ⚠ 不 import uiActions.js：那边依赖面很宽（actions / chests / mobs …），
 *   从 index.js 直接导出本模块即可，别再绕出一圈循环。
 */

import { blip } from './audio.js'
import { GLYPH_BLOCK } from './config.js'
import { CRAFT_N, clearCraft, craftSlots } from './crafting.js'
import { spellBookEntries } from './spell.js'
import { toast } from './uiState.js'

export const GLYPH_PAD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/* 字母盘：点一个字母，字块落到行优先的第一个空位。
 * 空格子不够时给提示而不是静默失败 —— 否则玩家会以为拼写又坏了。 */
export function placeGlyph(ch) {
  const id = GLYPH_BLOCK[String(ch || '').toUpperCase()];
  if (!id) return false;
  const i = craftSlots.indexOf(0);
  if (i < 0) {
    toast('合成格满了，点一下格子把字块拿掉');
    blip(200, 0.07, 'square', 0.03);
    return false;
  }
  craftSlots[i] = id;
  blip(660, 0.035, 'sine', 0.025);
  return true;
}

/* 词表：点一个词条，把它的字母序列一次性摆好。
 * 只认词表里真的存在的 key —— 这是 public boundary，别让脏 key 往合成台写东西。
 * 超过 9 个字母的词根本没进词表（ADR-0007），这里再挡一道。 */
export function pickSpellEntry(key) {
  const k = String(key || '').toLowerCase();
  const entry = spellBookEntries().find((e) => e.key === k);
  if (!entry) {
    toast('这个词在 3×3 合成台上拼不出来');
    blip(200, 0.07, 'square', 0.03);
    return 0;
  }
  clearCraft(true);                 // 非字块材料退回背包，字块直接清掉
  for (let i = 0; i < k.length && i < CRAFT_N; i++) {
    craftSlots[i] = GLYPH_BLOCK[k[i].toUpperCase()];
  }
  blip(720, 0.05, 'sine', 0.035);
  toast('已摆好「' + entry.text + '」· 点绿色结果格完成');
  return k.length;
}

/* 字母盘的「退一格」：只撤最后一个字块，别把玩家手动摆的普通材料也顺手清了。 */
export function undoGlyph() {
  for (let i = CRAFT_N - 1; i >= 0; i--) {
    const id = craftSlots[i] | 0;
    if (!id) continue;
    if (!Object.values(GLYPH_BLOCK).includes(id)) return false;
    craftSlots[i] = 0;
    blip(420, 0.04, 'sine', 0.03);
    return true;
  }
  return false;
}
