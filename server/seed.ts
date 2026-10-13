/** Seeds a believable demo persona: Meera, 74, living alone in Thrissur. */
import { db } from "./db.js";

const RESET = process.argv.includes("--reset");
if (RESET) {
  for (const t of ["med_logs", "check_ins", "rhythm_events", "alerts", "medications"]) db.prepare(`DELETE FROM ${t}`).run();
}

const medCount = (db.prepare(`SELECT COUNT(*) n FROM medications`).get() as any).n;
if (medCount > 0) { console.log("Already seeded (pass --reset to reseed)."); process.exit(0); }

const meds = [
  { name: "Amlodipine", dosage: "5mg", times: ["08:00"] },
  { name: "Metformin", dosage: "500mg", times: ["08:30", "20:30"] },
  { name: "Shelcal D3", dosage: "1000 IU", times: ["09:00"] },
];
const insMed = db.prepare(`INSERT INTO medications (name, dosage, times) VALUES (?, ?, ?)`);
for (const m of meds) insMed.run(m.name, m.dosage, JSON.stringify(m.times));

const insLog = db.prepare(`INSERT INTO med_logs (medication_id, scheduled_for, status, logged_at, note) VALUES (?, ?, ?, ?, ?)`);
const insEvent = db.prepare(`INSERT INTO rhythm_events (kind, happened_at, note) VALUES (?, ?, ?)`);
const insCheck = db.prepare(`INSERT INTO check_ins (scheduled_for, completed_at, mood, sleep_quality, notes, conversation_summary) VALUES (?, ?, ?, ?, ?, ?)`);
const medIds = (db.prepare(`SELECT id FROM medications ORDER BY id`).all() as any[]).map((r) => r.id);

const pad = (n: number) => String(n).padStart(2, "0");
const dt = (daysAgo: number, hhmm: string) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}:00`;
};
// Deterministic pseudo-random for a stable demo
let s = 42;
const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const kinds = ["breakfast", "walk", "call", "rest", "outing", "bedtime"] as const;
const moods = ["good", "good", "great", "okay", "good", "good", "okay"];

for (let ago = 14; ago >= 1; ago--) {
  // wake between 06:20 and 07:05
  const wakeMin = 380 + Math.floor(rand() * 45);
  insEvent.run("wake", dt(ago, `${pad(Math.floor(wakeMin / 60))}:${pad(wakeMin % 60)}`), null);
  const nEvents = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < nEvents; i++) {
    const k = kinds[Math.floor(rand() * kinds.length)];
    const hh = pad(9 + Math.floor(rand() * 10));
    insEvent.run(k, dt(ago, `${hh}:${pad(Math.floor(rand() * 60))}`), null);
  }
  // meds: ~87% taken
  for (const [i, id] of medIds.entries()) {
    const times = meds[i].times;
    for (const t of times) {
      const taken = rand() < 0.87;
      insLog.run(id, dt(ago, t), taken ? "taken" : "missed", dt(ago, t), null);
    }
  }
  if (ago <= 7) {
    const mood = moods[ago % moods.length];
    insCheck.run(dt(ago, "09:30"), dt(ago, "09:34"), mood, rand() < 0.7 ? "restful" : "fair",
      ago === 2 ? "Mentioned her knee was bothering her on the stairs." : null,
      "Morning chat: slept fine, planning to water the garden.");
  }
}
insEvent.run("wake", dt(0, "06:47"), null);
db.prepare(`INSERT INTO check_ins (scheduled_for) VALUES (?)`).run(dt(0, "09:30"));
db.prepare(`INSERT INTO alerts (level, title, body) VALUES ('info', 'Tend is set up', 'Daily check-ins are scheduled for 09:30. Meera gets a gentle call each morning.')`).run();

console.log("Seeded demo persona: 14 days of rhythm events, 3 medications with dose logs, 7 check-ins, today's schedule.");
