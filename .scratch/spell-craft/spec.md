# 让工作台里的「拼单词 / 拼音」真正可用

## 需求

> 可以在工作栏里合成单词或拼音的功能用不了，方块根本没法放进去。而且也没有各种单词的选项。

用户报的是三个连在一起的症状：合成台里**放不进字块**、**没有单词选项**、**拼词功能整体不可达**。

口径：字块是学习材料，不占背包账；拼写仍走既有的 `craftResult() → doCraft() → takeCraftResult()` 路径，不新增一套课业结算。

## 根因

拼写功能的**数据层和结果层早就存在**，缺的是输入层与入口。四处断点叠加，导致任何模式下都拼不出一个词：

1. **合成台默认看不见**：`BagPanel.vue` 里是 `<CraftBox v-if="surv" />`，而游戏默认进创造模式。默认的「方块库」页面根本没有 3×3 合成格，玩家连往哪儿放都不知道。
2. **没有任何一条把字块放进合成台的路径**：`GLYPH_BLOCK` / `GLYPH_LETTER` / `readGlyphSeq()` / `spellResult()` / `craftResult()` 的拼写分支都在，但背包点击只做「选中 / 对调」，配方书只列 `RECIPES`，字块既不在背包也不在方块库里供选取。于是 `craftSlots` 永远是普通材料，拼写分支永远命中不到 —— 这就是「方块根本没法放进去」。
3. **没有词表**：400 个课程词条只存在于 `SPELL_TABLE` 这张 Map 里，UI 从未把它列出来。ADR-0007 规定 3×3 行优先连读、最多 9 字母，玩家既不知道有哪些词能拼，也不知道字母要连着摆。
4. **清空会把字块凭空造出来**：`clearCraft()` / `craftClearAt()` 无条件 `invAdd(id, 1)`。一旦开始往合成台直接写字块，清空时就会往背包里退回从未扣过的字块。

另外 `engine.js` 的 `NOT_READY_KEYS` 必须同步登记新按钮，否则开始面板第一帧渲染出字母盘就抛 `engine.placeGlyph is not a function`。

线上 `https://voxel-craft-516.pages.dev/` 的 bundle 里 `spellBookEntries / glyphpad / placeGlyph` 全部为 0，确认用户玩到的是不含任何修复的旧构建。**修复代码在 2026-11-10 19:33–19:40 已写入工作区，但既未提交也未部署**，这才是「功能用不了」的直接原因。

## 做法

### 输入层：`src/game/spellPanel.js`（新）

- `GLYPH_PAD`：A–Z 26 个字母。
- `placeGlyph(ch)`：直接写 `craftSlots` 的**第一个空位**，不走 `craftPlace()`（那个会查 `invCount` 并 `invTake`）。满了给 Toast 而不是静默失败。
- `undoGlyph()`：从后往前只撤最后一个字块，不动手动摆的普通材料。
- `pickSpellEntry(key)`：只认词表里真实存在的 key，先 `clearCraft(true)` 再按行优先顺序一次性摆好。超过 9 字母的词根本没进词表，这里再挡一道。

刻意不 import `uiActions.js`：那边依赖面很宽，从 `index.js` 直接导出可避免拉出循环。

### 书目层：`src/game/spell.js` 的 `spellBookEntries()`

从 `SPELL_TABLE` 派生一份可展示清单：过滤掉 >9 字母与含非 A–Z 字符的 key；**同一个 key 只取 `arr[0]`**，与 `takeCraftResult()` 挑 `entries[0]` 的口径一致（工单 04 记录过 9 处撞 key，列出两行会看着像 bug）。结果 370 条：英语 275、拼音 95。

### 界面层

- `src/components/BagPanel.vue`：`<CraftBox />`，去掉 `v-if="surv"`。合成台两种模式都显示，默认创造模式直接可达。
- `src/components/CraftBox.vue`：加 A–Z 字母盘（27 键正好 9×3，与九宫格对齐）、「词表 / 配方书」双 tab，默认停在词表。
- `src/components/SpellBook.vue`（新）：370 条词卡，支持按词 / 拼音 / 释义 / 主题搜索与「全部 / 英语 / 拼音」筛选；点一条自动摆料，与配方书交互同构。中文文本走 DOM（ADR-0003），不烘进贴图集。

### 账目与装配

- `src/game/crafting.js`：`clearCraft` / `craftClearAt` 用 `config.isGlyphBlock` 守卫，字块不退回背包；`isGlyphBlock` 在 HEAD 中已存在，无需改 config。
- `src/game/index.js`：导出 `spellBookEntries` 与四个面板动作。
- `src/engine.js`：`NOT_READY_KEYS` 登记 `placeGlyph / pickSpellEntry / undoGlyph`。

`uiActions.takeCraftResult()` 的拼写结算分支 HEAD 中已有，本次未改动。

### 为什么用 `split.mjs` 拆分提交

工作区里同批文件还叠着**并行会话的箱子系统**改动（`chests.js` / `ChestPanel.vue` / `config.js` 新增四种箱子 / `textures.js` / `fluid.js` 等），全部未提交。`engine.js`、`index.js`、`crafting.js` 三个文件被两条线同时修改，直接 `git add` 会把别人的半成品带上。

`split.mjs` 从 `HEAD` 的 blob 出发，按锚点只施加拼写线的 hunk，生成 staging 内容，再用 `git hash-object -w` + `git update-index --cacheinfo` 写入暂存区。**工作区文件保持原样**，提交后箱子系统仍表现为未提交改动，一条都没丢。

## 验证

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 纯逻辑 | `node .scratch/spell-craft/probe.mjs` | 10/10 通过：370 条全可达、无撞 key、覆盖英 / 拼、长词排除、跨行续摆、空档不硬拼 |
| 真实 UI | `.scratch/spell-craft/ui-probe.mjs`（Playwright + 系统 Chrome） | 23/23 通过、零控制台报错：默认创造模式可见合成台、字母盘放字块、清空不造物、词表 370 条可筛选可自动摆料、结果格命中 APPLE 并完成课业、生存模式同样可用且不占背包账 |
| 构建 | `npx vite build`（干净 worktree） | 通过 |
| 线上 | 部署后 DOM 验收 | 见下 |

浏览器探针的两个既有坑仍然成立：改完代码必须重启 dev server（HMR 的 `?t=` 会给出第二个模块实例）；驱动一律 `import` 页面真实加载过的模块 URL，不能 `import('/src/engine.js')`（那是 noop 占位）。

## 边界

- 超过 9 个字母的词（`blackboard` / `basketball` / `volleyball` / `liangshuang`）按 ADR-0007 走 PICK 题型，不进拼写词表，词表里点了没反应的情况不会发生。
- 同音 / 撞 key 的词只展示 `arr[0]`，与结算口径一致。
- 字块是合成台专用的学习材料，不进背包、不进方块库；放进世界的字块方块仍按普通方块处理。
- 本次提交**不含**箱子系统；线上产物由干净 worktree 构建，天然不带那批未提交文件。
