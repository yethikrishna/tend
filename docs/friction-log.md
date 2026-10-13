# Friction log

Logged while building Tend against MCP spec 2025-11-25 and the hackathon surfaces.

## 1. Stateless Streamable HTTP server pattern is easy to get wrong

- **Task attempted:** run the MCP server behind Express using `StreamableHTTPServerTransport`.
- **Steps:** created one transport instance at startup and routed all requests to it.
- **Expected:** requests from different clients are handled independently.
- **Actual:** a single transport binds to a single session lifecycle; concurrent or sequential stateless clients interfere. The spec's session-management section explains session mode well, but the stateless pattern (fresh server + transport per request, `sessionIdGenerator: undefined`) is only discoverable through SDK examples, not the spec text.
- **Severity:** medium.
- **Workaround:** construct a new `McpServer` + transport per request and close both on response end.
- **Suggestion:** add an explicit "stateless servers" recipe to the Streamable HTTP section of the spec, including when to choose it (serverless, simple demos) and its trade-offs (no server-initiated requests, no resumability).

## 2. Protocol version negotiation isn't visible by default

- **Task attempted:** confirm a client actually negotiated spec 2025-11-25 (a hackathon requirement).
- **Steps:** connected with the TypeScript SDK client and looked for the negotiated version.
- **Expected:** a public accessor for the negotiated protocol version.
- **Actual:** had to read the initialize response out of internal fields; nothing in the public client API surfaces it.
- **Severity:** low.
- **Workaround:** log the `protocolVersion` from the raw initialize response.
- **Suggestion:** expose `client.getProtocolVersion()` as a documented public method. Hackathons and conformance tests will keep needing this.

## 3. Devpost registration selects are custom widgets

- **Task attempted:** complete the hackathon registration form.
- **Expected:** native selects and checkboxes.
- **Actual:** custom select widgets that don't reflect programmatic value changes without synthetic events; minor, but accessibility tooling (and plain keyboard flows) would benefit from native controls.
- **Severity:** low.
- **Suggestion:** prefer native form controls, or ensure custom widgets emit standard change events.
