Type: task
Status: resolved
Blocked by: 03

# 拼写合成：在合成台上拼出单词 / 拼音

玩家把字块按顺序摆进 3×3 合成台，横着读出来是一个词 → 产出对应的「词语物品」。

关键取舍：**不要塞进 `RECIPES`**。400 词 × 每条一个 grid 会把配方表炸掉，
而且配方书 UI 会被淹没。改为独立的 `spellMatch(craftSlots)`：
读合成台里横向排列的字块序列，去词表里查。

- 复用 `crafting.js` 现有的 `craftSlots` 3×3 数组与取结果的调用路径。
- 「拼单词」（英语）与「看拼音写词语」（语文）是**同一个函数**，只是查的表不同
  —— 这正是 ADR-0002 想换来的收益，别做成两套。
- 声调不进判定，拼音按不带调字母序列匹配。
✅ 已确认（2026-10-16）：拼音与英语走**同一个** `spellMatch`，只是查的表不同。

## Answer

2026-10-16 完成。

- `src/data/curriculum/spellTable.js` —— 字母序列 → 词条 的查表（374 个 key）
- `src/game/spell.js` —— `readGlyphSeq()` / `spellMatch()` / `spellResult()`
- `crafting.js` —— `craftResult()` 先查配方、查不到再查拼写；`doCraft()` 同理
- `uiActions.takeCraftResult()` / `CraftBox.vue` —— 产物格显示拼出来的词（DOM 文字）

**没做** `RECIPES` 路线：400 词 × 每条一个 grid 会炸表、配方书会被淹没。
拼写是和普通配方**并行**的一条匹配路径，`readGlyphSeq` 见到任何非字块就放弃，
所以「一行字块 + 一格石头」不会误判。

**踩到的真问题（已改设计）**：合成台一行只有 3 格，`píng bà` 是 6 个字母 ——
原本「只读一行」的设计让绝大多数词条摆不下。改为**行优先连读、换行续摆**（ADR-0007），
上限 9 个字母。超过 9 字母的词（blackboard 等）拼不出来，属已知限制，走 PICK 题型。

**拼写不发物品**：拼词是一次课业，不是一次制造。产物格显示的就是这个词本身，
学识结算等 `learning/progress`（工单 08/09）接进来。

**已知数据噪声（未修，可接受）**：9 个词同时出现在 vocab 和 phonics 表
（cat/hat/pen/ten/pig/wet/win/hot/big…），同一单词有两条词条 id。
拼词时 vocab 那条优先（EN_ENTRIES 里 vocab 在前），结果确定；
代价是这 9 个词的掌握度会被拆成两条。要合并的话得先决定「拼读练习」
和「词汇练习」算不算同一个词条 —— 留到 08 做掌握度时一起定。

## Comments
