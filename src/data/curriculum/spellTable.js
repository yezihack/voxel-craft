/* 拼写词表：字母序列 → 词条。纯数据 + 纯函数。
 *
 * 存在的理由：拼写合成不去查 `RECIPES`（400 词 × 每条一个 grid 会把配方表炸掉），
 * 而是查这张「规范化字母序列 → 词条」的表。
 *
 * ⚠ 拼音与英语**共用**同一张表（ADR-0002）——这正是共用 A–Z 字块换来的收益：
 *   「拼单词」和「看拼音写词语」是同一套匹配代码，只是命中不同的词条。
 * ⚠ key 一律是 `normalizeSpell` 之后的不带调字母序列，声调不进判定。
 *
 * ⚠ 生字（hanzi）**不进**这张表：单音节拼音同音字太多（shì / yī / jì …），
 *   拼出来无法唯一确定是哪一个字，判了也是瞎判。生字走选字题（PICK）。 */

import { EN_ENTRIES } from './en.js';
import { ZH_ENTRIES } from './zh.js';
import { normalizeSpell } from './quiz.js';

export const spellKeyOf = (text) => normalizeSpell(text);

/* value 是**数组**而不是单条：同音词、以及英语词与拼音偶然撞 key 的情况
 * 都要能表达出来，而不是后来者静默覆盖前面那条。撞 key 的条目会进
 * collisions，由 check-curriculum 报出来。 */
export function buildSpellTable() {
  const table = new Map();
  const collisions = [];
  const put = (key, entry) => {
    if (!key) return;
    const arr = table.get(key);
    if (arr) {
      if (arr.some((e) => e.id === entry.id)) return;
      if (arr.length === 1) collisions.push({ key, ids: [arr[0].id, entry.id] });
      else collisions[collisions.findIndex((c) => c.key === key)].ids.push(entry.id);
      arr.push(entry);
      return;
    }
    table.set(key, [entry]);
  };

  for (const e of EN_ENTRIES) {
    if (e.kind === 'vocab' || e.kind === 'phonics') put(spellKeyOf(e.text), e);
  }
  for (const e of ZH_ENTRIES) {
    if (e.kind === 'word') put(spellKeyOf(e.spellKey), e);
  }
  return { table, collisions };
}

export const SPELL_TABLE = buildSpellTable().table;
export const SPELL_COLLISIONS = buildSpellTable().collisions;

/* 查一个字母序列，返回命中的词条数组（没命中返回 null）。
 * 命中多条说明同音/同形，由调用方按 lang / 上下文挑一条。 */
export function spellLookup(letters, table = SPELL_TABLE) {
  const key = normalizeSpell(letters);
  if (!key) return null;
  const arr = table.get(key);
  return arr && arr.length ? arr : null;
}
