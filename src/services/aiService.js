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
  const prompt = `You are investigating the following security alert. Generate a structured investigation plan.

ALERT DETAILS:
${JSON.stringify(alert, null, 2)}

Generate 4-6 targeted investigation steps. For each step, specify:
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
  const resultsFormatted = toolResults.map((r, i) => ({
    step: investigationPlan.investigation_steps[i],
    result: r
  }));

  const prompt = `You have completed the investigation of a security alert. Synthesize all findings into a final triage report.

ORIGINAL ALERT:
${JSON.stringify(alert, null, 2)}

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
  // 1. Strip markdown code fences anywhere in the string (```json ... ``` or ``` ... ```)
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 2. If the model prefixed plain text before the JSON object, extract from first { or [
  const firstBrace = cleaned.search(/[{[]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // 3. If the model appended text after the JSON, extract up to the matching closing brace
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Surface enough of the raw text to diagnose the problem
    throw new Error(
      `AI returned invalid JSON.\n\nParse error: ${e.message}\n\nRaw response (first 400 chars):\n${text.slice(0, 400)}`
    );
  }
}
