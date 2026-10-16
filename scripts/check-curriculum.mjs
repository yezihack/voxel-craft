/* 课程数据无头自检。
 *
 * 用法：node scripts/check-curriculum.mjs
 *
 * 存在的理由：`src/data/curriculum/` 那一层是纯数据 + 纯函数，不该依赖浏览器。
 * 这里把它整段拉到 Node 里跑一遍，钉住几条不变式 —— 加数据、改判定之后
 * 只要这条命令还是绿的，就没有把出题逻辑改坏。
 *
 * ⚠ 不引入任何测试框架：项目没有测试依赖，也不值得为这几条断言装一个。 */
import {
  ALL_ENTRIES, TASK_KIND, countByKind, entriesOf, judge, makeQuiz, makeRng, makeTask,
  normalizeSpell, taskKindsFor,
} from '../src/data/curriculum/quiz.js';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); }
  return cond;
};

/* ---- 1. 规模 ---- */
const by = countByKind();
console.log('词条总数:', ALL_ENTRIES.length);
console.log('分kind:', by);

/* ---- 2. 词条 id 唯一（id 会存进掌握度，重复会让两个词条共享进度）---- */
{
  const seen = new Set();
  let dup = 0;
  for (const e of ALL_ENTRIES) { if (seen.has(e.id)) dup++; seen.add(e.id); }
  ok(dup === 0, `词条 id 重复 ${dup} 条`);
}

/* ---- 3. 拼写规范化 ---- */
ok(normalizeSpell('píng bà') === 'pingba', `去声调: ${normalizeSpell('píng bà')}`);
ok(normalizeSpell('lǜ') === 'lv', `ü 折成 v: ${normalizeSpell('lǜ')}`);
ok(normalizeSpell('  PinG BA ') === 'pingba', '大小写与空格不影响');
ok(normalizeSpell('o\'clock') === 'oclock', `撇号: ${normalizeSpell('o\'clock')}`);

/* ---- 4. 每个词条都能出题，且判定对/错各一次 ---- */
{
  let made = 0, bad = 0;
  for (const e of ALL_ENTRIES) {
    const kinds = taskKindsFor(e);
    if (!ok(kinds.length > 0, `${e.id} 没有任何支持的题型`)) continue;
    for (const k of kinds) {
      const t = makeTask(e, k, { seed: 7 });
      if (!ok(!!t, `${e.id} / ${k} 出题失败`)) { bad++; continue; }
      made++;
      /* 正确答案必须判对 */
      const right = t.kind === TASK_KIND.ORDER
        ? t.answer.slice()
        : t.answer;
      if (!ok(judge(t, right).ok, `${t.id} 正确答案被判错`)) bad++;
      /* 错误答案必须判错 */
      const wrong = t.kind === TASK_KIND.PICK ? '__none__'
        : t.kind === TASK_KIND.SPELL ? 'zzzzzz'
          : t.answer.slice().reverse();
      const jw = judge(t, wrong);
      if (!ok(!jw.ok, `${t.id} 错误答案被判对`)) bad++;
    }
  }
  console.log(`出题: 覆盖 ${made} 个「词条 × 题型」组合，异常 ${bad}`);
}

/* ---- 5. ORDER 课业：items 是乱序的，answer 能还原 ---- */
{
  const poems = entriesOf({ kind: 'poem' });
  ok(poems.length > 0, '没有古诗词条');
  let restored = 0;
  for (const p of poems) {
    const t = makeTask(p, TASK_KIND.ORDER, { seed: 3 });
    const got = t.answer.map((i) => t.items[i]).join('');
    const want = p.lines.join('');
    if (ok(got === want, `《${p.text}》按 answer 还原失败`)) restored++;
    ok(t.items.join('') !== want, `《${p.text}》items 居然是原序`);
  }
  console.log(`连诗句: ${restored}/${poems.length} 首可还原`);
}

/* ---- 6. PICK 课业：正确项在选项里，且选项够数 ---- */
{
  let n = 0;
  for (const e of ALL_ENTRIES) {
    for (const k of taskKindsFor(e)) {
      const t = makeTask(e, k, { seed: 11 });
      if (!t || t.kind !== TASK_KIND.PICK) continue;
      n++;
      ok(t.options.some((o) => o.id === t.answer), `${t.id} 正确项不在选项里`);
      ok(t.options.length >= 2, `${t.id} 选项不足 2 个`);
    }
  }
  console.log('选答题:', n, '个组合检查通过');
}

/* ---- 7. 可复现：同一 seed 出同一套题 ---- */
{
  const a = makeQuiz({ seed: 42, n: 8 });
  const b = makeQuiz({ seed: 42, n: 8 });
  ok(a.length === b.length, '同 seed 题目数量不一致');
  ok(a.every((t, i) => t.id === b[i].id && JSON.stringify(t.answer) === JSON.stringify(b[i].answer)),
    '同 seed 出的题不一样');
  const c = makeQuiz({ seed: 43, n: 8 });
  ok(a.map((t) => t.id).join() !== c.map((t) => t.id).join(), '不同 seed 居然出了同一套');
}

/* ---- 8. 筛选器 ---- */
{
  ok(entriesOf({ lang: 'zh' }).length > 0 && entriesOf({ lang: 'en' }).length > 0, '按语言筛选为空');
  ok(entriesOf({ grade: 3 }).length > 0 && entriesOf({ grade: 4 }).length > 0, '按年级筛选为空');
  const z = entriesOf({ lang: 'zh', grade: 3 });
  ok(z.every((e) => e.lang === 'zh' && e.grade === 3), '组合筛选串味');
}

/* ---- 9. rng 是确定的 ---- */
{
  const r1 = makeRng(5), r2 = makeRng(5);
  ok(r1() === r2() && r1() === r2(), 'rng 同一 seed 结果不同');
}

/* ---- 10. 拼写合成（工单 03/04）---- */
{
  const { GLYPH_BLOCK, GLYPH_CHARS } = await import('../src/game/config.js');
  const { readGlyphSeq: readGlyphRow, spellMatch, spellResult } = await import('../src/game/spell.js');
  const { SPELL_TABLE, SPELL_COLLISIONS } = await import('../src/data/curriculum/spellTable.js');

  ok(GLYPH_CHARS.length === 26, `字块不是 26 个: ${GLYPH_CHARS.length}`);
  ok(Object.values(GLYPH_BLOCK).every((id) => id > 0 && id < 200), '字块 id 越出了方块段');

  /* 字块表里是大写字母，摆台子时要先转大写；读出来的序列自然也是大写 ——
   * 判定侧才由 normalizeSpell 统一转小写。 */
  const row = (s, r0 = 1) => {
    const a = new Array(9).fill(0);
    const up = s.toUpperCase();
    for (let i = 0; i < up.length; i++) a[r0 * 3 + i] = GLYPH_BLOCK[up[i]];
    return a;
  };

  ok(readGlyphRow(row('cat')) === 'CAT', '读一行字块失败');
  ok(readGlyphRow(row('cat', 0)) === 'CAT', '第一行读不出来');
  ok(readGlyphRow(new Array(9).fill(0)) === null, '空合成台不该读出词');
  /* 空档：C A _ / T _ _ —— 字块没挨着，读不出来 */
  {
    const a = new Array(9).fill(0);
    a[3] = GLYPH_BLOCK.C; a[4] = GLYPH_BLOCK.A; a[6] = GLYPH_BLOCK.T;
    ok(readGlyphRow(a) === null, '字块没挨着竟然读出了词');
  }
  /* 换行续摆：一行只有 3 格，pingba（坪坝）必须能跨行 */
  {
    const a = new Array(9).fill(0);
    'PINGBA'.split('').forEach((c, i) => { a[i] = GLYPH_BLOCK[c]; });
    ok(readGlyphRow(a) === 'PINGBA', '跨行续摆读不出来');
    ok(!!spellResult(a), '跨行摆的 pingba 没拼出来');
  }
  /* 9 格封顶：摆满 9 个字母要能读出来 */
  {
    const a = new Array(9).fill(0);
    'CLASSROOM'.split('').forEach((c, i) => { a[i] = GLYPH_BLOCK[c]; });
    ok(readGlyphRow(a) === 'CLASSROOM', '9 格读不出来');
    ok(!!spellResult(a), 'classroom 没拼出来');
  }
  /* 混进非字块 → 交回普通配方 */
  {
    const a = row('cat'); a[0] = 3;                 // 石头
    ok(readGlyphRow(a) === null, '混进非字块竟然没放弃');
  }

  ok(!!spellMatch('cat'), 'cat 没命中词表');
  ok(!!spellMatch('CAT'), 'CAT 大小写不敏感失败');
  ok(!spellMatch('zzzq'), 'zzzq 不该命中');
  ok(!!spellMatch('pingba'), '拼音 pingba（坪坝）没命中');
  ok(!!spellMatch('píng bà'), '带调拼音没命中（声调不该影响判定）');

  const r = spellResult(row('cat'));
  ok(!!r && r.entries.length > 0, 'spellResult(cat) 没结果');
  ok(r && r.entries[0].text === 'cat', `spellResult(cat) 命中了 ${r && r.entries[0].text}`);
  ok(spellResult(row('zzq')) === null, 'spellResult(zzq) 不该有结果');

  /* 拼音和英语共用同一张表 —— 这正是 ADR-0002 想换来的 */
  ok(spellResult(row('pingba')).entries[0].lang === 'zh', '拼音没命中语文词条');
  ok(spellResult(row('cat')).entries[0].lang === 'en', '英文没命中英语词条');

  console.log(`拼写: 词表 ${SPELL_TABLE.size} 个 key，撞 key ${SPELL_COLLISIONS.length} 处`);
  if (SPELL_COLLISIONS.length) {
    for (const c of SPELL_COLLISIONS.slice(0, 8)) console.log('  撞:', c.key, c.ids.join(' / '));
  }
}

console.log(fails === 0 ? '\n全部通过' : `\n失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
