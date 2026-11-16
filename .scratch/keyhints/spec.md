# 快捷键速查表 + 进入游戏时显示的设置开关

Status: ready-for-agent

## Problem

用户需求：「新增一个设置、可以开始进入游戏时左上角可以显示快捷键的说明，可显示与隐藏，默认：开启。其它的显示，你自己决定」。

- 项目此前**没有任何设置面板**；开始 / 暂停面板（StartVeil）上的按键表（VEIL_KEYS）只在进游戏**之前**能看到。
- 进游戏之后玩家想查「某个键是干什么的」，只能暂停退回面板 —— 打断了游戏节奏。
- 既有设计原则「游戏内不放常驻文字 HUD」约束了实现方式：速查表不能永久挂在左上角挡视野。

## Solution

三层结构，各管一件事：

### 1. 数据层 `src/game/settings.js`（新建）

- 本机显示偏好（`reactive` + localStorage 键 `voxel-craft:settings`），**不进存档、不上 D1**。
  换设备时偏好跟着存档走是错的行为：手机要摇杆、桌面要键盘。
- `DEFAULTS.showKeyHints = true`（默认开）。
- `sanitize()` 只认白名单键 + 布尔值 —— localStorage 是外部输入（手改 / 旧版本残留），不校验会污染响应式对象（探针验证：`"yes"` 被拒、`evil` 键不进）。
- 读写全走 try/catch + `typeof localStorage === 'undefined'` 守卫，隐私模式不炸。
- 模块加载即读一次：设置开关在开始面板上，比引擎拉起得早，等引擎就绪再读会闪一个错误的开关状态。

### 2. 状态层 `src/game/uiState.js`（扩展）

- `ui.keyHintsOn`：速查表是否显示（组件只读这个）。
- `ui.keyHintsPending`：开关被打开后还没兑现的那一次「进游戏就弹」。玩家可能是在**暂停面板**里才打开开关的 —— 那时游戏已经进过一次，只认「第一次」的话这一局永远等不到那张表。
- `showKeyHints(autoHide)` / `hideKeyHints()` / `toggleKeyHints()` / `requestKeyHints()` / `cancelKeyHints()`；定时器住在状态中心（与 toast 同款），`KEY_HINTS_AUTO_HIDE_MS = 12000`。

### 3. 触发与显示

- `uiActions.startGame()`：`settings.showKeyHints && (firstEnter || ui.keyHintsPending)` 时 `showKeyHints(true)` 并清 pending。
  - `firstEnter` = `ui.started` false→true，**每页面会话只弹一次**（暂停恢复 / 关背包都走 startGame，每次都弹是噪音）。
- `input.js` H 键（`running` 守卫，挡住开始面板输入框的按键冒泡）：
  - 开关开着 → `toggleKeyHints()`；手动唤出的那张**不自动收起**。
  - 开关关着 → 不弹，toast「快捷键说明已关闭，可在开始面板的『设置』里打开」—— 静默无反应会让人以为键坏了。
- `StartVeil.vue` 新增 `.setrow` 设置行（⚙ 设置 + 滑块开关）：
  - 开 → `requestKeyHints()`（记下承诺）；关 → `cancelKeyHints()`（收表 + 撤承诺，「关闭必须彻底」）。
  - 开始面板与暂停面板共用，随时可改。
- `KeyHints.vue`（新建）：左上角速查表面板。
  - 桌面 13 条（KEY_HINTS）/ 触屏 4 条手指操作（TOUCH_HINTS），两列网格，≤420px 单列。
  - `pointer-events: none` —— 指针锁定期间鼠标事件全发画布，DOM 按钮点不到；**触屏不锁指针**才渲染一个真能点的 ×。
  - 触屏 `top:104px`（让开生命条 top:52px）；z-index 11（Vitals 12 之下，DeathScreen 40 之下）。

## User Stories

- 新玩家进游戏，左上角立刻有一张按键速查表，12 秒看完自动消失，不挡视野。
- 老玩家在开始面板把开关关掉，之后进游戏永远不弹（localStorage 持久化，刷新仍关）。
- 玩家暂停时临时打开开关，恢复游戏后照样弹一次（keyHintsPending 兑现）。
- 想再看的玩家随时按 H；手机玩家点右上角的 ×。

## Implementation

- `src/game/settings.js`（新）：偏好持久化。
- `src/data/keyHints.js`（新）：桌面 / 触屏两份键位数据，与 input.js 实际绑定保持一致。
- `src/components/KeyHints.vue`（新）：面板本体 + Transition 淡入淡出。
- `src/game/uiState.js`：keyHintsOn / keyHintsPending + 五个动作函数。
- `src/game/uiActions.js`：startGame 里 firstEnter || pending 触发。
- `src/game/input.js`：H 键（含关闭状态 toast）。
- `src/components/StartVeil.vue`：设置行 UI + toggleShowKeyHints。
- `src/engine.js`：静态导出 settings / toggleSetting / showKeyHints / hideKeyHints / toggleKeyHints / requestKeyHints / cancelKeyHints（纯界面状态不碰 GL，开始面板比引擎拉起得早，走 engine 门面会撞 NOT_READY_KEYS 占位）。
- `src/App.vue`：挂载 `<KeyHints />`。

## Testing

- `npx vite build` 通过：120 模块，index js 260.35 kB / gzip 99.03 kB。
- `.scratch/keyhints/probe.mjs`（Playwright 无头浏览器）35 条断言全过：
  - A 默认值 + 设置行；B 自动弹出（左上角 left=14 top=8、13 条、内容齐全）。
  - C 12 秒自动收起；D H 键显隐且手动唤出不自动消失。
  - E1 暂停恢复不重复弹；E2 关闭后不弹、H 键有提示、localStorage 持久化、刷新仍关、中途重开能兑现。
  - F 触屏 4 条手指说明 + × 可点 + top 98px 避开生命条。
  - 附加：脏 localStorage（非布尔值 / 白名单外键）被 sanitize 拒绝。
  - 三条链路控制台零报错。

## Out of Scope

- 没有做独立的「设置面板」页 —— 项目还没有第二个设置项，一行开关足够；以后加设置往 `.setrow` 里塞 `.setitem` 即可。
- 偏好不上 D1 云端（设备级偏好，跨设备同步反而是错的）。
- 自动收起时长（12 秒）不可调。

## Notes

- `settings.js` 与 `uiState.js` 都是**静态可引入**模块（只依赖 vue），被 `engine.js` 静态导出、同时被动态引擎图 import —— 同一文件路径是同一模块实例，状态共享成立。
- 触屏没有 H 键，× 按钮是触屏唯一的手动收起入口；桌面端 × 不渲染（指针锁定下点不到，挂一个假按钮比没有更糟）。
- 手动唤出（H）不自动收起、自动弹出（进游戏）12 秒收起 —— 「玩家主动要看，就别抢他的时间」。
