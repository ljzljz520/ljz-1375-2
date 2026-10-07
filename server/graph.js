// 受约束图搜索（时间依赖图）
// 节点=驿站；边=已核对(verified+reviewed) 的“相邻路段”。无边即无路——绝不按经纬度直线补边。
// 边带方向、移动时长、季节/公告窗口；班车按班期发车并检查换乘窗口；步行/混合按每日体力上限跨日累计。
import { toMinutes, fmtAbs } from './util.js';

export const DAY_START = 8 * 60; // 每日 08:00 开始计程

export function monthOf(dateISO) {
  return Number(String(dateISO).slice(5, 7));
}

// 某“相邻路段”在给定日期是否可用（历史叙事不参与本判断）
export function segmentStatusAt(seg, dateISO, data) {
  const month = monthOf(dateISO);
  if (!seg.reviewed || seg.status !== 'verified') {
    return { open: false, reason: 'unverified', reasonText: '路段未经核对，不纳入通行图' };
  }
  if (seg.window?.seasonal?.months && !seg.window.seasonal.months.includes(month)) {
    return { open: false, reason: 'season', reasonText: `${month} 月不在已核对季节窗口内` };
  }
  for (const a of data.announcements.filter((x) => x.segmentId === seg.id)) {
    const inside = inRange(dateISO, a.effectiveFrom, a.effectiveTo);
    if (!inside) continue;
    if (a.kind === 'closure') {
      return {
        open: false, reason: 'closure',
        reasonText: `公告 ${a.id} 封闭：${a.effectiveFrom} 至 ${a.effectiveTo}`,
        announcementId: a.id, latePublished: !!a.latePublished
      };
    }
    if (a.conflictsWithSeason && seg.window?.seasonal?.months && !seg.window.seasonal.months.includes(month)) {
      return {
        open: false, reason: 'season-conflict',
        reasonText: `公告 ${a.id} 声称开放，但与已核对季节窗口冲突；季节窗口优先（保守封闭），待核。`,
        announcementId: a.id, conflicts: [{ announcementId: a.id, text: a.title }]
      };
    }
  }
  const advisories = data.announcements
    .filter((x) => x.segmentId === seg.id && inRange(dateISO, x.effectiveFrom, x.effectiveTo) && x.kind === 'advisory')
    .map((x) => ({ announcementId: x.id, title: x.title, latePublished: !!x.latePublished }));
  return { open: true, reason: 'open', advisories };
}

export function buildOpenGraph(data, dateISO) {
  const adj = new Map();
  const statuses = new Map();
  const add = (a, b, seg, st) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, segmentId: seg.id });
    statuses.set(seg.id, st);
  };
  for (const seg of data.segments) {
    const st = segmentStatusAt(seg, dateISO, data);
    if (!st.open) continue;
    if (seg.direction === 'bidirectional') { add(seg.from, seg.to, seg, st); add(seg.to, seg.from, seg, st); }
    else if (seg.direction === 'northbound') add(seg.from, seg.to, seg, st);
    else if (seg.direction === 'southbound') add(seg.to, seg.from, seg, st);
  }
  return { adj, statuses };
}

function nextDeparture(readyAbs, hhmmList) {
  const day = Math.floor(readyAbs / 1440);
  const tod = readyAbs % 1440;
  const times = hhmmList.map(toMinutes).sort((a, b) => a - b);
  for (const t of times) if (t >= tod) return { depAbs: day * 1440 + t };
  return { depAbs: (day + 1) * 1440 + times[0] };
}
function nextDayStart(abs) {
  return (Math.floor(abs / 1440) + 1) * 1440 + DAY_START;
}
function monthAtAbs(abs, dateISO) {
  const base = new Date(dateISO + 'T00:00:00Z').getTime();
  return new Date(base + Math.floor(abs / 1440) * 86400000).getUTCMonth() + 1;
}

// 遍历一条边，输出到达时刻 + 统一 spans（travel/wait/rest），跨日累计
function traverse(seg, cursor, data, dailyCap) {
  const allowed = seg.window?.seasonal?.months;
  const monthOk = (abs) => !allowed || allowed.includes(monthAtAbs(abs, cursor.date));
  const spans = [];

  if (seg.mode === 'bus') {
    const tr = data.transports.find((t) => t.segmentId === seg.id);
    if (!tr) return { blocked: true, reasonText: '缺少班期数据' };
    const required = cursor.isOrigin ? 0 : (tr.minTransferMinutes || 0);
    const ready = cursor.abs + required;
    let { depAbs } = nextDeparture(ready, tr.departures);
    if (allowed && !allowed.includes(monthAtAbs(depAbs, cursor.date))) {
      return { blocked: true, reasonText: '最近班期不在季节窗口内' };
    }
    if (depAbs > cursor.abs) {
      spans.push({ kind: 'wait', fromAbs: cursor.abs, toAbs: depAbs, schedule: tr.name,
        transfer: !cursor.isOrigin ? { requiredMinutes: required, actualMinutes: depAbs - cursor.abs, windowMet: depAbs - cursor.abs >= required } : undefined });
    }
    const arrAbs = depAbs + seg.baseMinutes;
    spans.push({ kind: 'travel', fromAbs: depAbs, toAbs: arrAbs });
    return { arrAbs, activeToday: cursor.activeToday, spans };
  }

  // foot / mixed
  let abs = cursor.abs, active = cursor.activeToday, remain = seg.baseMinutes;
  if (!monthOk(abs)) return { blocked: true, reasonText: '出发日不在季节窗口内' };
  while (remain > 0) {
    let capLeft = dailyCap - active;
    if (capLeft <= 0) {
      const to = nextDayStart(abs);
      spans.push({ kind: 'rest', fromAbs: abs, toAbs: to });
      abs = to; active = 0; capLeft = dailyCap;
      if (!monthOk(abs)) return { blocked: true, reasonText: '行程延续进入封闭月份' };
      continue;
    }
    const chunk = Math.min(remain, capLeft);
    spans.push({ kind: 'travel', fromAbs: abs, toAbs: abs + chunk });
    abs += chunk; active += chunk; remain -= chunk;
    if (remain > 0) {
      const to = nextDayStart(abs);
      spans.push({ kind: 'rest', fromAbs: abs, toAbs: to });
      abs = to; active = 0;
      if (!monthOk(abs)) return { blocked: true, reasonText: '行程延续进入封闭月份' };
    }
  }
  return { arrAbs: abs, activeToday: active, spans };
}

export function search(data, opts) {
  const date = opts.date;
  const startClock = opts.startClock ?? DAY_START;
  const dailyCap = opts.dailyCapMinutes ?? 480;
  const modes = new Set(opts.modes || ['foot', 'bus', 'mixed']);
  const { adj, statuses } = buildOpenGraph(data, date);

  const make = (station, abs, activeToday, day) => ({ station, abs, activeToday, day, date });
  const labels = new Map([[opts.from, [make(opts.from, startClock, 0, 0)]]]);
  const pq = [labels.get(opts.from)[0]];
  let best = null;
  const dominates = (a, b) => a !== b && a.abs <= b.abs && a.activeToday <= b.activeToday;

  while (pq.length) {
    pq.sort((a, b) => a.abs - b.abs);
    const cur = pq.shift();
    if (cur.station === opts.to) { best = cur; break; }
    for (const e of adj.get(cur.station) || []) {
      const seg = data.segments.find((s) => s.id === e.segmentId);
      if (!modes.has(seg.mode)) continue;
      const out = traverse(seg, { ...cur, isOrigin: false }, data, dailyCap);
      if (!out || out.blocked) continue;
      const nl = make(e.to, out.arrAbs, out.activeToday, Math.floor(out.arrAbs / 1440));
      nl.prev = cur; nl.segmentId = seg.id; nl.spans = out.spans;
      const arr = labels.get(e.to) || [];
      if (arr.some((l) => dominates(l, nl))) continue;
      labels.set(e.to, [...arr.filter((l) => !dominates(nl, l)), nl]);
      pq.push(nl);
    }
  }

  if (!best) {
    return { reachable: false, date, modes: [...modes], ...findGaps(data, opts.from, opts.to, date, modes) };
  }
  const segChain = [];
  const spanChain = [];
  let node = best;
  while (node.prev) {
    segChain.unshift(node.segmentId);
    spanChain.unshift(node.spans);
    node = node.prev;
  }
  const legs = segChain.map((id) => {
    const seg = data.segments.find((s) => s.id === id);
    return {
      segmentId: seg.id, from: seg.from, to: seg.to, mode: seg.mode,
      direction: seg.direction, distanceKm: seg.distanceKm, minutes: seg.baseMinutes,
      window: seg.window, sources: seg.sources,
      status: statuses.get(seg.id)
    };
  });
  const itinerary = buildItinerary(legs, spanChain, date);
  return {
    reachable: true, from: opts.from, to: opts.to, date, startClock, dailyCapMinutes: dailyCap,
    legs, itinerary,
    totalMinutes: best.abs - startClock,
    arrival: fmtAbs(best.abs),
    totalDays: best.day + 1
  };
}

// 把 span 时间轴切成逐日行程
function buildItinerary(legs, spanChain, date) {
  const flat = [];
  legs.forEach((leg, i) => spanChain[i].forEach((sp) => flat.push({ ...sp, segmentId: leg.segmentId })));
  const days = new Map();
  for (const sp of flat) {
    let cur = sp.fromAbs;
    while (cur < sp.toAbs) {
      const d = Math.floor(cur / 1440);
      const end = Math.min(sp.toAbs, (d + 1) * 1440);
      if (!days.has(d)) days.set(d, []);
      days.get(d).push({ kind: sp.kind, segmentId: sp.segmentId,
        fromAbs: cur, toAbs: end,
        from: fmtAbs(cur), to: fmtAbs(end),
        transfer: sp.transfer, schedule: sp.schedule });
      cur = end;
    }
  }
  const byDay = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([d, entries]) => {
    const travel = entries.filter((e) => e.kind === 'travel');
    const active = travel.reduce((s, e) => s + (e.toAbs - e.fromAbs), 0);
    return {
      day: d + 1, date: addDays(date, d),
      activeMinutes: active,
      entries: entries.map((e) => ({ ...e, durationMinutes: e.toAbs - e.fromAbs }))
    };
  });
  const transfers = flat.filter((s) => s.transfer).map((s) => ({
    segmentId: s.segmentId, ...s.transfer, at: fmtAbs(s.toAbs)
  }));
  return { days: byDay, transfers };
}

function addDays(dateISO, n) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 断路/缺口分析：不生成任何“直线捷径”
export function findGaps(data, fromId, toId, date, modes) {
  const { adj, statuses } = buildOpenGraph(data, date);
  const reachable = new Set([fromId]);
  const q = [fromId];
  while (q.length) {
    const s = q.shift();
    for (const e of adj.get(s) || []) {
      if (modes && !modes.has(data.segments.find((x) => x.id === e.segmentId).mode)) continue;
      if (!reachable.has(e.to)) { reachable.add(e.to); q.push(e.to); }
    }
  }
  const name = (id) => data.stations.find((s) => s.id === id)?.name || id;

  const blockingEdges = [];
  for (const seg of data.segments) {
    const atFrontier = reachable.has(seg.from) || reachable.has(seg.to);
    if (!atFrontier) continue;
    const st = statuses.get(seg.id) || segmentStatusAt(seg, date, data);
    if (st.open) continue;
    blockingEdges.push({
      segmentId: seg.id, from: seg.from, to: seg.to,
      fromName: name(seg.from), toName: name(seg.to),
      reason: st.reason, reasonText: st.reasonText,
      latePublished: !!st.latePublished,
      anchorsReachableFrontier: true
    });
  }
  const historicalOnly = [];
  const hasModern = (a, b) => data.segments.some((s) =>
    (s.from === a && s.to === b) || (s.from === b && s.to === a));
  for (const h of data.historicalTrails) {
    for (let i = 0; i < h.stationRefs.length - 1; i++) {
      const a = h.stationRefs[i], b = h.stationRefs[i + 1];
      if (!hasModern(a, b)) {
        historicalOnly.push({
          from: a, to: b, fromName: name(a), toName: name(b), viaHistorical: h.id,
          note: '仅见于历史叙事，当代无已核对相邻路段，不能据此通行，也不绘制为路线连线。'
        });
      }
    }
  }
  return {
    reachableStations: [...reachable],
    targetReachable: reachable.has(toId),
    unreachableSegment: toId ? {
      target: toId, targetName: name(toId),
      note: `终点 ${name(toId)} 在该日期/模式约束下不可达；阻断片段列示如下，系统不会用直线跨越缺口。`
    } : null,
    blockingEdges,
    historicalOnlyGaps: historicalOnly
  };
}

function inRange(d, from, to) {
  return (!from || d >= from) && (!to || d <= to);
}
