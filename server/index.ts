import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTendTools } from "./tools.js";

const PORT = Number(process.env.TEND_MCP_PORT ?? 7701);

function createServer() {
  const server = new McpServer(
    { name: "tend-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTendTools(server);
  return server;
}

const app = express();
app.use(express.json());

// Stateless Streamable HTTP: a fresh server+transport per request.
// Spec 2025-11-25: single endpoint, POST for JSON-RPC, GET for the SSE stream.
app.all("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "tend-mcp", spec: "2025-11-25", transport: "streamable-http" }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`tend-mcp listening on http://127.0.0.1:${PORT}/mcp (MCP spec 2025-11-25, Streamable HTTP)`);
});
