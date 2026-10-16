/* 拼写合成：读合成台里的字块 → 查课程词表。
 *
 * 玩家把字块横着摆进 3×3 合成台，读出来的字母序列命中课程词表就算拼成了。
 * 和普通配方是**两条并行的匹配路径**：`craftResult()` 先查配方，查不到再查拼写。
 *
 * ⚠ 刻意**不塞进 RECIPES**：400 词 × 每条一个 grid 会把配方表炸掉，
 *   而且配方书 UI 会被淹没成几百页。这里做的是「读序列 → 查表」，两行代码的事。
 * ⚠ 拼音与英语走**同一个**函数，只是命中的词条不同（ADR-0002）。
 * ⚠ 声调不进判定 —— 拼音侧按不带调字母序列匹配（ADR-0002）。
 *
 * 整段不碰 DOM / 不碰 GL，`readGlyphRow` 甚至不依赖 config（letterOf 可注入），
 * 所以能直接拉到 Node 里做无头断言。 */

import { GLYPH_LETTER } from './config.js';
import { SPELL_TABLE, spellLookup } from '../data/curriculum/spellTable.js';

/* 从 9 格合成台里读出一个字母序列。读不出来返回 null。
 *
 * ⚠ 是**行优先连读**，不是「只读一行」。合成台一行只有 3 格，
 *   而拼音「píng bà」是 6 个字母、「apple」是 5 个 —— 只允许一行的话，
 *   绝大多数词条根本摆不下。所以规则是「横着摆，一行摆满就换行继续」，
 *   整个 3×3 最多 9 个字母。
 *
 * 规则（刻意从严，宁可不出也不要错出）：
 *   · 字块必须**挨着**（行优先顺序上连续）—— 「C A _ / T _ _」读不出 cat
 *   · 混进任何非字块 → 交回普通配方处理，这里直接放弃
 *   · 超过 9 个字母的词（blackboard 这类）在这张台子上拼不出来，
 *     属于已知限制，不是 bug —— 它们走别的题型（PICK）就好。
 *
 * letterOf 可注入：默认是 config 的 GLYPH_LETTER，测试时可传自己的映射。 */
export function readGlyphSeq(slots, letterOf) {
  const toChar = letterOf || ((id) => GLYPH_LETTER[id]);
  let letters = '';
  let started = false;
  let gap = false;
  for (let i = 0; i < 9; i++) {
    const id = slots[i] | 0;
    if (!id) { if (started) gap = true; continue; }
    const ch = toChar(id);
    if (!ch) return null;                   // 混了非字块 → 不是拼写
    if (gap) return null;                   // 中间有空档
    started = true;
    letters += ch;
  }
  return letters || null;
}

/* 字母序列 → 命中的词条数组（null = 没命中） */
export function spellMatch(letters, table) {
  return spellLookup(letters, table || SPELL_TABLE);
}

/* 合成台 → 拼写结果：{ letters, entries } 或 null。
 * entries 可能多于一条（同音词）；调用方按 lang 或上下文挑。 */
export function spellResult(slots, table) {
  const letters = readGlyphSeq(slots);
  if (!letters) return null;
  const entries = spellMatch(letters, table);
  if (!entries) return null;
  return { letters, entries };
}
