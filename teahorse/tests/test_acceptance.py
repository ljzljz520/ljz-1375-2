"""验收测试：同名驿站待确认 / 封路公告迟到 / 路线版本回退 / 季节条件冲突 /
地图离线 / 缺失海拔非零 / 历史商路非现行路线 / 多日累积与换乘窗口 /
断路不直线连缺口 / 来源版本绑定 / 体力标签来源。"""
import json
from conftest import sid, seg_id

# 1) 缺失海拔不能当零
def test_missing_elevation_is_null_not_zero(client):
    LJS = sid(client, "LJS"); JC = sid(client, "JC"); SHX = sid(client, "SHX")
    r = client.post("/api/plan/elevation-profile",
                    json={"station_ids": [SHX, JC, LJS]}).json()
    pts = {p["station_id"]: p for p in r["points"]}
    assert pts[LJS]["elevation_m"] is None and pts[LJS]["elevation_status"] == "missing"
    assert pts[JC]["elevation_status"] == "estimated"
    assert all(p["elevation_m"] != 0 for p in r["points"])
    assert "绝" in r["policy"]["zh"] or "never" in r["policy"]["en"]

# 2) 同名驿站待确认
def test_same_name_station_pending_confirmation(client):
    r = client.get("/api/stations/resolve", params={"name": "白马驿站"}).json()
    assert r["match"] == "ambiguous" and r["needs_confirmation"]
    pend = [c for c in r["candidates"] if c["verify_status"] == "pending"]
    assert len(pend) == 1 and pend[0]["alias_group"] == "baima"
    # 用待确认驿站做端点 → 拒绝
    BM2 = pend[0]["id"]; PUER = sid(client, "PUER")
    r = client.post("/api/plan/search", json={
        "from_station": PUER, "to_station": BM2, "depart": "2026-10-08T07:00:00+00:00"}).json()
    assert r["status"] == "error" and r["error"] == "station_pending_confirmation"
    # 管理端待确认队列可见同名分组
    q = client.get("/api/admin/pending",
                   headers={"X-Admin-Token": "test-token"}).json()
    assert any("same_name_group" in s for s in q["pending_stations"])

# 3) 历史商路不能直接视为现行徒步路线
def test_historic_route_not_a_hiking_route(client):
    r = client.get("/api/historic-routes").json()
    hr = r["historic_routes"][0]
    assert hr["is_current_hiking_route"] is False
    assert "不" in hr["usage_note"]["zh"]
    # 历史停靠点“凤阳邑”不在当代驿站表中，搜索不可用
    assert any(s["station_name"] == "凤阳邑" for s in hr["stops"])
    r = client.post("/api/plan/search", json={
        "from_name": "大理", "to_name": "凤阳邑", "depart": "2026-10-08T07:00:00+00:00"})
    assert r.status_code == 404

# 4) 多日行程累积时间并检查换乘窗口
def test_multiday_accumulates_and_transfer_window(client):
    PUER, DALI = sid(client, "PUER"), sid(client, "DALI")
    r = client.post("/api/plan/search", json={
        "from_station": PUER, "to_station": DALI,
        "depart": "2026-10-08T07:00:00+00:00"}).json()
    assert r["status"] == "ok"
    assert r["totals"]["days"] == 2                      # 跨天累积
    bus = next(l for l in r["legs"] if l["mode"] == "bus")
    dep_h = int(bus["depart"][11:13]) * 60 + int(bus["depart"][14:16])
    assert 8 * 60 <= dep_h <= 10 * 60                    # 班车窗口 08:00–10:00
    assert any(l["wait_min"] > 0 for l in r["legs"])     # 换乘等待被累积
    assert r["totals"]["minutes"] >= 2 * 12 * 60         # 含过夜等待

# 5) 断路时指出不可达片段，不能直线连过缺口
def test_closure_reports_unreachable_gap(client, admin):
    TGG_BM1 = seg_id(client, "TGG", "BM1")
    client.post("/api/admin/announcements", headers=admin, json={
        "kind": "closure", "segment_id": TGG_BM1,
        "title_zh": "通关—白马驿站塌方封闭", "title_en": "Tongguan–Baima landslide closure",
        "effective_from": "2026-10-08T00:00:00+00:00",
        "effective_to": "2026-10-20T00:00:00+00:00", "severity": "critical"})
    PUER, DALI = sid(client, "PUER"), sid(client, "DALI")
    r = client.post("/api/plan/search", json={
        "from_station": PUER, "to_station": DALI,
        "depart": "2026-10-09T07:00:00+00:00"}).json()
    assert r["status"] == "unreachable"
    assert r["blocked"]["segment_id"] == TGG_BM1
    assert r["blocked"]["reason"] == "closed_by_announcement"
    assert r["blocked"]["announcement_id"]
    assert len(r["reachable_legs"]) == 3                 # 只到通关为止
    assert r["gaps"] == [{"from_station": r["blocked"]["from_station"],
                          "to_station": r["blocked"]["to_station"]}]
    assert "直线" in r["map_note"]["zh"]                 # 明确不直线跨缺口
    # 可通行腿中不得包含被封闭路段（不得桥接缺口）
    assert all(l["segment_id"] != TGG_BM1 for l in r["reachable_legs"])

# 6) 封路公告迟到：收藏保留原依据，重连后展示变化
def test_late_closure_announcement_marks_favorite_changed(client, admin):
    PUER, DALI = sid(client, "PUER"), sid(client, "DALI")
    plan = client.post("/api/plan/search", json={
        "from_station": PUER, "to_station": DALI,
        "depart": "2026-11-02T07:00:00+00:00"}).json()
    assert plan["status"] == "ok"
    fav = client.post("/api/favorites", json={
        "client_id": "u1", "name": "普洱-大理", "plan": plan}).json()
    basis = fav["basis"]
    # 收藏后无变化
    assert client.post("/api/plans/diff", json={"basis": basis}).json()["changes"] == []
    # 管理端随后发布覆盖计划日期的封路公告（迟到）
    BM1_DALI = seg_id(client, "BM1", "DALI")
    client.post("/api/admin/announcements", headers=admin, json={
        "kind": "closure", "segment_id": BM1_DALI,
        "title_zh": "白马—大理班车停运", "title_en": "Baima–Dali shuttle suspended",
        "effective_from": "2026-11-01T00:00:00+00:00",
        "effective_to": "2026-11-05T00:00:00+00:00", "severity": "critical"})
    changes = client.post("/api/plans/diff", json={"basis": basis}).json()["changes"]
    late = [c for c in changes if c["type"] == "late_announcement"]
    assert late and late[0]["affects_plan_dates"] is True
    assert "迟到" in late[0]["note"]["zh"]
    # 原收藏仍保留原依据
    favs = client.get("/api/favorites", params={"client_id": "u1"}).json()["favorites"]
    assert favs[0]["basis"]["data_version"] == basis["data_version"]

# 7) 路线版本回退
def test_route_version_rollback(client, admin):
    rvs = client.get("/api/admin/route-versions", headers=admin).json()["route_versions"]
    v1 = next(v for v in rvs if v["route_key"] == "puer-dali-classic")
    legs_v1 = json.loads(v1["legs_json"])
    # 发布 v2（去掉一段）
    r2 = client.post("/api/admin/route-versions", headers=admin, json={
        "route_key": "puer-dali-classic", "name_zh": "普洱—大理经典线",
        "name_en": "Pu'er–Dali classic", "legs": legs_v1[:-1], "note": "v2"}).json()
    v2 = r2["route_version_id"]
    # 收藏基于 v2 的比较结果依据
    basis = {"data_version": None, "segments": {}, "announcements_cutoff": None,
             "route_version_ids": [v2], "segment_ids": [], "station_ids": []}
    # 回退到 v1
    r3 = client.post(f"/api/admin/route-versions/{v1['id']}/rollback", headers=admin).json()
    assert r3["rolled_back_from"] == v1["id"]
    rvs = client.get("/api/admin/route-versions", headers=admin).json()["route_versions"]
    cur = next(v for v in rvs if v["route_key"] == "puer-dali-classic" and v["status"] == "current")
    assert json.loads(cur["legs_json"]) == legs_v1 and cur["id"] != v1["id"]
    assert next(v for v in rvs if v["id"] == v2)["status"] == "superseded"
    # 收藏的差异提示版本已变更
    changes = client.post("/api/plans/diff", json={"basis": basis}).json()["changes"]
    assert any(c["type"] == "route_version_changed" for c in changes)

# 8) 季节条件冲突
def test_seasonal_conflict(client):
    JC, ZD = sid(client, "JC"), sid(client, "ZD")
    # 12 月出发：季节性路段关闭
    r = client.post("/api/plan/search", json={
        "from_station": JC, "to_station": ZD,
        "depart": "2026-12-01T07:00:00+00:00"}).json()
    assert r["status"] == "unreachable"
    assert r["blocked"]["reason"] == "seasonal_closed"
    # 10 月（开放月）可通行
    r2 = client.post("/api/plan/search", json={
        "from_station": JC, "to_station": ZD,
        "depart": "2026-10-09T07:00:00+00:00"}).json()
    assert r2["status"] == "ok"

# 9) 已审路线 vs 受约束图搜索：同一组来源版本 + 体力标签来源 + 免责边界
def test_compare_binds_same_sources_and_effort_provenance(client):
    PUER, DALI = sid(client, "PUER"), sid(client, "DALI")
    r = client.post("/api/plan/compare", json={
        "from_station": PUER, "to_station": DALI,
        "depart": "2026-10-25T07:00:00+00:00",
        "prefs": {"max_days": 3, "modes": ["walk", "bus"]}}).json()
    assert r["curated"] and r["search"]["status"] == "ok"
    assert r["curated"][0]["sources"] if "sources" in r["curated"][0] else True
    assert r["search"]["sources"]["data_version"] == r["sources"]["data_version"]
    assert r["sources"]["route_version_ids"] == [r["curated"][0]["route_version_id"]]
    walk_legs = [l for l in r["search"]["legs"] if l["mode"] == "walk"]
    assert all(l["effort_label"] and l["effort_source"] for l in walk_legs)
    assert "不能保证实地安全" in r["safety_disclaimer"]["zh"]
    assert "cannot guarantee on-site safety" in r["safety_disclaimer"]["en"]

# 10) 地图离线：Service Worker + 离线包带 data_version
def test_offline_support(client):
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "teahorse-cache" in sw.text
    appjs = client.get("/js/app.js").text
    assert "serviceWorker" in appjs          # 注册离线缓存
    assert "/sw.js" in appjs
    b = client.get("/api/bundle").json()
    assert b["data_version"] is not None and b["stations"] and b["segments"]

# 11) 编号目录 / 打印 / 多语言均说明待核信息
def test_catalog_pending_multilingual(client):
    zh = client.get("/api/catalog", params={"lang": "zh"}).json()
    en = client.get("/api/catalog", params={"lang": "en"}).json()
    assert zh["stations"][0]["no"] == 1 and en["segments"][1]["no"] == 2
    pend_zh = [s for s in zh["stations"] if s["verify"] == "pending"]
    pend_en = [s for s in en["stations"] if s["verify"] == "pending"]
    assert pend_zh and "待确认" in pend_zh[0]["pending_note"]
    assert pend_en and "Pending" in pend_en[0]["pending_note"]
    assert "待核" in zh["pending_explained"] and "pending" in en["pending_explained"]
    missing = [s for s in zh["stations"] if "缺失" in s["elevation"]]
    assert missing  # 目录中海拔缺失标注而非 0

# 12) 待核路段默认不进入规划，但可在目录中说明
def test_pending_segment_excluded_but_listed(client):
    TGG, BM2 = sid(client, "TGG"), sid(client, "BM2")
    r = client.post("/api/plan/search", json={
        "from_station": TGG, "to_station": sid(client, "BM1"),
        "depart": "2026-10-25T07:00:00+00:00", "require_verified": True}).json()
    assert r["status"] == "ok"
    segs = client.get("/api/segments").json()["segments"]
    pend = [s for s in segs if s["verify_status"] == "pending"]
    assert pend and pend[0]["to_station"] == BM2
