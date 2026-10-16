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

console.log(fails === 0 ? '\n全部通过' : `\n失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
