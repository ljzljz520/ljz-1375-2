/* 访客端逻辑：驿站/剖面/规划/比较/收藏/离线 */
let STATIONS = [], LAST_PLAN = null, CLIENT_ID = localStorage.getItem("client_id");
if (!CLIENT_ID) { CLIENT_ID = crypto.randomUUID(); localStorage.setItem("client_id", CLIENT_ID); }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});

const api = async (url, opts) => {
  const r = await fetch(url, opts ? {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(opts)} : undefined);
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw {status:r.status, body:e}; }
  return r.json();
};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function netStatus() {
  const b = document.getElementById("netBadge");
  const on = navigator.onLine;
  b.textContent = on ? t("online") : t("offline");
  b.className = "badge " + (on ? "ok" : "off");
}
window.addEventListener("online", () => { netStatus(); refreshFavChanges(); });
window.addEventListener("offline", netStatus);

async function refreshMeta() {
  try { const m = await api("/api/meta");
    document.getElementById("verBadge").textContent = t("data_version") + " " + m.data_version;
  } catch { const b = JSON.parse(localStorage.getItem("bundle") || "null");
    if (b) document.getElementById("verBadge").textContent = t("data_version") + " " + b.data_version + " (cache)"; }
}

/* ---------- 驿站 ---------- */
async function loadStations() {
  const q = document.getElementById("q").value.trim();
  let data;
  try { data = await api("/api/stations" + (q ? "?query=" + encodeURIComponent(q) : "")); }
  catch { data = JSON.parse(localStorage.getItem("bundle") || "{}"); }
  STATIONS = data.stations || [];
  const tb = document.querySelector("#stationTable tbody");
  tb.innerHTML = "";
  STATIONS.forEach((s, i) => {
    const elev = s.elevation_m == null ? `<span class="pending">${t("missing_elev")}</span>`
      : esc(s.elevation_m) + " m" + (s.elevation_status === "estimated" ? ` <span class="pending">(${t("estimated_elev")})</span>` : "");
    const ver = s.verify_status === "pending" ? `<span class="pending">${t("pending")}</span>` : `<span class="badge ok">✓</span>`;
    const same = s.same_name_group ? ` <span class="badge warn">${t("same_name")}</span>` : "";
    tb.insertAdjacentHTML("beforeend",
      `<tr><td>${i+1}</td><td>${esc(s.code)}</td><td>${esc(pick(s,"name_zh","name_en"))}${same}</td>
       <td>${elev}</td><td>${ver}</td>
       <td><button class="ghost" onclick="stationDetail(${s.id})">…</button></td></tr>`);
  });
  const sn = document.getElementById("sameName");
  const amb = STATIONS.filter(s => s.same_name_group && s.verify_status === "pending");
  sn.style.display = amb.length ? "" : "none";
  sn.textContent = amb.length ? `${t("same_name")}: ${amb.map(a=>pick(a,"name_zh","name_en")).join(", ")}` : "";
  fillSelects();
}
async function stationDetail(id) {
  const d = await api("/api/stations/" + id);
  const s = d.station;
  document.getElementById("stationDetail").innerHTML = `
    <div class="card"><b>${esc(pick(s,"name_zh","name_en"))}</b> (${esc(s.code)})
    ${s.verify_status==="pending" ? `<span class="pending">[${t("pending")}]</span>` : ""}<br>
    ${t("elevation")}: ${s.elevation_m == null ? t("missing_elev") : s.elevation_m + " m"}
    ${d.narratives.map(n => `<div class="card"><b>${esc(n.title)}</b> <span class="muted">(${esc(n.lang)}, ${esc(n.source||"")})</span><br>${esc(n.body)}</div>`).join("")}
    </div>`;
}
function fillSelects() {
  const opts = STATIONS.map(s => `<option value="${s.id}">${esc(pick(s,"name_zh","name_en"))}${s.verify_status==="pending"?" ⚠":""}</option>`).join("");
  document.getElementById("fromSel").innerHTML = opts;
  document.getElementById("toSel").innerHTML = opts;
  document.getElementById("toSel").selectedIndex = Math.min(6, STATIONS.length - 1);
}

/* ---------- 规划 ---------- */
function modes() { const m=[]; if(mWalk.checked)m.push("walk"); if(mBus.checked)m.push("bus"); return m; }
async function runPlan() {
  const body = { from_station:+fromSel.value, to_station:+toSel.value,
    depart:new Date(depart.value).toISOString(), modes:modes() };
  let res;
  try { res = await api("/api/plan/search", body); }
  catch(e){ if(e.status===409){ alert(t("same_name")); return; } throw e; }
  LAST_PLAN = res.status === "ok" ? res : null;
  renderPlan(res);
  drawMap(res);
  if (res.status === "ok") { renderProfile(res); }
}
function legRow(l) {
  return `<tr><td>${esc(l.from_name)} → ${esc(l.to_name)}</td><td>${t("mode_"+l.mode)||l.mode}</td>
    <td>${l.depart.slice(0,16).replace("T"," ")} → ${l.arrive.slice(11,16)}</td>
    <td>${l.duration_min}′${l.wait_min?` <span class="muted">(+${t("transfer_wait")} ${l.wait_min}′)</span>`:""}</td>
    <td>${l.effort_label ? esc(l.effort_label) : "—"}<br><span class="muted">${esc(l.effort_source||"")}</span></td>
    <td>${l.verify_status==="pending"?`<span class="pending">${t("pending_verify")}</span>`:"✓"}</td></tr>`;
}
function renderPlan(res) {
  const el = document.getElementById("planResult");
  const disc = document.getElementById("planDisclaimer");
  if (res.status === "ok") {
    el.innerHTML = `<p><span class="badge ok">${t("online")}</span>
      ${t("days")}: <b>${res.totals.days}</b> · ${t("minutes")}: <b>${res.totals.minutes}</b>
      · km: ${res.totals.distance_km ?? "?"} · ${t("data_version")}: ${res.sources.data_version}
      <button class="ghost" onclick="saveFav()">${t("save_fav")}</button></p>
      <table><thead><tr><th></th><th></th><th></th><th></th><th>${t("effort")}/${t("effort_src")}</th><th>${t("verify")}</th></tr></thead>
      <tbody>${res.legs.map(legRow).join("")}</tbody></table>`;
    disc.style.display = ""; disc.textContent = res.safety_disclaimer[LANG] || res.safety_disclaimer.zh;
  } else if (res.status === "unreachable") {
    const b = res.blocked || {};
    el.innerHTML = `<div class="gap-note"><b>${t("unreachable")}</b> — ${t("blocked_seg")}:
      ${esc(b.from_name||"")} → ${esc(b.to_name||"")} (${t("reason")}: <span class="closed">${esc(b.reason)}</span>
      ${b.announcement_title ? "· " + esc(b.announcement_title) : ""})<br>${t("gap_no_line")}</div>
      ${res.reachable_legs?.length ? `<table><tbody>${res.reachable_legs.map(legRow).join("")}</tbody></table>` : ""}`;
    disc.style.display = "none";
  } else {
    el.innerHTML = `<div class="gap-note">${esc(res.error||res.status)} ${res.station?esc(pick(res.station,"name_zh","name_en")):""}</div>`;
  }
}

/* ---------- 地图：缺口不直线相连 ---------- */
function drawMap(res) {
  const svg = document.getElementById("map");
  const pts = STATIONS.filter(s => s.lat && s.lon);
  if (!pts.length) return;
  const lats = pts.map(s=>s.lat), lons = pts.map(s=>s.lon);
  const X = lon => 40 + (lon - Math.min(...lons)) / (Math.max(...lons)-Math.min(...lons) || 1) * 920;
  const Y = lat => 320 - (lat - Math.min(...lats)) / (Math.max(...lats)-Math.min(...lats) || 1) * 280;
  const byId = Object.fromEntries(STATIONS.map(s=>[s.id,s]));
  let inner = "";
  const legs = res.status==="ok" ? res.legs : (res.reachable_legs||[]);
  for (const l of legs) {
    const a=byId[l.from_station], b=byId[l.to_station];
    if(!a||!b) continue;
    inner += `<line x1="${X(a.lon)}" y1="${Y(a.lat)}" x2="${X(b.lon)}" y2="${Y(b.lat)}"
      stroke="${l.mode==="bus"?"#1565c0":"#2e7d32"}" stroke-width="3"/>`;
  }
  if (res.status==="unreachable" && res.gaps) {   // 断路：红色叉标，不连线
    for (const g of res.gaps) {
      const a=byId[g.from_station], b=byId[g.to_station];
      if(!a||!b) continue;
      const mx=(X(a.lon)+X(b.lon))/2, my=(Y(a.lat)+Y(b.lat))/2;
      inner += `<text x="${mx}" y="${my}" font-size="22" fill="#b3261e" text-anchor="middle">✕✕✕</text>
        <text x="${mx}" y="${my+16}" font-size="11" fill="#b3261e" text-anchor="middle">${t("unreachable")} · ${t("no_straight")}</text>`;
    }
  }
  for (const s of pts) {
    inner += `<circle cx="${X(s.lon)}" cy="${Y(s.lat)}" r="6"
      fill="${s.verify_status==="pending"?"#fff":"#7a4a21"}" stroke="${s.verify_status==="pending"?"#b26a00":"#7a4a21"}"
      stroke-width="${s.verify_status==="pending"?2:1}" stroke-dasharray="${s.verify_status==="pending"?"3 2":"0"}"/>
      <text x="${X(s.lon)+9}" y="${Y(s.lat)+4}" font-size="11">${esc(pick(s,"name_zh","name_en"))}${s.verify_status==="pending"?" ⚠":""}</text>`;
  }
  svg.innerHTML = inner;
}

/* ---------- 高程剖面：缺失留空，绝不为 0 ---------- */
async function renderProfile(plan) {
  const ids = [plan.legs[0].from_station, ...plan.legs.map(l=>l.to_station)];
  const segs = plan.legs.map(l=>l.segment_id);
  const prof = await api("/api/plan/elevation-profile", {station_ids:ids, segment_ids:segs});
  document.getElementById("profilePolicy").textContent = prof.policy[LANG] || prof.policy.zh;
  const cv = document.getElementById("profile"), ctx = cv.getContext("2d");
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  ctx.clearRect(0,0,cv.width,cv.height);
  const P = prof.points, H = cv.height-30, W = cv.width-60;
  const known = P.filter(p=>p.elevation_m!=null).map(p=>p.elevation_m);
  const lo = Math.min(...known, 0) , hi = Math.max(...known, 1);
  const X = i => 40 + i*(W/(P.length-1||1));
  const Y = v => 10 + H - (v-lo)/(hi-lo||1)*H;
  ctx.strokeStyle="#ccc"; ctx.beginPath(); ctx.moveTo(40,10); ctx.lineTo(40,10+H); ctx.lineTo(40+W,10+H); ctx.stroke();
  let pen = false;
  P.forEach((p,i)=>{
    ctx.fillStyle="#2b2320"; ctx.font="10px sans-serif"; ctx.textAlign="center";
    ctx.fillText(LANG==="zh"?p.name_zh:p.name_en, X(i), 10+H+14);
    if (p.elevation_m == null) {   // 缺失：断线 + 灰色问号，绝不画到 0
      pen = false;
      ctx.fillStyle="#999"; ctx.font="14px sans-serif";
      ctx.fillText("?", X(i), 10+H/2);
      ctx.fillText(t("missing_elev"), X(i), 10+H/2+14);
      return;
    }
    ctx.strokeStyle = p.elevation_status==="estimated" ? "#b26a00" : "#2e7d32";
    ctx.setLineDash(p.elevation_status==="estimated" ? [4,3] : []);
    if (pen) { ctx.beginPath(); ctx.moveTo(X(i-1), Y(P[i-1].elevation_m)); ctx.lineTo(X(i), Y(p.elevation_m)); ctx.stroke(); }
    ctx.setLineDash([]); pen = true;
    ctx.fillStyle="#7a4a21"; ctx.beginPath(); ctx.arc(X(i), Y(p.elevation_m), 3, 0, 7); ctx.fill();
    ctx.fillText(p.elevation_m+"m", X(i), Y(p.elevation_m)-7);
  });
}

/* ---------- 方案比较 ---------- */
async function runCompare() {
  const body = { from_station:+fromSel.value, to_station:+toSel.value,
    depart:new Date(depart.value).toISOString(), prefs:{modes:modes(), max_days:5} };
  const r = await api("/api/plan/compare", body);
  const el = document.getElementById("compareResult");
  const cur = r.curated.map(c => `<div class="card"><b>${esc(pick(c,"name_zh","name_en"))}</b>
    <span class="badge ${c.status==="usable"?"ok":"bad"}">${c.status}</span> v#${c.route_version_id}
    ${c.totals?`· ${t("days")}:${c.totals.days}`:""}
    ${c.conflicts.map(x=>`<div class="closed">${t("conflicts")}: ${esc(x.reason)} (seg ${x.segment_id??"-"})</div>`).join("")}
    ${c.legs.map(legRow?l=>`<div class="muted">${esc(l.from_name)}→${esc(l.to_name)} ${l.duration_min}′</div>`:()=>{}).join("")}
    </div>`).join("") || `<div class="muted">—</div>`;
  const s = r.search;
  const gs = s.status==="ok"
    ? `<div class="card">${t("days")}: <b>${s.totals.days}</b> · ${t("minutes")}: ${s.totals.minutes}
       ${s.legs.map(l=>`<div class="muted">${esc(l.from_name)}→${esc(l.to_name)} ${l.duration_min}′ ${esc(l.effort_label||"")}(${esc(l.effort_source||"")})</div>`).join("")}</div>`
    : `<div class="gap-note">${t("unreachable")}: ${esc(s.blocked?.reason||"")}</div>`;
  el.innerHTML = `<div><h3>${t("curated")}</h3>${cur}</div><div><h3>${t("graph")}</h3>${gs}</div>`;
  const d = document.getElementById("compareDisclaimer");
  d.style.display=""; d.textContent = r.safety_disclaimer[LANG] || r.safety_disclaimer.zh;
}

/* ---------- 收藏：保留原依据，重连后展示变化 ---------- */
async function saveFav() {
  if (!LAST_PLAN) return;
  const name = prompt("plan name / 计划名", "plan-" + new Date().toISOString().slice(0,10));
  if (!name) return;
  const r = await api("/api/favorites", {client_id:CLIENT_ID, name, plan:LAST_PLAN});
  const local = JSON.parse(localStorage.getItem("favs")||"[]");
  local.push({id:r.favorite_id, name, basis:r.basis, plan:LAST_PLAN});
  localStorage.setItem("favs", JSON.stringify(local));
  loadFavs();
}
async function loadFavs() {
  let favs = [];
  try { favs = (await api("/api/favorites?client_id="+CLIENT_ID)).favorites
        .map(f=>({id:f.id, name:f.name, basis:f.basis, plan:f.plan})); }
  catch { favs = JSON.parse(localStorage.getItem("favs")||"[]"); }
  document.getElementById("favList").innerHTML = favs.map((f,i)=>
    `<div class="card"><b>${esc(f.name)}</b> <span class="muted">${t("data_version")}: ${f.basis.data_version}</span>
     <button class="ghost" onclick="diffFav(${i})">${t("changes_since")}</button></div>`).join("") || `<div class="muted">—</div>`;
  window._FAVS = favs;
}
async function diffFav(i) {
  const f = window._FAVS[i];
  const r = await api("/api/plans/diff", {basis:f.basis});
  document.getElementById("favChanges").innerHTML =
    `<h3>${t("changes_since")} — ${esc(f.name)}</h3>` +
    (r.changes.length ? r.changes.map(c=>{
      if (c.type==="late_announcement") return `<div class="change">⚠ ${t("late_ann")}:
        <b>${esc(pick(c,"title_zh","title_en"))}</b> (${c.effective_from.slice(0,10)}${c.affects_plan_dates?" · "+t("closed"):""})</div>`;
      if (c.type==="segment_updated") return `<div class="change">↻ ${t("seg_updated")}: seg ${c.segment_id} v${c.from_version}→v${c.to_version}</div>`;
      return `<div class="change">↩ ${t("route_changed")}: ${esc(c.route_key)} (#${c.saved_version_id}→#${c.current_version_id})</div>`;
    }).join("") : `<div class="muted">—</div>`);
}
async function refreshFavChanges(){ if (window._FAVS?.length) diffFav(0); }

/* ---------- 历史商路 / 公告 / 离线包 ---------- */
async function loadHistoric() {
  const r = await api("/api/historic-routes");
  document.getElementById("historicList").innerHTML = r.historic_routes.map(h =>
    `<div class="card"><b>${esc(pick(h,"name_zh","name_en"))}</b> <span class="badge warn">${esc(h.era)}</span>
     <div class="muted">${esc(h.usage_note[LANG])}</div>
     <div>${h.stops.map(s=>esc(s.station_name)).join(" → ")}</div></div>`).join("");
}
async function loadAnns() {
  const r = await api("/api/announcements");
  document.getElementById("annList").innerHTML = r.announcements.map(a =>
    `<div class="card"><span class="badge ${a.severity==="critical"?"bad":"warn"}">${esc(a.kind)}</span>
     <b>${esc(pick(a,"title_zh","title_en"))}</b>
     <div class="muted">${t("window")}: ${a.effective_from.slice(0,10)} → ${(a.effective_to||"…").slice(0,10)}
     · published ${a.published_at.slice(0,16).replace("T"," ")}</div></div>`).join("") || `<div class="muted">—</div>`;
}
document.getElementById("bundleBtn").onclick = async () => {
  const b = await api("/api/bundle");
  localStorage.setItem("bundle", JSON.stringify(b));
  alert(t("data_version") + " " + b.data_version);
};

async function renderAll(){ await Promise.all([loadStations(), loadHistoric(), loadAnns(), refreshMeta()]); loadFavs(); }
netStatus(); applyI18n(); renderAll();
