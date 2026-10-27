# 移除左上角 HUD + 触屏可玩性改造

## 背景

玩家反馈两件事：

1. 左上角常驻两块文字卡（状态行 + 九行按键说明）挡住了视野，要求全部删掉。
2. 游戏在手机上基本不能玩：没有挖掘 / 放置按钮，只能靠「按住画布 380ms」触发放置，
   而同一个手势还要负责转视角。

## 一、删除左上角提示语

| 文件 | 处理 |
|------|------|
| `src/components/HudPanel.vue` | 删除 |
| `src/components/HudCard.vue` | 删除（只被 HudPanel 用） |
| `src/data/helpKeys.js` | 删除（只被 HudPanel 用） |
| `src/App.vue` | 去掉 import 与 `<HudPanel />` |
| `src/game/loop.js` | 去掉 `syncHud` 调用；顺带清掉只为 HUD 统计的 `drawn` / `tris` |
| `src/game/uiSync.js` | 删掉 `syncHud`，只留 `syncVitals` / `syncHurt` |
| `src/game/uiState.js` | 删掉 `stat` / `flyTag` 两个字段 |
| `src/game/input.js` | F 飞行改播 toast，不再写 `ui.flyTag` |
| `src/game/uiActions.js` | 三处 `ui.flyTag` 赋值一并删除；`toggleFly` 改 toast |
| `src/assets/main.css` | 删掉 `.card` / `.card b` / `.card kbd` / `.dim` 四条死样式 |

保留的东西：`Vitals`（心形 / 鸡腿 / 气泡）、准星、挖掘环、弓蓄力条、`Toast`。
这些是**图形化反馈**或**瞬时提示**，不占视野；真正被删的是「常驻文字」。

## 二、触屏可玩性

### 手势重新分工

改造前画布上叠了三个手势：按住挖、长按 380ms 放、拖动转视角。电容屏分不清
「手指停顿」和「长按」，想转头经常挖出一个坑，停久一点又变成放置。
现在画布只保留最不会误判的一个：

- **画布滑动 = 转视角**（`input.js` 的 `touchmove`，灵敏度 ×2.2）
- **挖掘 / 放置 = 右下两个专用按钮**（`uiActions.touchMine` / `touchPlace`）

`pointerdown` 里显式跳过 `pointerType === 'touch'`，否则同一次滑动会被
pointer 与 touch 两套监听各算一次，灵敏度直接翻倍。

### 控件布局

```
┌──────────────────────────────────────────────┐
│                          [背包][模式][飞行][菜单] │
│                                              │
│                                              │
│   ╭───╮                            [跳] [潜] │
│   │ ⊕ │                            [挖] [放] │
│   ╰───╯                                      │
│            ▓▓▓▓ 快捷栏 9 格 ▓▓▓▓             │
└──────────────────────────────────────────────┘
```

- 左摇杆：移动（与改造前一致，仍然直接写 DOM 小圆点，不进响应式 diff）
- 右下 2×2：四颗一样大（68px），上排跳 / 潜，下排挖 / 放（主色描边）。
  大小一致是有意的 —— 拇指落点不该先分辨尺寸，靠颜色区分功能就够
- 右上：背包 / 模式 / 飞行 / 菜单
- 砍掉了原来的「右摇杆转头」：拇指要先找准圆心才敢动，远不如「哪儿都能滑」

### 新增的引擎动作（`uiActions.js`）

```js
touchMine(on)   // 按住 setBreakHeld，松手 cancelDig；生存模式仍走硬度计时
touchPlace(on)  // 按下立刻 doPlace 一次，同时开 placeRepeat 支持按住连发
cycleMode()     // 与键盘 G 共用同一个入口，避免两处逻辑跑偏
```

`touchPlace` 复用 `placeHeld` 之后，**弓蓄力**与**盾牌格挡**自动跟着生效 ——
它们本来就是「按住右键」的语义，不需要各写一套。

### 面板一打开就清空按住状态

`TouchControls` 监听 `show`（= touch && 未开背包 / 未暂停 / 未死亡）。
一旦隐藏就把摇杆、挖掘、放置、跳跃、潜行全部复位。原因：手指还压在按钮上时
被遮罩抢走焦点，`touchend` 可能永远不来，关掉背包回到游戏会「人还在自己往前走」。

### 移动端布局细节

- `canvas { touch-action: none }`：禁掉浏览器滚动 / 下拉刷新 / 双指缩放
- 热键栏：`max-width: 560px` 时格子收到 36×44、隐藏名字与键位号，
  9 格刚好排进竖屏；底部留白读 `env(safe-area-inset-bottom)`
- 摇杆与按钮都读 `env(safe-area-inset-*)`，避开刘海与手势条
- 生命条在 `pointer: coarse` 下抬到 `bottom: 86px`，不压快捷栏
- 渲染倍率在触屏下从 2.0 降到 1.5：手机 DPR 常是 3，按 2 倍算是 2.2M 像素，
  中端机会掉到 20 帧以下；1.5 倍肉眼几乎无差，帧率翻倍

### 触屏没有键盘，所以要补的入口

| 桌面 | 触屏替代 |
|------|----------|
| F5 存档 | 暂停面板的「💾 保存进度」按钮（`ui.started` 后才出现） |
| F9 读档 | 暂停面板的「📂 继续上次存档」 |
| Esc 暂停 | 右上「菜单」按钮 → `pauseGame()` |
| G 切模式 | 右上「模式」按钮 → `cycleMode()` |
| E 背包 | 右上「背包」按钮 |
| 左键挖 / 右键放 | 右下「挖」/「放」 |

`StartVeil` 在触屏下不再显示键盘按键表，改成四行触屏说明；
提示语也不再提「点击后会锁定鼠标」。

## 验证

```
npx vite build                     → 99 modules，通过
node .scratch/mobile/probe.mjs     → 39 条静态断言全过
node .scratch/mobile/shot.mjs      → 真 Chromium 触屏上下文，量出下面这组数字
```

probe 断言内容（纯文本扫描，不依赖 GL / DOM）：

1. HUD 三个文件确实不存在
2. `uiState` 不再有 `stat` / `flyTag`
3. `loop.js` 不再调用 `syncHud`，`uiSync.js` 不再导出它
4. `TouchControls` 同时绑定了 `touchMine` 与 `touchPlace`
5. 引擎门面导出了 `touchMine` / `touchPlace` / `cycleMode` / `toggleBag` / `pauseGame`
6. `input.js` 的画布触摸只做 `addLook`，不再有 `setBreakHeld` / 长按定时器
7. 触屏渲染倍率上限是 1.5

### 实机尺寸实测（`shot.mjs`，Playwright + 本机 Chromium）

| 视口 | 快捷栏 | 摇杆 | 动作区 | 重叠 |
|------|--------|------|--------|------|
| 844×390（横屏） | 189..655 × 320..382 | 18..122 × 208..312 | 700..828 × 186..314 | 无 |
| 390×844（竖屏） | 11..379 × 782..838 | 18..136 × 626..744 | 228..374 × 598..744 | 无 |

两档下左上角 `.hud` 均为 `null`（已彻底移除），9 格快捷栏都没有溢出屏幕。

`shot.mjs` 需要 playwright：不装进项目依赖，从 npx 缓存 require，并直接指向
本机已装的 Chromium（版本比包期望的新一档，用 `executablePath` 绕过）。

```
npx vite preview --port 4173 &
PW_ROOT=<npm-cache>/_npx/<hash>/node_modules node .scratch/mobile/shot.mjs
```

截图落在 `.scratch/mobile/*.png`，已在 `.gitignore` 里排除（可随时重新生成）。
