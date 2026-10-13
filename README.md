# Tend

**A care companion for aging parents, built as an Alexa+ MCP experience.**

More than 50 million families live apart from a parent who is aging alone. The hard part isn't any single emergency; it's the quiet daily uncertainty. Did she take her tablets? Did he sleep? Is today a normal Tuesday, or the start of something?

Tend turns Alexa+ into a gentle daily companion for that parent. It calls each morning for a short voice check-in, keeps track of medications and everyday routines, notices when the rhythm of a life changes, and keeps the whole family close through a live dashboard. One self-hosted MCP server powers all of it.

> Built for the **Build, Ship, Shape: Amazon Developer Hackathon** (Alexa+ track).
> The MCP server implements **MCP spec 2025-11-25** over **Streamable HTTP**.

## The experience

**For the parent** - a voice conversation, nothing to learn:

- "Good morning" starts a warm check-in: how did you sleep, how are you feeling.
- "I took my morning tablets" logs the dose.
- "I forgot my metformin last night" logs the miss, kindly, without judgment.
- "I went for a walk by the temple pond" becomes part of her daily rhythm.
- "I'm feeling a bit low today" completes the check-in and gently lets the family know a call would mean a lot.

**For the family** - a live dashboard that answers "how is she, really?" in one glance:

- Today's check-in status and mood.
- 7-day medication adherence, per medication, as honest numbers.
- A daily-rhythm chart: wake times against her personal 14-day baseline, activities per day.
- Alerts the moment Tend notices something: repeated low moods, missed doses, a wake time far past her usual.

**Under the hood** - every reply in the conversation is produced from live calls to the Tend MCP server. The web experience is the hackathon's sanctioned *simulated Alexa+ experience*: it shows exactly what Alexa+ can do once connected to an MCP server like this one.

## Architecture

```
            voice (Alexa+ / simulated experience)
                        │
              conversation agent loop
                        │  MCP client
              ┌─────────┴──────────┐
              │   tend-mcp server  │   MCP spec 2025-11-25, Streamable HTTP
              │                    │
              │  10 tools:         │
              │  check-ins, meds,  │
              │  rhythm, alerts,   │
              │  care summaries    │
              └─────────┬──────────┘
                        │
              SQLite + rule-based care logic
              (baseline + anomaly detection a family can read and trust)
                        │
              live family dashboard (SSE)
```

Anomaly detection is deliberately rule-based, not ML: a 14-day baseline of wake times and activity counts, with plain-language rules (woke >90 minutes late, two low check-ins in three days, two missed doses in a day). Families deserve alerts they can understand.

### MCP tools

| Tool | What it does |
| --- | --- |
| `get_today_brief` | Everything due today: check-in, doses, open alerts |
| `schedule_check_in` | Set or move the daily voice check-in |
| `log_check_in` | Record mood, sleep, notes; evaluates wellbeing signals |
| `add_medication` | Register a medication with dose times |
| `log_medication_taken` | Log a dose as taken / missed / skipped |
| `get_adherence` | Per-medication adherence over N days |
| `record_rhythm_event` | Log everyday activities that build the baseline |
| `get_rhythm_summary` | Baseline vs recent days, deviations flagged |
| `notify_family` | Post info / attention / urgent notes to the dashboard |
| `get_care_summary` | A spoken-friendly weekly digest |

## Quickstart

Requires Node.js 22+.

```bash
npm install
npm run seed     # demo persona: Meera, 74, with 14 days of history
npm run mcp      # MCP server on http://127.0.0.1:7701/mcp
npm run web      # simulated experience on http://127.0.0.1:7702
npm run smoke    # end-to-end client check of every tool
```

Open `http://127.0.0.1:7702` for the conversation and `http://127.0.0.1:7702/dashboard.html` for the family dashboard.

### Connect a real LLM (optional)

The conversation layer runs on any OpenAI-compatible chat-completions endpoint:

```bash
export TEND_LLM_BASE_URL=https://your-endpoint/v1
export TEND_LLM_API_KEY=...
export TEND_LLM_MODEL=...
```

With no LLM configured, a built-in deterministic conversation engine drives the same MCP tools, so the demo always runs offline. Either way, every answer comes from live MCP tool calls against the real server.

### Connect your own MCP client

Any client that speaks MCP spec 2025-11-25 over Streamable HTTP can connect to `http://127.0.0.1:7701/mcp` and use all ten tools directly.

## Repo layout

```
server/    MCP server: db, care logic, tools, Streamable HTTP entrypoint
web/       conversation experience + family dashboard (Express + SSE)
scripts/   smoke test, demo helpers
docs/      friction log, product feedback, design notes
data/      local SQLite (gitignored; created by npm run seed)
```

## Demo

- Video: _link added with submission_
- Track: Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)

## License

MIT
