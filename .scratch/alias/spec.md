# 移除导出/导入存档 + 新增 UUID 别名绑定与首次引导

Status: done

## 根因

1. **导出 / 导入 .json 按钮已经多余**：存档真源迁到 Cloudflare D1 后，浏览器里的 `localStorage` 只是读缓存和离线层。再让玩家手动导出文件，等于人为制造第二份「真源」——换设备导入后本地版本与云端版本分叉，还会把「保管文件」的责任推给玩家。
2. **匿名 UUID 不好记**：身份是 36 字符 UUID（`voxel-craft:owner`），换设备只能靠抄一长串字符 + 「认领」。开始面板虽然能显示并复制，但玩家记不住，也没法口头告诉别人。
3. 需要一个**好记的名字 ↔ UUID 绑定**，且必须存在服务端：只写浏览器 `localStorage` 的话，换设备时输入别名根本解析不回 owner。

## 做法

### 1. 移除导出 / 导入入口（保留纯函数）

- `StartVeil.vue`：删掉两个按钮、隐藏的 `<input type="file">`、下载 Blob / FileReader 包装。
- `src/engine.js` 的 `NOT_READY_KEYS`、`src/game/index.js` 的门面导出、`src/game/uiActions.js` 的两个包装函数同步删除。
- **`save.js` 的 `exportSaveJson()` / `importSaveJson()` 刻意保留**：它们是存档 JSON 唯一的编解码入口，`.scratch/saveio`、`savehole` 的往返探针靠它们验证字段级容错；注释明确写了「应用侧不要再接 UI —— 导入只写本地缓存、不会推云端」。

### 2. 服务端绑定（`aliases` 表）

`migrations/0002_aliases.sql`：

```sql
CREATE TABLE IF NOT EXISTS aliases (
  alias       TEXT PRIMARY KEY,   -- 归一化键：trim + toLowerCase
  owner       TEXT NOT NULL UNIQUE,
  display     TEXT NOT NULL,      -- 玩家原始输入，用于展示
  created_at  INTEGER NOT NULL
);
```

`functions/api/alias.js`：

| 方法 | 行为 |
|---|---|
| `GET /api/alias` | 当前 owner 的 `{alias}` |
| `GET /api/alias?name=x` | `{owner}`（认领时按别名解析） |
| `PUT /api/alias {name}` | 绑定 / 改名；改名在同一 `db.batch()` 里先 `DELETE WHERE owner=?` 再 `INSERT ... ON CONFLICT(alias) DO UPDATE`，满足 `owner UNIQUE` |
| `DELETE /api/alias` | 按 owner 解绑 |

**业务失败一律 200 + body**：`{ok:false, reason:'taken'|'invalid'}`。最初用 409 / 400，浏览器会把 4xx 记成控制台资源错误，而验收脚本要求零报错（这和空档 GET 由 404 改 200 是同一条原则）。只有 D1 未绑定 / 数据库异常这类真故障才 5xx。

`saves` / `edits` 永远只按 `owner` 存，**别名不参与主键**，改名不影响存档。

### 3. 客户端 / Functions 共用校验规则

`src/game/aliasName.js`（纯函数、无外部依赖，能被 Functions esbuild 打包）：

- `normalizeAlias(raw)`：2–20 字，`^[\p{L}\p{N}_-]+$`，trim + 小写 → 归一化键。
- `isOwnerCode(raw)`：UUID 或 `u[a-z0-9]{10,}` 兜底码。
- **关键回归**：认领框先判 `isOwnerCode` 再判别名，否则 `myworld123` 这种 10 字符纯字母别名会被当成 owner 直接写进 `x-owner` 头，去找一份根本不存在的档。

`save.js` 新增 `getAlias` / `setAlias` / `lookupAlias` / `resolveOwner`；`ALIAS_KEY = 'voxel-craft:alias'` 只作离线展示缓存，`setOwner()` 换身份时清掉，避免把上一位 owner 的别名闪出来。

### 4. 开始面板与首次引导（`StartVeil.vue`）

- 云端行：状态 + 别名 chip（点击设置 / 修改）+ 认领按钮；存档码降到第二行仍可复制。
- **首次引导** `showGuide = engineReady && !aliasName && !guideDismissed && cloudState 不是 checking/offline`：离线或还在连接时不弹，免得给一张设不上的空头支票。「暂不」写 `voxel-craft:alias-guide`，刷新后不再打扰；之后随时可以点别名 chip 进来设置。
- **认领**：输入别名或存档码 → `resolveOwner` → `setOwner` → `refreshCloud`。**若对方没有云端档，还原原 owner 再刷新**，否则会把当前世界推到别人的空档位上；有档才 `loadFromCloud()` 后 `startGame()`。
- `refreshCloud()` 顺带重查别名，所以认领后 chip 会立刻显示新 owner 的别名。

## 验证

| 项 | 结果 |
|---|---|
| `.scratch/alias/probe.mjs` | 23/23（归一化、非法输入、存档码 vs 别名、大小写判重） |
| `npx vite build` | 116 modules，index js 259.61 kB / gzip 98.70 kB |
| 本地 `0002_aliases.sql` + `/api/alias` curl | 空查 / 设置 / 小写解析 / 异主 409→200 taken / 改名 / 旧名失效 / 中文名 / 非法 / DELETE 全通 |
| `.scratch/alias/ui-probe.mjs`（本地 Pages Functions + D1） | **15/15** |
| 同一探针 `PROBE_URL=https://be458a2e.voxel-craft-516.pages.dev` | **15/15**，零控制台报错 |
| 线上残留 | `/api/alias?name=myworld → {"owner":null}`、探针 owner 的 `/api/save?meta=1 → {"has":false}` |

浏览器探针用两个独立 browser context 模拟两台设备：A 设置 `MyWorld` 并存一份云档 → B 用 `MYWORLD` 撞判重 → 点「暂不」并刷新验证不再打扰 → 输入 `MyWorld` 认领 → 自动载入 A 的存档并进游戏 → 刷新后别名仍在。同时断言开始面板不再出现「导出存档 / 导入存档」。

**探针踩坑**：两个页面同时开 WebGL + swiftshader 会把第二个页面卡到完全不渲染（表现为 `waitForSelector('.veil .panel h1')` 超时且零控制台报错）。改成 A 验证完立即 `ctx.close()`、纯 API 请求走 Node `fetch`、等待放宽到 45s，才稳定 15/15。

**部署**：远端 `npx wrangler@3 d1 migrations apply voxel-craft-saves --remote` 应用 `0002_aliases.sql`；`npx wrangler@3 pages deploy dist --project-name voxel-craft --branch=main` → `https://be458a2e.voxel-craft-516.pages.dev`（生产别名 `https://voxel-craft-516.pages.dev/`）。同批上线的还有此前未部署的「删除场上生物数量上限」`ea06584`。

## 边界 / 已知取舍

- 别名**全局唯一、大小写不敏感**，一个 owner 同时只能有一个别名，改名后旧名立即释放。
- 离线时 `getAlias()` 回退本地展示缓存，可能过期；真值始终在 D1。
- ⚠️ **别名不是账号密码**：它是「读档凭证」，任何知道别名的人都能在认领框载入那份存档（原来的存档码同理，只是别名更好猜）。当前 MVP 没有任何二次校验；若要防冒领，下一步需要加口令 / 设备绑定，或让认领必须同时提供存档码。
