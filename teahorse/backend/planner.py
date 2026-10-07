"""受约束图搜索（含方向/时长/可用窗口/换乘窗口）、多日时间累积、
不可达片段诊断（不以直线跨越缺口）、高程剖面（缺失海拔绝不当 0）。"""
from __future__ import annotations
import json, heapq
from collections import defaultdict
from datetime import datetime, timedelta, timezone

WALK_DEPART_MIN = 6 * 60          # 徒步最早出发 06:00
WALK_DEPART_MAX = 19 * 60         # 徒步最晚出发 19:00
SEARCH_HORIZON_DAYS = 45          # 搜索视界
MAX_WAIT_HOURS_DEFAULT = 24       # 单段最长可接受等待（超过即视为断路，不静默等待）

EFFORT_RANK = {"轻松": 1, "中等": 2, "偏高": 3, "高强度": 4}

DISCLAIMER = {
    "zh": "体力标签来自各段标注的来源（effort_source），仅供参考；"
          "算法结果不能保证实地安全，出行前请向当地管理方核实。",
    "en": "Effort labels come from the cited sources (effort_source of each leg) and are "
          "indicative only; algorithmic results cannot guarantee on-site safety. "
          "Verify with local authorities before travel.",
}
GAP_NOTE = {
    "zh": "存在不可达缺口：地图不会以直线连接缺口，请查看不可达片段说明。",
    "en": "Unreachable gap detected: the map does not bridge gaps with straight lines; "
          "see unreachable-segment details.",
}
MISSING_ELEV_POLICY = {
    "zh": "缺失海拔以 null 表示并留空，绝不按 0 绘制。",
    "en": "Missing elevation is null and left blank, never plotted as 0.",
}

def parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")

def _hhmm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)

def _combine(day, hhmm: str) -> datetime:
    h, m = _hhmm(hhmm)
    return datetime(day.year, day.month, day.day, h, m, tzinfo=timezone.utc)

def month_open(seg: dict, dt: datetime) -> bool:
    if not seg.get("seasonal_months"):
        return True
    return dt.month in json.loads(seg["seasonal_months"])

# ---------- 数据装载 ----------
def load_graph(conn):
    segs = conn.execute("SELECT * FROM segments").fetchall()
    segs = [dict(s) for s in segs]
    wins = defaultdict(list)
    for w in conn.execute("SELECT * FROM segment_windows").fetchall():
        wins[w["segment_id"]].append(dict(w))
    anns = [dict(a) for a in conn.execute(
        "SELECT * FROM announcements WHERE kind='closure'").fetchall()]
    stations = {s["id"]: dict(s) for s in conn.execute("SELECT * FROM stations").fetchall()}
    return segs, wins, anns, stations

# ---------- 时间窗 ----------
def _fit_daily_open(cand: datetime, opens: list[dict]) -> datetime | None:
    for d in range(SEARCH_HORIZON_DAYS):
        day = (cand + timedelta(days=d)).date()
        for w in sorted(opens, key=lambda x: x["start_hhmm"]):
            start, end = _combine(day, w["start_hhmm"]), _combine(day, w["end_hhmm"])
            dep = max(cand, start)
            if dep <= end:
                return dep
    return None

def _fit_walk_hours(dep: datetime) -> datetime:
    mins = dep.hour * 60 + dep.minute
    if mins < WALK_DEPART_MIN:
        return dep.replace(hour=6, minute=0)
    if mins > WALK_DEPART_MAX:
        return (dep + timedelta(days=1)).replace(hour=6, minute=0)
    return dep

def _blocked_until(seg, windows, anns, dep, arr):
    """返回阻塞结束时间；'indefinite' 表示无限期封路；None 表示未阻塞。"""
    end = None
    for w in windows:
        if w["effect"] != "closed":
            continue
        if w["kind"] == "range":
            ws, we = parse_dt(w["date_start"]), parse_dt(w["date_end"])
            if ws < arr and we > dep:
                end = we if end is None else max(end, we)
        else:
            for d in range((arr.date() - dep.date()).days + 1):
                day = dep.date() + timedelta(days=d)
                ws, we = _combine(day, w["start_hhmm"]), _combine(day, w["end_hhmm"])
                if ws < arr and we > dep:
                    end = we if end is None else max(end, we)
    for a in anns:
        if a["segment_id"] != seg["id"]:
            continue
        af = parse_dt(a["effective_from"])
        at = parse_dt(a["effective_to"]) if a["effective_to"] else None
        if af < arr and (at is None or at > dep):
            if at is None:
                return "indefinite"
            end = at if end is None else max(end, at)
    return end

def next_departure(seg, windows, anns, t: datetime) -> datetime | None:
    """在 t 之后（含）该路段可通行的最早出发时刻；考虑季节、每日窗、封路、徒步时段。"""
    dur = timedelta(minutes=seg["duration_min"])
    cand = t
    for _ in range(SEARCH_HORIZON_DAYS * 6):
        if not month_open(seg, cand):
            cand = (cand + timedelta(days=1)).replace(hour=6, minute=0)
            continue
        dep = cand
        opens = [w for w in windows if w["kind"] == "daily" and w["effect"] == "open"]
        if opens:
            dep = _fit_daily_open(cand, opens)
            if dep is None:
                return None
        if seg["mode"] == "walk":
            dep2 = _fit_walk_hours(dep)
            if dep2 != dep:
                cand = dep2
                continue
        blk = _blocked_until(seg, windows, anns, dep, dep + dur)
        if blk == "indefinite":
            return None
        if blk is not None:
            cand = blk
            continue
        return dep
    return None

# ---------- 主搜索 ----------
def search(conn, from_id: int, to_id: int, depart: datetime,
           modes=None, require_verified=True, max_days=None, max_effort=None,
           max_wait_hours=None):
    modes = modes or ["walk", "bus", "mule"]
    max_wait = timedelta(hours=max_wait_hours if max_wait_hours is not None
                         else MAX_WAIT_HOURS_DEFAULT)
    segs, wins, anns, stations = load_graph(conn)
    for sid in (from_id, to_id):
        st = stations.get(sid)
        if st is None:
            return {"status": "error", "error": "unknown_station", "station_id": sid}
        if require_verified and st["verify_status"] != "verified":
            return {"status": "error", "error": "station_pending_confirmation",
                    "station": st}
    effort_cap = EFFORT_RANK.get(max_effort) if max_effort else None

    def allowed(e):
        if e["mode"] not in modes:
            return False
        if require_verified and e["verify_status"] != "verified":
            return False
        if effort_cap is not None and e["effort_label"] in EFFORT_RANK \
                and EFFORT_RANK[e["effort_label"]] > effort_cap:
            return False
        return True

    adj = defaultdict(list)
    for e in segs:
        if allowed(e):
            adj[e["from_station"]].append(e)

    dist = {from_id: depart}
    prev = {}
    pq = [(depart, from_id)]
    while pq:
        t, u = heapq.heappop(pq)
        if t != dist[u]:
            continue
        if u == to_id:
            break
        for e in adj[u]:
            dep = next_departure(e, wins[e["id"]], anns, t)
            if dep is None or dep - t > max_wait:   # 等待超限 = 断路，不静默顺延
                continue
            arr = dep + timedelta(minutes=e["duration_min"])
            if max_days and (arr.date() - depart.date()).days + 1 > max_days:
                continue
            if e["to_station"] not in dist or arr < dist[e["to_station"]]:
                dist[e["to_station"]] = arr
                prev[e["to_station"]] = (u, e, dep, arr)
                heapq.heappush(pq, (arr, e["to_station"]))
    if to_id not in dist:
        return unreachable(conn, from_id, to_id, depart, segs, wins, anns,
                           stations, modes, require_verified, max_wait)
    legs, node = [], to_id
    while node != from_id:
        u, e, dep, arr = prev[node]
        legs.append(_leg(e, dep, arr, stations))
        node = u
    legs.reverse()
    for i in range(1, len(legs)):  # 换乘等待（窗口等待也累积进总时长）
        legs[i]["wait_min"] = int((parse_dt(legs[i]["depart"])
                                   - parse_dt(legs[i - 1]["arrive"])).total_seconds() // 60)
    legs[0]["wait_min"] = 0
    arrive = dist[to_id]
    return {
        "status": "ok",
        "legs": legs,
        "totals": {
            "minutes": int((arrive - depart).total_seconds() // 60),
            "days": (arrive.date() - depart.date()).days + 1,   # 多日累积
            "distance_km": _sum_distance(legs),
        },
        "depart": iso(depart), "arrive": iso(arrive),
        "effort_note": DISCLAIMER, "safety_disclaimer": DISCLAIMER,
    }

def _leg(e, dep, arr, stations):
    return {
        "segment_id": e["id"], "version": e["version"],
        "from_station": e["from_station"], "to_station": e["to_station"],
        "from_name": stations[e["from_station"]]["name_zh"],
        "to_name": stations[e["to_station"]]["name_zh"],
        "mode": e["mode"], "duration_min": e["duration_min"],
        "distance_km": e["distance_km"],
        "depart": iso(dep), "arrive": iso(arr),
        "effort_label": e["effort_label"], "effort_source": e["effort_source"],
        "verify_status": e["verify_status"],
    }

def _sum_distance(legs):
    if any(l["distance_km"] is None for l in legs):
        return None
    return round(sum(l["distance_km"] for l in legs), 2)

# ---------- 不可达诊断 ----------
def unreachable(conn, from_id, to_id, depart, segs, wins, anns, stations,
                modes, require_verified, max_wait=None):
    max_wait = max_wait or timedelta(hours=MAX_WAIT_HOURS_DEFAULT)
    # 结构参考路径（忽略时间/封闭，仅看连通性），用于定位缺口
    adj = defaultdict(list)
    for e in segs:
        if e["mode"] in modes:
            adj[e["from_station"]].append(e)
    prev, queue, seen = {}, [from_id], {from_id}
    while queue:
        u = queue.pop(0)
        if u == to_id:
            break
        for e in adj[u]:
            if e["to_station"] not in seen:
                seen.add(e["to_station"])
                prev[e["to_station"]] = (u, e)
                queue.append(e["to_station"])
    if to_id not in prev and to_id != from_id:
        return {"status": "unreachable", "reason": "no_structural_route",
                "gaps": [], "map_note": GAP_NOTE}
    ref, node = [], to_id
    while node != from_id:
        u, e = prev[node]
        ref.append(e)
        node = u
    ref.reverse()
    # 沿参考路径按真实约束推进，首个无法出发的边即缺口
    t, legs_done = depart, []
    blocked = None
    for e in ref:
        if require_verified and e["verify_status"] != "verified":
            blocked = (e, "pending_verification", None)
            break
        dep = next_departure(e, wins[e["id"]], anns, t)
        if dep is None or dep - t > max_wait:
            reason, ann = _diagnose(e, wins[e["id"]], anns, t)
            blocked = (e, reason, ann)
            break
        arr = dep + timedelta(minutes=e["duration_min"])
        legs_done.append(_leg(e, dep, arr, stations))
        t = arr
    if blocked is None:  # 理论上不会发生（主搜索已失败）
        e, blocked = ref[-1], (ref[-1], "unavailable", None)
    be, reason, ann = blocked
    bi = ref.index(be)
    remaining = [{"from_station": x["from_station"], "to_station": x["to_station"],
                  "from_name": stations[x["from_station"]]["name_zh"],
                  "to_name": stations[x["to_station"]]["name_zh"],
                  "state": "unevaluated"} for x in ref[bi + 1:]]
    return {
        "status": "unreachable",
        "reachable_legs": legs_done,
        "blocked": {
            "segment_id": be["id"], "from_station": be["from_station"],
            "to_station": be["to_station"],
            "from_name": stations[be["from_station"]]["name_zh"],
            "to_name": stations[be["to_station"]]["name_zh"],
            "reason": reason,
            "announcement_id": ann["id"] if ann else None,
            "announcement_title": (ann or {}).get("title_zh"),
        },
        "gaps": [{"from_station": be["from_station"], "to_station": be["to_station"]}],
        "remaining": remaining,
        "map_note": GAP_NOTE,
    }

def _diagnose(e, windows, anns, t):
    if not month_open(e, t):
        return "seasonal_closed", None
    dur = timedelta(minutes=e["duration_min"])
    for a in anns:
        if a["segment_id"] != e["id"]:
            continue
        af = parse_dt(a["effective_from"])
        at = parse_dt(a["effective_to"]) if a["effective_to"] else None
        if af < t + dur and (at is None or at > t):
            return "closed_by_announcement", a
    opens = [w for w in windows if w["kind"] == "daily" and w["effect"] == "open"]
    if opens:
        return "no_window_in_horizon", None
    return "unavailable", None

# ---------- 高程剖面 ----------
def elevation_profile(conn, station_ids, segment_ids=None):
    stations = {s["id"]: dict(s) for s in conn.execute("SELECT * FROM stations").fetchall()}
    segmap = {s["id"]: dict(s) for s in conn.execute("SELECT * FROM segments").fetchall()}
    points, km, km_known = [], 0.0, True
    for i, sid in enumerate(station_ids):
        st = stations.get(sid)
        if st is None:
            return {"status": "error", "error": "unknown_station", "station_id": sid}
        if i > 0 and segment_ids:
            seg = segmap.get(segment_ids[i - 1])
            d = seg["distance_km"] if seg else None
            if d is None:
                km_known = False
            elif km_known:
                km += d
        points.append({
            "station_id": sid, "name_zh": st["name_zh"], "name_en": st["name_en"],
            "elevation_m": st["elevation_m"],          # 缺失保持 None，绝不为 0
            "elevation_status": st["elevation_status"],
            "km": round(km, 2) if km_known else None,
        })
    return {"status": "ok", "points": points, "policy": MISSING_ELEV_POLICY}
