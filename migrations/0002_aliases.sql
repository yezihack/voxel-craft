-- 存档别名 ↔ 匿名 UUID 的绑定表。
-- 别名必须在服务端：换设备时输入别名要能解析回 owner，映射存在浏览器里就没意义了。
--
-- alias    = 归一化键（trim + toLowerCase），唯一；判重 / 解析都走它。
-- owner    = 匿名 UUID，唯一 —— 一份档同时只能有一个别名（改名走 DELETE+INSERT）。
-- display  = 玩家输入时的原貌，仅用于界面展示。
CREATE TABLE IF NOT EXISTS aliases (
  alias       TEXT PRIMARY KEY,
  owner       TEXT NOT NULL UNIQUE,
  display     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
