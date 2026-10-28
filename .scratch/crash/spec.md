# 工单：AI 玩家挨打不掉血 / 生物上限与挖放距离 / 进游戏闪退

## 一、AI 玩家被生物攻击时「不掉血」

### 先确认：伤害本身是通的
僵尸近战、骷髅的箭、苦力怕爆炸三条路径都在 `mobs.js` 里走
`botHook.damage(...)` → `damageBot()`，`boot()` 也调了 `installBotHook()`。
无头实测：僵尸贴脸 12 秒能把 AI 玩家从 20 打到 0。

### 真正的根因：三路回血叠起来比伤害还快
`bots.js` 里同时挂着三个回血来源：

| 来源 | 速率 |
|------|------|
| 吃东西（hp < 55% 自动进入 eat） | **5 / 秒** |
| 回到家 | **2.5 / 秒** |
| 定时回血 | 每 3.5 秒 +1 |

而僵尸的伤害是 3 点 / 秒。于是「吃口东西」的回血就超过了挨打的速度，
血条纹丝不动 —— 玩家看到的自然就是「AI 玩家根本不会受伤」。
再加上 bot 会跑、会回家，追着打的怪根本留不下痕迹。

### 做法
1. `damageBot()` 里加 `regenBlockT = 6`：**挨打后 6 秒内一滴血都回不了**。
   这一条是主药 —— 它让任何来源的回血都必须先等这 6 秒过去。
2. 三路回血都加禁疗判定，并把速率降下来：
   - 吃东西 5/s → **2.5/s**
   - 到家 2.5/s → **1.2/s**
   - 定时 每 3.5s+1 → **每 6s+1**
3. 头顶血条本来就有（`NameTags.vue` 的 `hpPct`），之前不动是因为血量真没变；
   现在掉血可见。

### 验证
`.scratch/crash/botdamage.mjs`（18 条断言）：
- 僵尸从 3 格外走过来 → 打到（hp 20 → 11）
- 骷髅的箭 → 打到（20 → 8）
- 苦力怕爆炸 → 波及（20 → 14）
- **站桩挨打 12 秒、botStep 的回血逻辑照常跑** → 最低 hp 0.0（修复前会卡在 20）
- 禁疗窗口：挨 6 点 → hp 14；禁疗期内吃东西 1 秒仍 14；解除后回血到 15.9

## 二、生物数量上限 / 挖掘放置距离

### 生物上限
`MOB_CAP` 38 → **64**，刷怪间隔 `mobSpawnT` 1.4s → **1.0s**。
只放宽上限不改速率的话，从 38 涨到 64 要多等 40 秒，看起来像「上限没变」。

### 挖放距离
`REACH` 9 → **13**（挖掘 / 放置 / 上车 / 召唤 / 点燃共用）。

⚠ 攻击距离必须拆开：原来攻击也吃 `REACH`，直接改成 13 会变成隔空点杀。
新增 `REACH_ATTACK = 9.0`，`tryAttackMob`、`tryAttackAny`（打 AI 玩家/打怪）、
旁观附身射线都只认它。

端到端验证（`.scratch/crash/e2e.mjs`）：在 11 格外放一块石头，
`raycast(REACH)` 命中距离 10.5，`raycast(9)` 返回 null。

## 三、每次进游戏都「闪退」

桌面/模拟器上复现不出来（`.scratch/crash/probe.mjs` 连续采样 45 秒：
堆 20–55MB 稳定、fps 32–34、零报错、无 crash）。所以按「手机上会闪退的
三种真实成因」逐个堵：

### 1. 触屏被误判成桌面 → 一进游戏就被踢回面板（最像「闪退」）
`App.vue` 原来的判据是 `pointer: coarse && 有触摸点`。
部分安卓浏览器 / 内置 WebView（微信、UC、夸克）不上报 `coarse`，
于是手机被当成桌面：开始面板显示键盘说明 → 点开始去请求指针锁定 →
手机上必然失败 → `pointerlockerror` → `pauseGame()` → **画面闪一下退回开始面板**。

修：
- 判定放宽成「有触摸能力 +（粗指针 **或** 视口 ≤ 900px）」
- `pointerlockerror` 在 `ui.touch` 为真时直接 return，不再暂停

### 2. 切后台 / 内存紧张导致 WebGL 上下文丢失 → 回来一片黑
- `webglcontextlost`：`preventDefault()` + 先存一份档 + 提示「上下文丢失，
  正在重新载入」+ 900ms 后 `location.reload()`。
  （`renderer.js` 的 program / 贴图都是模块顶层的 const，原地重建代价太大，
  重载是唯一稳的恢复路径。）
- `visibilitychange`：切到后台先存档再暂停，回来时至少有暂停面板可点。

### 3. JS 异常让主循环定住 → 看起来也是闪退
`App.vue` 加了 `window.onerror` / `unhandledrejection` 兜底，
把第一条错误显示在 `FatalNotice` 上（原来只有「不支持 WebGL」才会显示），
玩家至少能截图反馈是什么炸了。

## 四、验收

```bash
node .scratch/crash/botdamage.mjs        # 18 条：受伤 / 禁疗 / 常量
node .scratch/flat-stick/probe.mjs       # 回归
node .scratch/boss/probe.mjs             # 回归
node .scratch/gear/probe.mjs             # 回归
npx vite --port 4176 --strictPort &
PW_ROOT=<npx 缓存>/node_modules node .scratch/crash/e2e.mjs   # 触屏判定 / 闪退防御 / REACH
npx vite build
```
