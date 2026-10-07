/* 茶马古道资料站前端（无框架） */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  lang: localStorage.getItem('lang') || 'zh',
  i18n: {}, fv: null,
  stations: [], segments: [], transports: [], announcements: [], history: [], routes: [],
  selectedStation: null, searchResult: null,
  offline: !navigator.onLine
};
const L = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), state.i18n) ?? key;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadLocale() {
  const res = await fetch(`/locales/${state.lang}.json`);
  state.i18n = await res.json();
  document.documentElement.lang = state.lang === 'zh' ? 'zh' : 'en';
}

// —— 带离线缓存的取数：服务器结果与 sourceVersion 绑定，离线时显示缓存并标注 ——
const LS = 'tmr.cache.v1';
function readCache() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function writeCache(c) { localStorage.setItem(LS, JSON.stringify(c)); }
async function api(path, opts = {}) {
  const cache = readCache();
  try {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    cache[path + (opts.body || '')] = { json, at: Date.now() };
    writeCache(cache);
    state.offline = false; updateNet();
    return json;
  } catch (e) {
    const hit = cache[path + (opts.body ? JSON.stringify(opts.body) : '')];
    state.offline = true; updateNet();
    if (hit) return { ...hit.json, __offline: true, __cachedAt: new Date(hit.at).toLocaleString() };
    throw e;
  }
}
function updateNet() {
  const b = $('#netBadge');
  b.textContent = state.offline ? L('offline') : L('online');
  b.className = 'badge ' + (state.offline ? 'offline' : 'online');
}

async function bootstrap() {
  await loadLocale();
  await refreshAll();
  bindChrome();
  route(location.hash || '#stations');
  window.addEventListener('hashchange', () => route(location.hash));
  window.addEventListener('online', () => { state.offline = false; updateNet(); refreshAll(); });
  window.addEventListener('offline', () => { state.offline = true; updateNet(); });
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('/sw.js'); } catch {} }
}
async function refreshAll() {
  try {
    const [s, g, h, r] = await Promise.all([
      api('/api/stations'), api('/api/segments'),
      api('/api/historical-trails'), api('/api/routes')
    ]);
    state.stations = s.stations; state.segments = g.segments;
    state.history = h.historicalTrails; state.routes = r.routes;
    state.fv = s.sourceVersion;
    $('#sourceVersion').textContent = s.sourceVersion + (s.__offline ? ' (cache)' : '');
  } catch (e) { /* 离线且无缓存：各视图自行显示提示 */ }
  applyI18nChrome();
}

function bindChrome() {
  $('#langToggle').onclick = async () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('lang', state.lang);
    await loadLocale(); applyI18nChrome(); route(location.hash || '#stations');
  };
  $('#printBtn').onclick = () => window.print();
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) location.hash = b.dataset.view;
  });
}
function applyI18nChrome() {
  $('#appTitle').textContent = L('appTitle');
  $('#subtitle').textContent = L('subtitle');
  document.title = L('appTitle');
  $('#footSafety').textContent = '⚠ ' + L('safetyBoundary');
  $('#printPendingNote').textContent = '[' + L('pending') + '] ' +
    (state.lang === 'zh'
      ? '本打印件中所有标“待核/待确认”的条目均未经最终核定；海拔缺失处未填零，历史商路不等于现行徒步路线。请以最新来源版本为准。'
      : 'Items marked TBC on this printout are not finally verified; missing elevations are not filled as zero, and historical trade routes are not current hiking routes. Bind to the latest source version.');
  $$('#tabs button').forEach((b) => (b.textContent = L('nav.' + b.dataset.view)));
  $('#langToggle').textContent = state.lang === 'zh' ? 'EN' : '中文';
  $('#printBtn').textContent = L('printNote');
  updateNet();
}

function route(hash) {
  const view = hash.replace('#', '') || 'stations';
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const mount = $('#view');
  mount.innerHTML = '';
  ({
    stations: renderStations, map: renderMap, plan: renderPlan, routes: renderRoutesView,
    history: renderHistory, catalog: renderCatalog, admin: renderAdmin
  })[view]?.(mount);
}

function pendingBadge(st) {
  return st.nameStatus === 'pending'
    ? `<span class="badge tbc" title="${esc(st.pendingNote || '')}">${L('pendingBadge')}</span>` : '';
}
function statusBadge(seg) {
  return seg.reviewed
    ? `<span class="badge ok">${L('reviewed')}</span>`
    : `<span class="badge no">${L('unverified')}</span>`;
}
function modeLabel(m) { return { foot: '🚶', bus: '🚌', mixed: '🚶+🚌' }[m] || m; }
function dirLabel(d) { return { bidirectional: '⇄', northbound: '↑', southbound: '↓' }[d] || d; }
function windowText(seg) {
  if (!seg.window?.seasonal) return '—';
  return seg.window.seasonal.months.map((m) => m + '').join(',') + '月' + (seg.window.note ? '；' + esc(seg.window.note) : '');
}
function tagHtml(tag, provenance) {
  if (!tag) return `<span class="pill">—</span>`;
  return `<span class="tag ${tag}">${tag}</span> <span class="muted">(${provenance === 'curated' ? L('curated') : L('computed')})</span>`;
}

/* ===================== 驿站视图 ===================== */
async function renderStations(mount) {
  mount.innerHTML = `<h2>${L('nav.stations')}</h2>
    <div class="inputrow"><label>${L('pending')} <input type="checkbox" id="onlyPending"></label></div>
    <div class="grid" id="stationGrid"></div>
    <div id="stationDetail" style="margin-top:16px"></div>`;
  const draw = (only) => {
    const list = state.stations.filter((s) => !only || s.nameStatus === 'pending');
    $('#stationGrid').innerHTML = list.map((s) => `
      <div class="card" data-id="${s.id}" style="cursor:pointer">
        <h4>${esc(s.name)} ${pendingBadge(s)} <span class="pill">${s.id}</span></h4>
        <div class="muted">${s.elevation == null ? `<span class="badge tbc">${L('elevationMissing')}</span>` : `↗ ${s.elevation} m`}</div>
        <div class="muted">${esc(s.aliases.join('/'))}</div>
      </div>`).join('');
    $$('#stationGrid .card').forEach((c) => c.onclick = () => showStation(c.dataset.id));
  };
  draw(false);
  $('#onlyPending').onchange = (e) => draw(e.target.checked);
  if (state.selectedStation) showStation(state.selectedStation);
}

async function showStation(id) {
  state.selectedStation = id;
  const d = await api('/api/stations/' + id);
  if (d.error) { $('#stationDetail').innerHTML = `<div class="gap">${esc(d.error)}</div>`; return; }
  const s = d.station;
  const adjRows = d.adjacentSegments.map((g) => `
    <tr>
      <td class="mono">${g.segmentId}</td>
      <td><a href="#" onclick="event.preventDefault();showStationExternal('${g.neighborId}')">${esc(g.neighborName)}</a></td>
      <td>${modeLabel(g.mode)} ${g.mode}</td>
      <td>${dirLabel(g.direction)}</td>
      <td>${g.distanceKm} km</td>
      <td>${g.baseMinutes} ${L('minutes')}</td>
      <td>${g.reviewed ? `<span class="badge ok">${L('reviewed')}</span>` : `<span class="badge no">${L('unverified')}</span>`}</td>
      <td>${windowText(g)}</td>
      <td>${(g.sources || []).map((x) => `<span class="pill">${x}</span>`).join(' ')}</td>
    </tr>`).join('');
  const hist = d.historicalRefs.map((h) => `
    <div class="card"><h4>${esc(h.name)} <span class="pill">${esc(h.era)}</span> <span class="pill mono">${h.id}</span></h4>
    <p class="muted">${esc(h.disclaimer)}</p>
    <div>${(h.sources || []).map((x) => `<span class="pill">${x}</span>`).join(' ')}</div></div>`).join('')
    || `<p class="muted">—</p>`;
  const ans = d.announcements.map((a) => `
    <div class="${a.kind === 'closure' ? 'gap' : 'pending-note'}">
      <b>${esc(a.title)}</b>
      ${a.latePublished ? ` <span class="badge late">${L('latePublished')}</span>` : ''}
      ${a.conflictsWithSeason ? ` <span class="badge late">${L('seasonConflict')}</span>` : ''}
      <div class="muted mono">${a.id} · ${a.effectiveFrom} → ${a.effectiveTo} · ${L('sourceVersion')}: ${(a.sources||[]).join(',')}</div>
      <p>${esc(a.body)}</p>
    </div>`).join('') || '<p class="muted">—</p>';

  $('#stationDetail').innerHTML = `
    <h3>${esc(s.name)} <span class="pill mono">${s.id}</span> ${pendingBadge(s)}</h3>
    ${s.pendingNote ? `<div class="pending-note"><b>${L('pending')}：</b>${esc(s.pendingNote)}
       <div class="muted">${(s.sources||[]).map((x)=>`<span class="pill">${x}</span>`).join(' ')}</div></div>` : ''}
    <p class="muted">${s.lat?.toFixed(2)}, ${s.lon?.toFixed(2)} ·
      ${s.elevation == null ? `<span class="badge tbc">${L('elevationMissing')}</span>` : s.elevation + ' m'}</p>
    <h3>${L('adjacentSegments')}</h3>
    <table><thead><tr><th>ID</th><th>邻站</th><th>${L('mode')}</th><th>${L('direction')}</th><th>${L('distanceKm')}</th><th>${L('travelTime')}</th><th></th><th>${L('window')}</th><th>SRC</th></tr></thead>
    <tbody>${adjRows}</tbody></table>
    <h3>${L('elevationTitle')}</h3>
    ${await profileForSegments(d.adjacentSegments.filter((g) => g.reviewed).map((g) => g.segmentId))}
    <h3>${L('historicalRefs')}</h3>
    <div class="grid">${hist}</div>
    <h3>${state.lang === 'zh' ? '公告' : 'Announcements'}</h3>
    ${ans}
    <p class="muted">${L('sourceVersion')}: <code>${d.sourceVersion}</code></p>`;
  if (d.__offline) $('#stationDetail').insertAdjacentHTML('afterbegin', offlineNote(d));
}
window.showStationExternal = (id) => { state.selectedStation = id; showStation(id); };

async function profileForSegments(ids) {
  if (!ids.length) return `<p class="muted">—</p>`;
  // 逐段取剖面并拼接
  const parts = await Promise.all(ids.map((id) => api('/api/segments/' + id + '/profile').catch(() => null)));
  const valid = parts.filter(Boolean);
  if (!valid.length) return `<p class="muted">—</p>`;
  const samples = [];
  let off = 0;
  valid.forEach((p, i) => {
    p.samples.forEach((sp, j) => {
      samples.push({ ...sp, distanceKm: round1(off + sp.distanceKm) });
    });
    off += p.samples.length ? p.samples[p.samples.length - 1].distanceKm : 0;
  });
  const st = aggregateStats(valid.map((p) => p.stats));
  return elevationChart(samples, st);
}
function aggregateStats(ss) {
  const known = ss.filter((s) => s.maxKnownElevationM != null);
  return {
    cumulativeGainM: ss.reduce((a, s) => a + s.cumulativeGainM, 0),
    cumulativeLossM: ss.reduce((a, s) => a + s.cumulativeLossM, 0),
    maxKnownElevationM: known.length ? Math.max(...known.map((s) => s.maxKnownElevationM)) : null,
    minKnownElevationM: known.length ? Math.min(...known.map((s) => s.minKnownElevationM)) : null,
    hasMissingElevation: ss.some((s) => s.hasMissingElevation),
    missingStretches: ss.flatMap((s) => s.missingStretches)
  };
}
function round1(x){return Math.round(x*10)/10;}

/* 高程剖面 SVG：缺失海拔点不画为 0，而在基线处画空心虚线断点 */
function elevationChart(samples, st) {
  const W = 860, H = 260, PL = 48, PB = 34, PT = 18;
  const dMax = Math.max(...samples.map((s) => s.distanceKm), 1);
  const known = samples.filter((s) => s.elevation != null).map((s) => s.elevation);
  const eMin = known.length ? Math.min(...known) : 0;
  const eMax = known.length ? Math.max(...known) : 1;
  const X = (d) => PL + (d / dMax) * (W - PL - 14);
  const Y = (e) => H - PB - ((e - eMin) / Math.max(eMax - eMin, 1)) * (H - PB - PT);
  let line = '', gapMarks = '';
  let prev = null;
  samples.forEach((s) => {
    if (s.elevation != null) {
      const x = X(s.distanceKm), y = Y(s.elevation);
      line += (prev ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      if (prev && prev.elevation == null) gapMarks += `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="#c9972b" stroke-dasharray="2 2"/>`;
      prev = s;
    } else {
      if (prev && prev.elevation != null) {
        const x = X(s.distanceKm), y = Y(prev.elevation);
        gapMarks += `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="#c9972b" stroke-dasharray="2 2"/>
        <text x="${x+5}" y="${y-6}" font-size="10" fill="#8a5a00">${L('elevationMissing')}</text>`;
      }
      prev = s;
    }
  });
  const baseY = H - PB;
  return `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="elevation">
    <text x="${PL}" y="14" font-size="12" fill="#6d5f4f">${L('elevationTitle')}：
      ↑ ${st.cumulativeGainM} m · ↓ ${st.cumulativeLossM} m ·
      max ${st.maxKnownElevationM ?? '—'} m
      ${st.hasMissingElevation ? ` · <tspan fill="#8a5a00">${L('elevationMissing')}</tspan>` : ''}
    </text>
    <line x1="${PL}" y1="${baseY}" x2="${W-14}" y2="${baseY}" stroke="#cbbb9f"/>
    <path d="${line}" fill="none" stroke="#8a4b20" stroke-width="2"/>
    ${gapMarks}
    <text x="${PL}" y="${H-10}" font-size="11" fill="#6d5f4f">0</text>
    <text x="${W-60}" y="${H-10}" font-size="11" fill="#6d5f4f">${dMax} ${L('distanceKm')}</text>
    <text x="6" y="${PT+6}" font-size="11" fill="#6d5f4f">${eMax}${L('elevationM').replace(' m','')}</text>
    <text x="6" y="${baseY}" font-size="11" fill="#6d5f4f">${eMin}</text>
  </svg>`;
}
function offlineNote(d) {
  return `<div class="pending-note"><b>${L('offline')}</b> · ${d.__cachedAt || ''}</div>`;
}

/* ===================== 路线图视图 ===================== */
function renderMap(mount) {
  mount.innerHTML = `<h2>${L('nav.map')}</h2>
    <div class="legend">
      <span><i class="sw-foot" style="border-color:#8a4b20"></i>${'🚶 foot'}</span>
      <span><i class="sw-foot" style="border-color:#245b8a"></i>${'🚌 bus'}</span>
      <span><i class="sw-foot" style="border-color:#7a7a7a;border-top-style:dashed"></i>${'historical (narrative)'}</span>
      <span><i class="sw-foot" style="border-color:#a02c2c;border-top-style:dashed"></i>${'gap / no line'}</span>
      <span><span class="badge tbc">${L('pendingBadge')}</span> ${L('pending')}</span>
    </div>
    <div id="mapSvg"></div>
    <p class="muted">${L('noStraightLine')} · ${L('historicalNote')}</p>
    <p class="muted">${L('sourceVersion')}: <code>${state.fv}</code></p>`;
  $('#mapSvg').innerHTML = mapSvg();
}
function mapSvg() {
  const W = 900, H = 720, P = 60;
  const lats = state.stations.map((s) => s.lat), lons = state.stations.map((s) => s.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  // 简单等距圆柱投影；线路仅沿已核对 path 折线绘制，不跨缺口
  const X = (lon) => P + ((lon - minLon) / Math.max(maxLon - minLon, 1e-6)) * (W - 2 * P);
  const Y = (lat) => H - P - ((lat - minLat) / Math.max(maxLat - minLat, 1e-6)) * (H - 2 * P);
  const segPath = (seg) => (seg.path || []).map(([la, lo], i) => (i ? 'L' : 'M') + X(lo).toFixed(1) + ' ' + Y(la).toFixed(1)).join(' ');
  let segmentsSvg = '';
  for (const seg of state.segments) {
    if (!seg.reviewed) {
      // 未核对：画成极淡的问号虚线，明确“不是路线”
      segmentsSvg += `<path d="${segPath(seg)}" stroke="#bbb" stroke-width="1.5" stroke-dasharray="2 6" fill="none"/>
        <text x="${X((seg.path[0]||[0,0])[1])}" y="${Y((seg.path[0]||[0,0])[0])-6}" font-size="10" fill="#999">${seg.id} ? ${L('unverified')}</text>`;
      continue;
    }
    const color = seg.mode === 'bus' ? '#245b8a' : seg.mode === 'mixed' ? '#7a4f8a' : '#8a4b20';
    segmentsSvg += `<path d="${segPath(seg)}" stroke="${color}" stroke-width="3" fill="none"/>
      <text x="${X(seg.path[Math.floor(seg.path.length/2)][1])}" y="${Y(seg.path[Math.floor(seg.path.length/2)][0])-5}" font-size="10" fill="${color}">${seg.id} · ${seg.baseMinutes}${L('minutes')} · ${dirLabel(seg.direction)}</text>`;
  }
  // 历史叙事：灰色虚线（仅叙事，不可通行）
  let histSvg = '';
  for (const h of state.history) {
    histSvg += `<path d="${(h.path||[]).map(([la,lo],i)=>(i?'L':'M')+X(lo).toFixed(1)+' '+Y(la).toFixed(1)).join(' ')}"
      stroke="#7a7a7a" stroke-width="2" stroke-dasharray="6 5" fill="none"/>`;
  }
  // 缺口：在“历史有、当代无”的相邻驿站对之间画红色叉号屏障，不连线
  let gapSvg = '';
  const modern = new Set();
  state.segments.forEach((s) => { modern.add(s.from + '|' + s.to); modern.add(s.to + '|' + s.from); });
  for (const h of state.history) {
    for (let i = 0; i < h.stationRefs.length - 1; i++) {
      const a = h.stationRefs[i], b = h.stationRefs[i+1];
      if (modern.has(a + '|' + b)) continue;
      const sa = state.stations.find((x) => x.id === a), sb = state.stations.find((x) => x.id === b);
      if (!sa || !sb) continue;
      const mx = (X(sa.lon) + X(sb.lon)) / 2, my = (Y(sa.lat) + Y(sb.lat)) / 2;
      gapSvg += `<g><line x1="${mx-9}" y1="${my-9}" x2="${mx+9}" y2="${my+9}" stroke="#a02c2c" stroke-width="3"/>
        <line x1="${mx-9}" y1="${my+9}" x2="${mx+9}" y2="${my-9}" stroke="#a02c2c" stroke-width="3"/>
        <text x="${mx+12}" y="${my+4}" font-size="10" fill="#a02c2c">GAP</text></g>`;
    }
  }
  const stationDots = state.stations.map((s) => {
    const x = X(s.lon), y = Y(s.lat);
    return `<g style="cursor:pointer" onclick="showStationExternal('${s.id}');location.hash='stations'">
      <circle cx="${x}" cy="${y}" r="${s.kind==='town'?6:4}" fill="${s.nameStatus==='pending'?'#fff':'#3a2a1c'}" stroke="#3a2a1c" stroke-width="${s.nameStatus==='pending'?2.5:1}"/>
      <text x="${x+7}" y="${y+3}" font-size="11" fill="#2b2118">${esc(s.name)}${s.nameStatus==='pending'?' (TBC)':''}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${histSvg}${segmentsSvg}${gapSvg}${stationDots}</svg>`;
}

/* ===================== 规划 / 受约束图搜索 ===================== */
function stationOptions(sel) {
  return state.stations.map((s) => `<option value="${s.id}" ${s.id===sel?'selected':''}>${esc(s.name)}${s.nameStatus==='pending'?' ('+L('pendingBadge')+')':''} · ${s.id}</option>`).join('');
}
function renderPlan(mount) {
  mount.innerHTML = `
  <h2>${L('searchTitle')}</h2>
  <div class="card">
    <div class="inputrow">
      <label>${L('searchFrom')} <select id="pFrom">${stationOptions('ST-01')}</select></label>
      <label>${L('searchTo')} <select id="pTo">${stationOptions('ST-14')}</select></label>
      <label>${L('searchDate')} <input type="date" id="pDate" value="2026-09-15"></label>
      <label>${L('searchCap')} <input type="number" id="pCap" value="480" min="120" step="30" style="width:90px"></label>
      <label>${L('mode')}
        <select id="pModes" multiple size="3" style="min-width:110px">
          <option value="foot" selected>foot</option><option value="bus" selected>bus</option><option value="mixed" selected>mixed</option>
        </select></label>
      <button class="btn" id="pGo" style="background:var(--accent);color:#fff">${L('searchGo')}</button>
    </div>
    <p class="muted">${L('methodCompare')}：<code>constrained-graph-search</code> —
      ${state.lang==='zh'
        ? '仅沿已核对相邻路段、按方向/窗口/班期搜索；步行按每日上限跨日累计，班车检查换乘窗口；断路则报告不可达片段，不画直线。'
        : 'Only along verified adjacent sections, honoring direction/window/timetable; foot spans accumulate per day against a cap, buses check transfer windows; closures yield unreachable fragments, never straight lines.'}</p>
  </div>
  <div id="searchOut" style="margin-top:14px"></div>
  <h3>${L('savedPlans')}</h3>
  <div id="savedList"></div>`;
  $('#pGo').onclick = runSearch;
  renderSavedList();
}
function selectedModes() {
  return [...$('#pModes').selectedOptions].map((o) => o.value);
}
async function runSearch() {
  const body = {
    from: $('#pFrom').value, to: $('#pTo').value, date: $('#pDate').value,
    dailyCapMinutes: Number($('#pCap').value), modes: selectedModes()
  };
  const r = await api('/api/search', { method: 'POST', body });
  state.searchResult = { body, r };
  $('#searchOut').innerHTML = renderSearchResult(r, body);
}
function renderSearchResult(r, body) {
  if (r.__offline) var off = offlineNote(r);
  if (!r.reachable) {
    const block = (r.blockingEdges || []).map((b) => `
      <tr>
        <td class="mono">${b.segmentId}</td><td>${esc(b.fromName)} → ${esc(b.toName)}</td>
        <td>${reasonBadge(b)}</td><td>${esc(b.reasonText)}</td>
        <td>${b.latePublished ? `<span class="badge late">${L('latePublished')}</span>` : ''}</td>
      </tr>`).join('');
    const hist = (r.historicalOnlyGaps || []).map((g) => `
      <div class="change"><b>${esc(g.fromName)} ✕ ${esc(g.toName)}</b>
      <span class="pill mono">${g.viaHistorical}</span><p class="muted">${esc(g.note)}</p></div>`).join('');
    return `${off||''}
      <div class="gap"><h3 style="margin-top:0">${L('unreachable')} — ${esc(r.unreachableSegment?.targetName)}</h3>
      <p>${esc(r.unreachableSegment?.note)}</p></div>
      <h3>${L('blockingEdges')}</h3>
      <table><thead><tr><th>ID</th><th>${state.lang==='zh'?'路段':'Section'}</th><th>${state.lang==='zh'?'原因':'Reason'}</th><th>${state.lang==='zh'?'说明':'Detail'}</th><th></th></tr></thead>
      <tbody>${block || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table>
      <h3>${L('historicalOnlyGaps')}</h3>${hist || '<p class="muted">—</p>'}
      <p class="muted">${L('noStraightLine')}。${L('sourceVersion')}: <code>${r.sourceVersion}</code></p>`;
  }
  const days = r.itinerary.days.map((d) => `
    <div class="daybox"><b>${L('day').replace('{n}', d.day)}</b> · ${d.date} · ${L('searchCap').replace(/\(.*\)/,'')}: ${d.activeMinutes} ${L('minutes')}
      <table style="margin-top:6px"><tbody>${d.entries.map((e) => `
        <tr><td class="mono" style="width:110px">${e.from.label}–${e.to.clock}</td>
          <td>${kindLabel(e.kind)} ${e.segmentId ? `<span class="pill">${e.segmentId}</span>` : ''}
            ${e.schedule ? esc(e.schedule) : ''}
            ${e.transfer ? ` <span class="badge ${e.transfer.windowMet?'ok':'no'}">${L('transferWindows')}: ${e.transfer.requiredMinutes}${L('minutes')} ${e.transfer.windowMet?L('windowMet'):L('windowMissed')}</span>` : ''}
          </td><td style="width:70px">${e.durationMinutes}${L('minutes')}</td></tr>`).join('')}
      </tbody></table>
    </div>`).join('');
  const transfers = r.itinerary.transfers.map((t) => `
    <span class="badge ${t.windowMet?'ok':'no'}">${t.segmentId} @ ${t.at.label} · +${t.requiredMinutes}${L('minutes')} (${t.windowMet?L('windowMet'):L('windowMissed')})</span>`).join(' ');
  const legs = r.legs.map((l) => `<span class="pill mono" title="${windowText(l)}">${l.segmentId} ${modeLabel(l.mode)} ${dirLabel(l.direction)} ${l.minutes}${L('minutes')} ${l.status?.advisories?.length?'⚠':''}</span>`).join(' → ');
  return `${off||''}
    <div class="card">
      <h3 style="margin-top:0">${L('reachable')} · ${L('totalTime')}: ${Math.floor(r.totalMinutes/60)}h${r.totalMinutes%60} · ${L('totalDays')}: ${r.totalDays} · ${state.lang==='zh'?'到达':'Arrive'}: ${r.arrival.label}</h3>
      <p>${legs}</p>
      <p>${L('transferWindows')}: ${transfers || '—'}</p>
      <h3>${state.lang==='zh'?'多日行程（时间跨日累计，含换乘/过夜）':'Itinerary (time accumulates across days, incl. transfers/overnight)'}</h3>
      ${days}
      <button class="btn" id="savePlan" style="background:var(--ok);color:#fff">💾 ${L('searchSave')}</button>
      <span class="muted"> · ${L('sourceVersion')}: <code>${r.sourceVersion}</code></span>
      <p class="safety" style="margin-top:10px">${L('safetyBoundary')}</p>
    </div>`;
}
function reasonBadge(b) {
  if (b.reason === 'closure') return `<span class="badge no">closure</span>`;
  if (b.reason === 'season') return `<span class="badge late">season</span>`;
  if (b.reason === 'season-conflict') return `<span class="badge late">${L('seasonConflict')}</span>`;
  if (b.reason === 'unverified') return `<span class="badge tbc">${L('unverified')}</span>`;
  return b.reason;
}
function kindLabel(k) { return { travel: '🚶' + L('travel'), rest: '🌙' + L('rest'), wait: '🚌' + L('wait') }[k] || k; }

const PLAN_KEY = 'tmr.plans.v1';
function readPlans() { try { return JSON.parse(localStorage.getItem(PLAN_KEY) || '[]'); } catch { return []; } }
function writePlans(p) { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); }
function renderSavedList(notice = '') {
  const el = $('#savedList'); if (!el) return;
  const plans = readPlans();
  el.innerHTML = notice + plans.map((p, i) => `
    <div class="card" style="margin:8px 0">
      <h4>#${i+1} ${p.query.from} → ${p.query.to} · ${p.query.date}
        ${p.reachable ? `<span class="badge ok">${L('reachable')}</span>` : `<span class="badge no">${L('unreachable')}</span>`}
      </h4>
      <p class="muted">${L('retainBasis')} · ${L('sourceVersion')} <code>${p.sourceVersion}</code> · ${new Date(p.savedAt).toLocaleString()}</p>
      <div class="recheck-${i}"></div>
      <div class="inputrow">
        <button class="btn" onclick="recheckOne(${i})">🔄 ${L('recheck')}</button>
        <button class="btn" onclick="dropPlan(${i})">✕</button>
      </div>
    </div>`).join('') || `<p class="muted">—</p>`;
}
window.recheckOne = async (i) => {
  const plans = readPlans();
  const snap = await api('/api/plans/snapshot', { method: 'POST', body: plans[i].query });
  // 以收藏时保存的依据为准（不覆盖），用服务器当前数据比对
  const rc = await api('/api/plans/recheck', { method: 'POST', body: { snapshot: plans[i] } });
  const box = $('.recheck-' + i);
  if (!box) return;
  if (rc.__offline) { box.innerHTML = offlineNote(rc); return; }
  box.innerHTML = (rc.hasChanges
    ? `<b>${L('changes')}：</b>` + rc.changes.map((c) => `<div class="change">${changeText(c)}</div>`).join('')
    : `<div class="change no">${L('noChanges')}（<code>${rc.sourceVersion}</code>）</div>`)
    + `<details class="muted" style="margin-top:6px"><summary>${state.lang==='zh'?'查看保留的原依据':'Preserved basis'}</summary>
       <pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(plans[i], null, 2))}</pre></details>`;
};
function changeText(c) {
  const map = { 'source-version': L('sourceVersion'), closure: 'closure', 'late-announcement': L('latePublished'),
    'season-conflict': L('seasonConflict'), 'now-unreachable': L('unreachable'), 'now-reachable': L('reachable'),
    'duration-changed': '', 'path-changed': '', blocked: '' };
  return esc(c.text || (map[c.kind] || c.kind));
}
window.dropPlan = (i) => { const p = readPlans(); p.splice(i,1); writePlans(p); renderSavedList(); };

// 收藏按钮事件委托
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'savePlan' && state.searchResult) {
    const { body } = state.searchResult;
    const snap = await api('/api/plans/snapshot', { method: 'POST', body });
    const plans = readPlans(); plans.push(snap.saved); writePlans(plans);
    renderSavedList(`<div class="change no">${state.lang==='zh'?'已收藏，依据版本已绑定':'Saved with bound source version'}</div>`);
  }
});

/* ===================== 已审路线 + 偏好筛选 ===================== */
async function renderRoutesView(mount) {
  mount.innerHTML = `
  <h2>${L('filterTitle')}</h2>
  <div class="card">
    <div class="inputrow">
      <label>${L('mode')} <select id="fMode" multiple size="3">
        <option value="foot" selected>foot</option><option value="bus" selected>bus</option><option value="mixed" selected>mixed</option></select></label>
      <label>${state.lang==='zh'?'月份':'Month'} <input type="number" id="fMonth" value="9" min="1" max="12" style="width:70px"></label>
      <label>${L('searchCap')} <input type="number" id="fCap" value="540" style="width:90px"></label>
      <label>${L('difficulty')} <select id="fDiff">
        <option value="easy">easy</option><option value="moderate">moderate</option>
        <option value="strenuous" selected>strenuous</option><option value="very-strenuous">very-strenuous</option></select></label>
      <button class="btn" id="fGo" style="background:var(--accent);color:#fff">${L('apply')}</button>
    </div>
  </div>
  <div id="filterOut"></div>
  <h3>${state.lang==='zh'?'全部路线（含草稿，不参与筛选）':'All routes (drafts excluded from filter)'}</h3>
  <div id="allRoutes" class="grid"></div>`;
  $('#fGo').onclick = runFilter;
  await runFilter();
  const d = await api('/api/routes');
  $('#allRoutes').innerHTML = (d.routes || []).map((r) => `
    <div class="card"><h4>${esc(r.name)} <span class="pill mono">${r.id}</span></h4>
      <p><span class="badge ${r.status==='reviewed'?'ok':'tbc'}">${r.status}</span>
         v${r.version} · ${L('sourceVersion')} <code>${r.sourceVersion||state.fv}</code></p>
      <button class="btn" onclick="showRouteDetail('${r.id}')">${state.lang==='zh'?'详情/版本':'Detail / versions'}</button>
    </div>`).join('');
}
async function runFilter() {
  const modes = [...$('#fMode').selectedOptions].map((o) => o.value).join(',');
  const q = new URLSearchParams({ prefs: '1', modes, month: $('#fMonth').value, cap: $('#fCap').value, difficulty: $('#fDiff').value });
  const r = await api('/api/routes?' + q.toString());
  $('#filterOut').innerHTML = `
    <p class="muted">${esc(r.comparison || '')}</p>
    <div class="grid">${r.results.map((x) => `
      <div class="card"><h4>${esc(x.name)} <span class="pill mono">${x.routeId}</span> v${x.version}</h4>
        <p>${tagHtml(x.difficulty.tag, x.difficulty.provenance)}</p>
        <p class="muted">↑${x.profile.cumulativeGainM}m · ${x.profile.totalDistanceKm ?? '—'}km ·
          max ${x.profile.maxKnownElevationM ?? '—'}m
          ${x.profile.hasMissingElevation ? ` · <span class="badge tbc">${L('elevationMissing')}</span>` : ''}</p>
        <p class="muted">${esc(x.difficulty.basis?.note || x.difficulty.boundary || '')}</p>
        <div>${x.sources.map((s) => `<span class="pill">${s}</span>`).join(' ')}</div>
        <p class="muted">${L('sourceVersion')}: <code>${x.sourceVersion}</code></p>
        <button class="btn" onclick="showRouteDetail('${x.routeId}')">${state.lang==='zh'?'查看':'Open'}</button>
      </div>`).join('') || `<p class="muted">${state.lang==='zh'?'没有满足偏好的已审路线。':'No reviewed route matches preferences.'}</p>`}
    </div>
    <p class="safety">${esc(r.safetyBoundary)}</p>`;
}
window.showRouteDetail = async (id) => {
  const d = await api('/api/routes/' + id);
  if (d.error) return alert(d.error);
  const r = d.route;
  const out = document.createElement('div');
  out.className = 'card';
  out.style.cssText = 'position:fixed;inset:40px;overflow:auto;z-index:50;padding:20px';
  out.innerHTML = `
    <div class="inputrow" style="justify-content:space-between">
      <h3 style="margin:0">${esc(r.name)} · v${r.version}</h3>
      <button class="btn" onclick="this.closest('.card').remove()">✕</button>
    </div>
    <p>${tagHtml(r.difficultyTag, 'curated')} · ${L('difficultySource')}：${esc(d.tagProvenance)}</p>
    <p>${L('elevationTitle')}: ↑${d.profile.cumulativeGainM}m max ${d.profile.maxKnownElevationM ?? '—'}m
       ${d.profile.hasMissingElevation ? `<span class="badge tbc">${L('elevationMissing')}</span>`:''}</p>
    ${elevationChart(d.samples, d.profile)}
    <h4>${state.lang==='zh'?'版本历史（回退以新版本保留，可再撤销）':'Version history (rollback appends a new version)'}</h4>
    <table><thead><tr><th>v</th><th>at</th><th>note</th><th>segments</th><th></th></tr></thead><tbody>
    ${r.history.map((h) => `<tr>
      <td>${h.version}</td><td>${h.at}</td><td>${esc(h.note)}</td>
      <td class="mono">${h.segmentIds.join(',')}</td>
      <td>${h.version !== r.version ? `<button class="btn" onclick="doRollback('${r.id}',${h.version})">${L('rollbackRoute')}</button>` : '—'}</td>
    </tr>`).join('')}
    </tbody></table>
    <p class="muted">${L('sourceVersion')}: <code>${d.sourceVersion}</code></p>`;
  document.body.appendChild(out);
};
window.doRollback = async (id, ver) => {
  const r = await api(`/api/admin/routes/${id}/rollback`, { method: 'POST', body: { targetVersion: ver } });
  alert(`v${ver} → restored as new version. FV=${r.sourceVersion}`);
  await refreshAll(); location.hash = 'routes';
  $$('.card[style*="fixed"]').forEach((x) => x.remove());
  showRouteDetail(id);
};

/* ===================== 历史叙事（与当代通行分开） ===================== */
function renderHistory(mount) {
  mount.innerHTML = `<h2>${L('nav.history')}</h2>
    <p class="safety">${L('historicalNote')}</p>
    <div class="grid">${state.history.map((h) => `
      <div class="card">
        <h4>${esc(h.name)} <span class="pill">${esc(h.era)}</span> <span class="pill mono">${h.id}</span></h4>
        <p>${esc(h.body)}</p>
        <div class="pending-note">${esc(h.disclaimer)}</div>
        <div>${h.stationRefs.map((id) => {
          const st = state.stations.find((x) => x.id === id);
          return `<span class="pill">${id} ${esc(st?.name||'')}${st?.nameStatus==='pending'?' '+L('pendingBadge'):''}</span>`;
        }).join(' ')}</div>
        <div style="margin-top:6px">${(h.sources||[]).map((x)=>`<span class="pill">${x}</span>`).join(' ')}</div>
      </div>`).join('')}</div>
    <p class="muted">${state.lang==='zh'
      ? '提示：地图上历史路线为灰色虚线，不参与“规划/搜索”，也不会用来填补任何相邻路段缺口。'
      : 'Historical trails are grey dashed lines on the map; they never enter the search graph and never fill a section gap.'}</p>`;
}

/* ===================== 编号目录：所有编号 + 待核 + 来源版本 ===================== */
function renderCatalog(mount) {
  const tbcStations = state.stations.filter((s) => s.nameStatus === 'pending');
  const missingAlt = state.stations.filter((s) => s.elevation == null);
  const late = state.announcements.filter((a) => a.latePublished);
  const conflicts = state.announcements.filter((a) => a.conflictsWithSeason);
  const unverified = state.segments.filter((s) => !s.reviewed);
  mount.innerHTML = `
  <h2>${L('catalogTitle')}</h2>
  <div class="pending-note"><b>${L('pending')}：</b>
    ${state.lang==='zh'
      ? '本目录列出全部编号；凡标“待核/TBC”的名称、缺失海拔、未核对路段、迟到公告与季节冲突，在网页、打印件与中英双语页面中均同样标注，且必须绑定来源版本。'
      : 'Every number is listed here; same-name TBC stations, missing elevations, unverified sections, late notices and seasonal conflicts are flagged identically across web, print and both languages, bound to a source version.'}
  </div>
  <h3>${L('nav.stations')} (ST)</h3>
  <table><thead><tr><th>ID</th><th>${state.lang==='zh'?'名称':'Name'}</th><th>${L('elevationM')}</th><th>状态</th><th>SRC</th></tr></thead><tbody>
  ${state.stations.map((s) => `<tr>
    <td class="mono">${s.id}</td><td>${esc(s.name)} ${s.sameNameGroup?`<span class="pill">${s.sameNameGroup}</span>`:''} ${pendingBadge(s)}</td>
    <td>${s.elevation==null?`<span class="badge tbc">${L('elevationMissing')}</span>`:s.elevation}</td>
    <td>${s.nameStatus}</td><td>${(s.sources||[]).join(', ')}</td></tr>`).join('')}
  </tbody></table>
  <h3>${state.lang==='zh'?'相邻路段':'Segments'} (SG)</h3>
  <table><thead><tr><th>ID</th><th>from→to</th><th>${L('mode')}</th><th>${L('travelTime')}</th><th>${L('season')}</th><th>状态</th><th>SRC</th></tr></thead><tbody>
  ${state.segments.map((g) => `<tr>
    <td class="mono">${g.id}</td><td>${g.from} → ${g.to}</td><td>${g.mode}</td>
    <td>${g.baseMinutes}${L('minutes')}</td>
    <td>${g.window?.seasonal?g.window.seasonal.months.join(','):'all'}</td>
    <td>${g.reviewed?`<span class="badge ok">${L('reviewed')}</span>`:`<span class="badge tbc">${L('unverified')}</span>`}</td>
    <td>${(g.sources||[]).join(', ')}</td></tr>`).join('')}
  </tbody></table>
  <h3>${state.lang==='zh'?'公告':'Announcements'} (AN)</h3>
  ${[...late.map(a=>({a,flag:L('latePublished')})), ...conflicts.map(a=>({a,flag:L('seasonConflict')}))].map(({a,flag})=>
    `<div class="pending-note"><span class="badge late">${flag}</span> <b>${esc(a.title)}</b>
     <span class="mono">${a.id}</span><div class="muted">issued ${a.issuedAt} · effective ${a.effectiveFrom}→${a.effectiveTo}</div></div>`).join('') || '<p class="muted">—</p>'}
  <h3>${state.lang==='zh'?'待核汇总':'Pending summary'}</h3>
  <ul>
    <li>${L('pending')}: ${tbcStations.map((s)=>s.id+' '+s.name).join('；')||'—'}</li>
    <li>${L('elevationMissing')}: ${missingAlt.map((s)=>s.id+' '+s.name).join('；')}</li>
    <li>${L('unverified')}: ${unverified.map((s)=>s.id).join('，')||'—'}</li>
  </ul>
  <p class="muted">${L('sourceVersion')}: <code>${state.fv}</code></p>`;
}

/* ===================== Web 维护 ===================== */
async function renderAdmin(mount) {
  const segOptions = state.segments.map((s) =>
    `<option value="${s.id}">${s.id} ${s.from}→${s.to} (${s.reviewed?L('reviewed'):L('unverified')})</option>`).join('');
  const stationOptionsTbc = state.stations.filter((s) => s.nameStatus==='pending')
    .map((s) => `<option value="${s.id}">${s.id} ${esc(s.name)}</option>`).join('');
  const routeOptions = state.routes.map((r) => `<option value="${r.id}">${r.id} v${r.version} ${esc(r.name)}</option>`).join('');
  mount.innerHTML = `
  <h2>${L('adminTitle')}</h2>
  <p class="muted">${state.lang==='zh'?'所有维护动作都会产生审计记录，并改变来源版本指纹；路线回退以“新版本”形式保留。':'Every maintenance action is audited and bumps the source-version fingerprint; rollbacks append a new version.'}</p>

  <div class="grid">
    <div class="card"><h4>${L('reviewSegment')}</h4>
      <div class="inputrow"><select id="aSeg">${segOptions}</select>
        <button class="btn" onclick="adminReview(true)">✓ ${L('reviewed')}</button>
        <button class="btn" onclick="adminReview(false)">↩ ${L('unverified')}</button></div></div>

    <div class="card"><h4>${L('confirmStation')}</h4>
      <div class="inputrow"><select id="aStation">${stationOptionsTbc}</select>
        <button class="btn" onclick="adminConfirm()">✓ OK</button></div></div>

    <div class="card"><h4>${L('addAnnouncement')}</h4>
      <div class="inputrow">
        <select id="anSeg">${segOptions}</select>
        <select id="anKind"><option value="closure">closure</option><option value="advisory">advisory</option></select>
        <input type="date" id="anFrom" value="2026-12-01"><input type="date" id="anTo" value="2026-12-31">
        <input type="date" id="anIssued" value="2026-12-05">
        <button class="btn" onclick="adminAnnouncement()">${L('addAnnouncement')}</button></div></div>

    <div class="card"><h4>${L('rollbackRoute')}</h4>
      <div class="inputrow"><select id="aRoute">${routeOptions}</select>
        <input type="number" id="aVer" value="1" min="1" style="width:70px">
        <button class="btn" onclick="adminRollback()">↩ v</button></div></div>
  </div>

  <h3>${L('mutationLog')}</h3>
  <div id="logBox" class="mono muted" style="font-size:12px"></div>
  <div class="inputrow" style="margin-top:12px">
    <button class="btn" onclick="adminReset()">${state.lang==='zh'?'重置演示数据':'Reset demo data'}</button>
  </div>`;
  const log = await api('/api/admin/log');
  $('#logBox').innerHTML = (log.mutationLog || []).slice().reverse().map((m) =>
    `<div>#${m.seq} ${m.at} · ${m.type} · ${esc(JSON.stringify(m.detail))} · ${m.sourceVersionBefore} → ${m.sourceVersionAfter}</div>`).join('')
    || (state.lang==='zh'?'（暂无）':'(empty)');
}
async function adminAction(path, body, okMsg) {
  const r = await api(path, { method: 'POST', body });
  if (r.error) return alert(r.error);
  await refreshAll(); renderAdmin($('#view'));
  alert(okMsg + ' FV=' + r.sourceVersion);
}
window.adminReview = (v) => adminAction(`/api/admin/segments/${$('#aSeg').value}/review`, { reviewed: v },
  v ? (state.lang==='zh'?'路段已核对（进入通行图）':'Section verified (enters graph)')
    : (state.lang==='zh'?'路段已取消核对（退出通行图）':'Section unverified (leaves graph)'));
window.adminConfirm = () => adminAction(`/api/admin/stations/${$('#aStation').value}/confirm`,
  { note: state.lang==='zh'?'名称已人工核定':'Name manually confirmed' }, L('confirmStation'));
window.adminAnnouncement = () => adminAction('/api/admin/announcements', {
  segmentId: $('#anSeg').value, kind: $('#anKind').value,
  effectiveFrom: $('#anFrom').value, effectiveTo: $('#anTo').value, issuedAt: $('#anIssued').value,
  latePublished: $('#anIssued').value > $('#anFrom').value,
  title: (state.lang==='zh'?'维护公告':'Maintenance notice'), body: (state.lang==='zh'?'由维护端发布。':'Published from maintenance UI.')
}, L('addAnnouncement'));
window.adminRollback = () => adminAction(`/api/admin/routes/${$('#aRoute').value}/rollback`,
  { targetVersion: Number($('#aVer').value) }, L('rollbackRoute'));
window.adminReset = async () => {
  await api('/api/admin/reset', { method: 'POST', body: {} });
  writePlans([]); await refreshAll(); renderAdmin($('#view'));
};

bootstrap().catch((e) => { $('#view').innerHTML = `<div class="gap">${esc(String(e))}</div>`; console.error(e); });
