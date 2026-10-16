/* 出题与判定 —— 纯函数。
 *
 * 整段不 import vue / 不碰 DOM / 不碰 GL，可以直接抽到 Node 里跑无头测试
 * （和 crafting.js 同构）。
 *
 * 两条判定纪律：
 *   1. **答案一律用选项 id 或规范化后的字母序列**，绝不做原始字符串比较 ——
 *      否则全半角、大小写、空格、声调会变成一片泥潭。
 *   2. 声调**不进判定**（ADR-0002）：拼音按不带调字母序列匹配。
 *      pinyin（带调）只用于 DOM 显示。 */

import { EN_ENTRIES } from './en.js';
import { ZH_ENTRIES } from './zh.js';

/* ============================== 课业类型 ==============================
 * PICK   从若干选项里挑正确的那个（选字 / 选词 / 选读音 / 选量词 / 选句型）
 * SPELL  用字块拼出目标序列（英语单词 / 汉语拼音 / 拼读词）
 * ORDER  把打乱的片段排回原序（连诗句）
 *
 * 刻意**没有** MATCH（左右两列配对）：连诗句用 ORDER 已经够，
 * 配对判定的复杂度不值当，等真需要了再加。 */
export const TASK_KIND = { PICK: 'pick', SPELL: 'spell', ORDER: 'order' };

/* 词条 kind → 它支持的课业类型。避免「给一首古诗出一道选字题」这种错配。 */
export const SUPPORTED = {
  hanzi: [TASK_KIND.PICK],
  word: [TASK_KIND.SPELL, TASK_KIND.PICK],
  poem: [TASK_KIND.ORDER],
  duoyin: [TASK_KIND.PICK],
  liangci: [TASK_KIND.PICK],
  synant: [TASK_KIND.PICK],
  vocab: [TASK_KIND.SPELL, TASK_KIND.PICK],
  pattern: [TASK_KIND.PICK],
  phonics: [TASK_KIND.SPELL],
};

export const ALL_ENTRIES = [...ZH_ENTRIES, ...EN_ENTRIES];

/* ============================== 工具 ============================== */

/* 可复现的伪随机。出题必须可复现 —— 否则无头测试没法钉住「同一 seed
 * 出同一套题」，线上也没法重现玩家遇到的某一道题。 */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* 拼写规范化：去声调 → 去非字母 → 小写。
 * ü 按输入法惯例折成 v（lǜ → lv），否则「律」和「路」会撞成同一个答案。 */
export function normalizeSpell(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/u\u0308/gi, 'v')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

let poolCache = null;
function poolOf(kind) {
  if (!poolCache) {
    poolCache = {};
    for (const e of ALL_ENTRIES) {
      if (!poolCache[e.kind]) poolCache[e.kind] = [];
      poolCache[e.kind].push(e);
    }
  }
  return poolCache[kind] || [];
}

/* 干扰项：优先同年级、同话题（同话题里词义相近，猜对的难度才合理），
 * 不够再从同 kind 的其它词条里补。 */
function distractors(entry, n, rng) {
  const all = poolOf(entry.kind);
  const same = [];
  const rest = [];
  for (const e of all) {
    if (e.id === entry.id) continue;
    if (e.grade === entry.grade && (!entry.topic || e.topic === entry.topic)) same.push(e);
    else rest.push(e);
  }
  return shuffle(same.concat(rest), rng).slice(0, n);
}

/* 把「正确项 + 干扰项」组装成打乱好的选项列表 */
function buildOptions(correctId, correctText, others, textOf, rng) {
  const opts = [{ id: correctId, text: correctText }];
  for (const e of others) {
    const t = textOf(e);
    if (t === correctText) continue;              // 干扰项撞了正确项，丢掉
    opts.push({ id: e.id, text: t });
  }
  return shuffle(opts, rng);
}

/* ============================== 出题 ============================== */

function hanziTask(entry, rng, n) {
  const variant = rng() < 0.5 ? 0 : 1;
  const others = distractors(entry, n, rng);
  if (variant === 0) {
    return {
      kind: TASK_KIND.PICK, prompt: `「${entry.pinyin}」是哪个字？`,
      hint: `组词：${entry.word}`,
      options: buildOptions(entry.id, entry.text, others, (e) => e.text, rng),
      answer: entry.id,
    };
  }
  return {
    kind: TASK_KIND.PICK, prompt: `「${entry.text}」怎么读？`,
    hint: `组词：${entry.word}`,
    options: buildOptions(entry.id, entry.pinyin, others, (e) => e.pinyin, rng),
    answer: entry.id,
  };
}

function wordTask(entry, rng, n, kind) {
  if (kind === TASK_KIND.PICK) {
    const others = distractors(entry, n, rng);
    return {
      kind: TASK_KIND.PICK, prompt: `「${entry.pinyin}」是哪个词？`,
      options: buildOptions(entry.id, entry.text, others, (e) => e.text, rng),
      answer: entry.id,
    };
  }
  /* SPELL：给词语，拼拼音。声调交给 DOM 显示（hint），判定按不带调序列。 */
  return {
    kind: TASK_KIND.SPELL, prompt: `拼出「${entry.text}」的读音`,
    hint: entry.pinyin, answer: entry.spellKey,
  };
}

function poemTask(entry, rng) {
  const lines = entry.lines;
  let order = lines.map((_, i) => i);
  /* 1/24 的概率洗完还是原序，那这道题就没得做了 —— 重洗。 */
  for (let t = 0; t < 8; t++) {
    order = shuffle(order, rng);
    if (order.some((v, i) => v !== i)) break;
  }
  const items = order.map((i) => lines[i]);
  const posOf = {};
  order.forEach((orig, pos) => { posOf[orig] = pos; });
  return {
    kind: TASK_KIND.ORDER, prompt: `把《${entry.text}》的句子排回原序`,
    hint: `${entry.dynasty}·${entry.author}`,
    items, answer: lines.map((_, i) => posOf[i]),
  };
}

function duoyinTask(entry, rng, n) {
  const reads = entry.reads;
  const k = Math.floor(rng() * reads.length) % reads.length;
  const [py, word] = reads[k];
  const opts = reads.map((r, i) => ({ id: `${entry.id}#${i}`, text: r[0] }));
  /* 只有一个读音家族不够 4 项时，从别的字借读音凑满选项 */
  let pool = opts;
  if (pool.length < n) {
    for (const e of distractors(entry, n, rng)) {
      for (const r of e.reads) pool.push({ id: `${e.id}#${r[0]}`, text: r[0] });
      if (pool.length >= n) break;
    }
    pool = pool.slice(0, n);
  }
  return {
    kind: TASK_KIND.PICK, prompt: `「${word}」里的「${entry.text}」读什么？`,
    options: shuffle(pool, rng), answer: `${entry.id}#${k}`,
  };
}

function liangciTask(entry, rng, n) {
  const others = distractors(entry, n, rng);
  return {
    kind: TASK_KIND.PICK, prompt: `一（　）${entry.noun}`,
    options: buildOptions(entry.id, entry.text, others, (e) => e.text, rng),
    answer: entry.id,
  };
}

function synantTask(entry, rng, n) {
  const wantAnt = rng() < 0.5;
  const right = wantAnt ? entry.ant : entry.syn;
  const others = distractors(entry, n, rng);
  return {
    kind: TASK_KIND.PICK, prompt: `「${entry.text}」的${wantAnt ? '反义词' : '近义词'}是？`,
    options: buildOptions(entry.id, right, others, (e) => (wantAnt ? e.ant : e.syn), rng),
    answer: entry.id,
  };
}

function vocabTask(entry, rng, n, kind) {
  if (kind === TASK_KIND.PICK) {
    const enToZh = rng() < 0.5;
    const others = distractors(entry, n, rng);
    return {
      kind: TASK_KIND.PICK,
      prompt: enToZh ? `「${entry.text}」是什么意思？` : `「${entry.gloss}」用英语怎么说？`,
      hint: entry.topicName,
      options: buildOptions(entry.id, enToZh ? entry.gloss : entry.text,
        others, (e) => (enToZh ? e.gloss : e.text), rng),
      answer: entry.id,
    };
  }
  return {
    kind: TASK_KIND.SPELL, prompt: `拼出「${entry.gloss}」`,
    hint: `${entry.text.length} 个字母 · ${entry.topicName}`, answer: entry.spellKey,
  };
}

function patternTask(entry, rng) {
  return {
    kind: TASK_KIND.PICK, prompt: entry.text, hint: entry.gloss,
    options: shuffle(entry.options.map((t) => ({
      id: `${entry.id}#${t}`, text: t,
    })), rng),
    answer: `${entry.id}#${entry.answer}`,
  };
}

function phonicsTask(entry) {
  return {
    kind: TASK_KIND.SPELL, prompt: `拼出「${entry.gloss}」`,
    hint: `${entry.rhyme} 族 · ${entry.text.length} 个字母`, answer: entry.spellKey,
  };
}

/* ============================== 对外接口 ============================== */

export function taskKindsFor(entry) {
  return SUPPORTED[entry.kind] || [];
}

/* 出一道题。
 * opts: { rng, seed, n } —— n 是选项个数（ORDER 课业忽略它）。
 * 请求的 kind 不被该词条支持时，退回它支持的第一类。 */
export function makeTask(entry, kind, opts = {}) {
  const rng = opts.rng || makeRng(opts.seed || 1);
  const n = opts.n || 4;
  const kinds = taskKindsFor(entry);
  if (!kinds.length) return null;
  const use = kinds.indexOf(kind) >= 0 ? kind : kinds[0];

  let t;
  switch (entry.kind) {
    case 'hanzi': t = hanziTask(entry, rng, n); break;
    case 'word': t = wordTask(entry, rng, n, use); break;
    case 'poem': t = poemTask(entry, rng); break;
    case 'duoyin': t = duoyinTask(entry, rng, n); break;
    case 'liangci': t = liangciTask(entry, rng, n); break;
    case 'synant': t = synantTask(entry, rng, n); break;
    case 'vocab': t = vocabTask(entry, rng, n, use); break;
    case 'pattern': t = patternTask(entry, rng); break;
    case 'phonics': t = phonicsTask(entry); break;
    default: return null;
  }
  if (!t) return null;
  t.id = `${entry.id}:${use}`;
  t.entryId = entry.id;
  t.entryKind = entry.kind;
  t.lang = entry.lang;
  t.grade = entry.grade;
  return t;
}

/* 判定。答案语义随题型不同：
 *   PICK  → 选项 id
 *   SPELL → 字母序列（大小写、空格、声调都不影响）
 *   ORDER → 下标数组
 * 一律返回 { ok, expected, got, kind }，让调用方不用自己拼反馈。 */
export function judge(task, answer) {
  if (!task) return { ok: false, kind: null };
  if (task.kind === TASK_KIND.PICK) {
    return { ok: task.answer === answer, expected: task.answer, got: answer, kind: task.kind };
  }
  if (task.kind === TASK_KIND.SPELL) {
    const exp = normalizeSpell(task.answer);
    const got = normalizeSpell(answer);
    return { ok: exp !== '' && exp === got, expected: exp, got, kind: task.kind };
  }
  if (task.kind === TASK_KIND.ORDER) {
    const got = Array.isArray(answer) ? answer : [];
    const exp = task.answer;
    const ok = got.length === exp.length && got.every((v, i) => v === exp[i]);
    return { ok, expected: exp, got, kind: task.kind };
  }
  return { ok: false, kind: task.kind };
}

/* 出一套题。
 * opts: { seed, n, lang, grade, kinds } —— kinds 是**词条** kind 的白名单。 */
export function makeQuiz(opts = {}) {
  const rng = makeRng(opts.seed || 1);
  const n = opts.n || 10;
  let pool = ALL_ENTRIES;
  if (opts.lang) pool = pool.filter((e) => e.lang === opts.lang);
  if (opts.grade) pool = pool.filter((e) => e.grade === opts.grade);
  if (opts.kinds) pool = pool.filter((e) => opts.kinds.indexOf(e.kind) >= 0);
  const picked = shuffle(pool, rng).slice(0, n);
  const out = [];
  for (const e of picked) {
    const t = makeTask(e, null, { rng });
    if (t) out.push(t);
  }
  return out;
}

/* 词条查询：给 UI 的筛选器用 */
export function entriesOf(opts = {}) {
  let pool = ALL_ENTRIES;
  if (opts.lang) pool = pool.filter((e) => e.lang === opts.lang);
  if (opts.grade) pool = pool.filter((e) => e.grade === opts.grade);
  if (opts.kind) pool = pool.filter((e) => e.kind === opts.kind);
  return pool;
}

export function countByKind() {
  const m = {};
  for (const e of ALL_ENTRIES) m[e.kind] = (m[e.kind] || 0) + 1;
  return m;
}
