"""种子数据：滇南—滇西茶马古道片段；内置验收场景所需数据。"""
from . import db

STATIONS = [
    # code, zh, en, lat, lon, elev, elev_status, verify, alias_group, note_zh, note_en
    ("PUER", "普洱", "Pu'er", 22.78, 100.97, 1300, "verified", "verified", None,
     "滇南起点，清代普洱府治。", "Southern terminus, seat of Pu'er prefecture."),
    ("NKL", "那柯里", "Nakeli", 22.90, 101.05, 1280, "verified", "verified", None,
     "保存较好的古驿站。", "Well-preserved old post station."),
    ("MOH", "磨黑", "Mohei", 23.02, 101.18, 1350, "verified", "verified", None,
     "盐井古镇。", "Old salt-well town."),
    ("TGG", "通关", "Tongguan", 23.18, 101.32, 1500, "verified", "verified", None,
     "山口要隘。", "Mountain-pass chokepoint."),
    ("BM1", "白马驿站", "Baima Station", 23.30, 101.55, 1620, "verified", "verified",
     "baima", "宁洱侧白马驿站（已核实）。", "Baima station on the Ning'er side (verified)."),
    ("BM2", "白马驿站", "Baima Station", 23.41, 101.70, None, "missing", "pending",
     "baima", "同名候选点，位置与海拔待确认。", "Same-name candidate; location/elevation pending."),
    ("DALI", "大理", "Dali", 25.69, 100.16, 1970, "verified", "verified", None,
     "滇西枢纽。", "Western Yunnan hub."),
    ("SHX", "沙溪", "Shaxi", 26.32, 99.85, 2100, "verified", "verified", None,
     "寺登街集市。", "Sideng street market."),
    ("JC", "剑川", "Jianchuan", 26.54, 99.90, 2200, "estimated", "verified", None,
     "海拔为估计值（ interpolate 自相邻点）。", "Elevation estimated from neighbours."),
    ("LJS", "老君山", "Laojunshan", 26.75, 99.72, None, "missing", "verified", None,
     "高程缺失，剖面留空。", "Elevation missing; left blank in profile."),
    ("ZD", "中甸", "Zhongdian", 27.83, 99.70, 3200, "verified", "verified", None,
     "高原集散地。", "Plateau entrepôt."),
]

# from, to, mode, duration_min, km, effort, effort_src, verify, seasonal, note
SEGMENTS = [
    ("PUER", "NKL", "walk", 240, 14.0, "轻松", "2024 实地走访", "verified", None, None),
    ("NKL", "MOH", "walk", 300, 17.5, "中等", "2024 实地走访", "verified", None, None),
    ("MOH", "TGG", "walk", 360, 19.0, "中等", "管理方测定 2023", "verified", None, None),
    ("TGG", "BM1", "walk", 200, 11.0, "轻松", "管理方测定 2023", "verified", None, None),
    ("TGG", "BM2", "walk", 260, 15.0, None, None, "pending", None, "通往同名待确认点"),
    ("BM1", "DALI", "bus", 300, 210.0, None, None, "verified", None, "县际班车"),
    ("DALI", "SHX", "bus", 150, 120.0, None, None, "verified", None, "旅游专线"),
    ("SHX", "JC", "walk", 240, 13.0, "中等", "2024 实地走访", "verified", None, None),
    ("JC", "LJS", "walk", 300, 16.0, "偏高", "向导协会记录", "verified", [5, 6, 7, 8, 9, 10],
     "季节性开放（5–10 月）"),
    ("LJS", "ZD", "walk", 420, 22.0, "高强度", "历史文献推断，未经实测", "verified",
     [5, 6, 7, 8, 9, 10], "季节性开放（5–10 月）"),
    ("DALI", "PUER", "bus", 420, 330.0, None, None, "verified", None, "返程班车"),
]

# segment(from,to) -> windows
WINDOWS = [
    ("BM1", "DALI", "daily", "open", "08:00", "10:00", None, None, "班车发车窗口"),
    ("DALI", "SHX", "daily", "open", "09:00", "11:00", None, None, "专线发车窗口"),
    ("DALI", "PUER", "daily", "open", "08:30", "09:30", None, None, "返程班车窗口"),
]

NARRATIVES = [
    ("PUER", "zh", "普洱府与茶山", "清代普洱茶由此集散，马帮沿驿道北上……", "《普洱府志》"),
    ("PUER", "en", "Pu'er and the tea mountains",
     "Pu'er tea was consolidated here in the Qing era; caravans headed north…",
     "Gazetteer of Pu'er Prefecture"),
    ("SHX", "zh", "寺登街的集市", "沙溪寺登街曾是滇藏盐茶互市的重要集市……", "地方志办公室"),
    ("SHX", "en", "The Sideng market", "Sideng street in Shaxi was a key salt-tea market…",
     "Local gazetteer office"),
]

def seed_if_empty():
    db.init_db()
    with db.get_db() as c:
        if db.row(c, "SELECT id FROM stations LIMIT 1"):
            return False
        code2id = {}
        for code, zh, en, lat, lon, elev, es, vs, ag, nzh, nen in STATIONS:
            cur = c.execute(
                """INSERT INTO stations(code,name_zh,name_en,name_key,lat,lon,elevation_m,
                   elevation_status,verify_status,alias_group,note_zh,note_en,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (code, zh, en, zh, lat, lon, elev, es, vs, ag, nzh, nen,
                 db.now_iso(), db.now_iso()))
            code2id[code] = cur.lastrowid
            db.bump(c, "station", cur.lastrowid)
        seg_ids = {}
        for f, t, mode, dur, km, eff, src, vs, seasonal, note in SEGMENTS:
            cur = c.execute(
                """INSERT INTO segments(from_station,to_station,mode,duration_min,distance_km,
                   effort_label,effort_source,verify_status,seasonal_months,note,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (code2id[f], code2id[t], mode, dur, km, eff, src, vs,
                 db.json_dumps(seasonal) if seasonal else None, note, db.now_iso()))
            seg_ids[(f, t)] = cur.lastrowid
            db.bump(c, "segment", cur.lastrowid)
        for f, t, kind, effect, s, e, ds, de, note in WINDOWS:
            c.execute(
                """INSERT INTO segment_windows(segment_id,kind,effect,start_hhmm,end_hhmm,
                   date_start,date_end,note) VALUES(?,?,?,?,?,?,?,?)""",
                (seg_ids[(f, t)], kind, effect, s, e, ds, de, note))
        for code, lang, title, body, source in NARRATIVES:
            c.execute(
                """INSERT INTO narratives(station_id,lang,title,body,source,updated_at)
                   VALUES(?,?,?,?,?,?)""",
                (code2id[code], lang, title, body, source, db.now_iso()))
        # 历史商路（仅叙事，不是现行徒步路线）
        cur = c.execute(
            """INSERT INTO historic_routes(name_zh,name_en,era,note_zh,note_en,version)
               VALUES(?,?,?,?,?,1)""",
            ("滇藏盐茶古道（历史叙事）", "Historic salt-tea caravan route (narrative)",
             "明清", "历史商路复原，仅供阅读，不等于现行徒步路线。",
             "Historical reconstruction for reading only; NOT a current hiking route."))
        rid = cur.lastrowid
        for i, (name, lat, lon) in enumerate([
                ("普洱", 22.78, 100.97), ("磨黑", 23.02, 101.18), ("通关", 23.18, 101.32),
                ("凤阳邑", 25.66, 100.19), ("大理", 25.69, 100.16), ("沙溪", 26.32, 99.85)]):
            c.execute(
                "INSERT INTO historic_route_stops(route_id,seq,station_name,lat,lon,note) VALUES(?,?,?,?,?,?)",
                (rid, i + 1, name, lat, lon, None))
        # 已审路线 v1：普洱—大理经典线
        legs = [seg_ids[("PUER", "NKL")], seg_ids[("NKL", "MOH")], seg_ids[("MOH", "TGG")],
                seg_ids[("TGG", "BM1")], seg_ids[("BM1", "DALI")]]
        c.execute(
            """INSERT INTO route_versions(route_key,name_zh,name_en,status,legs_json,params_json,note,created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            ("puer-dali-classic", "普洱—大理经典线", "Pu'er–Dali classic", "current",
             db.json_dumps(legs), db.json_dumps({"days": 2}), "v1 初始审定", db.now_iso()))
        return True
