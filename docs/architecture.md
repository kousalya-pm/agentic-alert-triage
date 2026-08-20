# Architecture

## Three Versions

### v1.0 — Core Agentic Loop

Four workflow modes built on the same tool catalog and model abstraction:

| Mode | Pattern | When it fits |
|------|---------|--------------|
| **Standard** | Single agent, sequential tool execution | Straightforward alerts with a clear investigation path |
| **Adaptive** | Agent re-plans mid-investigation based on early findings | Ambiguous alerts where initial findings change the direction |
| **Chain** | Multi-tier escalation — Tier 1 → Tier 2 → senior handoff | Alerts that may require different expertise at different stages |
| **Parallel** | Specialist agents run simultaneously | Complex alerts needing multiple domains investigated at once |

**Tool catalog** — eight tools, mix of internal lookups and external APIs:

| Tool | Source | Type |
|------|--------|------|
| User / AD Lookup | employees.csv | Internal |
| CMDB Asset Lookup | assets.csv | Internal |
| SIEM Historical Query | past_alerts.csv | Internal |
| Threat Watchlist Check | watchlist.csv | Internal |
| IP Geolocation | ip-api.com | External (no key required) |
| AbuseIPDB | abuseipdb.com | External (free key) |
| VirusTotal | virustotal.com | External (free key) |
| URLScan.io | urlscan.io | External (optional key) |

**Alert scenarios** — 15 alerts across 6 categories: email (phishing, BEC, quishing), network (C2 beaconing, lateral movement), identity (impossible travel, privilege misuse), DLP (bulk download, USB transfer), cloud (S3 ACL, RBAC escalation), endpoint (ransomware-like behavior).

---

### v1.1 — Agent Memory

The agent fleet accumulates knowledge across investigations instead of resetting each time.

**What persists:** every completed investigation is written to `data/investigation_history.csv` — alert ID, mode, verdict, AI score, analyst decision, tools used, kill chain tactics, token counts, cost, investigation time.

**What is computed:** a Python analytics script runs after each save and produces `data/insights.json`:
- Tool effectiveness — accuracy rate per tool across historical verdicts
- Mode performance — accuracy and average time per workflow mode
- Similar case matching — past investigations with overlapping kill chain tactics and asset profile

**How the agent uses it:** before each new investigation, insights are fetched and injected into the agent's context — *"user_lookup has been accurate in 94% of past cases involving this kill chain tactic."* The investigation plan adapts accordingly.

Key files: `analytics/compute_insights.py`, `src/services/investigationHistoryService.js`, `src/services/insightsClient.js`

---

### v1.2 — Observability

Every investigation produces a full audit trail. Every platform cost is visible.

**Per-investigation trace** (`investigationTracer.js` — module-level singleton):
- Every AI call: function name, input/output tokens, cache hit or creation, latency, estimated cost
- Every tool call: tool name, parameters, latency, ok/error status
- Totals: aggregate tokens, total cost, cache savings USD, cache hit percentage, wall-clock time

**Model routing:** Critical alerts → Opus 4.8 ($5/M input); High → Sonnet 4.6 ($3/M); Medium/Low → Haiku 4.5 ($1/M). Cost tab in Analytics shows spend by model tier across all historical runs.

**MCP tool catalog** (`mcp-server.js` on port 3002): 10 tools exposed as MCP endpoints with full JSON schemas. Analysts can issue tool calls directly from the console; every call is logged with an audit badge. `McpRegistryPanel` shows the full catalog with a Claude Desktop config snippet.

**Run-scoped audit log:** analyst decisions and MCP console checks are keyed by `runId`, not `alertId`. Loading a historical run shows exactly what was decided and checked in that specific investigation.

**Analytics Dashboard** (Recharts): 4-tab layout — Performance (accuracy donuts, trend chart), Tools (effectiveness by tool), Cost (model tier breakdown, cost trend), History (last 30 investigations table).

Key files: `src/services/investigationTracer.js`, `src/components/TracePanel.jsx`, `src/components/McpRegistryPanel.jsx`, `src/components/AnalyticsDashboard.jsx`, `src/services/runHistoryService.js`

---

## System Architecture

![Architecture diagram — user → application → model → tools → data → response](screenshots/architecture-diagram.png)

→ [Interactive version with light/dark mode](architecture-diagram.html)

## Key Files

```
├── server.js                    # API proxy — port 3001
├── mcp-server.js                # MCP tool server — port 3002
├── analytics/
│   └── compute_insights.py      # Investigation analytics engine
├── data/
│   ├── investigation_history.csv
│   └── insights.json
├── public/data/                 # Static scenario data (CSV)
└── src/
    ├── services/
    │   ├── aiService.js         # Claude / OpenAI abstraction + model routing
    │   ├── toolService.js       # Tool executors + tracer integration
    │   ├── investigationTracer.js
    │   ├── runHistoryService.js
    │   └── insightsClient.js
    └── components/
        ├── AgentWorkflow.jsx
        ├── AdaptiveWorkflow.jsx
        ├── ChainWorkflow.jsx
        ├── ParallelAgentsWorkflow.jsx
        ├── AnalyticsDashboard.jsx
        ├── TracePanel.jsx
        ├── McpRegistryPanel.jsx
        ├── PlaybookPanel.jsx
        ├── PostInvestigationTabs.jsx
        └── AnalystChatBox.jsx
```
