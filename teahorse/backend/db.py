"""SQLite 数据层：历史叙事与当代通行信息分表存储；所有变更带版本戳。"""
from __future__ import annotations
import os, sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

DEFAULT_DB = os.path.join(os.path.dirname(__file__), "teahorse.db")

def db_path() -> str:
    return os.environ.get("TEAHORSE_DB", DEFAULT_DB)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER);

-- 当代通行：驿站（海拔缺失保持 NULL，绝不当 0）
CREATE TABLE IF NOT EXISTS stations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_zh TEXT NOT NULL, name_en TEXT NOT NULL, name_key TEXT NOT NULL,
  lat REAL, lon REAL,
  elevation_m REAL,                                  -- NULL = 缺失
  elevation_status TEXT NOT NULL DEFAULT 'missing'
    CHECK(elevation_status IN ('verified','estimated','missing')),
  verify_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(verify_status IN ('verified','pending')),  -- 待确认驿站（如同名）
  alias_group TEXT,
  note_zh TEXT, note_en TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT);

-- 历史叙事：与当代通行信息分离存储
CREATE TABLE IF NOT EXISTS narratives(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER REFERENCES stations(id),
  lang TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT);

-- 历史商路：仅叙事用途，绝不直接当作现行徒步路线
CREATE TABLE IF NOT EXISTS historic_routes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT, name_en TEXT, era TEXT, note_zh TEXT, note_en TEXT,
  version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS historic_route_stops(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER REFERENCES historic_routes(id),
  seq INTEGER, station_name TEXT, lat REAL, lon REAL, note TEXT);

-- 当代通行：有向路段（方向 + 移动时长 + 体力标签及其来源）
CREATE TABLE IF NOT EXISTS segments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_station INTEGER NOT NULL REFERENCES stations(id),
  to_station   INTEGER NOT NULL REFERENCES stations(id),
  mode TEXT NOT NULL CHECK(mode IN ('walk','bus','mule')),
  duration_min INTEGER NOT NULL,
  distance_km REAL,
  effort_label TEXT,        -- 体力标签：来自来源资料，非算法推断
  effort_source TEXT,       -- 标签来源（实地走访/管理方/文献…）
  verify_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(verify_status IN ('verified','pending')),
  seasonal_months TEXT,     -- JSON 数组：开放月份；NULL=全年
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT);

-- 可用窗口：daily=每日时刻窗（如班车），range=日期区间；effect=open/closed
CREATE TABLE IF NOT EXISTS segment_windows(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id),
  kind TEXT NOT NULL CHECK(kind IN ('daily','range')),
  effect TEXT NOT NULL CHECK(effect IN ('open','closed')),
  start_hhmm TEXT, end_hhmm TEXT,
  date_start TEXT, date_end TEXT,
  note TEXT, version INTEGER NOT NULL DEFAULT 1);

-- 公告：published_at 与 effective_from 分离（封路公告可能迟到）
CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('closure','notice','seasonal')),
  segment_id INTEGER REFERENCES segments(id),
  station_id INTEGER REFERENCES stations(id),
  title_zh TEXT, title_en TEXT, body_zh TEXT, body_en TEXT,
  effective_from TEXT NOT NULL, effective_to TEXT,
  published_at TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
  version INTEGER NOT NULL DEFAULT 1);

-- 已审路线（策划推荐）及其版本；回退=以旧版本为母本生成新的 current
CREATE TABLE IF NOT EXISTS route_versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key TEXT NOT NULL,
  name_zh TEXT, name_en TEXT,
  status TEXT NOT NULL DEFAULT 'current' CHECK(status IN ('current','superseded')),
  legs_json TEXT NOT NULL,          -- 有序 segment id 列表
  params_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL);

-- 收藏计划：保留原依据（来源版本快照），重连后用于差异比对
CREATE TABLE IF NOT EXISTS favorites(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  basis_json TEXT NOT NULL,
  created_at TEXT NOT NULL);

-- 实体版本戳：服务器计算结果与页面标注绑定同一组来源版本
CREATE TABLE IF NOT EXISTS data_versions(
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL, updated_at TEXT,
  PRIMARY KEY(entity, entity_id));
"""

@contextmanager
def get_db():
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def init_db() -> None:
    with get_db() as c:
        c.executescript(SCHEMA)
        c.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('data_version',0)")

def bump(conn, entity: str, entity_id: int) -> None:
    """实体版本 +1，并推进全局 data_version（计算结果与页面标注的对齐基准）。"""
    conn.execute(
        """INSERT INTO data_versions(entity,entity_id,version,updated_at) VALUES(?,?,1,?)
           ON CONFLICT(entity,entity_id) DO UPDATE SET version=version+1, updated_at=excluded.updated_at""",
        (entity, entity_id, now_iso()))
    conn.execute("UPDATE meta SET value=value+1 WHERE key='data_version'")

def data_version(conn) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key='data_version'").fetchone()
    return row["value"] if row else 0

def rows(conn, sql: str, params=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]

def row(conn, sql: str, params=()) -> dict | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None

import json as _json

def json_dumps(obj) -> str:
    return _json.dumps(obj, ensure_ascii=False)
