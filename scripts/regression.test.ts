import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Own temporary data only. Never use the developer's TEND_DATA_DIR for tests.
const dir=mkdtempSync(path.join(tmpdir(),'tend-test-'));
process.env.TEND_DATA_DIR=dir;
const {db,nowLocal,todayDate}=await import('../server/db.js');
const {logDose,setMedicationSchedule,dueSlots,canonicalSlot,validDay}=await import('../server/doses.js');
const {adherenceFor,evaluateAnomalies}=await import('../server/logic.js');
const {registerTendTools}=await import('../server/tools.js');
const handlers=new Map<string,Function>();
registerTendTools({registerTool(n:string,_c:unknown,f:Function){handlers.set(n,f);}} as any);
function reset(){for(const t of ['med_logs','alerts','check_ins','rhythm_events','medication_schedules','medications'])db.prepare(`DELETE FROM ${t}`).run();}
function med(name='TestMed',times=['08:00']){
 const id=Number(db.prepare('INSERT INTO medications(name,dosage,times) VALUES(?,?,?)').run(name,'test only',JSON.stringify(times)).lastInsertRowid);
 setMedicationSchedule(id,times,'2026-10-08 00:00:00');return id;
}
const at='2026-10-14 12:00:00';
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
test('strict real calendar dates and local dose times',()=>{
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2024-02-29'),true);
 for(const s of ['2026-02-30 08:00','2026-10-14 25:00','2026-10-14 08:60','2026-10-14 08:00:42'])assert.throws(()=>canonicalSlot(s));
 assert.equal(canonicalSlot('2026-10-14T08:00'),'2026-10-14 08:00:00');
});
test('same scheduled missed dose is idempotent, conflicting status refused',()=>{
 reset();med();assert.equal(logDose('TestMed','missed',undefined,undefined,at).duplicate,false);
 assert.equal(logDose('TestMed','missed',undefined,undefined,at).duplicate,true);
 assert.equal(logDose('TestMed','taken',undefined,undefined,at).error,'dose_status_conflict');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM med_logs').get() as any).n,1);
});
test('multi-dose requires an explicit slot, ambiguous names and future/off-schedule refused',()=>{
 reset();med('Metformin',['08:00','20:00']);med('Metformin XR');
 assert.equal(logDose('Metformin','taken',undefined,undefined,at).error,'dose_time_required');
 assert.equal(logDose('met','taken',undefined,undefined,at).error,'ambiguous_medication');
 assert.equal(logDose('Metformin','taken',undefined,'2026-10-14 20:00',at).error,'future_dose');
 assert.equal(logDose('Metformin','taken',undefined,'2026-10-14 09:00',at).error,'untracked_dose_slot');
 assert.equal(logDose('Metformin','taken',undefined,'2026-10-14 08:00',at).duplicate,false);
});
test('adherence includes due unreported slots, excludes future and out-of-window',()=>{
 reset();const id=med();logDose('TestMed','taken',undefined,'2026-10-14 08:00',at);
 const a=adherenceFor(id,7,at);assert.equal(a.total,7);assert.equal(a.taken,1);assert.equal(a.unreported,6);assert.equal(a.pct,14);
 assert.equal(dueSlots(id,1,'2026-10-14 07:59:00').length,0);
 assert.equal(adherenceFor(id,1,'2026-10-14 07:59:00').pct,null);
 assert.equal(dueSlots(id,1,at).length,1);
});
test('schedule changes preserve historical due slots, no pre-registration backfill',()=>{
 reset();const id=med();setMedicationSchedule(id,['09:00'],'2026-10-12 10:00:00');
 assert.deepEqual(dueSlots(id,3,at),['2026-10-12 08:00:00','2026-10-13 09:00:00','2026-10-14 09:00:00']);
 assert.equal(dueSlots(id,90,'2026-10-07 23:00:00').length,0);
});
test('legacy free-form logs remain preserved and excluded from scheduled-dose numerator',()=>{
 reset();const id=med();db.prepare('INSERT INTO med_logs(medication_id,scheduled_for,status) VALUES(?,?,?)').run(id,'2026-10-14 10:04:32','taken');
 const a=adherenceFor(id,1,at);assert.equal(a.taken,0);assert.equal(a.unreported,1);assert.equal(a.legacyUnmappedLogs,1);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM med_logs').get() as any).n,1);
});
test('two distinct missed slots create one alert; repeated evaluation and acknowledgement do not spam',()=>{
 reset();const id=med('TestMed',['00:00','00:01']);setMedicationSchedule(id,['00:00','00:01'],`${todayDate()} 00:00:00`);
 // Also keep initial known schedule through today, including both slots.
 for(const time of ['00:00','00:01'])assert.equal(logDose('TestMed','missed',undefined,`${todayDate()} ${time}`,nowLocal()).error,undefined);
 evaluateAnomalies();evaluateAnomalies();
 assert.equal((db.prepare("SELECT COUNT(*) n FROM alerts WHERE title='Multiple doses missed today'").get() as any).n,1);
 db.prepare('UPDATE alerts SET acknowledged_at=?').run(nowLocal());evaluateAnomalies();
 assert.equal((db.prepare('SELECT COUNT(*) n FROM alerts').get() as any).n,1);
});
test('one repeated dose never raises multiple-dose alert',()=>{
 reset();med('TestMed',['00:00']);
 const slot=`${todayDate()} 00:00`;logDose('TestMed','missed',undefined,slot);logDose('TestMed','missed',undefined,slot);
 evaluateAnomalies();assert.equal((db.prepare('SELECT COUNT(*) n FROM alerts').get() as any).n,0);
});
test('signal-specific dedupe does not suppress unrelated mood alert',()=>{
 reset();med();const today=todayDate();
 const prior=new Date();prior.setDate(prior.getDate()-1);
 const previous=`${prior.getFullYear()}-${String(prior.getMonth()+1).padStart(2,'0')}-${String(prior.getDate()).padStart(2,'0')}`;
 for(const day of [previous,today])db.prepare('INSERT INTO check_ins(scheduled_for,completed_at,mood) VALUES(?,?,?)').run(`${day} 09:00`,`${day} 09:00:00`,'low');
 db.prepare("INSERT INTO alerts(level,title,body) VALUES('attention','Unrelated','test')").run();
 evaluateAnomalies();evaluateAnomalies();
 assert.equal((db.prepare("SELECT COUNT(*) n FROM alerts WHERE title='Low mood on two recent days'").get() as any).n,1);
});
test('tool error responses do not silently mutate records',()=>{
 reset();med('TestMed',['08:00','20:00']);
 const r=handlers.get('log_medication_taken')!({medication:'TestMed',status:'missed'});
 assert.equal(r.structuredContent.error,'dose_time_required');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM med_logs').get() as any).n,0);
});

test('repeated same-day check-ins cannot fabricate two low-mood days',()=>{
 reset();const today=todayDate();
 for(let n=0;n<3;n++)db.prepare('INSERT INTO check_ins(scheduled_for,completed_at,mood) VALUES(?,?,?)').run(`${today} 09:00`,nowLocal(),'low');
 evaluateAnomalies();assert.equal((db.prepare('SELECT COUNT(*) n FROM alerts').get() as any).n,0);
});
