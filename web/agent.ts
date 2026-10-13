/** The conversational layer behind the simulated Alexa+ experience.
 *  Primary path: any OpenAI-compatible chat-completions endpoint (env-configured).
 *  Fallback: a deterministic on-device intent engine so the demo always runs, even offline. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.TEND_MCP_URL ?? "http://127.0.0.1:7701/mcp";
const LLM_BASE = process.env.TEND_LLM_BASE_URL;
const LLM_KEY = process.env.TEND_LLM_API_KEY;
const LLM_MODEL = process.env.TEND_LLM_MODEL ?? "gpt-4o-mini";

export interface TraceEvent {
  kind: "tool_call" | "tool_result" | "reply" | "engine";
  name?: string; args?: unknown; result?: string; text?: string; engine?: string;
}

async function withMcp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "tend-web", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try { return await fn(client); } finally { await client.close().catch(() => {}); }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const r = await client.callTool({ name, arguments: args });
  return (r.content as any[])?.map((c) => c.text).join(" ") ?? "";
}

const SYSTEM = `You are Tend, a warm voice companion inside Alexa+ for Meera, a 74-year-old who lives alone in Thrissur, Kerala.
You help her family care for her gently. You speak to Meera (or a family member) in short, natural, spoken-style sentences - this is a voice conversation, never use lists or markdown. Be warm, unhurried, respectful; never clinical, never condescending.
You have tools to her care system: use them proactively. On greetings or openers like "good morning", call get_today_brief and weave in what matters (check-in, doses due). When she mentions taking or forgetting a tablet, log it. When she describes her morning, log the check-in and any activities as rhythm events. If she sounds unwell or something is off, tell her kindly and notify the family. Keep replies under 60 words unless she asks for detail. Never invent medication names; use only what the tools report.`;

export async function chat(message: string, history: { role: string; content: string }[], onEvent: (e: TraceEvent) => void): Promise<string> {
  if (LLM_BASE && LLM_KEY) {
    try { return await llmChat(message, history, onEvent); }
    catch (err) { console.error("LLM path failed, using fallback engine:", err); onEvent({ kind: "engine", engine: "fallback (llm error)" }); }
  } else {
    onEvent({ kind: "engine", engine: "fallback (no llm configured)" });
  }
  return fallbackChat(message, onEvent);
}

async function llmChat(message: string, history: { role: string; content: string }[], onEvent: (e: TraceEvent) => void): Promise<string> {
  return withMcp(async (client) => {
    const { tools } = await client.listTools();
    const oaiTools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } },
    }));
    const messages: any[] = [{ role: "system", content: SYSTEM }, ...history.slice(-12), { role: "user", content: message }];
    for (let round = 0; round < 6; round++) {
      const resp = await fetch(`${LLM_BASE!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${LLM_KEY}` },
        body: JSON.stringify({ model: LLM_MODEL, messages, tools: oaiTools, tool_choice: "auto" }),
      });
      if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("empty LLM response");
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const text = String(msg.content ?? "").trim();
        onEvent({ kind: "reply", text });
        return text;
      }
      for (const c of calls) {
        const args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        onEvent({ kind: "tool_call", name: c.function.name, args });
        const result = await callTool(client, c.function.name, args);
        onEvent({ kind: "tool_result", name: c.function.name, result });
        messages.push({ role: "tool", tool_call_id: c.id, content: result });
      }
    }
    throw new Error("too many tool rounds");
  });
}

/* ---------- deterministic fallback engine ---------- */

const norm = (s: string) => s.toLowerCase();

async function fallbackChat(message: string, onEvent: (e: TraceEvent) => void): Promise<string> {
  const m = norm(message);
  return withMcp(async (client) => {
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      onEvent({ kind: "tool_call", name, args });
      const result = await callTool(client, name, args);
      onEvent({ kind: "tool_result", name, result });
      return result;
    };

    let text: string;
    if (/\b(hi|hello|hey|good morning|good afternoon| good evening|namaste|namaskaram)\b/.test(m)) {
      await run("get_today_brief");
      const sum = await run("get_care_summary", { days: 7 });
      text = `Good morning, Meera. It's lovely to hear your voice. Here's how things look: ${sum} Now then - how did you sleep, and how are you feeling this morning?`;
    } else if (/(took|taken|had)\b.*(tablet|medicine|pill|amlodipine|metformin|shelcal|dose)/.test(m)) {
      const which = m.includes("metformin") ? "metformin" : m.includes("shelcal") ? "shelcal" : m.includes("amlodipine") ? "amlodipine" : "amlodipine";
      await run("log_medication_taken", { medication: which, status: "taken" });
      text = `Well done, I've noted your ${which} for today. One less thing to think about.`;
    } else if (/(forgot|missed|skipped)\b.*(tablet|medicine|pill|dose|metformin|amlodipine|shelcal)/.test(m)) {
      const which = m.includes("metformin") ? "metformin" : m.includes("shelcal") ? "shelcal" : "amlodipine";
      await run("log_medication_taken", { medication: which, status: "missed", note: "Mentioned in conversation" });
      text = `That's alright, it happens to everyone. I've noted the missed ${which}. If it keeps slipping, I'll gently let the family know so they can help you stay on track.`;
    } else if (/(walk|garden|temple|out)/.test(m)) {
      await run("record_rhythm_event", { kind: "walk", note: message.slice(0, 80) });
      text = `That sounds lovely. I've noted your walk - moving a little every day keeps the rhythm steady.`;
    } else if (/(slept|sleep|tired|didn't sleep|not sleep)/.test(m)) {
      const poor = /(didn't|not|poorly|bad|tired)/.test(m) ? "poor" : "restful";
      await run("log_check_in", { mood: poor === "poor" ? "okay" : "good", sleep_quality: poor, notes: message.slice(0, 120), conversation_summary: "Check-in via fallback conversation engine" });
      text = poor === "poor"
        ? `I'm sorry the night was rough. I've written it down for today. A short rest after lunch might help, and I'll keep an eye on how tomorrow feels.`
        : `I'm glad you slept well. I've completed today's check-in. Anything else on your mind?`;
    } else if (/(sad|lonely|alone|low|unwell|sick|pain|hurt)/.test(m)) {
      await run("log_check_in", { mood: m.includes("pain") || m.includes("hurt") || m.includes("unwell") || m.includes("sick") ? "unwell" : "low", notes: message.slice(0, 120) });
      await run("notify_family", { level: "attention", title: "Meera isn't feeling her best", message: `She said: "${message.slice(0, 140)}" - a call today would mean a lot.` });
      text = `I'm sorry to hear that, Meera. I've let the family know you'd love a call today. You matter to a lot of people, you know.`;
    } else if (/(how is she|summary|week|adherence|report)/.test(m)) {
      const s = await run("get_care_summary", { days: 7 });
      text = s;
    } else {
      const brief = await run("get_today_brief");
      text = `I'm here with you. For today: ${brief} Would you like to check in, or tell me about your morning?`;
    }
    onEvent({ kind: "reply", text });
    return text;
  });
}
