const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load() {
  applyI18n();
  const d = await (await fetch("/api/catalog?lang=" + LANG)).json();
  document.getElementById("verBadge").textContent = t("data_version") + " " + d.data_version;
  document.getElementById("catStations").innerHTML = d.stations.map(s =>
    `<li><b>${esc(s.name)}</b> [${esc(s.code)}] — ${t("elevation")}: ${esc(s.elevation)}
     ${s.verify === "pending" ? `<span class="pending">[${t("pending")}] ${esc(s.pending_note||"")}</span>` : ""}</li>`).join("");
  document.getElementById("catSegments").innerHTML = d.segments.map(g =>
    `<li>${esc(g.from)} → ${esc(g.to)} · ${esc(g.mode)} · ${g.duration_min}′
     ${g.effort ? `· ${t("effort")}: ${esc(g.effort.label)} <span class="muted">(${t("effort_src")}: ${esc(g.effort.source||"")})</span>` : ""}
     ${g.windows?.length ? `· ${t("window")}: ${g.windows.map(w=>`${w.kind}/${w.effect} ${w.start_hhmm||w.date_start||""}–${w.end_hhmm||w.date_end||""}`).join("; ")}` : ""}
     ${g.verify === "pending" ? `<span class="pending">[${t("pending_verify")}] ${esc(g.pending_note||"")}</span>` : ""}</li>`).join("");
  document.getElementById("catAnns").innerHTML = d.announcements.map(a =>
    `<li><span class="badge ${a.severity==="critical"?"bad":"warn"}">${esc(a.kind)}</span>
     <b>${esc(LANG==="zh"?a.title_zh:a.title_en)}</b>
     <span class="muted">${a.effective_from.slice(0,10)} → ${(a.effective_to||"…").slice(0,10)}
     · published ${a.published_at.slice(0,10)}</span></li>`).join("") || "<li>—</li>";
  document.getElementById("catDisclaimer").textContent = d.disclaimer[LANG] || d.disclaimer.zh;
  document.getElementById("catPendingNote").textContent = d.pending_explained;
}
load();
