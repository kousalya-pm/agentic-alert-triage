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

// Token budgets
const MAX_TOKENS_PLAN    = 4096; // raised: incident plans with 6-8 steps + rationale need room
const MAX_TOKENS_SUMMARY = 8192; // raised: incident synthesis needs room for full narratives

// ─── Call 1: Generate investigation plan ──────────────────────────────────────
export async function generateInvestigationPlan(alert, settings) {
  const isIncident = !!alert._isIncident;

  // Build a lean alert object for the plan prompt — strip internal metadata
  // and cap description to avoid bloating the prompt for incident alerts.
  const { _isIncident, _alertCount, _entityIds, _allAlertIds, _groupKey, ...baseAlert } = alert;
  const alertForPlan = {
    ...baseAlert,
    description: baseAlert.description?.length > 800
      ? baseAlert.description.slice(0, 800) + '… [truncated]'
      : baseAlert.description,
  };

  const incidentNote = isIncident ? `

⚠️  INCIDENT — ${_alertCount} correlated alerts on the same entity.
All users:  ${_entityIds?.users?.join(', ')     || 'none'}
All hosts:  ${_entityIds?.hostnames?.join(', ') || 'none'}
All IPs:    ${[...(_entityIds?.srcIps || []), ...(_entityIds?.dstIps || [])].filter(Boolean).join(', ') || 'none'}

Your plan must cover ALL entities above and each ATT&CK stage visible in the incident.` : '';

  const prompt = `Investigate this security ${isIncident ? 'INCIDENT' : 'alert'} and generate a structured plan.

ALERT:
${JSON.stringify(alertForPlan)}${incidentNote}

Generate ${isIncident ? '6-8' : '4-6'} targeted steps. Keep rationale to 1-2 sentences.

Respond ONLY with valid JSON:
{
  "alert_summary": "one sentence",
  "initial_risk_assessment": "LOW|MEDIUM|HIGH|CRITICAL",
  "key_concerns": ["concern1", "concern2", "concern3"],
  "investigation_steps": [
    {
      "step_id": 1,
      "question": "What does this step answer?",
      "tool": "tool_name",
      "parameters": { "param": "value" },
      "rationale": "1-2 sentences max"
    }
  ]
}`;

  return callAI(prompt, settings, MAX_TOKENS_PLAN);
}

// ─── Call 2: Synthesize results into final verdict ────────────────────────────
export async function generateFinalSummary(alert, investigationPlan, toolResults, settings) {
  const isIncident = !!alert._isIncident;

  // Compact tool results — use summarizeResult() instead of raw JSON.
  // Raw VT data is ~2000 chars; summary is ~40 chars. This prevents max_tokens errors.
  const resultsCompact = toolResults.map((r, i) => {
    const step = investigationPlan.investigation_steps[i];
    return {
      step_id: step?.step_id,
      tool:    step?.tool,
      question: step?.question,
      findings: summarizeResult(step?.tool, r),
    };
  });

  // Strip internal metadata fields — they're prompt noise (already in description)
  const { _isIncident, _alertCount, _entityIds, _allAlertIds, _groupKey, ...alertForPrompt } = alert;

  const incidentSynthesisNote = isIncident ? `

⚠️  INCIDENT SYNTHESIS — You investigated a correlated incident, not a single alert.
Your response must:
- Reference ALL ${_alertCount} constituent alerts in your executive_summary
- Describe the complete attack chain in attack_narrative (from first alert to last)
- Provide recommended_actions that address the full incident scope
- In key_findings, call out the kill chain progression and any signs of lateral movement
- Set escalation_required to true if ANY of the constituent alerts warrant it` : '';

  const prompt = `You have completed the investigation of a security ${isIncident ? 'INCIDENT' : 'alert'}. Synthesize all findings into a final triage report.

ALERT: ${JSON.stringify(alertForPrompt)}${incidentSynthesisNote}

INITIAL ASSESSMENT: ${investigationPlan.initial_risk_assessment} — ${investigationPlan.alert_summary}
KEY CONCERNS: ${investigationPlan.key_concerns?.join('; ')}

TOOL FINDINGS:
${resultsCompact.map(r => `[${r.tool}] ${r.question?.slice(0, 100)} → ${r.findings}`).join('\n')}

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

// Extracts a compact, signal-rich summary from a tool result.
// Used in both adaptive re-planning and final synthesis to keep prompts small.
function summarizeResult(toolName, result) {
  if (!result || result.error) return result?.error ? `Error: ${result.error}` : 'No result';
  try {
    if (toolName === 'user_lookup') {
      if (!result.found) return 'User not found in directory';
      const flags = [];
      if (result.mfa_enabled !== 'yes') flags.push('NO MFA');
      if (result.status !== 'active')   flags.push(`status=${result.status}`);
      if (result.risk_score >= 70)      flags.push(`HIGH risk=${result.risk_score}`);
      if (result.admin_access === 'yes') flags.push('admin');
      if (result.end_date)              flags.push('DEPARTING');
      return `${result.full_name}, ${result.department}, ${result.title}, risk=${result.risk_score}${flags.length ? ` [${flags.join(', ')}]` : ''}${result.notes ? ` | notes: ${result.notes}` : ''}`;
    }
    if (toolName === 'asset_lookup') {
      if (!result.found) return 'Asset not found in CMDB';
      const flags = [];
      if (result.criticality === 'Critical') flags.push('CRITICAL asset');
      if (result.open_vulns_critical > 0)    flags.push(`${result.open_vulns_critical} critical vulns`);
      if (result.edr_installed === 'No')     flags.push('NO EDR');
      if (parseInt(result.patch_level) < 90) flags.push(`low patch=${result.patch_level}%`);
      return `${result.hostname}, ${result.os}, criticality=${result.criticality}, patch=${result.patch_level}%${flags.length ? ` [${flags.join(', ')}]` : ''}`;
    }
    if (toolName === 'siem_query') {
      const alerts = result.alerts || [];
      if (!alerts.length && !result.total_results) return 'No prior alerts found in SIEM';
      const total   = result.total_results ?? alerts.length;
      const critHigh = alerts.filter(a => a.severity === 'Critical' || a.severity === 'High').length;
      const tpCount  = alerts.filter(a => a.verdict === 'True Positive').length;
      const recent   = alerts.slice(0, 4).map(a => `[${a.severity}] ${a.title}`).join('; ');
      return `${total} prior alert(s) — ${critHigh} Critical/High, ${tpCount} True Positives. Recent: ${recent}`;
    }
    if (toolName === 'watchlist_check') {
      // toolService returns { match, indicators[] } or { matched, hits[] }
      const isHit = result.match || result.matched || false;
      if (!isHit) return 'No watchlist match — indicator is clean';
      const indicators = result.indicators || result.hits || [];
      return `⚠ WATCHLIST HIT: ${indicators.map(h => `${h.threat_category || h.indicator_type} (${h.confidence})`).join(', ')}`;
    }
    if (toolName === 'ip_geo') {
      // ip-api.com returns a flat object (no .data wrapper)
      const d = result;
      const flags = [];
      if (d.proxy)    flags.push('PROXY');
      if (d.hosting)  flags.push('HOSTING');
      const highRisk = ['CN','RU','KP','IR','BY','SY'];
      if (highRisk.includes(d.countryCode)) flags.push('HIGH-RISK COUNTRY');
      return `${d.city || '?'}, ${d.country || '?'} (${d.countryCode || '?'}), ISP: ${d.isp || '?'}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
    }
    if (toolName === 'whois') {
      const d = result;
      const ageDays = d.domain_age_days;
      const ageStr  = ageDays != null ? `${Math.floor(ageDays / 30)}mo old` : 'age unknown';
      return `Registrar: ${d.registrar || '?'}, ${ageStr}, country: ${d.country || '?'}${ageDays < 30 ? ' [VERY NEW DOMAIN]' : ''}`;
    }
    if (toolName === 'abuseipdb') {
      // AbuseIPDB proxy returns { data: { abuseConfidenceScore, totalReports, isTor, countryCode } }
      const d = result.data || result;
      const score   = d.abuseConfidenceScore ?? d.abuse_confidence_score ?? 0;
      const reports = d.totalReports ?? d.total_reports ?? 0;
      const tor     = d.isTor ?? d.is_tor ?? false;
      const flag    = score >= 80 ? ' [HIGH ABUSE]' : score >= 50 ? ' [MODERATE ABUSE]' : '';
      return `abuse_score=${score}%, reports=${reports}, tor=${tor}, country=${d.countryCode || d.country_code || '?'}${flag}`;
    }
    if (toolName === 'virustotal_ip') {
      // VT proxy returns { data: { last_analysis_stats, reputation } }
      const stats = result.data?.last_analysis_stats || {};
      const mal   = stats.malicious ?? result.malicious ?? 0;
      const sus   = stats.suspicious ?? result.suspicious ?? 0;
      const rep   = result.data?.reputation ?? result.reputation ?? 'n/a';
      const flag  = mal >= 5 ? ' [CONFIRMED MALICIOUS]' : mal > 0 ? ' [FLAGGED]' : ' [clean]';
      return `VT: malicious=${mal}, suspicious=${sus}, reputation=${rep}${flag}`;
    }
    if (toolName === 'virustotal_url') {
      const stats = result.data?.last_analysis_stats || {};
      const mal   = stats.malicious ?? result.malicious ?? 0;
      const flag  = mal > 0 ? ` [${mal} VENDORS FLAGGED]` : ' [clean]';
      return `VT URL: malicious=${mal}, suspicious=${stats.suspicious ?? 0}${flag}`;
    }
    if (toolName === 'urlscan') {
      if (result.malicious) return `URLScan: MALICIOUS — ${result.verdict || ''}`;
      const tags = result.tags?.slice(0, 3).join(', ') || '';
      return `URLScan: clean${tags ? `, tags: ${tags}` : ''}`;
    }
    // Fallback: compact JSON, max 300 chars
    return JSON.stringify(result).slice(0, 300);
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

  // Prefill the assistant turn with '{' — this forces Claude to begin JSON immediately
  // without any preamble text ("Here is the plan:", schema echoing, etc.).
  // The prefill character is NOT included in content[0].text, so we prepend it below.
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
      messages: [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '{' },   // ← prefill: skip all preamble
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API error ${response.status}: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();

  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      `AI response was cut off before completing (stop_reason: max_tokens). ` +
      `The tool results for this alert may be unusually large. ` +
      `Try re-running — if it fails again, reduce the number of investigation steps.`
    );
  }

  // Prepend the prefilled '{' — the API returns only the continuation after it
  const text = '{' + (data.content?.[0]?.text || '');
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
