import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, todayDate } from "../server/db.js";
import { adherenceFor, computeBaseline } from "../server/logic.js";
import { chat, type TraceEvent } from "./agent.js";

const PORT = Number(process.env.TEND_WEB_PORT ?? 7702);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (e: TraceEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const reply = await chat(String(req.body?.message ?? ""), req.body?.history ?? [], send);
    res.write(`data: ${JSON.stringify({ kind: "done", text: reply })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ kind: "error", text: err?.message ?? "unknown error" })}\n\n`);
  }
  res.end();
});

function dashboardData() {
  const today = todayDate();
  const checkIn = db.prepare(`SELECT * FROM check_ins WHERE date(scheduled_for) = ? ORDER BY scheduled_for LIMIT 1`).get(today);
  const meds = (db.prepare(`SELECT * FROM medications WHERE active = 1`).all() as any[]).map((m) => {
    const logs = db.prepare(`SELECT status, scheduled_for FROM med_logs WHERE medication_id = ? AND date(scheduled_for) = ? ORDER BY scheduled_for`).all(m.id, today) as any[];
    return { id: m.id, name: m.name, dosage: m.dosage, times: JSON.parse(m.times), todayLogs: logs.map((l) => l.status), adherence7d: adherenceFor(m.id, 7) };
  });
  const alerts = db.prepare(`SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 20`).all();
  const wakeRows = db.prepare(`
    SELECT date(happened_at) d, MIN(time(happened_at)) t FROM rhythm_events
    WHERE kind='wake' AND date(happened_at) >= date('now','localtime','-13 days') GROUP BY d ORDER BY d
  `).all();
  const perDay = db.prepare(`
    SELECT date(happened_at) d, COUNT(*) n FROM rhythm_events
    WHERE date(happened_at) >= date('now','localtime','-13 days') GROUP BY d ORDER BY d
  `).all();
  const recentEvents = db.prepare(`SELECT kind, happened_at, note FROM rhythm_events ORDER BY happened_at DESC, id DESC LIMIT 12`).all();
  const moods = db.prepare(`SELECT date(completed_at) d, mood FROM check_ins WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 7`).all();
  return { today, checkIn, meds, alerts, wakeRows, perDay, recentEvents, moods, baseline: computeBaseline(14) };
}

app.get("/api/dashboard", (_req, res) => res.json(dashboardData()));

app.post("/api/alerts/:id/ack", (req, res) => {
  db.prepare(`UPDATE alerts SET acknowledged_at = datetime('now','localtime') WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// Live dashboard updates over SSE (poll the shared SQLite db).
app.get("/api/events", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let last = "";
  const timer = setInterval(() => {
    const payload = JSON.stringify(dashboardData());
    if (payload !== last) { last = payload; res.write(`data: ${payload}\n\n`); }
  }, 2000);
  req.on("close", () => clearInterval(timer));
});

app.listen(PORT, () => console.log(`tend web on http://127.0.0.1:${PORT} (sim at /, family dashboard at /dashboard.html)`));
