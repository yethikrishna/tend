# Product feedback

## What we used

- **Model Context Protocol (spec 2025-11-25)** as the integration contract for the Alexa+ experience: one self-hosted MCP server over Streamable HTTP exposes all ten care tools.
- **@modelcontextprotocol/sdk (TypeScript, v1.32.x)** for both the server and the two clients (the conversation agent loop and the smoke test).
- **Devpost** for registration and submission.

## What worked well

- The MCP mental model transfers cleanly to voice experiences. Tools with honest descriptions and structured output map naturally to "things Alexa+ can do for a customer." We never had to fight the abstraction.
- Streamable HTTP is the right transport for this: one endpoint, plain POST for JSON-RPC, trivial to self-host, trivial to test with curl. No SSE-only legacy path to reason about.
- The TypeScript SDK is genuinely good. `registerTool` with zod schemas gives you validation, schema advertising, and structured content in one call.

## What needs work

- **A first-party Alexa+ MCP test harness.** Today, an external developer can build a spec-perfect MCP server but cannot hear how Alexa+ actually renders tool results as speech without Preview access. A hosted "Alexa+ simulator" (even text-only) that connects to your MCP endpoint and plays the conversation the way Alexa+ would phrase it would change the quality of submissions across the board. Our simulated experience exists precisely because this doesn't.
- **Enrollment path for MCP servers.** The journey from "I have a compliant MCP server" to "Alexa+ customers can use it" is not documented on the public track pages. A short, explicit path (validation, certification, listing) would help.
- **Protocol version introspection in the SDK** (see friction log #2).

## How onboarding felt

Good on the MCP side: the spec is readable in an afternoon, and the SDK quickstart gets you to a working server in under an hour. The Alexa+ side is where the fog is: the track page tells you what to build but not how it ships to customers, so you design for an experience you can't fully observe.

## Would we build with it again?

Yes. MCP as the contract for Alexa+ experiences is a bet we'd take again - it made the care server usable from our simulated experience, from test scripts, and (soon) from Alexa+ itself with zero changes.
