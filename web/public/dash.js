const $ = (id) => document.getElementById(id);

function ring(pct) {
  const p = pct === null ? 0 : pct;
  const c = 2 * Math.PI * 26;
  const off = c - (p / 100) * c;
  const label = pct === null ? " - " : pct + "%";
  return `<svg class="ring" width="64" height="64" viewBox="0 0 64 64">
    <circle class="track" cx="32" cy="32" r="26" fill="none" stroke-width="7"/>
    <circle class="val" cx="32" cy="32" r="26" fill="none" stroke-width="7"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle" font-size="13">${label}</text>
  </svg>`;
}

function render(d) {
  $("today").textContent = d.today;

  // check-in
  const ci = d.checkIn;
  $("checkin").innerHTML = ci
    ? (ci.completed_at
      ? `<div class="big">${ci.mood ?? "done"}</div>
         <div class="muted">Completed at ${(ci.completed_at || "").slice(11, 16)}${ci.sleep_quality ? ` · sleep: ${ci.sleep_quality}` : ""}</div>
         ${ci.notes ? `<p style="margin-top:8px">${escapeHtml(ci.notes)}</p>` : ""}
         ${ci.conversation_summary ? `<p class="muted" style="margin-top:6px">“${escapeHtml(ci.conversation_summary)}”</p>` : ""}
         <p style="margin-top:10px"><span class="pill ok">done</span></p>`
      : `<div class="big">${(ci.scheduled_for || "").slice(11, 16)}</div>
         <div class="muted">Scheduled  -  not yet completed</div>
         <p style="margin-top:10px"><span class="pill wait">waiting</span></p>`)
    : `<div class="muted">No check-in scheduled today.</div>`;

  // meds
  $("meds").innerHTML = d.meds.map((m) => {
    const doses = m.times.map((t, i) => `<span class="dose ${m.todayLogs[i] ?? ""}" title="${t}: ${m.todayLogs[i] ?? "pending"}"></span>`).join("");
    return `<div class="med-row">${ring(m.adherence7d.pct)}
      <div style="flex:1">
        <div class="med-name">${escapeHtml(m.name)} <span class="muted">${escapeHtml(m.dosage)}</span></div>
        <div class="muted">${m.times.join(" · ")} &nbsp; ${doses}</div>
      </div>
      <div class="muted">${m.adherence7d.taken}/${m.adherence7d.total} doses</div>
    </div>`;
  }).join("") || `<div class="muted">No medications.</div>`;

  // rhythm chart: wake time line + events/day bars, 14 days
  const days = d.perDay.map((r) => r.d);
  const wakes = Object.fromEntries(d.wakeRows.map((r) => [r.d, r.t]));
  const W = 640, H = 150, padL = 34, padB = 22, padT = 10;
  const iw = W - padL - 8, ih = H - padT - padB;
  const wakeMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const wvals = days.map((dd) => wakes[dd] ? wakeMin(wakes[dd]) : null).filter((v) => v !== null);
  const wMin = Math.min(...wvals, 360), wMax = Math.max(...wvals, 480);
  const maxN = Math.max(...d.perDay.map((r) => r.n), 1);
  const bw = iw / days.length;
  let bars = "", pts = [];
  days.forEach((dd, i) => {
    const n = d.perDay[i].n;
    const bh = (n / maxN) * (ih * 0.55);
    const x = padL + i * bw + bw * 0.18;
    bars += `<rect x="${x.toFixed(1)}" y="${(padT + ih - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="#e3ede4"/>`;
    if (wakes[dd]) {
      const y = padT + ((wakeMin(wakes[dd]) - wMin) / Math.max(wMax - wMin, 1)) * ih;
      pts.push([padL + i * bw + bw / 2, y]);
    }
  });
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="#4a7c59"/>`).join("");
  const xlabels = days.map((dd, i) => i % 2 === 0 ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" font-size="9" fill="#6b6459" text-anchor="middle">${dd.slice(5)}</text>` : "").join("");
  const wakeLine = d.baseline.avgWakeMinutes !== null
    ? (() => { const y = padT + ((d.baseline.avgWakeMinutes - wMin) / Math.max(wMax - wMin, 1)) * ih;
        return `<line x1="${padL}" x2="${W - 8}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#c05621" stroke-dasharray="4 4" stroke-width="1"/>`; })()
    : "";
  $("rhythm").innerHTML = `<svg class="spark" viewBox="0 0 ${W} ${H}">${bars}<path d="${path}" fill="none" stroke="#4a7c59" stroke-width="2"/>${dots}${wakeLine}${xlabels}</svg>
    <div class="muted">14-day baseline wake ${fmtMin(d.baseline.avgWakeMinutes)} · ${d.baseline.avgEventsPerDay.toFixed(1)} activities/day · dashed line = usual wake time</div>`;

  // alerts
  $("alerts").innerHTML = d.alerts.length ? d.alerts.map((a) => `
    <div class="alert ${a.acknowledged_at ? "acked" : ""}">
      <div>
        <span class="pill ${a.level}">${a.level}</span>
        <div class="ttl" style="margin-top:5px">${escapeHtml(a.title)}</div>
        <div class="bd">${escapeHtml(a.body)}</div>
        <div class="when">${a.created_at}</div>
      </div>
      ${a.acknowledged_at ? "" : `<button data-ack="${a.id}">Acknowledge</button>`}
    </div>`).join("") : `<div class="muted">Nothing needs you right now.</div>`;
  document.querySelectorAll("[data-ack]").forEach((b) => b.onclick = async () => {
    await fetch(`/api/alerts/${b.dataset.ack}/ack`, { method: "POST" });
  });

  // timeline
  $("timeline").innerHTML = d.recentEvents.map((e) => `
    <div class="ev"><span class="t">${e.happened_at.slice(5, 16)}</span><span class="kind">${escapeHtml(e.kind)}</span><span class="muted">${escapeHtml(e.note ?? "")}</span></div>
  `).join("");
}

function fmtMin(mins) {
  if (mins === null || mins === undefined) return " - ";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

fetch("/api/dashboard").then((r) => r.json()).then(render);
const es = new EventSource("/api/events");
es.onmessage = (e) => render(JSON.parse(e.data));
