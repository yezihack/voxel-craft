# voxel-craft.html → Vue 3 + Vite 迁移交付说明

原文件：`voxel-craft.html`（单文件，9575 行 / 474 KB，手写 WebGL 方块沙盒）
目标：Vue 3 `<script setup>` + Vite，纯 JavaScript，原生 CSS，视觉与交互与原版一致。

---

## 1. 运行方式

```bash
npm install     # 安装依赖（vue / vite / @vitejs/plugin-vue）
npm run dev     # 开发服务器，默认 http://localhost:5173/
npm run build   # 生产构建，产物在 dist/
npm run preview # 预览构建产物
```

**Windows 双击启动**：直接双击根目录的 `dev.bat` 即可。
它会自动 `cd` 到脚本所在目录、检查 Node.js、依赖缺失时自动安装，然后拉起 Vite 并打开浏览器。
不需要自动打开浏览器就执行 `dev.bat nobrowser`。

> **关于 `npm install` 的一个环境提示**：esbuild 的 postinstall 会执行
> `execFileSync(process.execPath, [二进制, '--version'])` 做一次版本自检。
> 在**受限沙箱**里「node 再拉起 node」会被拦掉，报 `spawnSync ... EBUSY`，
> 导致安装中断。这**不是工程问题**——已验证：
> - esbuild 原生二进制本身可正常运行（`0.25.12`）；
> - `node -e "execFileSync(process.execPath,['-e','1'])"` 在沙箱内单独复现同一错误；
> - 在普通终端（或加 `--ignore-scripts`）安装完全正常，33 个包、依赖齐全。
>
> 若你也遇到，用 `npm install --ignore-scripts` 即可（本项目不依赖任何 postinstall 脚本，
> esbuild 会直接走 `@esbuild/win32-x64` 平台包）。

---

## 2. 完整目录结构

```
voxel-craft/
├── index.html                  # Vite 入口（含 wb-* 导航站约定标签，原样保留）
├── vite.config.js              # vue 插件 + host/5173 + build.target es2020
├── dev.bat                     # Windows 双击启动：查 Node → 装依赖 → 起 Vite
├── package.json / package-lock.json
├── .gitignore                  # 新增：node_modules / dist / 编辑器文件
├── voxel-craft.html            # 原单文件，保留作对照基准（只读，不参与构建）
└── src/
    ├── main.js                 # createApp(App).mount('#app')
    ├── App.vue                 # 根组件：画布 + 15 个界面层 + 引擎拉起时机
    ├── engine.js               # Vue ⇄ 引擎的唯一桥（动态 import 引擎）
    ├── assets/
    │   └── main.css            # 全局样式：设计令牌、页面基底、跨组件原子类
    ├── data/                   # 重复结构的数据源（配合 v-for）
    │   ├── modes.js            # 三种模式按钮（创造 / 生存 / 旁观）
    │   ├── veilKeys.js         # 开始/暂停面板的 13 条按键说明
    │   └── helpKeys.js         # HUD 帮助卡里的按键提示
    ├── components/             # 界面层（22 个）
    │   ├── GameCanvas.vue      # WebGL 主画面
    │   ├── IconDefs.vue        # 心/鸡腿/气泡的 <defs> 图标定义
    │   ├── Crosshair.vue       # 准星
    │   ├── DigRing.vue         # 挖掘进度环
    │   ├── BowBar.vue          # 拉弓蓄力条
    │   ├── HurtFlash.vue       # 受伤红屏
    │   ├── NameTags.vue        # AI 玩家头顶名字标签
    │   ├── HudPanel.vue        # 左上角 HUD（状态卡 + 帮助卡）
    │   ├── HudCard.vue         # HUD 卡片外壳（可复用）
    │   ├── Vitals.vue          # 生存状态：氧气/生命/饥饿
    │   ├── VitalIcon.vue       # 单个状态图标（可复用）
    │   ├── HotBar.vue          # 底部 9 格物品栏
    │   ├── BagPanel.vue        # 背包/方块库弹窗外壳（创造↔生存分流）
    │   ├── BlockLibrary.vue    # 创造模式方块库（108 项 + 分组分隔）
    │   ├── InventoryPanel.vue  # 生存模式 54 格储物
    │   ├── CraftBox.vue        # 3×3 合成台 + 结果格
    │   ├── RecipeBook.vue      # 配方书（65 条，可点选自动摆料）
    │   ├── DeathScreen.vue     # 死亡界面
    │   ├── StartVeil.vue       # 开始/暂停遮罩（同一面板兼两用）
    │   ├── Toast.vue           # 浮动提示
    │   ├── TouchControls.vue   # 触屏双摇杆 + 4 按钮
    │   ├── FatalNotice.vue     # WebGL 不支持时的兜底提示
    │   └── ui/                 # 更细的可复用件
    │       ├── ItemIcon.vue    # 物品图标（canvas 现画的等距立方体）
    │       └── ItemSlot.vue    # 通用「格子」
    └── game/                   # 引擎（30 个模块，按原段落切分）
        ├── index.js            # 引擎门面：只导出 Vue 真正用到的名字
        ├── state.js            # 共享可变状态（叶子模块，无依赖）
        ├── canvasHost.js       # 画布宿主（叶子模块）
        ├── config.js           # 常量：世界尺寸、方块表、物品表、工具速度…
        ├── uiState.js          # 界面状态中心（reactive 源）
        ├── uiSync.js           # 每帧把引擎数值同步进 uiState
        ├── uiActions.js        # 界面动作门面（原 onclick 里的逻辑全收拢到这）
        ├── selectors.js        # 界面用的派生数据
        ├── boot.js             # 启动：世界生成、资源上传、事件挂载
        ├── loop.js             # 主循环：每帧更新 + 绘制
        ├── input.js            # 键盘/鼠标/触屏事件
        ├── renderer.js         # WebGL 上下文、着色器程序
        ├── post.js             # 后处理：泛光、合成、FXAA
        ├── textures.js         # 程序化贴图（canvas 现画贴图集）
        ├── mesher.js           # 区块面剔除与顶点构建
        ├── sky.js              # 天空、太阳月亮、云
        ├── world.js            # 地形列缓存、生物群系
        ├── generate.js         # 世界生成入口
        ├── dims.js             # 8 个维度的地形档案
        ├── fluid.js            # 水/岩浆扩散模拟
        ├── portal.js           # 传送门与维度切换
        ├── player.js           # AABB 碰撞、重力/跳跃/飞行
        ├── actions.js          # 挖掘/放置/进食/召唤
        ├── survival.js         # 生存：背包 Map、挖掘计时、生命饥饿氧气
        ├── crafting.js         # 3×3 配方匹配、配方书、材料统计
        ├── mobs.js             # 生物：被动/敌对 AI、刷怪
        ├── bots.js             # AI 玩家 NPC
        ├── nametags.js         # 名字标签投影计算
        ├── math.js             # 4×4 矩阵、值噪声
        └── audio.js            # WebAudio 合成音效
```

---

## 3. 对照迁移要求

| # | 要求 | 落地情况 |
|---|---|---|
| 1 | 先给拆分方案、确认后动手 | 已按「按原段落分模块」+「混合策略（语义状态用响应式，高频视觉值直写 CSS 变量）」执行 |
| 2 | 拆到 `src/components/`，可复用件单独抽 | 22 个组件；`HudCard`/`VitalIcon`/`ItemIcon`/`ItemSlot` 为抽出的可复用件 |
| 3 | `<style>` 拆全局 + 组件 scoped | 全局 130 行进 `src/assets/main.css`（令牌、`.card`/`.panel`/`.go`/`.ic`/`.dim` 等跨组件类）；其余进各组件 `<style scoped>` |
| 4 | 重复结构 → 数据数组 + `v-for` | 三种模式按钮、13 条按键表、HUD 帮助项 → `src/data/`；物品格/配方/方块库条目 → 引擎侧派生数组 + `v-for` |
| 5 | DOM 操作 → 响应式 + 模板绑定 | 见第 4 节 |
| 6 | CDN → npm；资源进 assets/public | **原 HTML 零外链**（全文件搜索无任何 `http(s)://`），无 CDN 可迁；贴图/图标本来就是 canvas 程序化生成，无图片字体资源需要搬运 |
| 7 | 不留无用代码和注释掉的旧代码 | 已清空（见第 4 节），全量扫描 `^\s*//.*[;{]\s*$` 无命中 |

---

## 4. 相对原 HTML 的改动清单

### 4.1 DOM 操作 → 响应式状态

| 原写法 | 现在 |
|---|---|
| `document.getElementById('hp')…` 逐个取节点改 `style`/`textContent` | 引擎侧 `uiState.js` 一个 `reactive` 对象；`uiSync.js` 每帧同步数值；组件用模板绑定 |
| 各按钮 `onclick="..."` 内联脚本 | `@click="engine.xxx()"` 调 `uiActions.js` 里的具名动作 |
| `document.body.classList.toggle('touch')` / `.survival` | `ui.touch` / `ui.survival` 响应式布尔值，组件用 `v-if`/`v-show` |
| 开始遮罩 `onclick` 里改 `innerHTML` 切换「开始/暂停」文案 | `ui.paused` 驱动模板分支 |
| `document.body.innerHTML = '<div style=…>不支持 WebGL</div>'` | `FatalNotice.vue` 覆盖层（观感一致，但不再摧毁整页 DOM） |
| 快捷栏/背包/方块库逐格 `createElement` | `v-for` 渲染，数据来自 `selectors.js` 的派生数组 |

### 4.2 模块化（这是本次工作量最大的部分）

原文件是一个 9000+ 行的 IIFE，所有变量共享一个作用域。拆成 30 个 ESM 模块后，
**循环依赖引发的 TDZ（`Cannot access 'X' before initialization`）成为主要风险**，
用三种手段系统性地解决：

1. **共享可变状态下沉到叶子模块** —— `state.js` 只放数据、不 import 任何东西，
   被重新赋值的跨模块变量（`selected`、`spectate`、`swingT`、`colCache`、`edits`…）
   全部集中到这里，配套 `setXxx()` setter。
   （ESM 的 import 绑定是只读的，`import { swingT }` 之后不能 `swingT -= dt`。）
2. **依赖注入切断反向边** —— `config.js` 原本 `import { heldId } from './survival.js'`，
   把 `survival → generate → dims → fluid → …` 整条链拖到 config 自己的常量之前求值，
   导致 `ATLAS_PX` TDZ。改成 `setHeldIdReader(fn)` 由 `survival.js` 反向注册；
   `MOB_TYPES` 同理用 `setMobTypes()`。
3. **常量上提** —— `DIM_N` 从 `dims.js` 挪到 `config.js`（`generate`/`portal`/`actions`
   都在模块顶层用它，而 `generate ↔ dims ↔ fluid` 本身成环）。

另外：**引擎必须动态 import**。`renderer.js` 在模块顶层就要拿 canvas 建 WebGL 上下文，
而 canvas 要等 Vue 挂载后才有。所以 `App.vue` 先 `await nextTick()` 让画布进 DOM，
再由 `engine.js` 里的 `initEngine()` 走 `await import('./game/index.js')`。
静态可引入的只有 `canvasHost.js` / `uiState.js` / `state.js`（都不依赖 DOM 与 GL）。

### 4.3 删除的无用代码

- `bindInvDrag()` / `dragFrom` —— 迁移到 Vue 后物品格拖拽改由 `ItemSlot.vue` 的
  指针事件处理，原来的手动拖拽绑定整段废弃。
- `.layer` 系列 CSS —— 被 `.card` / `.panel` 取代后不再有元素使用。
- `invDirty` 脏标记 —— 原方案是「改完标脏、下一帧重建 DOM」；现在响应式自动追踪，标记无意义。
- `ui.startLabel` —— 开始按钮文案改由 `ui.paused` 推导，独立字段冗余。
- 若干 `let x = null` 的全局暂存变量 —— 改为模块内的局部状态或 `state.js` 成员。

### 4.4 其他

- 新增 `.gitignore`（原来没有）。
- `index.html` 里的 `wb-*` 导航站约定标签**原样保留**，未改动。
- 没有引入任何 UI 框架、CSS 预处理器或额外运行时依赖，`dependencies` 只有 `vue`。

---

## 5. 不确定 / 需要你确认的地方

1. **`body.touch` / `body.survival` 类名被换成响应式布尔值。**
   原 HTML 靠 `<body>` 上的类名做全局样式分支（比如 `body.touch .hint { display:none }`）。
   现在这些分支都收敛到了组件内部的 `v-if` / `v-show`。
   如果你有外部脚本或样式依赖 `body.touch` / `body.survival` 这两个类名，需要告知我补回。

2. **`DIM_N` 的位置、`heldId`/`MOB_TYPES` 的注入方式**是对「逐行等分」的有意偏离。
   纯按原段落切分无法通过 ESM 求值顺序检查（会 TDZ 崩溃），所以做了上面 4.2 的三处调整。
   行为完全一致，但如果你希望模块边界严格贴合原文件段落，这三点是例外。

3. **`config.js` 现在同时承担「常量表」和「两个注入点」两个职责。**
   更干净的做法是再拆一个 `registry.js`，但那样会多一层间接。目前保持现状。

4. **`voxel-craft.html` 仍留在项目根目录**作为对照基准。
   Vite 不会把它当入口（入口由 `index.html` 指定），但开发服务器能通过
   `http://localhost:5173/voxel-craft.html` 访问到它——我的像素比对就是这么做的。
   如果不需要留档，可以直接删掉。

5. **`.workbuddy-ai/` 目录里有本次迁移的验证脚本**（不是应用代码，可随时删除）：
   - 长期有用的：`chkundef.py`（未声明标识符）、`chktdz.py`（模块顶层用 import = TDZ）、
     `chktpl.py`（模板串插值）、`pngdiff.py`（纯 Python PNG 解码 + 像素比对）、
     `cdp-check.cjs`（CDP 驱动真实 Chrome 截图 + 断言）
   - 一次性用完的：`analyze.py`、`split.py`、`patch.py`、`assign.py`、
     `checkimports.py`、`checkundef.py`、`deps.txt`、`split-report.json`
   - `shots/`、`parity/` 是验证截图

6. **触屏摇杆仍用 `addEventListener` 而非模板 `@touchmove`。**
   因为需要 `{ passive: false }` 才能 `preventDefault()` 阻止页面滚动，
   而 `v-if="ui.touch"` 下的元素挂载时机要用 `watch(..., { flush: 'post' })` 配合。
   这是有意的例外，不是遗漏。

7. **`index.html` 的 `<meta name="wb-order" content="5">`** 等导航站标签是原文件就有的，
   我没有动，但也不清楚这套标签在你的站点体系里是否还生效。

---

## 6. 验证证据

| 项目 | 结果 |
|---|---|
| `npm run build` | ✅ 91 模块，`index.html` 0.95 kB / CSS 17.05 kB / JS 87.68 + 165.87 kB |
| `npm run dev` | ✅ VITE v6.4.4，1968 ms 就绪，无告警 |
| **首屏像素比对**（原 HTML vs Vue 版，1280×760） | ✅ **明显不同的像素 0 个（占比 0.000%），最大通道差 7** |
| 浏览器控制台 | ✅ 0 错误 0 警告 |
| 生存 HUD | ✅ 生命 10 / 饥饿 10 / 氧气行可见（10 格） |
| 快捷栏 | ✅ 9 格，键位号 `123456789` |
| 背包（生存） | ✅ 合成格 9 / 配方 65 / 背包格 54，展开后 54 格可见，副标题文案一致 |
| 方块库（创造） | ✅ 108 条目 + `工具 · 武器 · 物品` 分隔符，选中态正确 |
| 死亡界面 | ✅ 显示正常，文案「生命值归零」 |
| 暂停遮罩 | ✅ 显示正常 |
| 触屏控件 | ✅ 双摇杆 + 4 按钮，摇杆 118×118 @ (22,510) |
| 死代码 / 内联事件 / 外链 | ✅ 全部为 0 |
