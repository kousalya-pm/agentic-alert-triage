/**
 * riskHeuristic.js
 * ─────────────────
 * Derives a qualitative risk label from in-progress tool results.
 * Called after each tool completes — no AI needed, purely rule-based.
 *
 * Label ladder (ascending severity):
 *   UNKNOWN → SUSPICIOUS → ELEVATED → CRITICAL
 */

// ─── One-line summary per tool ────────────────────────────────────────────────

/**
 * Returns a short, human-readable 1-line summary of a tool result.
 * Used for the collapsed step view so analysts get signal without opening it.
 */
export function oneLineSummary(toolName, result) {
  if (!result || result.error) return result?.error ? `Error: ${result.error}` : 'No data';

  switch (toolName) {
    case 'user_lookup': {
      if (!result.found) return 'User not found in directory';
      const risk = result.risk_score ?? 0;
      const mfa = result.mfa_enabled === 'yes' ? 'MFA ✓' : 'No MFA ⚠';
      return `${result.full_name} · ${result.department} · Risk ${risk}/100 · ${mfa}`;
    }
    case 'asset_lookup': {
      if (!result.found) return 'Asset not found in CMDB';
      const vulns = result.open_vulns_critical > 0 ? ` · ${result.open_vulns_critical} critical vulns` : '';
      return `${result.hostname} · ${result.criticality} criticality · Patch ${result.patch_level}%${vulns}`;
    }
    case 'siem_query': {
      const count = result.total_alerts ?? result.alerts?.length ?? 0;
      if (count === 0) return 'No prior alerts found in SIEM';
      const high = (result.alerts || []).filter(a => a.severity === 'Critical' || a.severity === 'High').length;
      return `${count} prior alerts${high > 0 ? ` · ${high} Critical/High` : ''} in last 30 days`;
    }
    case 'watchlist_check': {
      if (result.match) return `⚠ Matched watchlist: ${result.reason || result.list_name || 'threat indicator'}`;
      return 'No watchlist match — indicator is clean';
    }
    case 'ip_geo': {
      if (!result.country) return 'IP geolocation unavailable';
      const vpn = result.is_vpn ? ' · VPN detected' : '';
      const proxy = result.is_proxy ? ' · Proxy detected' : '';
      return `${result.city || ''}${result.city ? ', ' : ''}${result.country} · ISP: ${result.isp || 'unknown'}${vpn}${proxy}`;
    }
    case 'whois': {
      if (result.error) return 'WHOIS lookup failed';
      const age = result.domain_age_days ? `${Math.floor(result.domain_age_days / 30)}mo old` : '';
      return `${result.registrar || 'Unknown registrar'} · ${age || 'Age unknown'} · ${result.country || ''}`;
    }
    case 'abuseipdb': {
      const score = result.abuse_confidence_score ?? 0;
      const reports = result.total_reports ?? 0;
      if (score === 0 && reports === 0) return 'No abuse reports — IP is clean';
      return `Abuse score ${score}% · ${reports} reports · ${result.usage_type || 'Unknown type'}`;
    }
    case 'virustotal_ip': {
      const malicious = result.malicious ?? 0;
      const suspicious = result.suspicious ?? 0;
      if (malicious === 0 && suspicious === 0) return 'Clean across all VirusTotal engines';
      return `${malicious} malicious · ${suspicious} suspicious · ${result.total_engines ?? '?'} engines`;
    }
    case 'virustotal_url': {
      const malicious = result.malicious ?? 0;
      if (malicious === 0) return 'URL is clean on VirusTotal';
      return `${malicious} vendors flagged URL as malicious`;
    }
    case 'urlscan': {
      if (result.malicious) return `⚠ URLScan flagged as malicious — ${result.verdict || ''}`;
      const tags = result.tags?.slice(0, 3).join(', ') || '';
      return `URL scanned clean${tags ? ` · Tags: ${tags}` : ''}`;
    }
    default:
      return JSON.stringify(result).slice(0, 80).replace(/[{}"]/g, '') + '…';
  }
}

// ─── Risk level computation ───────────────────────────────────────────────────

/**
 * @param {Array<{tool: string, result: object}>} toolResults
 * @returns {'UNKNOWN'|'SUSPICIOUS'|'ELEVATED'|'CRITICAL'}
 */
export function computeRiskLevel(toolResults) {
  if (!toolResults || toolResults.length === 0) return 'UNKNOWN';

  let score = 0; // accumulate points, then map to label

  for (const { tool, result } of toolResults) {
    if (!result || result.error) continue;

    switch (tool) {
      case 'user_lookup': {
        if (!result.found) break;
        const r = result.risk_score ?? 0;
        if (r >= 80) score += 3;
        else if (r >= 60) score += 2;
        else if (r >= 40) score += 1;
        if (result.mfa_enabled !== 'yes') score += 1;
        if (result.status !== 'active') score += 2;
        break;
      }
      case 'asset_lookup': {
        if (!result.found) break;
        if (result.criticality === 'Critical') score += 2;
        else if (result.criticality === 'High') score += 1;
        if (result.open_vulns_critical > 3) score += 2;
        else if (result.open_vulns_critical > 0) score += 1;
        if (result.edr_installed === 'No') score += 1;
        break;
      }
      case 'siem_query': {
        const alerts = result.alerts || [];
        const criticalCount = alerts.filter(a => a.severity === 'Critical' || a.severity === 'High').length;
        if (criticalCount >= 3) score += 3;
        else if (criticalCount >= 1) score += 2;
        else if ((result.total_alerts ?? alerts.length) > 5) score += 1;
        break;
      }
      case 'watchlist_check': {
        if (result.match) score += 4; // definitive signal
        break;
      }
      case 'ip_geo': {
        if (result.is_vpn || result.is_proxy) score += 1;
        // High-risk country codes (simplified)
        const highRisk = ['CN', 'RU', 'KP', 'IR', 'BY', 'SY', 'CU'];
        if (result.countryCode && highRisk.includes(result.countryCode)) score += 2;
        break;
      }
      case 'abuseipdb': {
        const conf = result.abuse_confidence_score ?? 0;
        if (conf >= 80) score += 4;
        else if (conf >= 50) score += 3;
        else if (conf >= 20) score += 2;
        else if (conf > 0) score += 1;
        break;
      }
      case 'virustotal_ip':
      case 'virustotal_url': {
        const malicious = result.malicious ?? 0;
        if (malicious >= 10) score += 4;
        else if (malicious >= 3) score += 3;
        else if (malicious >= 1) score += 2;
        const suspicious = result.suspicious ?? 0;
        if (suspicious >= 5) score += 1;
        break;
      }
      case 'urlscan': {
        if (result.malicious) score += 3;
        break;
      }
      case 'whois': {
        const ageDays = result.domain_age_days ?? 9999;
        if (ageDays < 30) score += 3;  // very new domain
        else if (ageDays < 90) score += 1;
        break;
      }
    }
  }

  if (score >= 8) return 'CRITICAL';
  if (score >= 4) return 'ELEVATED';
  if (score >= 1) return 'SUSPICIOUS';
  return 'UNKNOWN';
}

// ─── Visual config per level ──────────────────────────────────────────────────

export const RISK_LEVEL_CONFIG = {
  UNKNOWN: {
    label: 'UNKNOWN',
    color: 'text-[#7a9cc0]',
    bg: 'bg-[#1e2d4a]/30 border-[#1e2d4a]',
    dot: 'bg-[#4a6080]',
    desc: 'Gathering data…',
  },
  SUSPICIOUS: {
    label: 'SUSPICIOUS',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/30',
    dot: 'bg-yellow-400',
    desc: 'Some indicators of concern',
  },
  ELEVATED: {
    label: 'ELEVATED',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/30',
    dot: 'bg-orange-400',
    desc: 'Multiple risk factors found',
  },
  CRITICAL: {
    label: 'CRITICAL',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
    dot: 'bg-red-500 animate-pulse',
    desc: 'High-confidence threat signals',
  },
};
