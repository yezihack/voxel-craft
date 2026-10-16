Type: task
Status: needs-triage
Blocked by: 07

# 掌握度、复习队列与持久化

项目目前**零持久化**（无 localStorage / IndexedDB / 账号），这是全新的一层。

- `src/game/learning/progress.js`：每个词条的掌握度 + 下次复习时间，
  间隔重复的档位先取保守值（1 / 2 / 4 / 7 天），不要一上来做完整 SM-2。
- 复习队列**同时收纳答错的与到期遗忘的**（见 GLOSSARY 的「复习队列」，
  别叫错题本 —— 不全是答错的）。
- 存储 key 带版本号，如 `voxel-craft.learning.v1`，并留迁移路径：
  读不懂的版本直接丢弃重建，不要让旧数据把新版本搞崩。

## Answer

## Comments
