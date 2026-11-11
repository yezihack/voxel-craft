/* 拼写面板 · 纯 Node 探针（seam 1：词表派生 + 合成台摆法可达性）
 *
 * 用法：node .scratch/spell-craft/probe.mjs
 *
 * 只 import 纯数据 / 纯函数模块，不碰 DOM / GL / 音频。
 * 验证的是「词表里给的每一个选项，玩家照着摆进 3×3 之后真的能拼出来」——
 * 这是拼写面板最核心的契约：UI 列出来的词必须可达，不能列一堆摆不下或拼不出的。
 *
 * 断言的期望值来自独立事实（词表 key、A–Z 字块表、ADR-0007 的 9 格上限），
 * 不是照抄实现里的表达式。
 */

const C = await import('../../src/game/config.js');
const SP = await import('../../src/game/spell.js');
const T = await import('../../src/data/curriculum/spellTable.js');

let fails = 0;
const ok = (name, cond, extra) => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra === undefined ? '' : '  · ' + extra}`);
};

/* 红阶段 spellBookEntries 还不存在 —— 用空数组让断言正常报失败，而不是整个探针崩掉。 */
const book = typeof SP.spellBookEntries === 'function' ? SP.spellBookEntries() : [];

ok('词表给出了可选的词条（期望 ≥ 300 条）', book.length >= 300, `实际 ${book.length}`);
ok('词表覆盖英语与拼音两种课业',
  book.some((e) => e.lang === 'en') && book.some((e) => e.lang === 'zh'),
  `en=${book.filter((e) => e.lang === 'en').length} zh=${book.filter((e) => e.lang === 'zh').length}`);
ok('同一个字母序列只出现一次',
  book.length > 0 && new Set(book.map((e) => e.key)).size === book.length,
  `${book.length} 条 / ${new Set(book.map((e) => e.key)).size} 个 key`);
ok('每条都有展示所需的字段',
  book.length > 0 && book.every((e) => e.text && e.key && e.lang && e.kind && e.id),
  book.filter((e) => !e.text || !e.key || !e.lang || !e.kind || !e.id).length + ' 条缺字段');

/* ADR-0007：3×3 最多 9 个字母，超长的词不进拼写词表，走 PICK 题型。 */
const longKeys = [...T.SPELL_TABLE.keys()].filter((k) => k.length > 9);
ok('9 格摆不下的长词被排除',
  longKeys.length > 0 && longKeys.every((k) => !book.some((e) => e.key === k)),
  `长词 ${longKeys.join(',')}`);
ok('词表里没有超过 9 字母的条目',
  book.length > 0 && book.every((e) => e.key.length >= 1 && e.key.length <= 9));

/* 每条词条的每个字母都必须有对应字块 —— 否则字母盘 / 自动摆料会静默漏格。 */
const noGlyph = book.filter((e) => [...e.key.toUpperCase()].some((ch) => !C.GLYPH_BLOCK[ch]));
ok('所有字母都能映射到 A–Z 字块', book.length > 0 && noGlyph.length === 0,
  noGlyph.slice(0, 3).map((e) => e.key).join(','));

/* 端到端契约：把词条按行优先顺序摆进 9 格，readGlyphSeq 读出来的序列必须命中该词条。
 * 这一步不经过 Vue，也不经过 crafting.js，是纯逻辑层的最短路径。 */
const unreachable = [];
for (const e of book) {
  const slots = new Array(9).fill(0);
  [...e.key.toUpperCase()].forEach((ch, i) => { slots[i] = C.GLYPH_BLOCK[ch]; });
  const letters = SP.readGlyphSeq(slots);
  const hit = letters ? T.spellLookup(letters) : null;
  if (!hit || !hit.some((x) => x.id === e.id)) unreachable.push(e.key);
}
ok('词表每一条照着摆都能拼出来', book.length > 0 && unreachable.length === 0,
  unreachable.length ? `不可达 ${unreachable.slice(0, 8).join(',')}` : `${book.length} 条全可达`);

/* 换行续摆：apple 是 5 个字母，必须跨两行读出来（ADR-0007），
 * 只读第一行的话词表里 5 字母以上的词全废。 */
const apple = new Array(9).fill(0);
[...'APPLE'].forEach((ch, i) => { apple[i] = C.GLYPH_BLOCK[ch]; });
ok('跨行续摆能读出 5 字母词', SP.readGlyphSeq(apple) === 'APPLE', SP.readGlyphSeq(apple));

/* 中间有空档不该硬拼（ADR-0007「宁可不出也不要错出」）。 */
const gapped = new Array(9).fill(0);
gapped[0] = C.GLYPH_BLOCK.C; gapped[2] = C.GLYPH_BLOCK.T;
ok('中间空档读不出序列', SP.readGlyphSeq(gapped) === null, SP.readGlyphSeq(gapped));

console.log(fails ? `\n${fails} 条失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
