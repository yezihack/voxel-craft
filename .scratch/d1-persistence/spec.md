Status: ready-for-agent

# 存档持久化迁移到 Cloudflare D1

## Problem Statement

存档目前只写进浏览器 `localStorage`（`voxel-craft:save` 一份完整 JSON 快照）。两个现实问题逼着要改：

1. **大地图会丢档**：地形是纯函数、存档只存「玩家改动过的格子」，但一片被玩家大规模改造的世界，`JSON.stringify` 后仍可达数 MB。浏览器 `localStorage` 约 5 MB 配额，超了写入直接失败，进度静默丢失（`save.js` 自己的注释也点名了这点）。
2. **档随浏览器走**：清浏览器数据、iOS ITP 的 7 天存储回收、隐私模式配额写不进，都会把档整份抹掉，玩家没有任何「握在手里」之外的备份。

项目已部署到 Cloudflare Pages，但没有后端、没有 `wrangler.toml`。用户希望把持久化迁到 Cloudflare D1，本地测试用 SQLite。

## Solution

引入一层极薄的 Cloudflare Pages Functions 后端，把存档落到 D1（服务端 SQLite）；浏览器侧保留 `localStorage` 作为**快速读缓存 + 离线层**，D1 作为**持久真源**。

- **身份用匿名 UUID（MVP）**：首次运行在 `localStorage` 生成一个 `voxel-craft:owner`，每次请求带在 `x-owner` 头里。换设备/清数据即失联（档仍在 D1 但拿不回）——这是 MVP 的已知取舍，「存档码」认领作为第二阶段。
- **规范化存储，不全存 JSON**：D1 里 `saves` 表存世界参数+玩家+背包等小字段，`edits` 表按 `(owner, slot, dim, x, y, z)` 逐格存玩家改动（`id=0` 表示挖成空气）。这样杜绝「数 MB 单列值」的 D1 行大小/序列化风险。
- **增量写**：自动存档只把「上次成功推送以来真正改动过的格子」作为 `added/removed` 发给后端做 `upsert/delete`，避免每 60 秒重传整个世界。
- **复用现有校验**：`snapshot()` / `applySave()` 里那些防手改作弊、字段级容错的代码全部保留，只替换底层 `store` 后端。

## User Stories

1. As a player, I want my save to survive a multi-MB world, so that heavily edited worlds don't silently fail to persist.
2. As a player, I want my progress backed up server-side, so that clearing browser data or storage eviction doesn't wipe my world.
3. As a player, I want the game to keep working offline, so that a flaky network doesn't block saving or loading.
4. As a player, I want autosave to stay cheap, so that only the blocks I actually changed since the last save are uploaded.
5. As a player on a new device with my owner id, I want to recover my cloud save, so that I don't lose everything when switching machines.
6. As a developer, I want the local dev loop to use real SQLite, so that what I test matches production D1 dialect exactly.
7. As a developer, I want the migration path to D1 to not rewrite the save validation logic, so that the anti-cheat field checks stay intact.
8. As a developer, I want a single integration seam for persistence, so that callers like `saveNow`/`loadNow` don't need to change.
9. As a player, I want export/import of a local `.json` file to keep working, so that I still hold a copy in my hands.
10. As a developer, I want the schema to reserve a `slot` column, so that multi-slot saves are a later additive change, not a migration.

## Implementation Decisions

- **部署形态**：纯静态 Pages 不变；新增 `wrangler.toml`（`pages_build_output_dir = "dist"` + `[[d1_databases]]` 绑定 `DB` + `migrations_dir`），新增 `functions/` 目录。现有 `wrangler pages deploy dist` 流程不动。D1 只能从服务端绑定访问，浏览器 JS 不能直接连——这是引入 Functions 的根本原因。
- **数据库名** `voxel-craft-saves`，`database_id` 由 `wrangler d1 create` 产出后填进 `wrangler.toml`（占位 `REPLACE_WITH_WRANGLER_D1_CREATE_OUTPUT`）。
- **Schema（规范化）**：
  - `saves(owner TEXT, slot INTEGER DEFAULT 0, seed, dim, flat, mode, time, px,py,pz, yaw, pitch, hp, food, air, spawn_x,spawn_y,spawn_z, fly, selected, inv TEXT, slots TEXT, armor TEXT, ench TEXT, potions TEXT, chests TEXT, v INTEGER, updated_at INTEGER, PRIMARY KEY(owner, slot))`
  - `edits(owner, slot, dim, x, y, z, id INTEGER, PRIMARY KEY(owner, slot, dim, x, y, z))`，`id=0` 表示挖空（沿用 `save.js` 语义）。
  - 建 `idx_edits_owner(owner, slot)` 便于按 owner 取全量。
- **API 契约**（`functions/api/save.js`）：
  - `GET /api/save`（头 `x-owner`）：返回 `{ save: <与 localStorage 同构的快照> }`；无档 `404`。`?meta=1` 时只回 `{ has, t, dim, mode, flat, blocks }`。
  - `PUT /api/save`（头 `x-owner`，JSON 体）：`saves` 行 `INSERT … ON CONFLICT(owner,slot) DO UPDATE`；`edits.added` 逐格 `INSERT … ON CONFLICT(owner,slot,dim,x,y,z) DO UPDATE SET id=excluded.id`；`edits.removed` 逐格 `DELETE`；全部走 `db.batch(...)` 一次提交。
- **客户端增量**：纯函数 `buildEditDelta(currentMaps, lastMaps)`（无重依赖，可单测）算 `added/removed`；`save.js` 在 `saveGame()` 写盘后 `pushToCloud(snapshot())`（异步 fire-and-forget，失败静默、本地缓存仍有效）；`loadGame()` 无本地档时回退 `pullFromCloud()` 并写回本地缓存。
- **单接入点**：云逻辑全部收进 `save.js` 自身（`save.js` 已不依赖 uiActions，避免循环）；新增 `pushToCloud / loadFromCloud / hasCloudSave / cloudMeta / invalidateCloud / deleteCloudSave / getOwner`，经 `src/game/index.js` 暴露到 `engine` 门面，`uiActions` 调用方零改动。
- **缓存与离线**：`localStorage` 继续作为首跳读缓存；`saveGame()` 同步落本地后立即异步推云；`deleteSave()` 同步删本地并异步删云；`importSaveJson` 后 `invalidateCloud()` 让下次推送重传全量。
- **保留导出/导入**：`exportSaveJson` / `importSaveJson` 不变（仍是本地文件交换）。

## Testing Decisions

- **好测试的标准**：只测外部行为（增量 diff 是否正确、快照往返无损、无网络时本地缓存不崩），不测 D1 客户端 API 内部。
- **测什么**：
  - `buildEditDelta`：纯函数单测——新增格、改 id、`id` 回到地形基准（`setBlock` 会 `edits.delete`）算 removed、`id=0` 挖空算 added 且语义保留。
  - `save.js` 往返：`snapshot()` → 推云（mock fetch 捕获 payload）→ `pullFromCloud` 重组 → `applySave` 还原，字段一致。
  - Functions 集成：本地 `wrangler dev --local`（Miniflare 起本地 SQLite）跑「PUT → GET → 比对」，覆盖增量 upsert 与 `?meta=1`。
- **先验（prior art）**：沿用 `.scratch/saveio/probe.mjs` 的「导出/导入往返无损 + 坏数据三拒」套路；`buildEditDelta` 单测不 import 重图（避开 `textures.js` 的 `document.createElement` 在 node 崩溃）。
- **构建门禁**：`npx vite build` 必须过（108 modules、贴图 242/256）。

## Out of Scope

- 真登录 / OAuth（GitHub、邮箱）——第二阶段。
- 「存档码」跨设备认领 UI——第二阶段（临时复用匿名 UUID）。
- 多存档槽位 UI——schema 预留 `slot` 列，但 MVP 只用 `slot=0`。
- KV / R2 方案对比——已据「结构化 + 稀疏增量 + 强一致」选定 D1。
- 现有 localStorage 存档的自动迁移脚本（MVP 直接双写，旧本地档下次启动自然被云端同 owner 覆盖/补充）。

## Further Notes

- **配额无忧**：D1 免费版 10 万写/天、500 万读/天；增量 edits + 60 秒一次自动存档，单人活跃约 1500 次写/天，余量极大。D1 单线程，一份存档单人写入，无并发冲突。
- **本地测试即用 SQLite**：`wrangler dev --local` 由 Miniflare 起本地 SQLite 文件，方言/客户端 API 与生产 D1 一致；不要另起 `better-sqlite3` 手搓（API 与方言会分叉）。
- **MVP 已知局限**：owner UUID 存 `localStorage`，整份清数据时 UUID 一并丢失、云端档不可达。这正是「存档码」要解的。但大地图的「localStorage 配额写失败」因存档主体已迁入 D1 而被根治。
- **部署步骤**（实现后由用户执行）：`wrangler d1 create voxel-craft-saves` → 填 `database_id` → `wrangler d1 migrations apply voxel-craft-saves --local` 与 `--remote` → 在 Pages 控制台确认 D1 绑定 `DB` → `npm run build && npx wrangler pages deploy dist --project-name voxel-craft --branch=main`。
