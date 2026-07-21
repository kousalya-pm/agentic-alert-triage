# Platform Thinking

## The Questions This Prototype Explored

### How should agents coordinate?

A single agent investigating a complex alert serially misses the opportunity to run independent workstreams in parallel. But parallel agents need a coordination layer — something that dispatches work, collects results, and synthesizes a coherent verdict.

This prototype implements both patterns and makes the tradeoff visible: Parallel mode is faster and surfaces more signal, but the synthesis step is harder. Chain mode is slower but each tier can build on the previous tier's findings. Standard mode is the simplest to reason about and debug. The right choice depends on alert complexity and the cost of the investigation time.

**Design decision:** all four modes share the same tool catalog, model abstraction, and analyst interface. The orchestration pattern changes; the platform layer does not.

---

### What context should agents retain?

An agent that starts fresh on every investigation makes the same mistakes repeatedly. It doesn't know that a particular tool has been unreliable for a certain alert type, or that a similar case last month turned out to be a false positive from the same IP range.

This prototype builds investigation history into the platform layer — not into the agent prompt directly. The analytics engine computes what's useful (tool effectiveness rates, mode accuracy, similar cases) and the platform injects only that into the agent's context. The agent doesn't need to search its own history; the platform surfaces the relevant signal.

**Design decision:** learning is a platform service, not an agent capability. Individual agents don't maintain their own memory; the platform accumulates it and provides it selectively.

---

### When should humans stay in the loop?

The agent investigates and recommends. It does not act. Response actions — block an IP, disable an account, isolate an endpoint — require explicit analyst approval through the Remediation Playbook interface.

This isn't a technical limitation. It's a deliberate product decision: at this stage of agentic maturity, the cost of a wrong automated response (a legitimate user locked out, a critical system isolated) outweighs the cost of the approval step. The human-in-the-loop requirement is enforced at the platform layer, not left to individual agents.

**Design decision:** the platform distinguishes between investigative actions (agent-executed automatically) and response actions (analyst-approved). That boundary is explicit in the UI and enforced in the code.

---

### How should investigations be evaluated?

Verdict accuracy is the obvious metric. But it's not enough on its own. An agent that is 90% accurate but takes 8 minutes per investigation and costs $0.80 per run is a different product decision than one that is 88% accurate, takes 90 seconds, and costs $0.04.

The analytics layer tracks all of these: accuracy by mode, average investigation time, cost by model tier, tool effectiveness. The Cost tab in the dashboard breaks down spend by Opus / Sonnet / Haiku calls — making the model routing strategy's COGS impact visible.

**Design decision:** the platform owns the evaluation layer. Individual use-case teams shouldn't build their own metrics; the platform accumulates the signal and makes it available to everyone.

---

### What platform services become reusable building blocks?

Building this prototype made five platform services obvious:

1. **Tool catalog** — one MCP server, one set of tool schemas, callable by any agent. No per-agent VirusTotal integration.
2. **Model router** — risk-tiered model selection as configuration, not per-agent code.
3. **Tracer** — per-call token, cost, and latency recording as infrastructure. Any agent that calls `aiService` or `toolService` gets traced automatically.
4. **Investigation history** — append-only log that any analytics workload can read.
5. **Human approval interface** — a standard Remediation Playbook component any workflow can drop in.

None of these should be rebuilt per use case. They belong in a shared platform layer.

---

## What Was Intentionally Left Out

- Production authentication or session management
- Real SIEM integration (Splunk / Sentinel / Chronicle)
- Response execution — playbook steps are recommended, not carried out
- Multi-tenant data isolation
- Backend database (investigation history is CSV; analytics are JSON)
- Model fine-tuning or evaluation benchmarking

The omissions are deliberate. The goal was to explore platform architecture decisions, not to engineer a production system. A working prototype that makes the decisions visible is more useful for that purpose than a complete implementation that buries them.

---

## What This Informed

Building this clarified several things that are easy to underestimate from a distance:

**MCP is the right abstraction for tool sharing.** Defining tools once with a JSON schema, exposing them over a standard protocol, and letting any agent or analyst call them directly — this is obviously correct at scale. The alternative (each team maintains their own VirusTotal wrapper) creates fragmentation that compounds quickly.

**Cost governance requires per-call granularity.** Aggregate monthly spend doesn't tell you which investigation type is too expensive or which model tier is being overused. You need per-investigation, per-call data before you can make meaningful routing decisions.

**The analytics → learning loop changes the agent's behavior measurably.** Once there are enough historical investigations, the agent's tool prioritization shifts noticeably toward tools that have been reliable in past similar cases. This is a platform capability, not a prompting trick.

**Human-in-the-loop friction is worth designing carefully.** The approve/reject interface for remediation actions needs to be fast and contextual — if it's slow or requires the analyst to re-read the full investigation, approvals become rubber stamps. The friction should match the risk level of the action.
