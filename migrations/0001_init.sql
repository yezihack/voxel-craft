-- voxel-craft 存档：规范化 D1 schema
-- 设计要点：地形是纯函数、不入档；只存「世界参数 + 玩家状态 + 玩家改动过的格子」。
-- edits 按 (owner, slot, dim, x, y, z) 逐格存，id=0 表示「这格被挖成空气」（沿用 save.js 语义）。

CREATE TABLE IF NOT EXISTS saves (
  owner      TEXT    NOT NULL,
  slot       INTEGER NOT NULL DEFAULT 0,
  seed       INTEGER,
  dim        INTEGER,
  flat       INTEGER,
  mode       INTEGER,
  time       REAL,
  px         REAL,
  py         REAL,
  pz         REAL,
  yaw        REAL,
  pitch      REAL,
  hp         REAL,
  food       REAL,
  air        REAL,
  spawn_x    REAL,
  spawn_y    REAL,
  spawn_z    REAL,
  fly        INTEGER,
  selected   INTEGER,
  inv        TEXT,    -- JSON: [[id, n], ...]
  slots      TEXT,    -- JSON: [id, ...]
  armor      TEXT,    -- JSON（可为 null）
  ench       TEXT,    -- JSON（可为 null）
  potions    TEXT,    -- JSON（可为 null）
  chests     TEXT,    -- JSON（可为 null）
  v          INTEGER, -- 存档格式版本
  updated_at INTEGER,
  PRIMARY KEY (owner, slot)
);

CREATE TABLE IF NOT EXISTS edits (
  owner TEXT    NOT NULL,
  slot  INTEGER NOT NULL DEFAULT 0,
  dim   INTEGER NOT NULL,
  x     INTEGER NOT NULL,
  y     INTEGER NOT NULL,
  z     INTEGER NOT NULL,
  id    INTEGER NOT NULL,   -- 0 = 挖空（空气）
  PRIMARY KEY (owner, slot, dim, x, y, z)
);

CREATE INDEX IF NOT EXISTS idx_edits_owner ON edits (owner, slot);
