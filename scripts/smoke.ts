/** Assertion-based transport check. Only run against an isolated seeded demo DB: mutates demo records. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client=new Client({name:'tend-smoke',version:'0.2.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.TEND_MCP_URL ?? 'http://127.0.0.1:7701/mcp')));
try {
 const tools=await client.listTools();assert.equal(tools.tools.length,10);
 const call=async(name:string,args:Record<string,unknown>={})=>{
  const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name}: MCP error`);
  const data=r.structuredContent as Record<string,any>;assert.ok(data && !data.error,`${name}: ${JSON.stringify(data)}`);return data;
 };
 const brief=await call('get_today_brief');assert.ok(brief.date);
 await call('schedule_check_in',{time:'09:30'});
 const check=await call('log_check_in',{mood:'good',sleep_quality:'restful',notes:'Synthetic transport test'});assert.equal(check.mood,'good');
 // Explicit past slot removes dependence on the current hour, and reruns are idempotent.
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 const date=`${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
 await call('add_medication',{name:'SmokeDose',dosage:'synthetic only',times:['00:00']});
 // A newly registered medication has no fabricated past history.
 const unknown=await client.callTool({name:'log_medication_taken',arguments:{medication:'SmokeDose',status:'taken',scheduled_for:`${date} 00:00`}});
 assert.equal((unknown.structuredContent as any).error,'untracked_dose_slot');
 const doseReply=await client.callTool({name:'log_medication_taken',arguments:{medication:'Amlodipine',status:'taken',scheduled_for:`${date} 08:00`}});
 assert.ok(!doseReply.isError);
 const dose=doseReply.structuredContent as any;
 if(dose.error) assert.equal(dose.error,'dose_status_conflict');else assert.equal(dose.status,'taken');
 const rhythm=await call('record_rhythm_event',{kind:'walk',note:'Synthetic transport test'});assert.equal(rhythm.kind,'walk');
 const adherence=await call('get_adherence',{days:7});assert.ok(adherence.medications.length>=3);for(const m of adherence.medications)assert.equal(m.total,m.taken+m.missed+m.skipped+m.unreported);
 const summary=await call('get_rhythm_summary',{days:7});assert.ok(summary.baseline.daysObserved>0);
 const notification=await call('notify_family',{level:'info',title:'Synthetic smoke test',message:'Demo data only'});assert.ok(notification.id);
 const care=await call('get_care_summary',{days:7});assert.ok(typeof care.summary==='string' && care.summary.length>0);
 console.log('smoke assertions OK: all 10 tools, refusal path, transport');
} finally {await client.close();}
