import { db, nowLocal, todayDate } from "./db.js";

/** Deterministic, explainable care logic. No ML - rules a family can read and trust. */

export interface RhythmBaseline {
  avgWakeMinutes: number | null;   // minutes since midnight
  avgEventsPerDay: number;
  daysObserved: number;
}

export function computeBaseline(days = 14): RhythmBaseline {
  const rows = db.prepare(`
    SELECT kind, happened_at FROM rhythm_events
    WHERE date(happened_at) >= date('now', 'localtime', ?)
    ORDER BY happened_at
  `).all(`-${days} days`) as { kind: string; happened_at: string }[];

  const wakeMinutes: number[] = [];
  const perDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.happened_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    if (r.kind === "wake") {
      const t = r.happened_at.slice(11, 16).split(":");
      wakeMinutes.push(parseInt(t[0]) * 60 + parseInt(t[1]));
    }
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return {
    avgWakeMinutes: avg(wakeMinutes),
    avgEventsPerDay: perDay.size ? [...perDay.values()].reduce((s, x) => s + x, 0) / perDay.size : 0,
    daysObserved: perDay.size,
  };
}

export function adherenceFor(medicationId: number, days = 7) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as n FROM med_logs
    WHERE medication_id = ? AND date(scheduled_for) >= date('now', 'localtime', ?)
    GROUP BY status
  `).all(medicationId, `-${days} days`) as { status: string; n: number }[];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const taken = byStatus["taken"] ?? 0;
  const missed = byStatus["missed"] ?? 0;
  const skipped = byStatus["skipped"] ?? 0;
  const total = taken + missed + skipped;
  return { taken, missed, skipped, total, pct: total ? Math.round((taken / total) * 100) : null };
}

/** Evaluate today's signals against the baseline; create alerts when something is meaningfully off. */
export function evaluateAnomalies(): string[] {
  const findings: string[] = [];
  const base = computeBaseline(14);
  const today = todayDate();

  const wakeToday = db.prepare(`
    SELECT happened_at FROM rhythm_events WHERE kind = 'wake' AND date(happened_at) = ?
    ORDER BY happened_at LIMIT 1
  `).get(today) as { happened_at: string } | undefined;

  const recentAttention = db.prepare(`
    SELECT COUNT(*) as n FROM alerts WHERE level IN ('attention','urgent') AND date(created_at) = ?
  `).get(today) as { n: number };

  const raise = (level: string, title: string, body: string) => {
    db.prepare(`INSERT INTO alerts (level, title, body) VALUES (?, ?, ?)`).run(level, title, body);
    findings.push(title);
  };

  if (base.avgWakeMinutes !== null && wakeToday && recentAttention.n === 0) {
    const t = wakeToday.happened_at.slice(11, 16).split(":");
    const mins = parseInt(t[0]) * 60 + parseInt(t[1]);
    if (mins - base.avgWakeMinutes > 90) {
      raise("attention", "Woke much later than usual", `Wake time was ${wakeToday.happened_at.slice(11, 16)}, over 90 minutes past the 14-day average.`);
    }
  }

  const lowMoods = db.prepare(`
    SELECT COUNT(*) as n FROM check_ins
    WHERE mood IN ('low','unwell') AND date(completed_at) >= date('now', 'localtime', '-2 days')
  `).get() as { n: number };
  if (lowMoods.n >= 2 && recentAttention.n === 0) {
    raise("attention", "Low mood reported twice this week", "Two recent check-ins reported feeling low or unwell. A call today would mean a lot.");
  }

  const missesToday = db.prepare(`
    SELECT COUNT(*) as n FROM med_logs WHERE status = 'missed' AND date(scheduled_for) = ?
  `).get(today) as { n: number };
  if (missesToday.n >= 2) {
    raise("urgent", "Multiple doses missed today", `${missesToday.n} medication doses were missed today. Please check in directly.`);
  }

  return findings;
}

export function weeklySummary(days = 7): string {
  const meds = db.prepare(`SELECT * FROM medications WHERE active = 1`).all() as any[];
  const lines: string[] = [];
  for (const m of meds) {
    const a = adherenceFor(m.id, days);
    if (a.pct !== null) lines.push(`${m.name} ${m.dosage}: ${a.pct}% adherence (${a.taken}/${a.total} doses)`);
  }
  const ci = db.prepare(`
    SELECT COUNT(*) as n, GROUP_CONCAT(DISTINCT mood) as moods FROM check_ins
    WHERE completed_at IS NOT NULL AND date(completed_at) >= date('now', 'localtime', ?)
  `).get(`-${days} days`) as any;
  const base = computeBaseline(14);
  const wake = base.avgWakeMinutes !== null
    ? `${String(Math.floor(base.avgWakeMinutes / 60)).padStart(2, "0")}:${String(Math.round(base.avgWakeMinutes % 60)).padStart(2, "0")}`
    : "not enough data";
  const moodList = ci.moods ? String(ci.moods).split(",") : [];
  const moodText = moodList.length
    ? moodList.every((x: string) => ["good", "great"].includes(x))
      ? "in good spirits"
      : moodList.some((x: string) => ["low", "unwell"].includes(x))
        ? "with some harder days"
        : "mostly steady"
    : null;
  const medPhrases = lines.map((l) => {
    const m = l.match(/^(.*): (\d+)% adherence/);
    if (!m) return l;
    const n = Number(m[2]);
    const word = n >= 95 ? "spot on" : n >= 85 ? "holding well" : "in need of a gentle nudge";
    return `${m[1]} is ${word} at ${m[2]}%`;
  });
  const medText = medPhrases.length ? medPhrases.join(", ") + "." : "No active medications right now.";
  const parts = [
    `Over the past ${days} days she completed ${ci.n} check-ins${moodText ? `, mostly feeling ${moodText}` : ""}.`,
    medText,
    base.avgWakeMinutes !== null
      ? `She's usually up around ${wake}, with about ${Math.round(base.avgEventsPerDay)} everyday activities logged each day.`
      : `The routine baseline is still forming.`,
  ];
  return parts.join(" ");
}

export { nowLocal, todayDate };
