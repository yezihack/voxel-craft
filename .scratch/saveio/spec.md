# 存档导出 / 导入（防丢档）

## 根因
存档只存在 localStorage（`voxel-craft:save`），三种现实丢法：
清浏览器数据、iOS ITP 的 7 天存储回收、隐私模式配额写不进。
玩家对存档没有任何「握在手里」的途径。

## 做法
- **save.js** 新增 `exportSaveJson()`（无档时退回内存快照兜底）与
  `importSaveJson(text)`（校验 JSON 合法性 + 版本号 → 原样写回 SAVE_KEY →
  同步重建 meta）。导入即替换浏览器存档，字段级容错仍由 applySave 负责。
- **uiActions.js** 新增 `exportSave()`（先 saveGame 保证导出最新进度 →
  Blob + a.download 触发浏览器下载）与 `importSaveFile(file)`（读文件 →
  importSaveJson → loadNow 立即读档进世界，复用既有清场 + toast）。
- **StartVeil.vue**（开始/暂停共用面板）加两枚 `.iobtn`：⬇导出 / ⬆导入，
  隐藏 `<input type=file>`，change 后清空 value（同一文件选第二次也要触发）。
- engine.js NOT_READY_KEYS 补 `exportSave` / `importSaveFile` 占位。

## 验证
- `.scratch/saveio/probe.mjs` 19 条：导出内容/兜底、坏 JSON/数组/错版本三拒、
  导入后 loadGame 生效、meta 重建、往返无损。全过。
- `.scratch/saveio/e2e.mjs` 9 条（真 Chromium + acceptDownloads）：
  按钮存在、下载文件名 `voxel-craft-save-YYYYMMDD-HHmmss.json`、导出 JSON 合法、
  改 seed/hp 的文件导入后 localStorage 被覆盖、摘要面板更新、
  坏文件拒绝且存档保留、零页面报错。全过。
- `npx vite build` 100 modules 通过。
