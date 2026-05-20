// Tool Service - executes all tool calls for the agent
// Internal tools use CSV data; external tools call the proxy server

import { lookupUser, lookupAsset, queryPastAlerts, checkWatchlist } from './csvService.js';

const PROXY = '/api';

// ─── Tool Registry ────────────────────────────────────────────────────────────
// Maps tool names returned by the AI to executor functions

export const TOOLS = {
  user_lookup: {
    label: 'Active Directory / User Lookup',
    icon: '👤',
    source: 'Internal — AD/LDAP (employees.csv)',
    category: 'internal',
    description: 'Look up employee profile, department, role, risk score, and account status',
  },
  asset_lookup: {
    label: 'CMDB / Asset Lookup',
    icon: '🖥️',
    source: 'Internal — CMDB (assets.csv)',
    category: 'internal',
    description: 'Look up device details, OS, patch level, criticality, and EDR status',
  },
  siem_query: {
    label: 'SIEM Historical Query',
    icon: '📊',
    source: 'Internal — Microsoft Sentinel (past_alerts.csv)',
    category: 'internal',
    description: 'Search past alerts and incidents for the same user or IP address',
  },
  watchlist_check: {
    label: 'Internal Threat Watchlist',
    icon: '🔍',
    source: 'Internal — Threat Intel Watchlist (watchlist.csv)',
    category: 'internal',
    description: 'Check if indicator appears on internal blocklist or threat watchlist',
  },
  ip_geo: {
    label: 'IP Geolocation',
    icon: '🌍',
    source: 'External — ip-api.com',
    category: 'external',
    description: 'Geolocate an IP address — country, city, ISP, ASN',
  },
  whois: {
    label: 'WHOIS / ASN Lookup',
    icon: '🔎',
    source: 'External — ARIN / ip-api.com',
    category: 'external',
    description: 'WHOIS registration and ASN information for an IP',
  },
  abuseipdb: {
    label: 'AbuseIPDB Check',
    icon: '🚨',
    source: 'External — AbuseIPDB',
    category: 'external',
    description: 'Check if IP has been reported for malicious activity by the community',
  },
  virustotal_ip: {
    label: 'VirusTotal IP Analysis',
    icon: '🦠',
    source: 'External — VirusTotal',
    category: 'external',
    description: 'Check IP reputation across 70+ security vendors on VirusTotal',
  },
  virustotal_url: {
    label: 'VirusTotal URL Scan',
    icon: '🦠',
    source: 'External — VirusTotal',
    category: 'external',
    description: 'Scan URL/domain against 70+ security vendors on VirusTotal',
  },
  urlscan: {
    label: 'URLScan.io Analysis',
    icon: '🌐',
    source: 'External — URLScan.io',
    category: 'external',
    description: 'Search URLScan.io for existing scan results of a domain or URL',
  },
};

// ─── Tool Executor ────────────────────────────────────────────────────────────

export async function executeTool(toolName, params, settings) {
  const start = Date.now();

  try {
    let result;

    switch (toolName) {
      case 'user_lookup':
        result = await runUserLookup(params);
        break;
      case 'asset_lookup':
        result = await runAssetLookup(params);
        break;
      case 'siem_query':
        result = await runSiemQuery(params);
        break;
      case 'watchlist_check':
        result = await runWatchlistCheck(params);
        break;
      case 'ip_geo':
        result = await runIPGeo(params);
        break;
      case 'whois':
        result = await runWHOIS(params);
        break;
      case 'abuseipdb':
        result = await runAbuseIPDB(params, settings);
        break;
      case 'virustotal_ip':
        result = await runVirusTotalIP(params, settings);
        break;
      case 'virustotal_url':
        result = await runVirusTotalURL(params, settings);
        break;
      case 'urlscan':
        result = await runURLScan(params, settings);
        break;
      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    return { ...result, duration_ms: Date.now() - start };
  } catch (err) {
    return { error: err.message, duration_ms: Date.now() - start };
  }
}

// ─── Internal Tools ───────────────────────────────────────────────────────────

async function runUserLookup({ user_id }) {
  if (!user_id) return { found: false, reason: 'No user_id provided' };
  const user = await lookupUser(user_id);
  if (!user) return { found: false, user_id, reason: 'User not found in directory' };
  return {
    found: true,
    user_id: user.user_id,
    full_name: user.full_name,
    email: user.email,
    department: user.department,
    title: user.title,
    manager: user.manager,
    location: user.location,
    employee_type: user.employee_type,
    status: user.status,
    start_date: user.start_date,
    end_date: user.end_date || null,
    risk_score: parseInt(user.risk_score),
    vpn_access: user.vpn_access,
    admin_access: user.admin_access,
    mfa_enabled: user.mfa_enabled,
    last_login: user.last_login,
    last_login_ip: user.last_login_ip,
    last_login_location: user.last_login_location,
    notes: user.notes || null,
  };
}

async function runAssetLookup({ hostname }) {
  if (!hostname) return { found: false, reason: 'No hostname provided' };
  const asset = await lookupAsset(hostname);
  if (!asset) return { found: false, hostname, reason: 'Asset not found in CMDB' };
  return {
    found: true,
    hostname: asset.hostname,
    asset_id: asset.asset_id,
    type: asset.type,
    os: asset.os,
    ip_address: asset.ip_address,
    owner_user_id: asset.owner_user_id,
    department: asset.department,
    location: asset.location,
    criticality: asset.criticality,
    patch_level: asset.patch_level,
    last_seen: asset.last_seen,
    antivirus: asset.antivirus,
    edr_installed: asset.edr_installed,
    encrypted: asset.encrypted,
    open_vulns_critical: parseInt(asset.open_vulns_critical),
    open_vulns_high: parseInt(asset.open_vulns_high),
    notes: asset.notes || null,
  };
}

async function runSiemQuery({ user_id, src_ip }) {
  const past = await queryPastAlerts(user_id, src_ip);
  return {
    query: { user_id, src_ip },
    total_results: past.length,
    alerts: past.map(a => ({
      alert_id: a.alert_id,
      timestamp: a.timestamp,
      severity: a.severity,
      category: a.category,
      title: a.title,
      verdict: a.verdict,
      analyst_notes: a.analyst_notes,
    })),
  };
}

async function runWatchlistCheck({ indicator }) {
  if (!indicator) return { matched: false, reason: 'No indicator provided' };
  const hits = await checkWatchlist(indicator);
  return {
    indicator,
    matched: hits.length > 0,
    hits: hits.map(h => ({
      indicator: h.indicator,
      type: h.indicator_type,
      threat_category: h.threat_category,
      confidence: h.confidence,
      source: h.source,
      description: h.description,
      added_date: h.added_date,
    })),
  };
}

// ─── External Tools ───────────────────────────────────────────────────────────

async function runIPGeo({ ip }) {
  const resp = await fetch(`${PROXY}/ip-geo/${ip}`);
  return await resp.json();
}

async function runWHOIS({ ip }) {
  const resp = await fetch(`${PROXY}/whois/${ip}`);
  return await resp.json();
}

async function runAbuseIPDB({ ip }, settings) {
  const headers = {};
  const key = settings?.abuseipdbKey;
  if (key) headers['x-api-key'] = key;
  const resp = await fetch(`${PROXY}/abuseipdb/${ip}`, { headers });
  return await resp.json();
}

async function runVirusTotalIP({ ip }, settings) {
  const headers = {};
  const key = settings?.virusTotalKey;
  if (key) headers['x-api-key'] = key;
  const resp = await fetch(`${PROXY}/virustotal/ip/${ip}`, { headers });
  return await resp.json();
}

async function runVirusTotalURL({ url }, settings) {
  const headers = { 'Content-Type': 'application/json' };
  const key = settings?.virusTotalKey;
  if (key) headers['x-api-key'] = key;
  const resp = await fetch(`${PROXY}/virustotal/url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });
  return await resp.json();
}

async function runURLScan({ query }, settings) {
  const headers = {};
  const key = settings?.urlScanKey;
  if (key) headers['x-api-key'] = key;
  const resp = await fetch(`${PROXY}/urlscan/search?q=${encodeURIComponent(query)}`, { headers });
  return await resp.json();
}
