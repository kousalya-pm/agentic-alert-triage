#!/usr/bin/env node
/**
 * Acme Corp SOC MCP Server
 * Exposes 10 SOC investigation tools via Model Context Protocol.
 *
 * Claude Desktop (stdio):
 *   node mcp-server.js
 *
 * HTTP mode (browser registry + testing):
 *   node mcp-server.js --http        → port 3002
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "acme-soc-tools": {
 *         "command": "node",
 *         "args": ["/ABSOLUTE/PATH/TO/mcp-server.js"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'public', 'data');
const PROXY_BASE = 'http://localhost:3001/api';

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

export const MCP_TOOLS = [
  {
    name: 'user_lookup',
    description: 'Look up an employee profile from Active Directory — department, role, risk score, MFA status, and account state.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Username, email prefix, or employee ID (e.g. jdoe, jdoe@acme.com)' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'asset_lookup',
    description: 'Look up a device from the CMDB — OS, patch level, criticality, EDR status, and open vulnerabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Device hostname (e.g. WKSTN-FIN-001)' },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'siem_query',
    description: 'Query the SIEM (Microsoft Sentinel) for past security alerts related to a user or IP address.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id:    { type: 'string', description: 'Username to search past alerts for' },
        ip_address: { type: 'string', description: 'IP address to search past alerts for' },
        time_range: { type: 'string', description: 'Lookback window (e.g. 7d, 30d)', default: '30d' },
      },
    },
  },
  {
    name: 'watchlist_check',
    description: 'Check if an IP address, domain, or hash appears on the internal threat intelligence watchlist.',
    inputSchema: {
      type: 'object',
      properties: {
        indicator: { type: 'string', description: 'IP, domain, URL, or file hash to check' },
        type:      { type: 'string', enum: ['ip', 'domain', 'hash', 'url'], description: 'Indicator type' },
      },
      required: ['indicator'],
    },
  },
  {
    name: 'ip_geo',
    description: 'Geolocate an IP address — country, city, ISP, ASN, and proxy/hosting flags.',
    inputSchema: {
      type: 'object',
      properties: {
        ip: { type: 'string', description: 'IPv4 or IPv6 address to geolocate' },
      },
      required: ['ip'],
    },
  },
  {
    name: 'whois',
    description: 'WHOIS and ASN registration data for an IP address — registrar, org, and domain age.',
    inputSchema: {
      type: 'object',
      properties: {
        ip: { type: 'string', description: 'IP address to look up' },
      },
      required: ['ip'],
    },
  },
  {
    name: 'abuseipdb',
    description: 'Check an IP address against AbuseIPDB — abuse confidence score, report count, and Tor flag.',
    inputSchema: {
      type: 'object',
      properties: {
        ip: { type: 'string', description: 'IP address to check' },
      },
      required: ['ip'],
    },
  },
  {
    name: 'virustotal_ip',
    description: 'Check an IP address reputation across 70+ security vendors on VirusTotal.',
    inputSchema: {
      type: 'object',
      properties: {
        ip: { type: 'string', description: 'IP address to analyse' },
      },
      required: ['ip'],
    },
  },
  {
    name: 'virustotal_url',
    description: 'Scan a URL or domain against 70+ security vendors on VirusTotal.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL or domain to scan' },
      },
      required: ['url'],
    },
  },
  {
    name: 'urlscan',
    description: 'Search URLScan.io for existing scan results of a domain, showing malicious verdict and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Domain or URL to search' },
      },
      required: ['url'],
    },
  },
];

// ─── Tool executors ───────────────────────────────────────────────────────────

function parseCSV(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || '').trim()]));
    });
  } catch { return []; }
}

async function proxyGet(path) {
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(`${PROXY_BASE}${path}`);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function executeTool(name, args) {
  switch (name) {
    case 'user_lookup': {
      const id = (args.user_id || '').toLowerCase();
      const rows = parseCSV(path.join(DATA_DIR, 'employees.csv'));
      const row = rows.find(r =>
        r.user_id?.toLowerCase() === id ||
        r.email?.toLowerCase().startsWith(id)
      );
      if (!row) return { found: false, user_id: args.user_id };
      return { found: true, ...row };
    }

    case 'asset_lookup': {
      const host = (args.hostname || '').toLowerCase();
      const rows = parseCSV(path.join(DATA_DIR, 'assets.csv'));
      const row = rows.find(r => r.hostname?.toLowerCase() === host);
      if (!row) return { found: false, hostname: args.hostname };
      return { found: true, ...row };
    }

    case 'siem_query': {
      const rows = parseCSV(path.join(DATA_DIR, 'past_alerts.csv'));
      const id = (args.user_id || '').toLowerCase();
      const ip = args.ip_address || '';
      const matches = rows.filter(r =>
        (id && r.user_id?.toLowerCase() === id) ||
        (ip && (r.src_ip === ip || r.dst_ip === ip))
      ).slice(0, 10);
      return { total_results: matches.length, alerts: matches };
    }

    case 'watchlist_check': {
      const indicator = (args.indicator || '').toLowerCase();
      const rows = parseCSV(path.join(DATA_DIR, 'watchlist.csv'));
      const hits = rows.filter(r =>
        r.indicator?.toLowerCase() === indicator ||
        r.value?.toLowerCase() === indicator
      );
      return { match: hits.length > 0, matched: hits.length > 0, indicators: hits, hits };
    }

    case 'ip_geo': {
      const data = await proxyGet(`/geo/${args.ip}`);
      return data || { error: 'Geo lookup unavailable', ip: args.ip };
    }

    case 'whois': {
      const data = await proxyGet(`/whois/${args.ip}`);
      return data || { error: 'WHOIS lookup unavailable', ip: args.ip };
    }

    case 'abuseipdb': {
      const data = await proxyGet(`/abuseipdb/${args.ip}`);
      return data || { error: 'AbuseIPDB unavailable', ip: args.ip };
    }

    case 'virustotal_ip': {
      const data = await proxyGet(`/virustotal/ip/${args.ip}`);
      return data || { error: 'VirusTotal unavailable', ip: args.ip };
    }

    case 'virustotal_url': {
      const encoded = encodeURIComponent(args.url);
      const data = await proxyGet(`/virustotal/url/${encoded}`);
      return data || { error: 'VirusTotal unavailable', url: args.url };
    }

    case 'urlscan': {
      const encoded = encodeURIComponent(args.url);
      const data = await proxyGet(`/urlscan/${encoded}`);
      return data || { error: 'URLScan unavailable', url: args.url };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

const mcpServer = new Server(
  { name: 'acme-soc-tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await executeTool(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

// ─── HTTP sidecar (port 3002) — for browser registry panel ───────────────────

function startHttpSidecar() {
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/mcp/tools' && req.method === 'GET') {
      res.end(JSON.stringify({ tools: MCP_TOOLS, server: 'acme-soc-tools', version: '1.0.0' }));
      return;
    }

    if (req.url === '/mcp/call' && req.method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        try {
          const { name, arguments: args } = JSON.parse(body);
          const result = await executeTool(name, args || {});
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
          }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(3002, () => {
    process.stderr.write('🔌 MCP HTTP sidecar → http://localhost:3002\n');
    process.stderr.write('   GET  /mcp/tools  — list tool definitions\n');
    process.stderr.write('   POST /mcp/call   — execute a tool\n');
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const httpMode = process.argv.includes('--http');

// Always start the HTTP sidecar (doesn't conflict with stdio)
startHttpSidecar();

if (httpMode) {
  process.stderr.write('🛡️  MCP server running in HTTP-only mode\n');
} else {
  // Stdio transport for Claude Desktop
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
