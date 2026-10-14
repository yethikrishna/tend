import { db, nowLocal } from './db.js';

export const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const value = new Date(y, m - 1, d, 12);
  return value.getFullYear() === y && value.getMonth() === m - 1 && value.getDate() === d;
}
export function canonicalSlot(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::00)?$/.exec(value);
  if (!match || !validDay(match[1]) || !TIME_PATTERN.test(match[2])) throw new Error('invalid_dose_slot');
  return `${match[1]} ${match[2]}:00`;
}
export function setMedicationSchedule(id: number, times: string[], effectiveFrom = nowLocal()): void {
  if (!times.length || times.some(t => !TIME_PATTERN.test(t)) || new Set(times).size !== times.length) throw new Error('invalid_dose_times');
  const normalized = [...times].sort();
  const current = db.prepare('SELECT * FROM medication_schedules WHERE medication_id=? AND effective_until IS NULL').get(id) as any;
  if (current && current.times === JSON.stringify(normalized)) return;
  db.transaction(() => {
    if (current) db.prepare('UPDATE medication_schedules SET effective_until=? WHERE id=?').run(effectiveFrom, current.id);
    db.prepare('INSERT INTO medication_schedules(medication_id,times,effective_from) VALUES(?,?,?)').run(id, JSON.stringify(normalized), effectiveFrom);
  })();
}

/** Expected slots use only recorded schedule history. An unreported slot is not a medical conclusion. */
export function dueSlots(id: number, days = 7, at = nowLocal()): string[] {
  const schedules = db.prepare('SELECT * FROM medication_schedules WHERE medication_id=? ORDER BY effective_from').all(id) as any[];
  const endDay = at.slice(0,10);
  if (!validDay(endDay) || !Number.isInteger(days) || days < 1 || days > 90) throw new Error('invalid_window');
  const [y,m,d] = endDay.split('-').map(Number);
  const start = new Date(y,m-1,d-(days-1),12);
  const result = new Set<string>();
  for (let n=0;n<days;n++) {
    const day = new Date(start); day.setDate(start.getDate()+n);
    const date = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    for (const schedule of schedules) for (const time of JSON.parse(schedule.times) as string[]) {
      const slot = `${date} ${time}:00`;
      if (slot <= at && slot >= schedule.effective_from && (!schedule.effective_until || slot < schedule.effective_until)) result.add(slot);
    }
  }
  return [...result].sort();
}

export function logDose(medication: string, status: string, note?: string, scheduledFor?: string, at = nowLocal()): Record<string, unknown> {
  const query = medication.trim().toLowerCase();
  if (!query || !['taken','missed','skipped'].includes(status)) return {error:'invalid_dose'};
  const meds = db.prepare('SELECT * FROM medications WHERE active=1').all() as any[];
  const exact = meds.filter(m => m.name.toLowerCase() === query);
  const candidates = exact.length ? exact : meds.filter(m => m.name.toLowerCase().includes(query));
  if (candidates.length !== 1) return {error:candidates.length ? 'ambiguous_medication' : 'not_found', medication};
  const med = candidates[0];
  let slot: string;
  if (scheduledFor) {
    try {slot = canonicalSlot(scheduledFor);} catch {return {error:'invalid_dose_slot'};}
  } else {
    const times = JSON.parse(med.times) as string[];
    if (times.length !== 1) return {error:'dose_time_required', medication:med.name, times};
    slot = `${at.slice(0,10)} ${times[0]}:00`;
  }
  if (!dueSlots(med.id,90,at).includes(slot)) return {error:slot > at ? 'future_dose' : 'untracked_dose_slot', medication:med.name};
  const prior = db.prepare('SELECT * FROM med_logs WHERE medication_id=? AND dose_key=?').get(med.id,slot) as any;
  if (prior) return prior.status === status
    ? {medication:med.name,status,scheduledFor:slot,duplicate:true}
    : {error:'dose_status_conflict',medication:med.name,scheduledFor:slot,existingStatus:prior.status};
  db.prepare('INSERT INTO med_logs(medication_id,scheduled_for,status,note,dose_key) VALUES(?,?,?,?,?)').run(med.id,slot,status,note ?? null,slot);
  if (status === 'taken') db.prepare("INSERT INTO rhythm_events(kind,note) VALUES('other',?)").run(`Reported taking ${med.name}`);
  return {medication:med.name,status,scheduledFor:slot,duplicate:false};
}
