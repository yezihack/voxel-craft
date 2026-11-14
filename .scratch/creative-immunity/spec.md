# 让创造模式下的玩家不会受到怪物攻击

## 需求

> 让创造模式下的玩家不会受到怪物攻击。

已确认口径：

- **怪物完全无视玩家**：不追踪、不挥击、不射箭、不爆破、不击退；怪仍在世界里游荡，也仍会打傀儡 / AI 玩家。
- 验证 seam：纯 Node AI 探针，直接驱动真实 `mobs.js` / `survival.js` 的公共接口，不测内部实现。

## 根因

`survival.js` 的 `hurt()` 早有 `if (mode !== MODE.SURVIVAL) return -1`，所以创造模式**本来就不掉血**。但「攻击」不止扣血 —— 除扣血外的所有副作用都绕过了 `hurt()`：

| 路径 | 副作用 | 原判据 |
| --- | --- | --- |
| `hostileTarget()` | 锁定玩家 → 追踪 / 挥击 / 射箭 / 引信 / boss 爆破 | 只排除 `MODE.SPECTATOR` 与 `player.dead` |
| `mobAI()` 近战 | `player.vx/vz/vy += ...` 击退、`m.atkT` 挥击冷却 | 跟随 `hostileTarget` 返回的目标 |
| `updateArrows()` | foe 箭命中 → 吞箭 + 命中粒子 | `!player.dead && mode !== MODE.SPECTATOR` |
| `explodeMob()` | 苦力怕爆炸击退 | `mode !== MODE.SPECTATOR` |

红探针实测（贴脸僵尸 120 帧）：创造模式 `hp` 不变，但 `vx=10.40 / vy=3.40`、`atkT=1.00`；已在飞的 foe 箭仍被吞；苦力怕爆炸把人轰到 `vx=-7.74 / vy=5.16`。

结论：**免伤 ≠ 不被攻击**。四处各写了一遍 mode 判断，口径不一致，只有扣血那一处挡住了非生存模式。

## 做法

1. 在 `survival.js` 新增唯一判定 `playerAttackable()`：`mode === MODE.SURVIVAL && !player.dead`。`hurt()` 立刻复用，把原先分散的 `p.dead` 与 `mode` 两行合并。
2. `mobs.js` 三处改用它：
   - `hostileTarget()` → `if (!playerAttackable()) bd = Infinity`，怪转为闲逛；场上若有傀儡 / AI 玩家，照常锁定它们。
   - `updateArrows()` 的 foe 命中 → 非生存模式箭直接穿过，不吞箭、不产生命中结算（`puff` 粒子由 `spawnParticles` 注入，Node stub 下不可观测，探针不宣称验证了它）。
   - `explodeMob()` 的玩家击退 → 非生存模式不参与爆炸结算。
3. 保留不动：`explodeMob()` 的球形破坏方块（世界行为，与玩家无关）、`updateMobSpawn()` 的刷怪规则、`setMode()` 切创造时清怪、`bots.js` 中 AI 玩家的攻击判定（本就是 `mode === MODE.SURVIVAL`）。

`hostileTarget()` 是杠杆最大的一处：骷髅放箭、苦力怕引信、凋灵喷弹与爆破、boss 近战全都挂在 `if (T)` 分支下，目标一断就整体静默，无需逐条打补丁。剩下两处（已在飞的箭、独立结算的爆炸）是目标选择覆盖不到的残留入口，必须单独挡。

## 验证

`.scratch/creative-immunity/probe.mjs`：纯 Node，stub 掉 DOM / WebGL / 音频，直接 import 真实模块走 `hostileTarget` / `mobAI` / `updateArrows` / `explodeMob` / `hurt`。32 条断言。

按 vertical slice 分三片红 → 绿：

- **切片 1**（目标选择 + 贴脸近战）：3 条失败（仍锁定玩家、仍击退、仍进挥击冷却）→ 只改 `hostileTarget()` → 9/9 转绿。
- **切片 2**（残留攻击面）：2 条失败（foe 箭被吞、爆炸击退 `vx=-7.74`）→ 抽 `playerAttackable()` 并统一四处判据 → 25/25 转绿。
- **切片 3**（审查补强）：Spec 轴指出「凋灵不爆破」是空断言（reset 后地板恒非 0，无法区分没炸与炸了没炸到），且 AI 玩家 / 傀儡实打 / 怪仍游荡 / 旁观 / 死亡玩家缺测 → 补 7 条断言 → 32/32 转绿。其中 `wiS.floor === 0` 先证明同一场景在生存模式确实炸得动方块，创造模式那条才有对照意义。

覆盖：创造 / 生存 / 旁观三模式；近战击退与挥击冷却、敌方箭、爆炸击退与方块破坏、骷髅放箭、苦力怕引信、凋灵喷弹与爆破、傀儡 / AI 玩家仍会被锁定并挨打、怪仍游荡。主要攻击路径都配了生存模式对照组，旁观与死亡状态另有回归断言，防止把其它模式一并改哑。

`npx vite build` 通过（114 modules）。

## 取舍

- **不清怪**。切到创造模式由 `setMode()` 调 `despawnAllMobs()`，`updateMobSpawn()` 在创造模式也不刷。本次只保证「万一场上有怪（刷怪蛋 / 核心召唤 / 切模式前的残留箭矢）也无视玩家」。禁止敌对生物存在会破坏建造测试玩法，用户未选这一档。
- **爆炸仍破坏方块**。这是世界行为，不是「对玩家的攻击」；挡掉会改变创造模式里苦力怕炸地形这一既有玩法。
- `bots.js` 的 AI 玩家攻击判定已是 `mode === MODE.SURVIVAL`，语义等价且本次无测试覆盖，不动它以免无谓扩大 diff。
- `player.dead` 现在也挡掉爆炸击退（原 `explodeMob` 不判 dead）—— 属顺带修正，死人不该被击飞。

## 回归与审查

双轴代码审查（Standards / Spec）：Standards 轴无成文标准违规，只有「探针 stub 与既有 gap-fall 探针逐字重复」这一判断性意见（既有裁定为可接受，不抽）。Spec 轴无范围蔓延，指出的空断言与漏测已在切片 3 全部补齐。

**历史探针前提失效（已修）**：`.scratch/gap-fall/probe.mjs` 与 `.scratch/boss/probe.mjs` 从未显式设置模式，默认跑在 `MODE.CREATIVE`，靠「怪会追玩家」驱动 AI / 物理 / boss 召唤与爆破。本次需求让创造模式怪物无视玩家，于是前者 20 条、后者 2 条断言全部假阴性。两个探针各补一行 `setModeState(MODE.SURVIVAL)` 并注明原因，现均全部通过。这是测试前提被需求改变，**不是产品回归**。

回归结果：`gap-fall` / `boss` / `bot-hurt` / `sunburn` / `mine-density` / `spell-craft` 纯 Node 全过；`bots` 的「空手死亡偶尔掉落火把」是历史记录过的随机偶发（连跑 3 次全过），与本次无关；`potions` / `enchant` 依赖 Playwright 与 dev server，在重起的干净 dev server（5190）+ 系统 Chrome 下也全过 —— 药水零控制台报错、贴图 244 格，附魔 52 项。
