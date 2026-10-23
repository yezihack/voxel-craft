# Boss 生物 + 火把透视修复

两件事：修火把/铁轨放下后透视的穿帮；新增三种玩家可召唤的 boss。

## 一、火把/铁轨透视根因

`isOpaque(id)` 判定一个方块是否「不透明」—— 用于面剔除（mesher 里「被不透明邻居挡住就剔面」）。
旧代码：`!!B && !B.alpha && !B.liquid`。

火把、铁轨、传送板既无 `alpha` 也非 `liquid`，于是被判定为「不透明」。
面剔除因此把**相邻实心方块朝向火把那一面**剔掉了——以为「被火把挡住了」。
但火把只是贴地的薄片，薄片后面没有几何遮挡，于是玩家透过火把就能看到那块被剔掉面的方块内部。

修法：`isOpaque` 对带 `shape` 的方块返回 `false`。薄片只占一格薄层，不该遮挡任何邻面。

改动只有一行：`!B.shape`。

## 二、Boss 生物

三种 boss，每种一种打法：

| boss | hp | 打法 | 掉落 |
|---|---|---|---|
| 末影龙 | 200 | 飞行盘旋 + 远程喷弹（ranged），保持 5~20 格 | 3 钻石 |
| 凋灵 | 160 | 飞行 + 三头远程齐射 + 周期爆破方块（witherBomb，半径 2.5） | 2 黑曜石 |
| 远古守卫 | 240 | 地面近战（dmg 8）+ 周期召唤小史莱姆（summonAdds，上限 4） | 4 金 |

boss 不进昼夜刷新池（NIGHT_POOL 不含它们），不参与距离回收（updateMobs 末尾加了 `!boss` 判定）。
只能由玩家用 boss 蛋主动召唤。

### 实现

- `config.js`：EGG_DRAGON/WITHER/GUARDIAN（259-261）+ ITEMS 定义 + mob 贴图基色。
- `mobs.js`：MOB_TYPES 加 dragon/wither/guardian；mobAI 加 `D.boss` 分支（在 hostile 之前）；
  mobPhysics 加 `D.fly` 短路（跳过重力，只做水平 AABB）。
- `textures.js`：6 张 boss 贴图（身体 + 眼/脸），走 noiseTile 基础。
- `crafting.js`：3 个配方，8 黑曜石 + 中心一味（钻石/火药/金矿）。
- 贴图格 192 / 256。

### Boss AI 分支要点

boss 分支在 `if (D.hostile)` 之前，单独一支：

- 锁定玩家（复用 hostileTarget），保持中距。
- 飞行 boss（fly）：水平维持 ranged 窗口距离，vy 用正弦呼吸（盘旋感）。
- 地面 boss：直接追玩家，近战。
- 远程（ranged）：复用 shootArrowAt（foe:true 只认玩家）。
- 凋灵爆破（witherBomb）：在目标脚下炸球，破坏方块 + 距离衰减伤人。只借 explodeMob 的方块破坏部分，不调 explodeMob（那会自杀）。
- 守卫召唤（summonAdds）：场上小史莱姆不超过 cap 就召 n 只。

### 物理短路

mobPhysics 开头加 `D.fly` 短路：飞行 boss 跳过重力与贴地探测，只做三轴 AABB 扫掠防穿墙。
不做这条的话，飞行 boss 会像普通生物一样经历自由落体→贴地→再落体，fly 参数形同虚设。

## 三、验证

`.scratch/boss/probe.mjs` 无头冒烟，16 条断言全过：
- isOpaque 对薄片返回 false，对石头/红石块仍 true；
- 三种 boss 类型注册、boss 标记、fly/guard 字段、hp 值；
- 三种 boss 蛋进了 EGG_OF；
- buildMobMesh 三种都产出部件与索引（7/8/7 部件）；
- spawnMob 三种都成功；
- 60 帧 mobPhysics+mobAI 不崩、boss 不死、飞行 boss 真离地（y 浮动）；
- boss 不被距离回收（player 跑到 1000 格外仍存活）；
- 远古守卫一刀秒（dead=true）+ 死亡掉落；
- 守卫召出 2 只小史莱姆；
- 凋灵爆破把目标脚下方块炸掉。
