# 茶马古道资料站 (Tea Horse Road Archive)

访客查看驿站与高程剖面；管理端维护已核对的相邻路段、交通窗口与公告；
后端将**历史叙事**与**当代通行信息**分表存储。

## 运行

```bash
./run.sh            # 开发服务器 http://localhost:8000 （访客页 /）
python3 -m pytest tests/ -q   # 12 项验收测试
```

- 访客页 `/index.html`：驿站（同名待确认提示）、高程剖面、路线规划、方案比较、收藏、历史商路、公告
- 管理端 `/admin.html`：待确认队列、路段核实、交通窗口、发布公告、路线版本回退（令牌 `ADMIN_TOKEN`，默认 `admin-dev-token`）
- 编号目录 `/catalog.html`：编号、可打印、中/英双语，均说明待核信息

## 关键设计

| 需求 | 实现 |
|---|---|
| 路线图含方向/时长/窗口 | `segments` 为有向边；`segment_windows` 支持每日时刻窗（班车）与日期区间 |
| 缺失海拔不能当零 | `elevation_m` 保持 NULL；剖面接口返回 `null` 并留空断线（`elevation_status: missing/estimated`） |
| 历史商路 ≠ 现行徒步路线 | `historic_routes` 独立存储，接口标注 `is_current_hiking_route=false`，规划器只读 `segments` |
| 已审路线 vs 受约束图搜索 | `POST /api/plan/compare` 同响应返回两者，绑定同一 `sources`（data_version + 路段版本 + 公告截点） |
| 体力标签来源与算法边界 | 每段 `effort_label` + `effort_source`；所有计划附双语免责：算法不能保证实地安全 |
| 多日累积 + 换乘窗口 | 时间依赖 Dijkstra：等待/过夜累积计时，班车只能在每日窗口内发车；单段等待超 24h（可调 `max_wait_hours`）视为断路 |
| 断路不直线跨缺口 | 搜索失败时沿结构参考路径诊断，返回 `blocked`（原因/公告）、`reachable_legs`、`gaps`；前端以 ✕ 标注缺口而非连线 |
| 同名驿站待确认 | `alias_group` 分组 + `verify_status=pending`；`/api/stations/resolve` 返回歧义候选；待确认驿站不能作为已核规划端点 |
| 封路公告迟到 | `published_at`（微秒）与 `effective_from` 分离；收藏保存 `basis`（来源版本快照），重连后 `POST /api/plans/diff` 列出迟到公告/路段更新/版本变更 |
| 路线版本回退 | 回退 = 以旧版本为母本生成新的 `current` 版本，历史保留为 `superseded` |
| 季节条件冲突 | `seasonal_months` 关闭月份内搜索报 `seasonal_closed`；已审路线模拟时列入 `conflicts` |
| 地图离线 | `sw.js` 缓存应用外壳与最近数据；`/api/bundle` 离线包带 `data_version`，重连后比对 |
| 来源版本绑定 | 每次变更推进全局 `data_version` 与实体版本；计算结果与页面标注共用同一 `sources` |

## API 摘要

- 访客：`GET /api/stations` `/api/stations/resolve` `/api/segments` `/api/announcements` `/api/historic-routes`；
  `POST /api/plan/search` `/api/plan/compare` `/api/plan/elevation-profile`；
  `POST /api/favorites` `POST /api/plans/diff`；`GET /api/catalog` `/api/bundle` `/api/meta`
- 管理（`X-Admin-Token`）：`GET /api/admin/pending`；`POST /api/admin/segments[/…/verify|/…/windows]`；
  `POST /api/admin/announcements`；`POST /api/admin/route-versions[/{id}/rollback]`；
  `POST /api/admin/stations/{id}/verify`

## 验收场景 → 测试

`tests/test_acceptance.py`：同名驿站待确认、封路公告迟到、路线版本回退、
季节条件冲突、地图离线、缺失海拔非零、历史商路非现行路线、多日换乘窗口、
断路缺口不连线、来源版本绑定、目录多语言待核说明、待核路段默认不入规划。
