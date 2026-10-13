import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.TEND_DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "tend.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS check_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheduled_for TEXT NOT NULL,          -- ISO date-time, local
  completed_at TEXT,
  mood TEXT,                            -- great | good | okay | low | unwell
  sleep_quality TEXT,                   -- restful | fair | poor
  notes TEXT,
  conversation_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  dosage TEXT NOT NULL,
  times TEXT NOT NULL,                  -- JSON array of "HH:MM" local times
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS med_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications(id),
  scheduled_for TEXT NOT NULL,          -- ISO date-time of the dose window
  status TEXT NOT NULL,                 -- taken | missed | skipped
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS rhythm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                   -- wake | breakfast | walk | call | rest | outing | bedtime | other
  happened_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  level TEXT NOT NULL,                  -- info | attention | urgent
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  acknowledged_at TEXT
);
`);

export function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayDate(): string {
  return nowLocal().slice(0, 10);
}
