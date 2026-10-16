Type: task
Status: resolved
Blocked by: 01

# 落地课程数据与出题/判定纯函数

在 `src/data/curriculum/` 下建 `zh.js` / `en.js` / `quiz.js`。

硬要求：

- **纯数据 + 纯函数**。不 import vue、不碰 DOM、不碰 GL —— 和 `crafting.js` 同构，
  可以整段抽到 Node 里无头测试。
- `quiz.js` 暴露 `makeTask(entry, kind)` 与 `judge(task, answer)`，
  答案一律用**选项 id**而不是字符串比较（避免全半角、大小写、空格的判定泥潭）。
- 学习层是 `config.js` 的**下游**：它可以 import config 拿方块 id，
  但 config 绝不 import 它。违反会撞上 config 的 TDZ 纪律。

验收：Node 里跑一遍「每个词条都能出题、判定对/错各一次」不报错。

## Answer

2026-10-16 完成。

- `src/data/curriculum/zh.js` —— 语文 310 条（生字 / 词语 / 古诗 / 多音字 / 量词 / 近反义）
- `src/data/curriculum/en.js` —— 英语 303 条（话题词汇 / 句型 / CVC 拼读词族）
- `src/data/curriculum/quiz.js` —— `makeTask()` / `judge()` / `makeQuiz()` / `entriesOf()`
- `scripts/check-curriculum.mjs` —— 无头自检，`npm run check:curriculum`

**自检覆盖 9 组断言，全绿**：词条 id 唯一、拼写规范化（去声调 / ü→v / 撇号）、
每个「词条 × 题型」组合都能出题且对/错各判一次（946 个组合）、连诗句可还原、
正确项必在选项中、同 seed 出题可复现、筛选器不串味。

三条纪律已写进文件头：不 import vue / 不碰 DOM / 不碰 GL；不收课文原文；
声调不进判定（pinyin 带调只用于 DOM 显示，判定的依据是 `spellKey`）。

**确认过的一件事**：`src/data/curriculum/` 只 import 彼此，
不依赖 `src/game/` 里任何东西 —— 学习层是 `config.js` 的**下游**，
这条边一旦反过来就会撞上 config 的 TDZ 纪律。

## Comments
