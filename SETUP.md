# Acme Corp SOC Alert Triage — Setup Guide

## What this is
A working browser prototype of an Agentic SOC Alert Triage system for **Acme Corp** (fictional fintech, 500 employees, hybrid cloud).

The AI agent investigates each alert by:
1. Generating a triage plan (4–6 investigation questions)
2. Executing tool calls — real external APIs + internal CSV lookups
3. Synthesizing a verdict, risk score, and recommended actions

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- An **Anthropic API key** (recommended) from [console.anthropic.com](https://console.anthropic.com/settings/keys)
  - OR an **OpenAI API key** from [platform.openai.com](https://platform.openai.com/api-keys)

---

## Quick Start (3 steps)

### 1. Install dependencies
```bash
cd AgenticSOCAlertTriage
npm install
```

### 2. Start the app
```bash
npm run dev
```
This starts two things simultaneously:
- **Vite dev server** → http://localhost:5173 (the app)
- **Express proxy server** → http://localhost:3001 (handles AbuseIPDB, VirusTotal, etc.)

### 3. Add your API key in the app
- Open http://localhost:5173 in your browser
- Click **Settings** (top right)
- Paste your Anthropic API key
- Click **Save Settings**

That's it. Select any alert from the left panel and click **Run AI Triage**.

---

## Optional: Add threat intel API keys

All are free with signup and make the external tool calls real instead of simulated.

| Service | Get Key | What it does |
|---|---|---|
| **AbuseIPDB** | [abuseipdb.com/register](https://www.abuseipdb.com/register) | IP reputation from community reports |
| **VirusTotal** | [virustotal.com/gui/join-us](https://www.virustotal.com/gui/join-us) | IP/URL scan across 70+ AV vendors |
| **URLScan.io** | [urlscan.io/user/signup](https://urlscan.io/user/signup) | URL/domain analysis (optional) |

Add them in Settings → External Threat Intel APIs. Without keys, realistic simulated data is shown automatically.

---

## What's included

### Alert scenarios (15 alerts across 6 categories)
- **Email**: Phishing, BEC, QR-code quishing, exec impersonation
- **Network**: C2 beaconing, lateral movement, anomalous data transfer
- **Identity**: Impossible travel, privileged account misuse
- **DLP**: SharePoint bulk download, USB transfer, email exfiltration
- **Cloud**: S3 public ACL, Azure RBAC escalation
- **Endpoint**: Ransomware-like behavior

### Tool calls the agent uses
| Tool | Source | Type |
|---|---|---|
| User / AD Lookup | employees.csv | Internal |
| CMDB Asset Lookup | assets.csv | Internal |
| SIEM Historical Query | past_alerts.csv | Internal |
| Threat Watchlist Check | watchlist.csv | Internal |
| IP Geolocation | ip-api.com | External (free, no key) |
| WHOIS / ASN Lookup | ip-api.com | External (free, no key) |
| AbuseIPDB | abuseipdb.com | External (free key) |
| VirusTotal | virustotal.com | External (free key) |
| URLScan.io | urlscan.io | External (optional key) |

---

## File structure
```
AgenticSOCAlertTriage/
├── server.js              # Express proxy for external APIs (handles CORS)
├── vite.config.js         # Vite proxies /api/* to server.js
├── public/data/           # CSV data files (edit to add your own scenarios)
│   ├── alerts.csv         # 15 realistic alert scenarios
│   ├── employees.csv      # 16 employee records
│   ├── assets.csv         # 15 device/asset records
│   ├── past_alerts.csv    # 15 historical alerts for SIEM queries
│   └── watchlist.csv      # 10 threat indicators
└── src/
    ├── services/
    │   ├── aiService.js   # Claude / OpenAI abstraction
    │   ├── toolService.js # All tool call executors
    │   └── csvService.js  # CSV parsing utilities
    └── components/
        ├── AlertQueue.jsx      # Left panel — alert list
        ├── AgentWorkflow.jsx   # Core — step-by-step agent UI
        └── SettingsModal.jsx   # API key configuration
```

---

## Phase 2 ideas (next steps)
- Analyst feedback loop (Confirm / FP / Escalate buttons)
- Metrics dashboard (MTTD, MTTR, FP rate over time)
- Multi-agent view (Tier 1, Threat Intel, Cloud specialist)
- Case management (group related alerts into incidents)
- Export triage report as PDF
- Add real SIEM integration (Sentinel / Splunk API)
