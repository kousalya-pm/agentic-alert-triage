// AI Service - abstraction layer for Claude (Anthropic) and OpenAI
// Two-call approach:
//   Call 1: AI generates investigation plan (questions + tool assignments)
//   [We execute all tool calls]
//   Call 2: AI synthesizes results into final verdict + summary

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const OPENAI_MODEL = 'gpt-4o';

// ─── System prompt shared across both providers ───────────────────────────────
const SYSTEM_PROMPT = `You are an expert SOC (Security Operations Center) analyst AI agent for Acme Corp, a financial services firm with ~500 employees, hybrid on-prem datacenter and AWS/Azure cloud.

Your role is to autonomously triage security alerts the way a senior Tier 2 SOC analyst would. You think systematically, check multiple data sources, and provide clear, actionable verdicts.

ALERT CATEGORIES YOU HANDLE:
- Email Security (Proofpoint)
- Data Loss Prevention / DLP (Microsoft Purview)
- Network Security (Palo Alto Firewall, Zscaler)
- Identity & Access (Azure Entra ID, CyberArk PAM)
- Endpoint Security (CrowdStrike Falcon)
- Cloud Security (AWS CloudTrail, Azure Monitor)

AVAILABLE INVESTIGATION TOOLS:
- user_lookup: Query Active Directory for employee info, risk score, account status
- asset_lookup: Query CMDB for device details, criticality, patch level
- siem_query: Query Microsoft Sentinel for past alerts on the same user/IP
- watchlist_check: Check internal threat intelligence watchlist
- ip_geo: Geolocate an IP address (country, city, ISP)
- whois: WHOIS/ASN registration info for an IP
- abuseipdb: Community IP reputation check (AbuseIPDB)
- virustotal_ip: IP reputation across 70+ AV vendors (VirusTotal)
- virustotal_url: URL/domain scan against 70+ AV vendors (VirusTotal)
- urlscan: Search URLScan.io for existing URL scan results

INVESTIGATION PRINCIPLES:
1. Always check user context (who triggered the alert, their role, risk history)
2. Always check asset context (what device, its criticality)
3. For any external IP or URL, check geo + reputation
4. Always check SIEM for prior related alerts (pattern recognition)
5. Always check watchlist for known indicators
6. Build a timeline of events
7. Consider business context (e.g., finance team, quarter-end, departing employee)

VERDICT DEFINITIONS:
- TRUE_POSITIVE: Confirmed malicious activity requiring immediate response
- FALSE_POSITIVE: Legitimate activity that triggered an alert
- NEEDS_ESCALATION: High severity, requires senior analyst or management involvement
- INCONCLUSIVE: Insufficient data to determine, recommend monitoring`;

// Token budgets — plan responses are small; summary responses can be large
const MAX_TOKENS_PLAN    = 2048;
const MAX_TOKENS_SUMMARY = 4096;

// ─── Call 1: Generate investigation plan ──────────────────────────────────────
export async function generateInvestigationPlan(alert, settings) {
  const isIncident = !!alert._isIncident;
  const incidentNote = isIncident ? `

⚠️  INCIDENT INVESTIGATION — This is a correlated incident comprising ${alert._alertCount} related alerts on the same entity.
Constituent alert IDs: ${alert._allAlertIds?.join(', ')}
All involved users: ${alert._entityIds?.users?.join(', ') || 'none'}
All involved hosts: ${alert._entityIds?.hostnames?.join(', ') || 'none'}
All involved IPs:   ${[...(alert._entityIds?.srcIps || []), ...(alert._entityIds?.dstIps || [])].join(', ') || 'none'}

Generate 6-8 steps (more than a single-alert investigation). Your plan must:
- Cover ALL users, hosts and IPs listed above — not just the first one
- Investigate each stage of the ATT&CK progression visible in the incident
- Look for lateral movement between the involved entities
- Assess the full scope and blast radius of this incident` : '';

  const prompt = `You are investigating the following security ${isIncident ? 'INCIDENT' : 'alert'}. Generate a structured investigation plan.

ALERT DETAILS:
${JSON.stringify(alert, null, 2)}${incidentNote}

Generate ${isIncident ? '6-8' : '4-6'} targeted investigation steps. For each step, specify:
1. The investigation question an analyst would ask
2. Which tool to use (from the available tools list)
3. What parameter(s) to pass to the tool
4. Your rationale for this step

Respond ONLY with valid JSON matching this exact schema:
{
  "alert_summary": "one sentence description of what this alert represents",
  "initial_risk_assessment": "LOW|MEDIUM|HIGH|CRITICAL",
  "key_concerns": ["concern1", "concern2", "concern3"],
  "investigation_steps": [
    {
      "step_id": 1,
      "question": "What is the question this step answers?",
      "tool": "tool_name",
      "parameters": { "param": "value" },
      "rationale": "Why this step matters for this specific alert"
    }
  ]
}

Choose tools based on what's actually useful for THIS alert type. Only include steps with real investigative value.`;

  return callAI(prompt, settings, MAX_TOKENS_PLAN);
}

// ─── Call 2: Synthesize results into final verdict ────────────────────────────
export async function generateFinalSummary(alert, investigationPlan, toolResults, settings) {
  const isIncident = !!alert._isIncident;
  const resultsFormatted = toolResults.map((r, i) => ({
    step: investigationPlan.investigation_steps[i],
    result: r
  }));

  const incidentSynthesisNote = isIncident ? `

⚠️  INCIDENT SYNTHESIS — You investigated a correlated incident, not a single alert.
Your response must:
- Reference ALL ${alert._alertCount} constituent alerts in your executive_summary
- Describe the complete attack chain in attack_narrative (from first alert to last)
- Provide recommended_actions that address the full incident scope
- In key_findings, call out the kill chain progression and any signs of lateral movement
- Set escalation_required to true if ANY of the constituent alerts warrant it` : '';

  const prompt = `You have completed the investigation of a security ${isIncident ? 'INCIDENT' : 'alert'}. Synthesize all findings into a final triage report.

ORIGINAL ALERT:
${JSON.stringify(alert, null, 2)}${incidentSynthesisNote}

INVESTIGATION PLAN:
${JSON.stringify(investigationPlan, null, 2)}

TOOL RESULTS (in order):
${JSON.stringify(resultsFormatted, null, 2)}

Based on ALL the evidence gathered, provide your final analysis.

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "TRUE_POSITIVE|FALSE_POSITIVE|NEEDS_ESCALATION|INCONCLUSIVE",
  "confidence_pct": 85,
  "risk_score": 8.5,
  "executive_summary": "2-3 sentence plain-English summary of what happened and what it means",
  "key_findings": [
    "Finding 1 — what the evidence shows",
    "Finding 2",
    "Finding 3"
  ],
  "attack_narrative": "paragraph describing the likely attack sequence or business explanation if FP",
  "mitre_assessment": {
    "tactic": "tactic name",
    "technique": "T1XXX",
    "technique_name": "technique description"
  },
  "recommended_actions": [
    {
      "priority": "IMMEDIATE|SHORT_TERM|MONITOR",
      "action": "Specific action to take",
      "owner": "SOC Analyst|IR Team|IT Admin|Management|HR"
    }
  ],
  "escalation_required": true,
  "escalation_reason": "Why escalation is needed (or null if not required)",
  "similar_past_incidents": ["HIST-XXX: brief description"],
  "analyst_notes": "Any additional context or caveats for the analyst reviewing this"
}`;

  return callAI(prompt, settings, MAX_TOKENS_SUMMARY);
}

// ─── Parallel mode: Run one specialist agent ──────────────────────────────────
// toolCallsWithResults = [{ tool, parameters, result }, ...]
export async function runSpecialistAgent(alert, specialist, toolCallsWithResults, settings) {
  // If specialist has no tools for this alert, return without an AI call
  if (toolCallsWithResults.length === 0) {
    return {
      specialist: specialist.id,
      relevant: false,
      risk_contribution: 'LOW',
      findings: ['No relevant indicators available for this specialist on this alert type.'],
      key_iocs: [],
      recommendation: 'No additional context from this domain for this alert.',
      confidence: 0,
    };
  }

  const prompt = `You are the ${specialist.name} in a 4-agent parallel SOC triage system for Acme Corp (financial services, ~500 employees, hybrid cloud). Your role is strictly limited to your domain.

YOUR SPECIALTY: ${specialist.focus}

ALERT:
${JSON.stringify({
  alert_id: alert.alert_id,
  title: alert.title,
  category: alert.category,
  severity: alert.severity,
  description: alert.description,
  src_ip: alert.src_ip,
  dst_ip: alert.dst_ip,
  user_id: alert.user_id,
  hostname: alert.hostname,
  mitre_tactic: alert.mitre_tactic,
  mitre_technique: alert.mitre_technique,
}, null, 2)}

YOUR TOOL RESULTS (${toolCallsWithResults.length} source${toolCallsWithResults.length > 1 ? 's' : ''}):
${JSON.stringify(toolCallsWithResults, null, 2)}

Analyse the alert strictly from your specialist perspective. Be concise and factual — another agent handles other domains.

Respond ONLY with valid JSON:
{
  "specialist": "${specialist.id}",
  "relevant": true,
  "risk_contribution": "LOW|MEDIUM|HIGH|CRITICAL",
  "findings": ["2-4 specific findings from YOUR domain only, referencing actual data from your tool results"],
  "key_iocs": ["any indicators of compromise you identified"],
  "recommendation": "One sentence: what the team should do based on YOUR findings",
  "confidence": 85
}`;

  return callAI(prompt, settings, 1024);
}

// ─── Parallel mode: Orchestrator synthesises all specialist reports ────────────
export async function synthesizeSpecialistReports(alert, specialistReports, settings) {
  const prompt = `You are the Orchestrator in a 4-agent parallel SOC triage system for Acme Corp. Four specialist agents — Identity, Network, Threat Intel, and Endpoint — have independently investigated an alert. Synthesise their findings into a final verdict.

ALERT:
${JSON.stringify({
  alert_id: alert.alert_id,
  title: alert.title,
  category: alert.category,
  severity: alert.severity,
  description: alert.description,
  src_ip: alert.src_ip,
  dst_ip: alert.dst_ip,
  user_id: alert.user_id,
  hostname: alert.hostname,
  mitre_tactic: alert.mitre_tactic,
}, null, 2)}

SPECIALIST REPORTS:
${JSON.stringify(specialistReports, null, 2)}

Synthesise all specialist input. Where specialists disagree, explain the tension. Weight HIGH/CRITICAL specialist contributions more heavily.

Respond ONLY with valid JSON:
{
  "verdict": "TRUE_POSITIVE|FALSE_POSITIVE|NEEDS_ESCALATION|INCONCLUSIVE",
  "confidence_pct": 85,
  "risk_score": 8.5,
  "executive_summary": "2-3 sentences summarising what happened and what it means, referencing which specialist agents contributed key findings",
  "key_findings": ["finding from Identity", "finding from Network", "finding from Threat Intel", "finding from Endpoint"],
  "attack_narrative": "Paragraph describing the likely attack sequence, citing specialist evidence",
  "mitre_assessment": { "tactic": "...", "technique": "T1XXX", "technique_name": "..." },
  "recommended_actions": [{ "priority": "IMMEDIATE|SHORT_TERM|MONITOR", "action": "...", "owner": "..." }],
  "escalation_required": true,
  "escalation_reason": "...",
  "analyst_notes": "Any specialist disagreements or caveats worth flagging"
}`;

  return callAI(prompt, settings, MAX_TOKENS_SUMMARY);
}

// ─── Call 2b (Adaptive mode): Check if a new step should be added ─────────────
export async function checkForAdditionalSteps(alert, plan, stepResults, settings) {
  const completedSteps = plan.investigation_steps
    .slice(0, stepResults.length)
    .map((step, i) => ({
      tool: step.tool,
      question: step.question,
      key_findings: summarizeResult(step.tool, stepResults[i]),
    }));

  const remainingTools = plan.investigation_steps
    .slice(stepResults.length)
    .map(s => s.tool);

  const prompt = `You are mid-investigation of a security alert. Decide if one more investigation step is warranted based on what you've found so far.

ALERT (key fields):
${JSON.stringify({
  alert_id: alert.alert_id,
  title: alert.title,
  category: alert.category,
  severity: alert.severity,
  src_ip: alert.src_ip,
  user_id: alert.user_id,
  hostname: alert.hostname,
  description: alert.description,
}, null, 2)}

COMPLETED STEPS AND KEY FINDINGS:
${JSON.stringify(completedSteps, null, 2)}

REMAINING PLANNED STEPS (tools): ${remainingTools.length > 0 ? remainingTools.join(', ') : 'none — this was the last step'}

Should you add ONE additional investigation step based on these findings? Only say yes if:
1. A finding revealed a new uninvestigated indicator (a second IP, a new domain, a related user, a file hash)
2. A result was suspicious enough to warrant corroboration from a different source not already planned
3. The step is NOT already covered by the remaining planned steps above

Respond ONLY with valid JSON — no preamble, no explanation outside the JSON:
{"add_step": false}
OR
{"add_step": true, "step": {"question": "What specific question does this answer?", "tool": "tool_name", "parameters": {"param": "value"}, "rationale": "Exactly which finding triggered this and why a second look matters"}}

Available tools: user_lookup, asset_lookup, siem_query, watchlist_check, ip_geo, whois, abuseipdb, virustotal_ip, virustotal_url, urlscan`;

  return callAI(prompt, settings, 600);
}

// Extracts a brief summary from a tool result for use in the re-planning prompt
function summarizeResult(toolName, result) {
  if (!result || result.error) return result?.error ? `Error: ${result.error}` : 'No result';
  try {
    if (toolName === 'user_lookup') {
      if (!result.found) return 'User not found';
      return `${result.full_name}, ${result.department}, risk=${result.risk_score}, status=${result.status}, mfa=${result.mfa_enabled}${result.notes ? `, notes: ${result.notes}` : ''}`;
    }
    if (toolName === 'asset_lookup') {
      if (!result.found) return 'Asset not found';
      return `${result.hostname}, criticality=${result.criticality}, patch=${result.patch_level}%, edr=${result.edr_installed}, critical_vulns=${result.open_vulns_critical}`;
    }
    if (toolName === 'siem_query') {
      if (result.total_results === 0) return 'No prior alerts found';
      const titles = result.alerts?.slice(0, 3).map(a => a.title).join('; ') || '';
      return `${result.total_results} prior alert(s): ${titles}`;
    }
    if (toolName === 'watchlist_check') {
      if (!result.matched) return 'Not on watchlist';
      return `WATCHLIST HIT: ${result.hits?.map(h => `${h.threat_category} (${h.confidence})`).join(', ')}`;
    }
    if (toolName === 'ip_geo' || toolName === 'whois') {
      const d = result.data || result;
      return `${d.city || ''} ${d.country || ''} (${d.countryCode || '?'}), ISP: ${d.isp || '?'}, ASN: ${d.as || '?'}`;
    }
    if (toolName === 'abuseipdb') {
      const d = result.data || {};
      return `abuse_score=${d.abuseConfidenceScore}%, reports=${d.totalReports}, tor=${d.isTor}, country=${d.countryCode}`;
    }
    if (toolName === 'virustotal_ip') {
      const s = result.data?.last_analysis_stats || {};
      return `malicious=${s.malicious || 0}, suspicious=${s.suspicious || 0}, reputation=${result.data?.reputation ?? 'n/a'}`;
    }
    if (toolName === 'virustotal_url' || toolName === 'urlscan') {
      const s = result.data?.last_analysis_stats || {};
      return `malicious=${s.malicious ?? 'n/a'}, suspicious=${s.suspicious ?? 'n/a'}`;
    }
    return JSON.stringify(result).slice(0, 200);
  } catch {
    return 'Summary unavailable';
  }
}

// ─── Chain mode: Tier 1 quick-scan routing decision ──────────────────────────
export async function runQuickTriage(alert, earlyResults, settings) {
  const prompt = `You are a Tier 1 SOC analyst performing rapid initial triage for Acme Corp. Based on minimal early scan data, decide whether to close or investigate this alert.

ALERT:
${JSON.stringify({
  alert_id: alert.alert_id,
  title: alert.title,
  category: alert.category,
  severity: alert.severity,
  description: alert.description,
  src_ip: alert.src_ip,
  dst_ip: alert.dst_ip,
  user_id: alert.user_id,
  hostname: alert.hostname,
  mitre_tactic: alert.mitre_tactic,
  mitre_technique: alert.mitre_technique,
}, null, 2)}

QUICK SCAN RESULTS (${earlyResults.length} tool${earlyResults.length !== 1 ? 's' : ''}):
${JSON.stringify(earlyResults, null, 2)}

Route this alert to exactly one of:
- CLOSE: Evidence clearly points to a false positive. No further investigation needed.
- INVESTIGATE: Suspicious enough to warrant full deep investigation.

Respond ONLY with valid JSON:
{
  "routing": "CLOSE|INVESTIGATE",
  "rationale": "One concise sentence citing specific evidence from the scan results",
  "confidence_pct": 75,
  "key_indicators": ["up to 3 specific data points that drove this decision"]
}`;

  return callAI(prompt, settings, 400);
}

// ─── Chain mode: Tier 3 — plan additional corroborating steps ────────────────
export async function planEscalationSteps(alert, intermediateVerdict, allStepResults, settings) {
  const toolsAlreadyCalled = [...new Set(allStepResults.map(r => r.tool))];

  const prompt = `You are planning a Tier 3 escalation review for a high-confidence security threat. Tier 2 investigation returned: ${intermediateVerdict.verdict} (${intermediateVerdict.confidence_pct}% confidence).

ALERT: ${JSON.stringify({
  alert_id: alert.alert_id, title: alert.title, category: alert.category,
  severity: alert.severity, src_ip: alert.src_ip, dst_ip: alert.dst_ip,
  user_id: alert.user_id, hostname: alert.hostname,
}, null, 2)}

TOOLS ALREADY CALLED: ${toolsAlreadyCalled.join(', ')}
TIER 2 SUMMARY: ${intermediateVerdict.executive_summary}

Select 1-2 additional corroborating steps using tools NOT in the already-called list above, that would definitively confirm or refute this verdict before escalation.

Available tools: user_lookup, asset_lookup, siem_query, watchlist_check, ip_geo, whois, abuseipdb, virustotal_ip, virustotal_url, urlscan

Respond ONLY with valid JSON:
{
  "steps": [
    {
      "tool": "tool_name",
      "question": "What does this confirm?",
      "parameters": {"param": "value"},
      "rationale": "Why this tool adds value at this point"
    }
  ],
  "escalation_focus": "One sentence: what specifically are we trying to confirm?"
}`;

  return callAI(prompt, settings, 600);
}

// ─── Core AI call dispatcher ──────────────────────────────────────────────────

async function callAI(prompt, settings, maxTokens = MAX_TOKENS_PLAN) {
  const provider = settings?.aiProvider || 'anthropic';

  if (provider === 'openai') {
    return callOpenAI(prompt, settings, maxTokens);
  }
  return callClaude(prompt, settings, maxTokens);
}

async function callClaude(prompt, settings, maxTokens) {
  const apiKey = settings?.anthropicKey;
  if (!apiKey) throw new Error('Anthropic API key not configured. Go to Settings to add your key.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API error ${response.status}: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();

  // Detect truncation before attempting JSON parse
  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      `AI response was cut off before completing (stop_reason: max_tokens). ` +
      `The tool results for this alert may be unusually large. ` +
      `Try re-running — if it fails again, reduce the number of investigation steps.`
    );
  }

  const text = data.content?.[0]?.text || '';
  return parseJSON(text);
}

async function callOpenAI(prompt, settings, maxTokens) {
  const apiKey = settings?.openaiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured. Go to Settings to add your key.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error ${response.status}: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();

  // Detect truncation before attempting JSON parse
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error(
      `AI response was cut off before completing (finish_reason: length). ` +
      `The tool results for this alert may be unusually large. ` +
      `Try re-running — if it fails again, reduce the number of investigation steps.`
    );
  }

  const text = data.choices?.[0]?.message?.content || '';
  return parseJSON(text);
}

function parseJSON(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract from first { or [ if model added preamble text
  const firstBrace = cleaned.search(/[{[]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // Trim anything after the last } or ]
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  // Attempt 1: parse as-is
  try { return JSON.parse(cleaned); } catch (_) {}

  // Attempt 2: fix invalid escape sequences
  // The AI sometimes includes Windows paths (C:\Users\...) or other \ followed by
  // characters that are not valid JSON escape chars (valid: " \ / b f n r t uXXXX).
  // Replace \X (invalid) with \\X so the backslash becomes a literal character.
  const fixedEscapes = cleaned.replace(/\\([^"\\\/bfnrtu\n\r])/g, '\\\\$1');
  try { return JSON.parse(fixedEscapes); } catch (_) {}

  // Attempt 3: also strip trailing commas and fix unquoted keys
  const aggressive = fixedEscapes
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  try { return JSON.parse(aggressive); } catch (e) {
    throw new Error(
      `AI returned invalid JSON.\n\nParse error: ${e.message}\n\nRaw response (first 400 chars):\n${text.slice(0, 400)}`
    );
  }
}
