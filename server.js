// Acme Corp SOC Triage - API Proxy Server
// Handles external API calls that can't be made directly from the browser (CORS)
// Run with: node server.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { saveInvestigation, getInvestigationHistory, recordAnalystFeedback } from './src/services/investigationHistoryService.js';

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Helper to read env or fall through to header
const getKey = (req, envVar) => process.env[envVar] || req.headers['x-api-key'] || '';

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Investigation History (v1.1 Agent Memory) ───────────────────────────────

// Helper: Run analytics computation
async function runAnalytics() {
  try {
    await execAsync('python3 analytics/compute_insights.py');
    return true;
  } catch (err) {
    console.warn('Analytics computation failed:', err.message);
    return false;
  }
}

// Helper: Load insights from file
function loadInsights() {
  try {
    const insightsPath = path.join('data', 'insights.json');
    if (fs.existsSync(insightsPath)) {
      const data = fs.readFileSync(insightsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('Failed to load insights:', err.message);
  }
  return null;
}

app.post('/api/investigations/save', async (req, res) => {
  try {
    const { fullTrace, ...investigationData } = req.body;
    const result = await saveInvestigation(investigationData);

    // Persist full trace JSON alongside the CSV row
    if (fullTrace && investigationData.timestamp) {
      try {
        const safeTs = investigationData.timestamp.replace(/[:.]/g, '-');
        const filename = `${investigationData.alertId}_${safeTs}.json`;
        const traceDir = path.join('data', 'traces');
        fs.mkdirSync(traceDir, { recursive: true });
        fs.writeFileSync(path.join(traceDir, filename), JSON.stringify(fullTrace, null, 2));
      } catch (traceErr) {
        console.warn('Trace file write failed:', traceErr.message);
      }
    }

    // Trigger analytics computation (async, don't wait)
    runAnalytics().catch(err => console.warn('Analytics computation error:', err));

    res.json({ status: 'saved', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Investigation save failed', detail: err.message });
  }
});

app.get('/api/traces/:traceId', (req, res) => {
  const tracePath = path.join('data', 'traces', `${req.params.traceId}.json`);
  if (!fs.existsSync(tracePath)) return res.status(404).json({ error: 'Trace not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(tracePath, 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read trace', detail: err.message });
  }
});

app.post('/api/playbook/execute', (req, res) => {
  const { actionId, alertId, title } = req.body;
  if (!actionId) return res.status(400).json({ error: 'actionId required' });
  res.json({
    success: true,
    actionId,
    alertId,
    title,
    executedAt: new Date().toISOString(),
    mock: true,
    message: `Action "${title}" dispatched successfully (simulated)`,
  });
});

app.get('/api/investigations', async (req, res) => {
  try {
    const history = await getInvestigationHistory();
    res.json({ status: 'ok', count: history.length, data: history });
  } catch (err) {
    res.status(500).json({ error: 'Investigation history retrieval failed', detail: err.message });
  }
});

app.get('/api/insights', (req, res) => {
  const insights = loadInsights();
  if (insights) {
    res.json({ status: 'ok', data: insights });
  } else {
    res.status(404).json({ status: 'not_found', message: 'No insights available yet. Run investigations first.' });
  }
});

app.post('/api/investigations/feedback', async (req, res) => {
  try {
    const { alertId, timestamp, analystDecision } = req.body;

    if (!alertId || !timestamp || !analystDecision) {
      return res.status(400).json({ error: 'Missing required fields: alertId, timestamp, analystDecision' });
    }

    const result = await recordAnalystFeedback(alertId, timestamp, analystDecision);

    // Trigger analytics recomputation (async, don't wait)
    runAnalytics().catch(err => console.warn('Analytics computation error:', err));

    res.json({ status: 'recorded', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record feedback', detail: err.message });
  }
});

app.post('/api/investigations/bulk-feedback', async (req, res) => {
  try {
    const { decisions } = req.body;

    if (!decisions || !Array.isArray(decisions)) {
      return res.status(400).json({ error: 'decisions must be an array' });
    }

    let updated = 0;
    const results = [];

    for (const { alertId, timestamp, decision } of decisions) {
      try {
        const result = await recordAnalystFeedback(alertId, timestamp, decision);
        results.push({ ...result, status: 'ok' });
        updated++;
      } catch (err) {
        results.push({ alertId, timestamp, status: 'error', error: err.message });
      }
    }

    // Trigger analytics recomputation (async, don't wait)
    runAnalytics().catch(err => console.warn('Analytics computation error:', err));

    res.json({ status: 'bulk_complete', updated, total: decisions.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record bulk feedback', detail: err.message });
  }
});

// ─── IP Geolocation (ip-api.com — free, no key needed) ───────────────────────
app.get('/api/ip-geo/:ip', async (req, res) => {
  const { ip } = req.params;
  try {
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`
    );
    const data = await response.json();
    res.json({ source: 'ip-api.com', data });
  } catch (err) {
    res.status(500).json({ error: 'ip-api.com request failed', detail: err.message });
  }
});

// ─── AbuseIPDB ───────────────────────────────────────────────────────────────
app.get('/api/abuseipdb/:ip', async (req, res) => {
  const { ip } = req.params;
  const apiKey = getKey(req, 'ABUSEIPDB_API_KEY');

  if (!apiKey) {
    // Return realistic simulated data if no key
    return res.json({
      source: 'AbuseIPDB',
      simulated: true,
      data: simulateAbuseIPDB(ip)
    });
  }

  try {
    const response = await fetch(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90&verbose`,
      { headers: { Key: apiKey, Accept: 'application/json' } }
    );
    const data = await response.json();
    res.json({ source: 'AbuseIPDB', simulated: false, data });
  } catch (err) {
    res.status(500).json({ error: 'AbuseIPDB request failed', detail: err.message });
  }
});

// ─── VirusTotal - IP ─────────────────────────────────────────────────────────
app.get('/api/virustotal/ip/:ip', async (req, res) => {
  const { ip } = req.params;
  const apiKey = getKey(req, 'VIRUSTOTAL_API_KEY');

  if (!apiKey) {
    return res.json({
      source: 'VirusTotal',
      simulated: true,
      data: simulateVirusTotalIP(ip)
    });
  }

  try {
    const response = await fetch(
      `https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
      { headers: { 'x-apikey': apiKey } }
    );
    const data = await response.json();
    res.json({ source: 'VirusTotal', simulated: false, data });
  } catch (err) {
    res.status(500).json({ error: 'VirusTotal request failed', detail: err.message });
  }
});

// ─── VirusTotal - URL / Domain / Hash ────────────────────────────────────────
app.post('/api/virustotal/url', async (req, res) => {
  const { url } = req.body;
  const apiKey = getKey(req, 'VIRUSTOTAL_API_KEY');

  if (!apiKey) {
    return res.json({
      source: 'VirusTotal',
      simulated: true,
      data: simulateVirusTotalURL(url)
    });
  }

  try {
    // First submit the URL for scanning
    const submitResp = await fetch('https://www.virustotal.com/api/v3/urls', {
      method: 'POST',
      headers: { 'x-apikey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`
    });
    const submitData = await submitResp.json();
    res.json({ source: 'VirusTotal', simulated: false, data: submitData });
  } catch (err) {
    res.status(500).json({ error: 'VirusTotal URL scan failed', detail: err.message });
  }
});

// ─── URLScan.io - lookup existing scans ──────────────────────────────────────
app.get('/api/urlscan/search', async (req, res) => {
  const { q } = req.query;
  const apiKey = getKey(req, 'URLSCAN_API_KEY');

  if (!apiKey && !q) {
    return res.json({ source: 'URLScan.io', simulated: true, data: simulateURLScan(q) });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['API-Key'] = apiKey;
    const response = await fetch(
      `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=5`,
      { headers }
    );
    const data = await response.json();
    res.json({ source: 'URLScan.io', simulated: false, data });
  } catch (err) {
    res.status(500).json({ error: 'URLScan.io request failed', detail: err.message });
  }
});

// ─── WHOIS (using ip-api for ASN/org data + arin for whois) ──────────────────
app.get('/api/whois/:ip', async (req, res) => {
  const { ip } = req.params;
  try {
    const [geoResp] = await Promise.all([
      fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,as,asname,query`)
    ]);
    const geo = await geoResp.json();
    res.json({ source: 'WHOIS / ip-api.com', data: { ...geo, whois_note: 'ASN and org data from ip-api.com' } });
  } catch (err) {
    res.status(500).json({ error: 'WHOIS lookup failed', detail: err.message });
  }
});

// ─── Simulation helpers (realistic fake data when no API key) ────────────────

function simulateAbuseIPDB(ip) {
  const knownBad = {
    '185.220.101.45': { abuseConfidenceScore: 97, totalReports: 284, numDistinctUsers: 89, isTor: true, usageType: 'Tor Exit Node', isp: 'Abuse Legalize Cannabis Advocates', domain: 'torservers.net', countryCode: 'DE', lastReportedAt: '2024-05-12T18:00:00Z' },
    '91.108.4.200': { abuseConfidenceScore: 89, totalReports: 142, numDistinctUsers: 44, isTor: false, usageType: 'Data Center/Web Hosting', isp: 'Hosting provider RU', domain: 'hostsrv.ru', countryCode: 'RU', lastReportedAt: '2024-05-11T09:00:00Z' },
  };
  return knownBad[ip] || {
    abuseConfidenceScore: Math.floor(Math.random() * 15),
    totalReports: Math.floor(Math.random() * 5),
    numDistinctUsers: Math.floor(Math.random() * 3),
    isTor: false,
    usageType: 'Corporate',
    isp: 'Unknown ISP',
    countryCode: 'US',
    lastReportedAt: null,
    note: 'Simulated - add AbuseIPDB API key for real data'
  };
}

function simulateVirusTotalIP(ip) {
  const knownBad = {
    '185.220.101.45': { malicious: 22, suspicious: 4, harmless: 48, undetected: 14, tags: ['tor', 'c2'], reputation: -42 },
    '91.108.4.200': { malicious: 18, suspicious: 3, harmless: 52, undetected: 15, tags: ['apt', 'exfiltration'], reputation: -35 },
  };
  const result = knownBad[ip] || {
    malicious: 0, suspicious: 1, harmless: 70, undetected: 17,
    tags: [], reputation: 0, note: 'Simulated - add VirusTotal API key for real data'
  };
  return { last_analysis_stats: result };
}

function simulateVirusTotalURL(url) {
  const isSuspicious = url && (url.includes('netlify') || url.includes('m365') || url.includes('secure-login'));
  return {
    last_analysis_stats: {
      malicious: isSuspicious ? 14 : 0,
      suspicious: isSuspicious ? 3 : 0,
      harmless: isSuspicious ? 55 : 72,
      undetected: 15
    },
    categories: isSuspicious ? { 'Phishing': 'phishing', 'Malicious': 'malware site' } : {},
    note: 'Simulated - add VirusTotal API key for real data'
  };
}

function simulateURLScan(q) {
  return {
    results: [
      {
        task: { url: q, time: '2024-05-13T06:00:00Z' },
        page: { domain: q, ip: '104.21.45.67', country: 'US' },
        verdicts: { overall: { score: 75, malicious: true, categories: ['phishing'] } },
        note: 'Simulated - add URLScan.io API key for real data'
      }
    ],
    total: 1
  };
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛡️  Acme Corp SOC Proxy Server running on http://localhost:${PORT}`);
  console.log(`   AbuseIPDB: ${process.env.ABUSEIPDB_API_KEY ? '✅ Key loaded' : '⚠️  No key — using simulated data'}`);
  console.log(`   VirusTotal: ${process.env.VIRUSTOTAL_API_KEY ? '✅ Key loaded' : '⚠️  No key — using simulated data'}`);
  console.log(`   URLScan.io: ${process.env.URLSCAN_API_KEY ? '✅ Key loaded' : '⚠️  No key — public API'}`);
  console.log(`   ip-api.com: ✅ Free, no key needed\n`);
});
