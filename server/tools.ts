import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db, nowLocal, todayDate } from "./db.js";
import { adherenceFor, computeBaseline, evaluateAnomalies, weeklySummary } from "./logic.js";

type Text = { type: "text"; text: string };
const reply = (text: string, data?: unknown) => ({
  content: [{ type: "text", text } as Text],
  structuredContent: (data ?? { message: text }) as Record<string, unknown>,
});

export function registerTendTools(server: McpServer) {
  server.registerTool("get_today_brief", {
    title: "Today's care brief",
    description: "Everything due for the parent today: check-in status, medication doses with windows, open alerts, and how the week looks. Call this first in any conversation about their day.",
    inputSchema: {},
  }, () => {
    const today = todayDate();
    const checkIn = db.prepare(`SELECT * FROM check_ins WHERE date(scheduled_for) = ? ORDER BY scheduled_for LIMIT 1`).get(today) as any;
    const meds = (db.prepare(`SELECT * FROM medications WHERE active = 1`).all() as any[]).map((m) => {
      const times = JSON.parse(m.times) as string[];
      const logs = db.prepare(`SELECT status FROM med_logs WHERE medication_id = ? AND date(scheduled_for) = ?`).all(m.id, today) as any[];
      const a = adherenceFor(m.id, 7);
      return { name: m.name, dosage: m.dosage, times, logged: logs.map((l) => l.status), adherence7d: a.pct };
    });
    const alerts = db.prepare(`SELECT id, level, title, created_at FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 5`).all();
    const data = {
      date: today,
      checkIn: checkIn ? { scheduledFor: checkIn.scheduled_for, completed: !!checkIn.completed_at, mood: checkIn.mood } : null,
      medications: meds,
      openAlerts: alerts,
    };
    const text = [
      `Brief for ${today}.`,
      checkIn ? (checkIn.completed_at ? `Check-in done (mood: ${checkIn.mood ?? "not recorded"}).` : `Check-in scheduled ${checkIn.scheduled_for.slice(11, 16)}, not done yet.`) : "No check-in scheduled today.",
      ...meds.map((m) => `${m.name} ${m.dosage} at ${m.times.join(", ")}${m.logged.length ? ` - today: ${m.logged.join(", ")}` : " - nothing logged yet"} (7-day adherence ${m.adherence7d ?? "n/a"}%).`),
      (alerts as any[]).length ? `${(alerts as any[]).length} open alert(s).` : "No open alerts.",
    ].join(" ");
    return reply(text, data);
  });

  server.registerTool("schedule_check_in", {
    title: "Schedule a check-in",
    description: "Schedule a daily voice check-in for the parent at a local time (HH:MM), optionally on a specific date (YYYY-MM-DD, default today).",
    inputSchema: { time: z.string().regex(/^\d{2}:\d{2}$/).describe("Local time, 24h, e.g. 09:30"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  }, ({ time, date }) => {
    const day = date ?? todayDate();
    const scheduledFor = `${day} ${time}:00`;
    const existing = db.prepare(`SELECT id FROM check_ins WHERE date(scheduled_for) = ? AND completed_at IS NULL`).get(day);
    if (existing) {
      db.prepare(`UPDATE check_ins SET scheduled_for = ? WHERE id = ?`).run(scheduledFor, (existing as any).id);
      return reply(`Moved today's check-in to ${time}.`, { id: (existing as any).id, scheduledFor });
    }
    const r = db.prepare(`INSERT INTO check_ins (scheduled_for) VALUES (?)`).run(scheduledFor);
    return reply(`Check-in scheduled for ${day} at ${time}.`, { id: r.lastInsertRowid, scheduledFor });
  });

  server.registerTool("log_check_in", {
    title: "Log a completed check-in",
    description: "Record the outcome of a voice check-in conversation: mood, sleep quality, free-text notes, and a one-line conversation summary. Also evaluates wellbeing signals and alerts family if something looks off.",
    inputSchema: {
      mood: z.enum(["great", "good", "okay", "low", "unwell"]),
      sleep_quality: z.enum(["restful", "fair", "poor"]).optional(),
      notes: z.string().optional(),
      conversation_summary: z.string().optional(),
    },
  }, ({ mood, sleep_quality, notes, conversation_summary }) => {
    const today = todayDate();
    const existing = db.prepare(`SELECT id FROM check_ins WHERE date(scheduled_for) = ? AND completed_at IS NULL ORDER BY scheduled_for LIMIT 1`).get(today) as any;
    const fields = [nowLocal(), mood, sleep_quality ?? null, notes ?? null, conversation_summary ?? null];
    let id: number;
    if (existing) {
      db.prepare(`UPDATE check_ins SET completed_at=?, mood=?, sleep_quality=?, notes=?, conversation_summary=? WHERE id=?`).run(...fields, existing.id);
      id = existing.id;
    } else {
      const r = db.prepare(`INSERT INTO check_ins (scheduled_for, completed_at, mood, sleep_quality, notes, conversation_summary) VALUES (?,?,?,?,?,?)`).run(`${today} 09:00:00`, ...fields);
      id = Number(r.lastInsertRowid);
    }
    const findings = evaluateAnomalies();
    const text = findings.length
      ? `Check-in logged (mood: ${mood}). Note: ${findings.join("; ")} - the family dashboard has been updated.`
      : `Check-in logged for ${today} - mood: ${mood}${sleep_quality ? `, sleep: ${sleep_quality}` : ""}.`;
    return reply(text, { id, mood, anomalyFindings: findings });
  });

  server.registerTool("add_medication", {
    title: "Add a medication",
    description: "Register a medication with dosage and daily dose times (local HH:MM list).",
    inputSchema: { name: z.string(), dosage: z.string().describe('e.g. "5mg"'), times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1) },
  }, ({ name, dosage, times }) => {
    const r = db.prepare(`INSERT INTO medications (name, dosage, times) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET dosage=excluded.dosage, times=excluded.times, active=1`).run(name, dosage, JSON.stringify(times));
    return reply(`${name} ${dosage} added, ${times.length} dose(s) daily at ${times.join(", ")}.`, { id: r.lastInsertRowid, name, dosage, times });
  });

  server.registerTool("log_medication_taken", {
    title: "Log a medication dose",
    description: "Record that a dose was taken, missed, or skipped. Matches medication by name (case-insensitive, partial ok).",
    inputSchema: {
      medication: z.string().describe("Medication name or part of it"),
      status: z.enum(["taken", "missed", "skipped"]),
      note: z.string().optional(),
    },
  }, ({ medication, status, note }) => {
    const med = db.prepare(`SELECT * FROM medications WHERE active = 1 AND lower(name) LIKE lower(?) ORDER BY length(name) LIMIT 1`).get(`%${medication}%`) as any;
    if (!med) return reply(`I couldn't find an active medication matching "${medication}".`, { error: "not_found", medication });
    db.prepare(`INSERT INTO med_logs (medication_id, scheduled_for, status, note) VALUES (?, ?, ?, ?)`).run(med.id, nowLocal(), status, note ?? null);
    if (status === "taken") db.prepare(`INSERT INTO rhythm_events (kind, note) VALUES ('other', ?)`).run(`Took ${med.name}`);
    const findings = evaluateAnomalies();
    const text = status === "taken"
      ? `Logged: ${med.name} ${med.dosage} taken.`
      : `Logged: ${med.name} ${status}. ${findings.length ? findings.join("; ") + "." : ""}`;
    return reply(text, { medication: med.name, status, anomalyFindings: findings });
  });

  server.registerTool("get_adherence", {
    title: "Medication adherence report",
    description: "Adherence percentages per medication over the last N days (default 7), with taken/missed/skipped counts.",
    inputSchema: { days: z.number().int().min(1).max(90).optional() },
  }, ({ days }) => {
    const d = days ?? 7;
    const meds = (db.prepare(`SELECT * FROM medications WHERE active = 1`).all() as any[]).map((m) => ({ name: m.name, dosage: m.dosage, ...adherenceFor(m.id, d) }));
    const text = meds.length
      ? `Adherence, last ${d} days: ` + meds.map((m) => `${m.name} ${m.pct ?? "n/a"}% (${m.taken}/${m.total})`).join("; ") + "."
      : "No active medications to report on.";
    return reply(text, { days: d, medications: meds });
  });

  server.registerTool("record_rhythm_event", {
    title: "Record a daily-rhythm event",
    description: "Log an everyday activity - waking up, a walk, a meal, a phone call, going out, bedtime. These build the routine baseline that anomaly detection compares against.",
    inputSchema: {
      kind: z.enum(["wake", "breakfast", "walk", "call", "rest", "outing", "bedtime", "other"]),
      note: z.string().optional(),
      happened_at: z.string().optional().describe('Local "YYYY-MM-DD HH:MM", default now'),
    },
  }, ({ kind, note, happened_at }) => {
    const at = happened_at ? (happened_at.length === 16 ? `${happened_at}:00` : happened_at) : nowLocal();
    db.prepare(`INSERT INTO rhythm_events (kind, happened_at, note) VALUES (?, ?, ?)`).run(kind, at, note ?? null);
    const findings = evaluateAnomalies();
    return reply(`Recorded: ${kind}${note ? ` (${note})` : ""}.`, { kind, happenedAt: at, anomalyFindings: findings });
  });

  server.registerTool("get_rhythm_summary", {
    title: "Routine rhythm summary",
    description: "Summarizes the daily-rhythm baseline (typical wake time, activity counts per day) and the last N days of events, flagging deviations.",
    inputSchema: { days: z.number().int().min(1).max(30).optional() },
  }, ({ days }) => {
    const d = days ?? 7;
    const base = computeBaseline(14);
    const events = db.prepare(`
      SELECT kind, happened_at, note FROM rhythm_events
      WHERE date(happened_at) >= date('now', 'localtime', ?) ORDER BY happened_at DESC LIMIT 60
    `).all(`-${d} days`) as any[];
    const wake = base.avgWakeMinutes !== null
      ? `${String(Math.floor(base.avgWakeMinutes / 60)).padStart(2, "0")}:${String(Math.round(base.avgWakeMinutes % 60)).padStart(2, "0")}` : null;
    const text = wake
      ? `Across ${base.daysObserved} observed days, typical wake time is ${wake} and ${base.avgEventsPerDay.toFixed(1)} activities are logged per day. ${events.length} events in the last ${d} days.`
      : `Not enough baseline yet - ${events.length} events in the last ${d} days across ${base.daysObserved} observed days.`;
    return reply(text, { baseline: base, typicalWake: wake, recentEvents: events });
  });

  server.registerTool("notify_family", {
    title: "Notify the family",
    description: "Post a message to the family dashboard. Use level 'info' for everyday updates, 'attention' when something deserves a call, 'urgent' only for situations needing immediate action.",
    inputSchema: { level: z.enum(["info", "attention", "urgent"]), title: z.string(), message: z.string() },
  }, ({ level, title, message }) => {
    const r = db.prepare(`INSERT INTO alerts (level, title, body) VALUES (?, ?, ?)`).run(level, title, message);
    return reply(`Family dashboard updated (${level}): ${title}.`, { id: r.lastInsertRowid, level, title });
  });

  server.registerTool("get_care_summary", {
    title: "Weekly care summary",
    description: "A digest of the last N days: check-ins and moods, per-medication adherence, routine baseline. Good for a weekly family review.",
    inputSchema: { days: z.number().int().min(1).max(30).optional() },
  }, ({ days }) => {
    const text = weeklySummary(days ?? 7);
    return reply(text, { summary: text });
  });
}
