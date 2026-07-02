# v1.2 Observability — Completion Summary

**Date Completed**: 2026-07-02  
**Branch**: feature/agentic-v1.2-observability  
**Status**: ✅ All Features Complete and Wired

---

## What Was Built

A full observability layer over the agentic investigation pipeline: per-run AI call traces, MCP tool catalog, run-scoped audit logging, remediation playbook caching, a rebuilt analytics dashboard, and infrastructure fixes for dev server stability.

---

## Feature 1: Per-Investigation Trace (TracePanel + investigationTracer)

**Files**:
- `src/services/investigationTracer.js` — Module-level singleton trace recorder
- `src/components/TracePanel.jsx` — Collapsible trace UI in Agent Trace tab
- `src/components/PostInvestigationTabs.jsx` — Hosts TracePanel, PlaybookPanel, Analyst Console, MCP Registry in a tabbed view

**What it does**:
- `startTrace()` called at the start of each investigation — initializes the singleton
- `recordAiCall(name, usage, latencyMs, model)` called by `aiService.js` after every AI response — records input/output/cache tokens, latency, and estimated cost per model
- `recordToolCall(tool, params, latencyMs, status)` called by `toolService.js` after every tool execution — records tool name, parameters, latency, and ok/error status
- `getTrace()` assembles totals: summed tokens, total cost, cache savings USD, cache hit %, dominant model used, wall-clock time, AI call count, tool call count
- TracePanel UI: collapsed header shows `N AI calls · N tools · N tokens · $X.XXXX · N% cached`; expanded shows full per-call tables and cache savings callout (`⚡ Prompt caching saved $X.XXXX on this run`)
- Trace is also stored inside each run object via `buildInvestigationPayload` → `saveRun`

**Wired in all four workflow modes**:
- `AgentWorkflow.jsx` — Standard mode
- `AdaptiveWorkflow.jsx` — Adaptive mode
- `ChainWorkflow.jsx` — Chain-of-thought mode
- `ParallelAgentsWorkflow.jsx` — Parallel specialists mode

**Model-aware pricing** (per million tokens):

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| claude-opus-4-8 | $5.00 | $25.00 | $6.25 | $0.50 |
| claude-sonnet-4-6 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-haiku-4-5 | $1.00 | $5.00 | $1.25 | $0.10 |

---

## Feature 2: MCP Analyst Console (AnalystChatBox)

**File**: `src/components/AnalystChatBox.jsx`

**What it does**:
- Analyst Console panel allows analysts to issue MCP tool calls against the live MCP server (port 3002) during or after an investigation
- Each tool call result is displayed with an amber "Analyst check" badge, tool name, parameters, and result
- **Run-scoped persistence**: checks are stored in localStorage keyed by `analyst-checks-${runId}` — loading a historical run shows only the checks for that run, not checks from other runs
- Checks reload automatically when switching between runs via `useEffect` on `storageKey`

**Before (broken)**: flat key `analyst-checks-${alertId}` meant all runs shared the same check list — loading any historical run showed the latest run's checks.  
**After (fixed)**: each run has its own isolated check list.

---

## Feature 3: MCP Tool Registry (McpRegistryPanel)

**File**: `src/components/McpRegistryPanel.jsx`

**What it does**:
- Displays 10 registered MCP tools organized by category: Identity, Endpoint, SIEM, Threat Intel, Network
- Shows live MCP server status (port 3002 online/offline indicator)
- Each tool shows: name, description, category icon, and collapsible JSON schema (parameters)
- Includes a Claude Desktop configuration snippet for connecting the MCP server
- Accessible via the "MCP Tools" tab in PostInvestigationTabs

---

## Feature 4: Remediation Playbook Caching (PlaybookPanel)

**File**: `src/components/PlaybookPanel.jsx`

**What it does**:
- Generates a remediation playbook (via AI) for TRUE_POSITIVE / NEEDS_ESCALATION verdicts
- Playbook is cached to localStorage under key `playbook-cache-${alert_id}` after first generation — stores both the `actions` array and the `statuses` map (approved/rejected/pending per action)
- On load of a historical run: checks cache first, skips AI call entirely if cached
- Analyst approve/reject decisions per action are persisted back to cache on every change

**Before (broken)**: `useEffect` with empty deps array called `generatePlaybook()` on every mount — even historical runs regenerated the playbook from scratch on every view.  
**After (fixed)**: historical runs load instantly from cache; only net-new investigations hit the AI.

---

## Feature 5: Analytics Dashboard Rebuild (AnalyticsDashboard)

**File**: `src/components/AnalyticsDashboard.jsx`

**What it does**:
- Complete rewrite from hardcoded SVG charts to [Recharts](https://recharts.org/) library
- **4-tab layout** replacing a single crowded view:
  - **Performance** — AI Verdict Mix donut, Feedback Status donut, Mode Accuracy table, Accuracy Trend area chart
  - **Tools** — Top tools by usage with expand toggle (shows top 5 by default, expandable to full list), Tool Effectiveness bar chart
  - **Cost** — Model routing breakdown (Opus/Sonnet/Haiku), Cost Trend area chart, total cost across all runs
  - **History** — Last 30 investigations table (alert ID, mode, verdict, time, date)

**Chart improvements**:
- `DonutChart` → Recharts `PieChart` + `ResponsiveContainer` (height: 200): fills card automatically, custom center label via SVG `<text>`, custom tooltip
- Line charts → Recharts `AreaChart` (height: 220): linearGradient fill, white-outlined dots (`r: 4`), CartesianGrid, XAxis with dates, animated on load
- `CostTrendChart` same pattern with cyan (`#00d4ff`) accent

---

## Feature 6: Run-Scoped Analyst Decisions

**Files modified**: `AgentWorkflow.jsx`, `AdaptiveWorkflow.jsx`, `ChainWorkflow.jsx`, `ParallelAgentsWorkflow.jsx`, `src/services/runHistoryService.js`

**What it does**:
- `updateRun(alertId, runId, updates)` added to `runHistoryService.js` — patches any fields into an existing run object in localStorage by matching `runId`
- When analyst submits a decision (True Positive / False Positive / Escalate), it is written into the run object via `updateRun(alertId, targetRunId, { analystDecision: decision })`
- `loadHistoricalRun` reads `run.analystDecision` instead of querying the flat `decisions` store

**Before (broken)**: `loadDecisions()[alert.alert_id]` always returned the most recent decision regardless of which historical run was being viewed — decisions leaked across runs.  
**After (fixed)**: each run carries its own `analystDecision`; loading a historical run shows the decision from that specific investigation.

---

## Feature 7: MCP Server

**File**: `mcp-server.js`

**What it does**:
- Standalone Express server on port 3002 exposing all 10 SOC tools as MCP endpoints
- Tools: `user_lookup`, `ip_geo`, `siem_query`, `virustotal_check`, `abuseipdb_check`, `urlscan_check`, `endpoint_status`, `file_hash_lookup`, `alert_history`, `threat_intelligence`
- Each tool accepts structured parameters and returns simulated SOC data
- Required for AnalystChatBox MCP tool calls and McpRegistryPanel status indicator

---

## Infrastructure Fix: Dev Server Stability

**File**: `.claude/launch.json`

**Change**: Switched from `npm run dev` (which uses `concurrently`) to `npx vite --port 5173` directly.

**Root cause**: `concurrently` with `kill-others` kills Vite whenever `server.js` exits (e.g., EADDRINUSE on port 3001). This caused Vite to die silently whenever the backend server failed to start.

**How to run the full stack** (from your own Terminal, not Claude Code):
```bash
# Terminal 1 — Backend
node server.js

# Terminal 2 — MCP Server
node mcp-server.js

# Terminal 3 — Frontend
npx vite --port 5173
```

---

## Files Added

| File | Purpose |
|------|---------|
| `src/services/investigationTracer.js` | Singleton trace recorder (AI calls + tool calls + cost) |
| `src/components/TracePanel.jsx` | Per-investigation trace UI with collapsed header + expanded tables |
| `src/components/PostInvestigationTabs.jsx` | Tabbed post-investigation panel (Playbook / Similar Cases / Trace / MCP) |
| `src/components/AnalystChatBox.jsx` | MCP Analyst Console with run-scoped persistence |
| `src/components/McpRegistryPanel.jsx` | MCP tool registry with 10 tools, schemas, status indicator |
| `src/components/PlaybookPanel.jsx` | Remediation playbook with localStorage caching |
| `mcp-server.js` | MCP server on port 3002 |
| `data/traces/` | Per-run trace JSON files written after each investigation |

## Files Modified

| File | Key Changes |
|------|------------|
| `src/components/AnalyticsDashboard.jsx` | Full Recharts rewrite, 4-tab layout (~550 lines) |
| `src/components/AgentWorkflow.jsx` | startTrace/getTrace wiring, updateRun for decisions, runId → AnalystChatBox |
| `src/components/AdaptiveWorkflow.jsx` | Same three changes as AgentWorkflow |
| `src/components/ChainWorkflow.jsx` | Same three changes |
| `src/components/ParallelAgentsWorkflow.jsx` | Same three changes |
| `src/services/runHistoryService.js` | Added `updateRun()` |
| `src/services/aiService.js` | `recordAiCall` import and call after every AI response |
| `src/services/toolService.js` | `recordToolCall` import and call after every tool execution |
| `.claude/launch.json` | Switched to `npx vite` direct (bypass concurrently) |
| `package.json` / `package-lock.json` | Added recharts dependency |

---

## How Tracing Works (End-to-End)

```
User clicks "Run Investigation" (any mode)
         ↓
startTrace() called — initializes singleton { aiCalls: [], toolCalls: [] }
         ↓
Agent generates investigation plan
  → aiService.js calls Claude API
  → records: recordAiCall('generateInvestigationPlan', usage, latencyMs, model)
         ↓
Agent executes tools
  → toolService.js runs each tool (VirusTotal, SIEM, etc.)
  → records: recordToolCall('virustotal_check', {ip}, 312, 'ok')
         ↓
Agent synthesizes final verdict
  → another Claude API call recorded via recordAiCall
         ↓
Investigation completes
  → getTrace() assembles totals: tokens, cost, cache%, wall-clock
  → trace stored in run object via buildInvestigationPayload
  → trace written to data/traces/<alertId>_<timestamp>.json
  → trace passed to PostInvestigationTabs → TracePanel (UI display)
         ↓
Analyst opens "Agent Trace" tab
  → Sees: "3 AI calls · 5 tools · 12,450 tokens · $0.0247 · 68% cached"
  → Expands for per-call breakdown and cache savings callout
```

---

## What This Enables

1. **LLM Cost Governance**: Per-investigation, per-call token and cost breakdown — the foundation for COGS tracking across hundreds of agents at scale
2. **Model Routing Visibility**: Cost tab shows which investigations used Opus vs Sonnet vs Haiku, validating the risk-tiered routing strategy
3. **Audit Trail**: Every MCP tool call an analyst issues is logged with parameters and results; every AI call recorded with latency and cache status
4. **Run Isolation**: Analyst decisions and MCP checks are scoped to specific runs — no data bleed when reviewing historical investigations
5. **Prompt Cache Efficiency**: Cache hit % and savings USD visible per investigation — shows ROI of prompt caching strategy
6. **Platform Pattern**: MCP tool catalog (McpRegistryPanel) + centralized tool config (SettingsModal) together demonstrate the "shared tool library + single config point" platform architecture

---

## API Endpoints (unchanged from v1.1)

v1.2 adds no new server endpoints. Tracing is entirely client-side. The MCP server (port 3002) runs as a separate process.

---

## Recharts Dependency

```bash
npm install recharts
```

Components used: `ResponsiveContainer`, `PieChart`, `Pie`, `Cell`, `Tooltip`, `AreaChart`, `Area`, `CartesianGrid`, `XAxis`, `YAxis`, `defs`, `linearGradient`

---

## Testing Checklist

- [x] Trace records correctly: AI calls show correct token/cost/cache breakdown
- [x] Tool calls appear in trace with params and ok/error status
- [x] Cache savings callout appears when cacheReadTokens > 0
- [x] TracePanel collapsed header shows correct totals
- [x] TracePanel renders in all four workflow modes
- [x] PlaybookPanel loads from cache on historical runs (no spinner)
- [x] PlaybookPanel approve/reject persists across page reloads
- [x] Analyst decisions linked to specific run (not shared across runs)
- [x] Analyst Console checks isolated by runId (switching runs reloads correct checks)
- [x] McpRegistryPanel shows MCP server status (online/offline)
- [x] AnalyticsDashboard donuts render with correct segments and center labels
- [x] Area charts render with gradient fill and labeled axes
- [x] 4-tab layout: all tabs reachable and correct content per tab
- [x] Dev server starts cleanly on port 5173 via `npx vite`

---

## Next Steps (v1.3+)

### Governance & Multi-Tenancy
- Add org-level tool usage quotas to MCP server (enforce per-tool rate limits)
- Track cost-per-analyst and cost-per-alert-type in analytics pipeline
- Add `approved_by` and `approved_at` fields to playbook action audit trail

### Trace Persistence & Search
- Expose `data/traces/` via `GET /api/traces/:alertId/:runId` endpoint
- Add trace comparison view (run A vs run B side-by-side, same alert)
- Allow analysts to annotate traces with notes ("this tool call was redundant")

### MCP Expansion
- Connect MCP server tools to real external APIs (VirusTotal live, AbuseIPDB live)
- Add authentication token per MCP tool (SettingsModal already has API key fields)
- Tool-call result caching: skip redundant calls for same IP/hash within a session

### Agent Evaluation
- Export trace data to benchmark dataset: `(alert, mode, trace, analyst_decision)` tuples
- Run evals comparing Opus vs Sonnet verdict agreement on the same alert set
- Surface which prompts produce the most cache hits (prompt efficiency scoring)

---

**v1.2 is complete and committed on `feature/agentic-v1.2-observability`**
