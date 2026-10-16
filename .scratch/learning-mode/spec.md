# 学习层（小学 3–4 年级 · 语文 + 英语）

## 目标

把语文、英语学习做成**沙盒世界的一部分**，而不是盖在沙盒上的答题弹窗：
字母是能搬能放的方块，学堂是能走进去的建筑，题干挂在世界里的讲席上方，
作答走 DOM 面板（点选为主，不要求打字）。

## 非目标

- 不做账号、不做云端同步（单机 localStorage 足够）
- 不做教材课文原文收录（ADR-0004）
- 不做手写板 / 键盘输入汉字（3–4 年级打字极慢，产品会死）
- 不新增维度（ADR-0001）

## 已定决策

| 决策 | ADR |
|---|---|
| 学习区建在主世界，作为第 8 种结构「学堂」 | [0001](../../docs/adr/0001-learning-lives-in-overworld.md) |
| 拼音与英语共用一套 A–Z 字块 | [0002](../../docs/adr/0002-shared-glyph-blocks.md) |
| 中文文本走 DOM 覆盖层，不烘进贴图集 | [0003](../../docs/adr/0003-chinese-text-is-dom-overlay.md) |
| 只收事实性素材，不收课文原文 | [0004](../../docs/adr/0004-curriculum-content-boundary.md) |
| 语音走 speechSynthesis，可静默降级 | [0005](../../docs/adr/0005-speech-via-speechsynthesis.md) |
| 学识只兑换建造权限，不兑资源也不是分数 | [0006](../../docs/adr/0006-scholar-point-is-building-permission.md) |

术语见仓库根 `GLOSSARY.md`。

### 已确认（2026-10-16）

1. **拼音与英语共用 A–Z 字块，声调交给 DOM**（ADR-0002）——拼写判定按不带调字母序列。
2. **学识 = 建造权限货币**（ADR-0006）——不兑资源、不做分数展示。
3. **术语「词条」「字块」**（GLOSSARY.md）——最小内容单位称词条，A–Z 方块称字块。

## 分层

```
src/data/curriculum/     纯数据 + 纯函数（无 DOM / 无 GL / 无 vue，可无头测试）
  ├─ zh.js               汉字表 · 词语 · 古诗 · 句式（3–4 年级）
  ├─ en.js               词汇表 · 句型 · 自然拼读（PEP 三起 3–4 年级）
  └─ quiz.js             出题 + 判定（纯函数）
src/game/learning/       状态与能力（config 的下游，**绝不反向依赖 config 之外的引擎模块**）
  ├─ progress.js         掌握度 + 复习队列 + localStorage
  ├─ speech.js           speak() 抽象
  └─ unlock.js           学识 → 建造权解锁表
src/components/learning/ 呈现（Vue）
  ├─ LessonTag.vue       世界内题干（复用 nametags 投影机制）
  └─ QuizPanel.vue       DOM 作答（点选）
```

⚠ `config.js` 是叶模块且有严格 TDZ 纪律（依赖注入 `setHeldIdReader` / `setMobTypes`）。
学习层是 config 的**下游**：它 import config 拿方块 id，config 绝不 import 学习层。
字块与汉字物品只能**追加 id**，不许插队（1–15 语义锁死，≥200 是物品）。

## 对现有代码的插入点

| 现有文件 | 改动 |
|---|---|
| `src/game/config.js` | `BLOCKS` 追加 26 条字块；`ITEMS` 追加汉字物品（通用底板贴图） |
| `src/game/textures.js` | 新增字母贴图绘制（离屏 canvas `fillText`，非 3D 渲染） |
| `src/game/dims.js` | `collectStruct` 加 `case 8: collectAcademy`；`STRUCT_NAME[8]='学堂'`；重分 `structAt` hash 区间 |
| `src/game/crafting.js` | 拼写匹配（独立 `spellMatch`，复用 `craftSlots` 的 3×3 数组，不塞进 `RECIPES`） |
| `src/game/nametags.js` | 把 tagPos 投影机制泛化，供 `LessonTag.vue` 复用 |
| `src/game/uiState.js` | 加 `lesson`（当前课业）、`scholar`（学识） |
| `src/game/uiActions.js` | 加 `openQuiz` / `answerQuiz` / `closeQuiz` |
| `src/App.vue` | 挂 `LessonTag` / `QuizPanel` |
| `src/components/ui/ItemSlot.vue` | 通用底板图标 + DOM 叠字（汉字物品） |

## 内容清单（3–4 年级）

**语文**：识字表（约 500 字）、词语（看拼音写词 / 近反义 / 量词 / 多音字）、
必背古诗、句式（把字句·被字句 / 修改病句 / 关联词）、修辞（比喻·拟人）。
**英语**：话题词汇（数字·颜色·动物·食物·家庭·学校·身体·天气）、
自然拼读（字母音 · CVC 词族）、核心句型、单词辨音。

## 分期

| 期 | 内容 | ticket |
|---|---|---|
| 0 | 课程范围调研（教什么、多少条） | 01 |
| 0 | 课程数据 + 出题/判定纯函数 | 02 |
| 1 | A–Z 字块（方块 + 贴图） | 03 |
| 2 | 拼写合成（拼单词 / 拼拼音） | 04 |
| 3 | 学堂结构（第 8 种） | 05 |
| 4 | 世界内题干 + DOM 作答 | 06, 07 |
| 5 | 掌握度 + 复习队列 + 持久化 | 08 |
| 6 | 学识 → 建造权解锁 | 09 |
| 7 | 语音朗读 | 10 |

01 → 02 → 07 → 08 → 09 是一条主链；03 → 04、05 → 06 是两条可并行的支链；10 独立。

## 预算与风险

- **贴图格**：已用 147 / 256，字块占 26 → 173，余 83。汉字**不占**格（ADR-0003）。
  剩余额度要留警戒线，汉字物品用**通用底板**（每种材质 1 格，不是每字 1 格）。
- **结构概率**：加学堂要重分 `structAt` 的 hash 区间，否则村庄会变稀有。
- **持久化**：localStorage 需要带版本号（如 `voxel-craft.learning.v1`）与迁移路径。
- **性能**：世界内题干每帧投影，数量必须 capped，并做距离剔除（照抄 nametags 的 46 格上限）。

## Comments

- 2026-10-16：四个叉路口已拍板（世界内嵌 + DOM 作答 / 主世界学堂 / 引入语音可降级 /
  只收事实性素材），据此确立 ADR-0001…0005。
