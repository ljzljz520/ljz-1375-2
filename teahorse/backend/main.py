"""茶马古道资料站 API：访客查询 / 管理维护 / 规划与比较 / 收藏与差异 / 目录与离线包。"""
from __future__ import annotations
import json, os
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, planner, seed

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "admin-dev-token")
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

app = FastAPI(title="茶马古道资料站", version="1.0.0")

@app.on_event("startup")
def _startup():
    seed.seed_if_empty()

# ---------- 工具 ----------
def admin_auth(x_admin_token: str = Header(default="")):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(401, "invalid admin token")
    return True

def _sources(conn, segment_ids=None, route_version_ids=None) -> dict:
    """服务器计算结果与页面标注绑定同一组来源版本。"""
    segs = {}
    if segment_ids:
        q = ",".join("?" * len(segment_ids))
        for r in conn.execute(
                f"SELECT entity_id, version FROM data_versions WHERE entity='segment' AND entity_id IN ({q})",
                segment_ids):
            segs[str(r["entity_id"])] = r["version"]
    return {
        "data_version": db.data_version(conn),
        "segments": segs,
        "announcements_cutoff": db.now_iso(),
        "route_version_ids": route_version_ids or [],
    }

def _station_out(s: dict) -> dict:
    return {k: s[k] for k in ("id", "code", "name_zh", "name_en", "lat", "lon",
                              "elevation_m", "elevation_status", "verify_status",
                              "alias_group", "note_zh", "note_en", "version")}

# ---------- 访客：驿站 / 高程 / 叙事 ----------
@app.get("/api/stations")
def list_stations(query: str | None = None):
    with db.get_db() as c:
        if query:
            like = f"%{query}%"
            ss = db.rows(c, """SELECT * FROM stations
                               WHERE name_zh LIKE ? OR name_en LIKE ? OR code LIKE ?
                               ORDER BY code""", (like, like, like))
        else:
            ss = db.rows(c, "SELECT * FROM stations ORDER BY code")
        groups = {}
        for s in ss:
            if s["alias_group"]:
                groups.setdefault(s["alias_group"], []).append(s["id"])
        out = []
        for s in ss:
            d = _station_out(s)
            if s["alias_group"] and len(groups.get(s["alias_group"], [])) > 1:
                d["same_name_group"] = groups[s["alias_group"]]  # 同名驿站提示
            out.append(d)
        return {"data_version": db.data_version(c), "stations": out}

@app.get("/api/stations/resolve")
def resolve_station(name: str):
    """同名驿站消歧：返回候选与待确认状态，由用户确认后再规划。"""
    with db.get_db() as c:
        ss = db.rows(c, "SELECT * FROM stations WHERE name_zh=? OR name_en=?", (name, name))
        if not ss:
            return {"match": "none", "candidates": []}
        if len(ss) > 1:
            return {"match": "ambiguous", "needs_confirmation": True,
                    "candidates": [_station_out(s) for s in ss]}
        return {"match": "unique", "candidates": [_station_out(ss[0])]}

@app.get("/api/stations/{sid}")
def get_station(sid: int):
    with db.get_db() as c:
        s = db.row(c, "SELECT * FROM stations WHERE id=?", (sid,))
        if not s:
            raise HTTPException(404, "station not found")
        narr = db.rows(c, "SELECT lang,title,body,source,version FROM narratives WHERE station_id=?", (sid,))
        return {"station": _station_out(s), "narratives": narr,
                "data_version": db.data_version(c)}

@app.get("/api/segments")
def list_segments():
    with db.get_db() as c:
        segs = db.rows(c, "SELECT * FROM segments ORDER BY id")
        wins = db.rows(c, "SELECT * FROM segment_windows ORDER BY id")
        wmap = {}
        for w in wins:
            wmap.setdefault(w["segment_id"], []).append(w)
        for s in segs:
            s["windows"] = wmap.get(s["id"], [])
        return {"data_version": db.data_version(c), "segments": segs}

@app.get("/api/announcements")
def list_announcements():
    with db.get_db() as c:
        return {"data_version": db.data_version(c),
                "announcements": db.rows(c, "SELECT * FROM announcements ORDER BY published_at DESC")}

@app.get("/api/historic-routes")
def historic_routes():
    """历史商路：与现行徒步路段分离，明确标注不可当作现行路线。"""
    with db.get_db() as c:
        rs = db.rows(c, "SELECT * FROM historic_routes")
        for r in rs:
            r["stops"] = db.rows(c, "SELECT seq,station_name,lat,lon,note FROM historic_route_stops WHERE route_id=? ORDER BY seq", (r["id"],))
            r["is_current_hiking_route"] = False
            r["usage_note"] = {"zh": "历史叙事内容，不能直接视为现行徒步路线。",
                               "en": "Historical narrative; not a current hiking route."}
        return {"data_version": db.data_version(c), "historic_routes": rs}

# ---------- 规划 ----------
class SearchReq(BaseModel):
    from_station: int | None = None
    to_station: int | None = None
    from_name: str | None = None
    to_name: str | None = None
    depart: str
    modes: list[str] | None = None
    require_verified: bool = True
    max_days: int | None = None
    max_effort: str | None = None
    max_wait_hours: float | None = None

def _resolve(conn, sid, name):
    if sid:
        return sid, None
    ss = db.rows(conn, "SELECT * FROM stations WHERE name_zh=? OR name_en=?", (name, name))
    if not ss:
        raise HTTPException(404, f"unknown station name: {name}")
    if len(ss) > 1:
        raise HTTPException(409, {"error": "ambiguous_station", "needs_confirmation": True,
                                  "candidates": [_station_out(s) for s in ss]})
    return ss[0]["id"], None

@app.post("/api/plan/search")
def plan_search(req: SearchReq):
    with db.get_db() as c:
        fid, _ = _resolve(c, req.from_station, req.from_name)
        tid, _ = _resolve(c, req.to_station, req.to_name)
        res = planner.search(c, fid, tid, planner.parse_dt(req.depart),
                             modes=req.modes, require_verified=req.require_verified,
                             max_days=req.max_days, max_effort=req.max_effort,
                             max_wait_hours=req.max_wait_hours)
        seg_ids = [l["segment_id"] for l in res.get("legs", [])]
        seg_ids += [l["segment_id"] for l in res.get("reachable_legs", [])]
        if res.get("blocked"):
            seg_ids.append(res["blocked"]["segment_id"])
        res["sources"] = _sources(c, sorted(set(seg_ids)))
        return res

class ProfileReq(BaseModel):
    station_ids: list[int]
    segment_ids: list[int] | None = None

@app.post("/api/plan/elevation-profile")
def plan_profile(req: ProfileReq):
    with db.get_db() as c:
        res = planner.elevation_profile(c, req.station_ids, req.segment_ids)
        res["sources"] = _sources(c, req.segment_ids or [])
        return res

class CompareReq(BaseModel):
    from_station: int
    to_station: int
    depart: str
    prefs: dict | None = None   # max_days / modes / max_effort

@app.post("/api/plan/compare")
def plan_compare(req: CompareReq):
    """比较：A=按用户偏好筛选的已审路线；B=受约束图搜索。两者绑定同一组来源版本。"""
    prefs = req.prefs or {}
    depart = planner.parse_dt(req.depart)
    with db.get_db() as c:
        curated = []
        rvs = db.rows(c, "SELECT * FROM route_versions WHERE status='current'")
        segmap = {s["id"]: dict(s) for s in c.execute("SELECT * FROM segments")}
        stmap = {s["id"]: dict(s) for s in c.execute("SELECT * FROM stations")}
        _, wins, anns, _ = planner.load_graph(c)
        for rv in rvs:
            seg_ids = json.loads(rv["legs_json"])
            if not seg_ids:
                continue
            first, last = segmap[seg_ids[0]], segmap[seg_ids[-1]]
            if first["from_station"] != req.from_station or last["to_station"] != req.to_station:
                continue
            legs, t, conflicts, ok = [], depart, [], True
            for sid in seg_ids:
                e = segmap[sid]
                if prefs.get("modes") and e["mode"] not in prefs["modes"]:
                    conflicts.append({"segment_id": sid, "reason": "mode_excluded"})
                    ok = False
                    break
                dep = planner.next_departure(e, wins[e["id"]], anns, t)
                if dep is None:
                    reason, ann = planner._diagnose(e, wins[e["id"]], anns, t)
                    conflicts.append({"segment_id": sid, "reason": reason,
                                      "announcement_id": ann["id"] if ann else None})
                    ok = False
                    break
                arr = dep + planner.timedelta(minutes=e["duration_min"])
                legs.append(planner._leg(e, dep, arr, stmap))
                t = arr
            if prefs.get("max_days") and legs:
                if (planner.parse_dt(legs[-1]["arrive"]).date() - depart.date()).days + 1 > prefs["max_days"]:
                    conflicts.append({"segment_id": None, "reason": "exceeds_max_days"})
                    ok = False
            cap = planner.EFFORT_RANK.get(prefs.get("max_effort") or "", None)
            if cap is not None:
                for l in legs:
                    if l["effort_label"] in planner.EFFORT_RANK and planner.EFFORT_RANK[l["effort_label"]] > cap:
                        conflicts.append({"segment_id": l["segment_id"], "reason": "effort_exceeds_preference"})
                        ok = False
            curated.append({
                "route_version_id": rv["id"], "name_zh": rv["name_zh"], "name_en": rv["name_en"],
                "status": "usable" if ok else "conflict", "conflicts": conflicts,
                "legs": legs if ok else [],
                "totals": {"days": (planner.parse_dt(legs[-1]["arrive"]).date() - depart.date()).days + 1,
                           "minutes": int((planner.parse_dt(legs[-1]["arrive"]) - depart).total_seconds() // 60)} if legs else None,
            })
        search_res = planner.search(c, req.from_station, req.to_station, depart,
                                    modes=prefs.get("modes"),
                                    require_verified=prefs.get("require_verified", True),
                                    max_days=prefs.get("max_days"),
                                    max_effort=prefs.get("max_effort"),
                                    max_wait_hours=prefs.get("max_wait_hours"))
        seg_ids = [l["segment_id"] for l in search_res.get("legs", [])]
        for cu in curated:
            seg_ids += [l["segment_id"] for l in cu["legs"]]
        src = _sources(c, sorted(set(seg_ids)),
                       route_version_ids=[cu["route_version_id"] for cu in curated])
        search_res["sources"] = src
        return {"sources": src, "curated": curated, "search": search_res,
                "effort_note": planner.DISCLAIMER, "safety_disclaimer": planner.DISCLAIMER}

# ---------- 收藏与差异（封路公告迟到 / 版本回退的验收） ----------
class FavReq(BaseModel):
    client_id: str
    name: str
    plan: dict   # 需含 sources、legs、depart/arrive

@app.post("/api/favorites")
def save_favorite(req: FavReq):
    plan = req.plan
    src = plan.get("sources", {})
    seg_ids = sorted({l["segment_id"] for l in plan.get("legs", [])})
    st_ids = sorted({l["from_station"] for l in plan.get("legs", [])}
                    | {l["to_station"] for l in plan.get("legs", [])})
    basis = {
        "data_version": src.get("data_version"),
        "segments": src.get("segments", {}),
        "announcements_cutoff": src.get("announcements_cutoff"),
        "route_version_ids": src.get("route_version_ids", []),
        "segment_ids": seg_ids, "station_ids": st_ids,
        "start": plan.get("depart"), "end": plan.get("arrive"),
    }
    with db.get_db() as c:
        cur = c.execute(
            "INSERT INTO favorites(client_id,name,plan_json,basis_json,created_at) VALUES(?,?,?,?,?)",
            (req.client_id, req.name, json.dumps(plan, ensure_ascii=False),
             json.dumps(basis, ensure_ascii=False), db.now_iso()))
        return {"favorite_id": cur.lastrowid, "basis": basis}

@app.get("/api/favorites")
def list_favorites(client_id: str):
    with db.get_db() as c:
        fs = db.rows(c, "SELECT * FROM favorites WHERE client_id=? ORDER BY id", (client_id,))
        for f in fs:
            f["plan"] = json.loads(f.pop("plan_json"))
            f["basis"] = json.loads(f.pop("basis_json"))
        return {"favorites": fs}

class DiffReq(BaseModel):
    basis: dict

@app.post("/api/plans/diff")
def plans_diff(req: DiffReq):
    """重连后比对：迟到公告、路段版本变化、已审路线回退/替换。"""
    b = req.basis
    changes = []
    with db.get_db() as c:
        cutoff = b.get("announcements_cutoff") or "1970-01-01T00:00:00+00:00"
        seg_ids = b.get("segment_ids") or []
        st_ids = b.get("station_ids") or []
        if seg_ids or st_ids:
            cond, params = [], []
            if seg_ids:
                cond.append(f"segment_id IN ({','.join('?'*len(seg_ids))})")
                params += seg_ids
            if st_ids:
                cond.append(f"station_id IN ({','.join('?'*len(st_ids))})")
                params += st_ids
            for a in db.rows(c, f"""SELECT * FROM announcements
                                      WHERE published_at > ? AND ({' OR '.join(cond)})
                                      ORDER BY published_at""", [cutoff] + params):
                hit_dates = True
                if b.get("start") and a["effective_to"]:
                    hit_dates = a["effective_from"] <= b["end"] and a["effective_to"] >= b["start"]
                elif b.get("start"):
                    hit_dates = a["effective_from"] <= b["end"]
                changes.append({
                    "type": "late_announcement", "announcement_id": a["id"], "kind": a["kind"],
                    "title_zh": a["title_zh"], "title_en": a["title_en"],
                    "published_at": a["published_at"], "effective_from": a["effective_from"],
                    "effective_to": a["effective_to"], "severity": a["severity"],
                    "affects_plan_dates": bool(hit_dates),
                    "note": {"zh": "公告发布晚于计划收藏时间（迟到公告）。",
                             "en": "Announcement published after the plan was saved (late notice)."},
                })
        for sid, old_v in (b.get("segments") or {}).items():
            r = db.row(c, "SELECT version FROM data_versions WHERE entity='segment' AND entity_id=?",
                       (int(sid),))
            if r and r["version"] > int(old_v):
                changes.append({"type": "segment_updated", "segment_id": int(sid),
                                "from_version": int(old_v), "to_version": r["version"]})
        for rvid in b.get("route_version_ids") or []:
            rv = db.row(c, "SELECT * FROM route_versions WHERE id=?", (rvid,))
            if rv and rv["status"] != "current":
                cur = db.row(c, "SELECT * FROM route_versions WHERE route_key=? AND status='current'",
                             (rv["route_key"],))
                changes.append({"type": "route_version_changed", "route_key": rv["route_key"],
                                "saved_version_id": rvid,
                                "current_version_id": cur["id"] if cur else None,
                                "note": {"zh": "已审路线版本已变更（可能为回退）。",
                                         "en": "Curated route version changed (possibly a rollback)."}})
        return {"data_version": db.data_version(c), "changes": changes}

# ---------- 目录 / 离线包 / 元信息 ----------
@app.get("/api/catalog")
def catalog(lang: str = "zh"):
    """编号目录：待核信息在打印件与多语言页面中均有说明。"""
    pick = (lambda zh, en: en if lang == "en" else zh)
    with db.get_db() as c:
        stations = db.rows(c, "SELECT * FROM stations ORDER BY code")
        segments = db.rows(c, "SELECT * FROM segments ORDER BY id")
        stmap = {s["id"]: s for s in stations}
        anns = db.rows(c, "SELECT * FROM announcements ORDER BY published_at DESC")
        def elev(s):
            if s["elevation_m"] is None:
                return pick("未知（缺失，非 0）", "unknown (missing, not 0)")
            if s["elevation_status"] == "estimated":
                return f"{s['elevation_m']} m " + pick("（估计）", "(estimated)")
            return f"{s['elevation_m']} m"
        cat_stations = [{
            "no": i + 1, "code": s["code"], "name": pick(s["name_zh"], s["name_en"]),
            "elevation": elev(s),
            "verify": s["verify_status"],
            "pending_note": pick("待确认：同名或资料未核实", "Pending: duplicate name or unverified")
            if s["verify_status"] == "pending" else None,
        } for i, s in enumerate(stations)]
        cat_segments = [{
            "no": i + 1,
            "from": pick(stmap[s["from_station"]]["name_zh"], stmap[s["from_station"]]["name_en"]),
            "to": pick(stmap[s["to_station"]]["name_zh"], stmap[s["to_station"]]["name_en"]),
            "mode": s["mode"], "duration_min": s["duration_min"],
            "effort": ({"label": s["effort_label"], "source": s["effort_source"]}
                       if s["effort_label"] else None),
            "verify": s["verify_status"],
            "pending_note": pick("待核路段", "Segment pending verification")
            if s["verify_status"] == "pending" else None,
        } for i, s in enumerate(segments)]
        return {"lang": lang, "generated_at": db.now_iso(),
                "data_version": db.data_version(c),
                "stations": cat_stations, "segments": cat_segments, "announcements": anns,
                "disclaimer": planner.DISCLAIMER,
                "pending_explained": pick(
                    "凡标注“待核/待确认”的条目，其信息尚未完成核对，请谨慎采用。",
                    "Entries marked pending are not yet verified; use with caution.")}

@app.get("/api/bundle")
def bundle():
    """离线包：客户端/Service Worker 缓存，附 data_version 供重连比对。"""
    with db.get_db() as c:
        segs = db.rows(c, "SELECT * FROM segments ORDER BY id")
        wins = db.rows(c, "SELECT * FROM segment_windows ORDER BY id")
        wmap = {}
        for w in wins:
            wmap.setdefault(w["segment_id"], []).append(w)
        for s in segs:
            s["windows"] = wmap.get(s["id"], [])
        return {"data_version": db.data_version(c), "generated_at": db.now_iso(),
                "stations": db.rows(c, "SELECT * FROM stations ORDER BY code"),
                "segments": segs,
                "announcements": db.rows(c, "SELECT * FROM announcements ORDER BY published_at DESC"),
                "narratives": db.rows(c, "SELECT * FROM narratives"),
                "historic_routes": db.rows(c, "SELECT * FROM historic_routes"),
                "route_versions": db.rows(c, "SELECT * FROM route_versions WHERE status='current'")}

@app.get("/api/meta")
def meta():
    with db.get_db() as c:
        return {"data_version": db.data_version(c), "server_time": db.now_iso()}

# ---------- 管理 Web ----------
class SegmentIn(BaseModel):
    from_station: int
    to_station: int
    mode: str
    duration_min: int
    distance_km: float | None = None
    effort_label: str | None = None
    effort_source: str | None = None
    verify_status: str = "pending"
    seasonal_months: list[int] | None = None
    note: str | None = None

@app.post("/api/admin/segments")
def admin_create_segment(seg: SegmentIn, _auth=Depends(admin_auth)):
    with db.get_db() as c:
        cur = c.execute(
            """INSERT INTO segments(from_station,to_station,mode,duration_min,distance_km,
               effort_label,effort_source,verify_status,seasonal_months,note,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (seg.from_station, seg.to_station, seg.mode, seg.duration_min, seg.distance_km,
             seg.effort_label, seg.effort_source, seg.verify_status,
             json.dumps(seg.seasonal_months) if seg.seasonal_months else None,
             seg.note, db.now_iso()))
        db.bump(c, "segment", cur.lastrowid)
        return {"segment_id": cur.lastrowid, "data_version": db.data_version(c)}

@app.post("/api/admin/segments/{sid}/verify")
def admin_verify_segment(sid: int, _auth=Depends(admin_auth)):
    with db.get_db() as c:
        c.execute("UPDATE segments SET verify_status='verified', version=version+1, updated_at=? WHERE id=?",
                  (db.now_iso(), sid))
        db.bump(c, "segment", sid)
        return {"ok": True, "data_version": db.data_version(c)}

class WindowIn(BaseModel):
    kind: str
    effect: str
    start_hhmm: str | None = None
    end_hhmm: str | None = None
    date_start: str | None = None
    date_end: str | None = None
    note: str | None = None

@app.post("/api/admin/segments/{sid}/windows")
def admin_add_window(sid: int, w: WindowIn, _auth=Depends(admin_auth)):
    with db.get_db() as c:
        cur = c.execute(
            """INSERT INTO segment_windows(segment_id,kind,effect,start_hhmm,end_hhmm,date_start,date_end,note)
               VALUES(?,?,?,?,?,?,?,?)""",
            (sid, w.kind, w.effect, w.start_hhmm, w.end_hhmm, w.date_start, w.date_end, w.note))
        db.bump(c, "segment", sid)
        return {"window_id": cur.lastrowid, "data_version": db.data_version(c)}

@app.post("/api/admin/stations/{sid}/verify")
def admin_verify_station(sid: int, _auth=Depends(admin_auth)):
    with db.get_db() as c:
        c.execute("UPDATE stations SET verify_status='verified', version=version+1, updated_at=? WHERE id=?",
                  (db.now_iso(), sid))
        db.bump(c, "station", sid)
        return {"ok": True, "data_version": db.data_version(c)}

class AnnouncementIn(BaseModel):
    kind: str = "closure"
    segment_id: int | None = None
    station_id: int | None = None
    title_zh: str
    title_en: str
    body_zh: str | None = None
    body_en: str | None = None
    effective_from: str
    effective_to: str | None = None
    severity: str = "warning"

@app.post("/api/admin/announcements")
def admin_publish_announcement(a: AnnouncementIn, _auth=Depends(admin_auth)):
    """发布公告：published_at=现在（可能晚于 effective_from —— 迟到公告）。"""
    with db.get_db() as c:
        cur = c.execute(
            """INSERT INTO announcements(kind,segment_id,station_id,title_zh,title_en,body_zh,body_en,
               effective_from,effective_to,published_at,severity) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (a.kind, a.segment_id, a.station_id, a.title_zh, a.title_en, a.body_zh, a.body_en,
             a.effective_from, a.effective_to, db.now_iso(), a.severity))
        if a.segment_id:
            db.bump(c, "segment", a.segment_id)
        return {"announcement_id": cur.lastrowid, "published_at": db.now_iso(),
                "data_version": db.data_version(c)}

@app.get("/api/admin/pending")
def admin_pending(_auth=Depends(admin_auth)):
    with db.get_db() as c:
        st = db.rows(c, "SELECT * FROM stations WHERE verify_status='pending'")
        sg = db.rows(c, "SELECT * FROM segments WHERE verify_status='pending'")
        groups = {}
        for s in db.rows(c, "SELECT * FROM stations WHERE alias_group IS NOT NULL"):
            groups.setdefault(s["alias_group"], []).append(s["id"])
        for s in st:
            if s["alias_group"]:
                s["same_name_group"] = groups[s["alias_group"]]
        return {"pending_stations": st, "pending_segments": sg,
                "data_version": db.data_version(c)}

class RouteVersionIn(BaseModel):
    route_key: str
    name_zh: str
    name_en: str
    legs: list[int]
    params: dict | None = None
    note: str | None = None

@app.post("/api/admin/route-versions")
def admin_create_route_version(rv: RouteVersionIn, _auth=Depends(admin_auth)):
    with db.get_db() as c:
        c.execute("UPDATE route_versions SET status='superseded' WHERE route_key=? AND status='current'",
                  (rv.route_key,))
        cur = c.execute(
            """INSERT INTO route_versions(route_key,name_zh,name_en,status,legs_json,params_json,note,created_at)
               VALUES(?,?,?,'current',?,?,?,?)""",
            (rv.route_key, rv.name_zh, rv.name_en, json.dumps(rv.legs),
             json.dumps(rv.params or {}), rv.note, db.now_iso()))
        return {"route_version_id": cur.lastrowid, "data_version": db.data_version(c)}

@app.post("/api/admin/route-versions/{rid}/rollback")
def admin_rollback_route(rid: int, _auth=Depends(admin_auth)):
    """回退：以指定旧版本为母本生成新的 current 版本（历史不丢）。"""
    with db.get_db() as c:
        target = db.row(c, "SELECT * FROM route_versions WHERE id=?", (rid,))
        if not target:
            raise HTTPException(404, "route version not found")
        c.execute("UPDATE route_versions SET status='superseded' WHERE route_key=? AND status='current'",
                  (target["route_key"],))
        cur = c.execute(
            """INSERT INTO route_versions(route_key,name_zh,name_en,status,legs_json,params_json,note,created_at)
               VALUES(?,?,?,'current',?,?,?,?)""",
            (target["route_key"], target["name_zh"], target["name_en"], target["legs_json"],
             target["params_json"], f"回退自版本 #{rid} / rolled back from #{rid}", db.now_iso()))
        return {"route_version_id": cur.lastrowid, "rolled_back_from": rid,
                "data_version": db.data_version(c)}

@app.get("/api/admin/route-versions")
def admin_list_route_versions(_auth=Depends(admin_auth)):
    with db.get_db() as c:
        return {"route_versions": db.rows(c, "SELECT * FROM route_versions ORDER BY id"),
                "data_version": db.data_version(c)}

# ---------- 前端静态资源 ----------
@app.get("/sw.js")
def service_worker():
    return FileResponse(os.path.join(FRONTEND_DIR, "sw.js"), media_type="application/javascript")

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
