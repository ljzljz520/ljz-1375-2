let TOK = sessionStorage.getItem("adm") || "admin-dev-token";
const H = () => ({"Content-Type":"application/json", "X-Admin-Token": TOK});
const api = async (u, body) => {
  const r = await fetch(u, body ? {method:"POST", headers:H(), body:JSON.stringify(body)} : {headers:H()});
  if (!r.ok) throw new Error((await r.json()).detail || r.status);
  return r.json();
};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function saveTok(){ TOK = document.getElementById("token").value; sessionStorage.setItem("adm", TOK); loadAll(); }
document.getElementById("token").value = TOK;

async function loadPending() {
  const p = await api("/api/admin/pending");
  document.getElementById("pending").innerHTML =
    p.pending_stations.map(s => `<div class="card">⚠ 驿站 #${s.id} ${esc(s.name_zh)}
      ${s.same_name_group ? `(同名组: ${s.same_name_group.join(",")})` : ""}
      <button onclick="verifyStation(${s.id})">确认核实</button></div>`).join("") +
    p.pending_segments.map(g => `<div class="card">⚠ 路段 #${g.id} (${g.from_station}→${g.to_station})
      <button onclick="verifySegment(${g.id})">确认核实</button></div>`).join("") || "<div class=muted>无</div>";
}
async function verifyStation(id){ await api(`/api/admin/stations/${id}/verify`, {}); loadAll(); }
async function verifySegment(id){ await api(`/api/admin/segments/${id}/verify`, {}); loadAll(); }

async function loadSegments() {
  const d = await api("/api/segments");
  const st = (await api("/api/stations")).stations;
  const nm = Object.fromEntries(st.map(s=>[s.id, s.name_zh]));
  document.querySelector("#segTable tbody").innerHTML = d.segments.map(g =>
    `<tr><td>${g.id}</td><td>${esc(nm[g.from_station])} → ${esc(nm[g.to_station])}</td>
     <td>${g.mode}</td><td>${g.duration_min}′</td>
     <td>${esc(g.effort_label||"—")}<br><span class=muted>${esc(g.effort_source||"")}</span></td>
     <td>${(g.windows||[]).map(w=>`${w.kind}/${w.effect} ${w.start_hhmm||w.date_start||""}–${w.end_hhmm||w.date_end||""}`).join("<br>")||"—"}
         ${g.seasonal_months?`<br><span class=muted>季节:${esc(g.seasonal_months)}</span>`:""}</td>
     <td>${g.verify_status==="pending"?'<span class=pending>待核</span>':"✓"} v${g.version}</td>
     <td>${g.verify_status==="pending"?`<button class=ghost onclick="verifySegment(${g.id})">核实</button>`:""}</td></tr>`).join("");
  const opts = d.segments.map(g=>`<option value="${g.id}">#${g.id} ${esc(nm[g.from_station])}→${esc(nm[g.to_station])}</option>`).join("");
  document.getElementById("aSeg").innerHTML = opts;
  document.getElementById("wSeg").innerHTML = opts;
}
async function publish() {
  await api("/api/admin/announcements", {
    kind: aKind.value, segment_id:+aSeg.value,
    title_zh: aTitleZh.value, title_en: aTitleEn.value || aTitleZh.value,
    effective_from: new Date(aFrom.value).toISOString(),
    effective_to: aTo.value ? new Date(aTo.value).toISOString() : null,
    severity: aSev.value });
  aTitleZh.value = aTitleEn.value = ""; loadAll();
}
async function addWindow() {
  const daily = wKind.value === "daily";
  await api(`/api/admin/segments/${wSeg.value}/windows`, {
    kind: wKind.value, effect: wEffect.value,
    start_hhmm: daily ? wStart.value : null, end_hhmm: daily ? wEnd.value : null,
    date_start: daily ? null : wStart.value, date_end: daily ? null : wEnd.value });
  loadAll();
}
async function loadAnns() {
  const r = await api("/api/announcements");
  document.getElementById("annList").innerHTML = r.announcements.map(a =>
    `<div class="card"><span class="badge ${a.severity==="critical"?"bad":"warn"}">${a.kind}</span>
     <b>${esc(a.title_zh)}</b> <span class=muted>${a.effective_from.slice(0,10)}→${(a.effective_to||"…").slice(0,10)}
     · 发布 ${a.published_at.slice(0,19).replace("T"," ")}</span></div>`).join("") || "—";
}
async function loadRV() {
  const r = await api("/api/admin/route-versions");
  document.getElementById("rvList").innerHTML = r.route_versions.map(v =>
    `<div class="card">#${v.id} <b>${esc(v.name_zh)}</b> [${esc(v.route_key)}]
     <span class="badge ${v.status==="current"?"ok":"off"}">${v.status}</span>
     <span class=muted>${esc(v.note||"")} ${v.created_at.slice(0,16).replace("T"," ")}</span>
     ${v.status!=="current"?`<button class=ghost onclick="rollback(${v.id})">回退到此版本</button>`:""}</div>`).join("");
}
async function rollback(id){ if(confirm("回退到此版本？")) { await api(`/api/admin/route-versions/${id}/rollback`, {}); loadAll(); } }
async function loadAll(){
  try { await Promise.all([loadPending(), loadSegments(), loadAnns(), loadRV()]);
    const m = await api("/api/meta");
    document.getElementById("verBadge").textContent = "data_version " + m.data_version;
  } catch(e){ document.getElementById("pending").innerHTML = `<div class="gap-note">${esc(e.message)}</div>`; }
}
loadAll();
