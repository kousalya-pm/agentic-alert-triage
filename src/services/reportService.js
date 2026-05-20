// reportService.js
// Generates a self-contained HTML triage report, opens in a new tab,
// and triggers the browser print dialog (user saves as PDF).

import { TOOLS } from './toolService.js';

const VERDICT_STYLE = {
  TRUE_POSITIVE:    { label: 'TRUE POSITIVE',   bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626' },
  FALSE_POSITIVE:   { label: 'FALSE POSITIVE',  bg: '#f0fdf4', border: '#86efac', text: '#14532d', badge: '#16a34a' },
  NEEDS_ESCALATION: { label: 'NEEDS ESCALATION',bg: '#fff7ed', border: '#fdba74', text: '#9a3412', badge: '#ea580c' },
  INCONCLUSIVE:     { label: 'INCONCLUSIVE',    bg: '#fefce8', border: '#fde047', text: '#713f12', badge: '#ca8a04' },
};

const SEV_COLOR = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#ca8a04', Low: '#2563eb',
};

const ACTION_LABEL = {
  confirm_tp: '✅ Confirmed True Positive',
  mark_fp:    '✅ Marked as False Positive',
  escalate:   '⬆️  Escalated to IR Team',
};

// ─── Summarise a single tool result into readable text ────────────────────────
function summariseTool(toolName, params, result) {
  if (result?.error) return `Error: ${result.error}`;

  switch (toolName) {
    case 'user_lookup':
      if (!result.found) return `User "${params.user_id}" not found in directory.`;
      return [
        `Name: ${result.full_name} | Dept: ${result.department} | Title: ${result.title}`,
        `Status: ${result.status} | Risk Score: ${result.risk_score}/100 | MFA: ${result.mfa_enabled}`,
        `Last login: ${result.last_login_location} at ${result.last_login}`,
        result.notes ? `⚠ Notes: ${result.notes}` : '',
      ].filter(Boolean).join('\n');

    case 'asset_lookup':
      if (!result.found) return `Asset "${params.hostname}" not found in CMDB.`;
      return [
        `Hostname: ${result.hostname} (${result.type}) | OS: ${result.os}`,
        `Criticality: ${result.criticality} | Patch Level: ${result.patch_level} | EDR: ${result.edr_installed}`,
        `Critical Vulns: ${result.open_vulns_critical} | High Vulns: ${result.open_vulns_high}`,
        result.notes ? `⚠ Notes: ${result.notes}` : '',
      ].filter(Boolean).join('\n');

    case 'siem_query':
      if (result.total_results === 0) return 'No prior related alerts found for this user/IP.';
      return `Found ${result.total_results} prior alert(s):\n` +
        (result.alerts || []).map(a =>
          `  • [${a.verdict}] ${a.alert_id} — ${a.title} (${a.timestamp?.slice(0, 10)})`
        ).join('\n');

    case 'watchlist_check':
      if (!result.matched) return `Indicator "${result.indicator}" is NOT on the internal threat watchlist.`;
      return `⚠ WATCHLIST HIT for "${result.indicator}":\n` +
        (result.hits || []).map(h =>
          `  • ${h.confidence} confidence | ${h.threat_category} | Source: ${h.source}`
        ).join('\n');

    case 'ip_geo':
    case 'whois': {
      const d = result.data || result;
      return [
        `Location: ${d.city || ''} ${d.regionName || ''}, ${d.country || ''} (${d.countryCode || ''})`,
        `ISP: ${d.isp || '—'} | Org: ${d.org || '—'} | ASN: ${d.as || '—'}`,
      ].join('\n');
    }

    case 'abuseipdb': {
      const d = result.data || {};
      return [
        `Abuse Confidence Score: ${d.abuseConfidenceScore}% | Reports: ${d.totalReports} | Distinct reporters: ${d.numDistinctUsers}`,
        `Is Tor: ${d.isTor ? 'YES' : 'No'} | Country: ${d.countryCode} | Usage: ${d.usageType}`,
        result.simulated ? '(Simulated data — AbuseIPDB API key not configured)' : '',
      ].filter(Boolean).join('\n');
    }

    case 'virustotal_ip':
    case 'virustotal_url': {
      const stats = result.data?.last_analysis_stats || result.last_analysis_stats || {};
      return [
        `Malicious: ${stats.malicious ?? '—'} | Suspicious: ${stats.suspicious ?? '—'} | Harmless: ${stats.harmless ?? '—'}`,
        stats.tags?.length ? `Tags: ${stats.tags.join(', ')}` : '',
        result.simulated ? '(Simulated data — VirusTotal API key not configured)' : '',
      ].filter(Boolean).join('\n');
    }

    case 'urlscan': {
      const results = result.data?.results || [];
      if (!results.length) return 'No URLScan.io results found.';
      return results.map(r =>
        `URL: ${r.task?.url} | Domain: ${r.page?.domain} | Malicious: ${r.verdicts?.overall?.malicious ? 'YES' : 'No'}`
      ).join('\n');
    }

    default:
      return JSON.stringify(result, null, 2).slice(0, 400);
  }
}

// ─── Main export function ─────────────────────────────────────────────────────
export function exportTriageReport({ alert, plan, stepResults, summary, analystDecision, elapsed }) {
  const vs = VERDICT_STYLE[summary?.verdict] || VERDICT_STYLE.INCONCLUSIVE;
  const now = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const alertTime = alert.timestamp
    ? new Date(alert.timestamp).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
    : '—';

  // Build investigation steps HTML
  const stepsHtml = (plan?.investigation_steps || []).map((step, i) => {
    const toolMeta = TOOLS[step.tool] || {};
    const result = stepResults[i];
    const summary_text = result ? summariseTool(step.tool, step.parameters, result) : 'Not executed';
    const isExternal = toolMeta.category === 'external';
    const paramStr = Object.entries(step.parameters || {}).map(([k, v]) => `${k}=${v}`).join(', ');

    return `
      <div class="step">
        <div class="step-header">
          <span class="step-num">${i + 1}</span>
          <div class="step-meta">
            <span class="step-tool">${toolMeta.icon || '🔧'} ${toolMeta.label || step.tool}</span>
            <span class="tag ${isExternal ? 'tag-ext' : 'tag-int'}">${isExternal ? 'External API' : 'Internal'}</span>
            <span class="step-source">${toolMeta.source || ''}</span>
          </div>
        </div>
        <div class="step-question">❓ ${step.question}</div>
        <div class="step-rationale">Rationale: ${step.rationale}</div>
        ${paramStr ? `<div class="step-params">Parameters: <code>${paramStr}</code></div>` : ''}
        ${result ? `<pre class="step-result">${escHtml(summary_text)}${result.duration_ms ? `\n\n⏱ Response time: ${result.duration_ms}ms` : ''}</pre>` : ''}
      </div>`;
  }).join('');

  // Build recommended actions HTML
  const actionsHtml = (summary?.recommended_actions || []).map(a => `
    <div class="action priority-${(a.priority || '').toLowerCase()}">
      <span class="priority-badge">${a.priority}</span>
      <div>
        <div class="action-text">${escHtml(a.action)}</div>
        <div class="action-owner">Owner: ${a.owner}</div>
      </div>
    </div>`).join('');

  // Build key findings HTML
  const findingsHtml = (summary?.key_findings || []).map(f =>
    `<li>${escHtml(f)}</li>`).join('');

  // Analyst decision section
  const decisionHtml = analystDecision ? `
    <section>
      <h2>Analyst Decision</h2>
      <div class="decision-box">
        <div class="decision-action">${ACTION_LABEL[analystDecision.action] || analystDecision.action}</div>
        ${analystDecision.note ? `<div class="decision-note">"${escHtml(analystDecision.note)}"</div>` : ''}
        <div class="decision-meta">Recorded by ${analystDecision.analyst} on ${new Date(analystDecision.timestamp).toLocaleString()}</div>
      </div>
    </section>` : `
    <section>
      <h2>Analyst Decision</h2>
      <p class="muted">No analyst decision recorded for this alert.</p>
    </section>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SOC Triage Report — ${alert.alert_id}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 0; }

    /* Print layout */
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      section { page-break-inside: avoid; }
      .step { page-break-inside: avoid; }
    }
    @page { margin: 18mm 15mm; size: A4; }

    /* Header */
    .report-header { display: flex; justify-content: space-between; align-items: flex-start;
      padding: 16px 20px; background: #0f172a; color: white; }
    .report-header-left h1 { font-size: 15pt; font-weight: 700; letter-spacing: -0.3px; }
    .report-header-left p { font-size: 9pt; color: #94a3b8; margin-top: 2px; }
    .report-header-right { text-align: right; font-size: 9pt; color: #94a3b8; }
    .report-header-right strong { color: #e2e8f0; font-size: 10pt; }

    /* TLP banner */
    .tlp-banner { background: #dc2626; color: white; text-align: center;
      font-size: 8pt; font-weight: 700; letter-spacing: 2px; padding: 3px 0; }

    /* Alert info bar */
    .alert-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
      border-bottom: 2px solid #e2e8f0; background: #f8fafc; }
    .alert-bar-item { padding: 10px 16px; border-right: 1px solid #e2e8f0; }
    .alert-bar-item:last-child { border-right: none; }
    .alert-bar-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .alert-bar-value { font-size: 10pt; font-weight: 600; color: #0f172a; }

    /* Alert title block */
    .alert-title-block { padding: 14px 20px 10px; border-bottom: 1px solid #e2e8f0; }
    .alert-title-block h2 { font-size: 13pt; color: #0f172a; margin-bottom: 4px; }
    .alert-title-block p { font-size: 9pt; color: #475569; line-height: 1.5; }
    .alert-meta-row { margin-top: 8px; display: flex; gap: 20px; flex-wrap: wrap; font-size: 9pt; color: #64748b; }
    .alert-meta-row span strong { color: #0f172a; }

    /* Sections */
    section { padding: 14px 20px; border-bottom: 1px solid #e2e8f0; }
    section h2 { font-size: 10pt; font-weight: 700; color: #334155; text-transform: uppercase;
      letter-spacing: 0.8px; margin-bottom: 10px; border-left: 3px solid #3b82f6; padding-left: 8px; }

    /* Verdict banner */
    .verdict-banner { border-radius: 8px; padding: 14px 18px; border: 1.5px solid ${vs.border};
      background: ${vs.bg}; display: flex; align-items: center; justify-content: space-between; }
    .verdict-label { font-size: 18pt; font-weight: 800; color: ${vs.badge}; letter-spacing: -0.5px; }
    .verdict-sub { font-size: 9pt; color: ${vs.text}; margin-top: 2px; }
    .verdict-scores { display: flex; gap: 28px; text-align: right; }
    .verdict-scores .score-block .score-val { font-size: 18pt; font-weight: 700; color: #0f172a; }
    .verdict-scores .score-block .score-lbl { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Text blocks */
    .summary-text { font-size: 10pt; line-height: 1.65; color: #1e293b; }
    .narrative { font-size: 9pt; color: #475569; line-height: 1.6; font-style: italic;
      background: #f8fafc; border-left: 3px solid #e2e8f0; padding: 8px 12px; border-radius: 4px; margin-top: 8px; }

    /* Findings list */
    .findings-list { list-style: none; padding: 0; }
    .findings-list li { padding: 5px 0 5px 18px; position: relative; font-size: 10pt; color: #1e293b; border-bottom: 1px solid #f1f5f9; }
    .findings-list li::before { content: '→'; position: absolute; left: 0; color: #3b82f6; font-weight: 700; }

    /* MITRE */
    .mitre-block { display: inline-flex; align-items: center; gap: 10px; background: #f0f4ff;
      border: 1px solid #c7d2fe; border-radius: 6px; padding: 8px 14px; }
    .mitre-technique { font-family: monospace; font-size: 11pt; font-weight: 700; color: #4338ca; }
    .mitre-name { font-size: 9pt; color: #3730a3; }

    /* Investigation steps */
    .step { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
    .step-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .step-num { width: 22px; height: 22px; border-radius: 50%; background: #3b82f6; color: white;
      font-size: 9pt; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-tool { font-size: 10pt; font-weight: 600; color: #0f172a; }
    .step-source { font-size: 8pt; color: #94a3b8; }
    .tag { font-size: 8pt; padding: 1px 7px; border-radius: 10px; font-weight: 600; }
    .tag-ext { background: #ede9fe; color: #6d28d9; }
    .tag-int { background: #dcfce7; color: #15803d; }
    .step-question { padding: 7px 12px; font-size: 9.5pt; color: #334155; font-style: italic; border-bottom: 1px solid #f1f5f9; }
    .step-rationale { padding: 4px 12px; font-size: 8.5pt; color: #64748b; border-bottom: 1px dotted #e2e8f0; }
    .step-params { padding: 4px 12px; font-size: 8pt; color: #64748b; border-bottom: 1px dotted #e2e8f0; }
    .step-params code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 8pt; }
    .step-result { padding: 8px 12px; font-size: 8.5pt; color: #1e293b; white-space: pre-wrap;
      font-family: 'Consolas', 'Courier New', monospace; background: #f8fafc; line-height: 1.6; }

    /* Actions */
    .action { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
      border-radius: 6px; margin-bottom: 6px; border: 1px solid; }
    .action.priority-immediate { background: #fff1f2; border-color: #fca5a5; }
    .action.priority-short_term { background: #fff7ed; border-color: #fdba74; }
    .action.priority-monitor { background: #eff6ff; border-color: #93c5fd; }
    .priority-badge { font-size: 8pt; font-weight: 700; padding: 2px 8px; border-radius: 10px;
      white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
    .priority-immediate .priority-badge { background: #dc2626; color: white; }
    .priority-short_term .priority-badge { background: #ea580c; color: white; }
    .priority-monitor .priority-badge { background: #2563eb; color: white; }
    .action-text { font-size: 10pt; color: #0f172a; }
    .action-owner { font-size: 8pt; color: #64748b; margin-top: 2px; }

    /* Escalation */
    .escalation-box { background: #fff7ed; border: 1.5px solid #fdba74; border-radius: 6px;
      padding: 10px 14px; margin-top: 10px; }
    .escalation-box strong { color: #9a3412; font-size: 10pt; }
    .escalation-box p { font-size: 9pt; color: #7c3a15; margin-top: 3px; }

    /* Analyst decision */
    .decision-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 6px; padding: 12px 16px; }
    .decision-action { font-size: 11pt; font-weight: 700; color: #15803d; margin-bottom: 4px; }
    .decision-note { font-size: 10pt; color: #166534; font-style: italic; margin-bottom: 6px; }
    .decision-meta { font-size: 8.5pt; color: #64748b; }

    /* Footer */
    .report-footer { background: #0f172a; color: #64748b; padding: 10px 20px;
      display: flex; justify-content: space-between; font-size: 8pt; }

    /* Print button (hidden in print) */
    .print-btn-bar { background: #1e3a5f; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; }
    .print-btn { background: #3b82f6; color: white; border: none; padding: 8px 20px;
      border-radius: 6px; font-size: 10pt; font-weight: 600; cursor: pointer; }
    .print-btn:hover { background: #2563eb; }
    .muted { color: #94a3b8; font-size: 9.5pt; font-style: italic; }
  </style>
</head>
<body>

  <!-- Print/Save button bar (hidden when printing) -->
  <div class="print-btn-bar no-print">
    <span style="color:#94a3b8; font-size:9pt;">
      🛡 Acme Corp SOC Triage Report — ${alert.alert_id} &nbsp;|&nbsp; Generated ${now}
    </span>
    <button class="print-btn" onclick="window.print()">⬇ Save as PDF / Print</button>
  </div>

  <!-- TLP Banner -->
  <div class="tlp-banner">TLP:RED — RESTRICTED TO ACME CORP SOC PERSONNEL ONLY</div>

  <!-- Report Header -->
  <div class="report-header">
    <div class="report-header-left">
      <h1>🛡 Acme Corp</h1>
      <p>Security Operations Center — Agentic Triage Report</p>
    </div>
    <div class="report-header-right">
      <div><strong>Report ID:</strong> RPT-${alert.alert_id}</div>
      <div>Generated: ${now}</div>
      <div>AI Model: ${summary ? 'Claude / GPT-4o' : 'N/A'}</div>
      <div>Triage time: ${elapsed}s</div>
    </div>
  </div>

  <!-- Alert Info Bar -->
  <div class="alert-bar">
    <div class="alert-bar-item">
      <div class="alert-bar-label">Alert ID</div>
      <div class="alert-bar-value">${alert.alert_id}</div>
    </div>
    <div class="alert-bar-item">
      <div class="alert-bar-label">Severity</div>
      <div class="alert-bar-value" style="color:${SEV_COLOR[alert.severity] || '#111'}">${alert.severity}</div>
    </div>
    <div class="alert-bar-item">
      <div class="alert-bar-label">Category</div>
      <div class="alert-bar-value">${alert.category}</div>
    </div>
    <div class="alert-bar-item">
      <div class="alert-bar-label">Detection Time</div>
      <div class="alert-bar-value" style="font-size:9pt">${alertTime}</div>
    </div>
  </div>

  <!-- Alert Title -->
  <div class="alert-title-block">
    <h2>${escHtmlInline(alert.title)}</h2>
    <p>${escHtmlInline(alert.description || '')}</p>
    <div class="alert-meta-row">
      ${alert.user_id    ? `<span><strong>User:</strong> ${alert.user_id}</span>` : ''}
      ${alert.hostname   ? `<span><strong>Host:</strong> ${alert.hostname}</span>` : ''}
      ${alert.src_ip     ? `<span><strong>Src IP:</strong> ${alert.src_ip}</span>` : ''}
      ${alert.dst_ip     ? `<span><strong>Dst IP:</strong> ${alert.dst_ip}</span>` : ''}
      ${alert.source_tool? `<span><strong>Source:</strong> ${alert.source_tool}</span>` : ''}
      ${alert.mitre_tactic ? `<span><strong>MITRE:</strong> ${alert.mitre_tactic} · ${alert.mitre_technique}</span>` : ''}
    </div>
  </div>

  <!-- AI Verdict -->
  <section>
    <h2>AI Verdict</h2>
    <div class="verdict-banner">
      <div>
        <div class="verdict-label">${vs.label}</div>
        <div class="verdict-sub">AI-generated verdict · Always review with analyst judgment</div>
      </div>
      <div class="verdict-scores">
        <div class="score-block">
          <div class="score-val">${summary?.risk_score ?? '—'}<span style="font-size:10pt;color:#64748b">/10</span></div>
          <div class="score-lbl">Risk Score</div>
        </div>
        <div class="score-block">
          <div class="score-val">${summary?.confidence_pct ?? '—'}<span style="font-size:10pt;color:#64748b">%</span></div>
          <div class="score-lbl">Confidence</div>
        </div>
        <div class="score-block">
          <div class="score-val">${elapsed}<span style="font-size:10pt;color:#64748b">s</span></div>
          <div class="score-lbl">Triage Time</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Executive Summary -->
  <section>
    <h2>Executive Summary</h2>
    <p class="summary-text">${escHtmlInline(summary?.executive_summary || '')}</p>
    ${summary?.attack_narrative ? `<div class="narrative">${escHtmlInline(summary.attack_narrative)}</div>` : ''}
  </section>

  <!-- Key Findings -->
  ${findingsHtml ? `
  <section>
    <h2>Key Findings</h2>
    <ul class="findings-list">${findingsHtml}</ul>
  </section>` : ''}

  <!-- MITRE ATT&CK -->
  ${summary?.mitre_assessment ? `
  <section>
    <h2>MITRE ATT&CK Mapping</h2>
    <div class="mitre-block">
      <span class="mitre-technique">${summary.mitre_assessment.technique}</span>
      <span>·</span>
      <span class="mitre-name">${escHtmlInline(summary.mitre_assessment.tactic)} — ${escHtmlInline(summary.mitre_assessment.technique_name)}</span>
    </div>
  </section>` : ''}

  <!-- Investigation Steps -->
  <section>
    <h2>Investigation Steps (${plan?.investigation_steps?.length || 0})</h2>
    ${stepsHtml || '<p class="muted">No investigation steps recorded.</p>'}
  </section>

  <!-- Recommended Actions -->
  ${actionsHtml ? `
  <section>
    <h2>Recommended Actions</h2>
    ${actionsHtml}
    ${summary?.escalation_required ? `
    <div class="escalation-box">
      <strong>⬆ Escalation Required</strong>
      <p>${escHtmlInline(summary.escalation_reason || '')}</p>
    </div>` : ''}
  </section>` : ''}

  <!-- Analyst Decision -->
  ${decisionHtml}

  <!-- Notes -->
  ${summary?.analyst_notes ? `
  <section>
    <h2>Additional Analyst Notes</h2>
    <p style="font-size:9.5pt;color:#475569;font-style:italic;">${escHtmlInline(summary.analyst_notes)}</p>
  </section>` : ''}

  <!-- Footer -->
  <div class="report-footer">
    <span>Acme Corp — Security Operations Center</span>
    <span>TLP:RED — Do not distribute outside Acme Corp SOC</span>
    <span>Generated ${now}</span>
  </div>

  <script>
    // Auto-trigger print dialog after a short delay for rendering
    setTimeout(() => window.print(), 600);
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ─── HTML escape helpers ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline version (preserves newlines as <br> for display text)
function escHtmlInline(str) {
  return escHtml(str).replace(/\n/g, '<br>');
}
