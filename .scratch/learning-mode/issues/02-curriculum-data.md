Type: task
Status: needs-triage
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

## Comments
