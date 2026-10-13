/** End-to-end check: connects as a real MCP client over Streamable HTTP and exercises every tool. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.TEND_MCP_URL ?? "http://127.0.0.1:7701/mcp");
const client = new Client({ name: "tend-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(url));

const version = (client as any).getServerVersion?.() ?? {};
const negotiated = (client as any)._transport?._protocolVersion ?? (client as any).getProtocolVersion?.();
console.log("connected:", JSON.stringify(version), "protocol:", negotiated ?? "(see initialize)");

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as any[])?.map((c) => c.text).join(" ") ?? "";
  console.log(`\n> ${name} ${JSON.stringify(args)}\n  ${text.slice(0, 220)}`);
  return r;
};

await call("get_today_brief");
await call("schedule_check_in", { time: "09:30" });
await call("log_check_in", { mood: "good", sleep_quality: "restful", notes: "Watered the garden.", conversation_summary: "Morning chat: cheerful, knee still a bit stiff." });
await call("log_medication_taken", { medication: "amlodipine", status: "taken" });
await call("log_medication_taken", { medication: "metformin", status: "missed", note: "Forgot the morning dose" });
await call("record_rhythm_event", { kind: "walk", note: "20 minutes around the temple pond" });
await call("get_adherence", { days: 7 });
await call("get_rhythm_summary", { days: 7 });
await call("notify_family", { level: "info", title: "Morning check-in complete", message: "Meera sounded cheerful; knee still stiff on stairs." });
await call("get_care_summary", { days: 7 });

await client.close();
console.log("\nsmoke OK");
