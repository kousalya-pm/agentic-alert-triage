/**
 * incidentService.js
 * ─────────────────────────────────────────────────────────────────────
 * Groups related open alerts into incidents and maps alert data to the
 * MITRE ATT&CK kill chain for visualization.
 *
 * Grouping key (in priority order):
 *   user_id  → group all alerts for the same user
 *   hostname → group all alerts on the same host (when no user)
 *   src_ip   → group by source IP (network-only alerts)
 *   alert_id → fallback (solo alert, no grouping)
 */

// ── MITRE ATT&CK stages in kill-chain order ────────────────────────────────
export const KILL_CHAIN_STAGES = [
  { id: 'Reconnaissance',       label: 'Recon',      abbr: 'RC', order: 0  },
  { id: 'Resource Development', label: 'Res Dev',    abbr: 'RD', order: 1  },
  { id: 'Initial Access',       label: 'Init Access',abbr: 'IA', order: 2  },
  { id: 'Execution',            label: 'Execution',  abbr: 'EX', order: 3  },
  { id: 'Persistence',          label: 'Persist',    abbr: 'PS', order: 4  },
  { id: 'Privilege Escalation', label: 'Priv Esc',   abbr: 'PE', order: 5  },
  { id: 'Defense Evasion',      label: 'Def Evasion',abbr: 'DE', order: 6  },
  { id: 'Credential Access',    label: 'Cred Access',abbr: 'CA', order: 7  },
  { id: 'Discovery',            label: 'Discovery',  abbr: 'DI', order: 8  },
  { id: 'Lateral Movement',     label: 'Lateral Mov',abbr: 'LM', order: 9  },
  { id: 'Collection',           label: 'Collection', abbr: 'CO', order: 10 },
  { id: 'Command and Control',  label: 'C2',         abbr: 'C2', order: 11 },
  { id: 'Exfiltration',         label: 'Exfil',      abbr: 'EF', order: 12 },
  { id: 'Impact',               label: 'Impact',     abbr: 'IM', order: 13 },
];

const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

// ── Core helpers ───────────────────────────────────────────────────────────

/** Map a tactic string to a KILL_CHAIN_STAGES entry. */
export function tacticToStage(tactic) {
  if (!tactic) return null;
  return KILL_CHAIN_STAGES.find(
    s => s.id.toLowerCase() === tactic.trim().toLowerCase()
  ) || null;
}

/**
 * Returns a Map of stageId → { stage, alerts[], severity }.
 * Alerts that don't match any stage are ignored.
 * The entry severity reflects the highest-severity alert in that stage.
 */
export function getKillChainCoverage(alerts) {
  const map = new Map();
  for (const alert of alerts) {
    const stage = tacticToStage(alert.mitre_tactic);
    if (!stage) continue;
    if (!map.has(stage.id)) {
      map.set(stage.id, { stage, alerts: [], severity: alert.severity });
    }
    const entry = map.get(stage.id);
    entry.alerts.push(alert);
    if ((SEV_ORDER[alert.severity] ?? 4) < (SEV_ORDER[entry.severity] ?? 4)) {
      entry.severity = alert.severity;
    }
  }
  return map;
}

// ── Incident grouping ──────────────────────────────────────────────────────

/**
 * Group a flat alert array into incidents.
 * Returns incidents sorted: multi-alert incidents first, then by severity.
 *
 * @param {Array} alerts
 * @returns {Array<{ key, entityType, entityId, alerts[] }>}
 */
export function groupAlerts(alerts) {
  const map = new Map();

  for (const alert of alerts) {
    const key        = alert.user_id || alert.hostname || alert.src_ip || alert.alert_id;
    const entityType = alert.user_id ? 'user' : 'asset';
    const entityId   = alert.user_id || alert.hostname || alert.src_ip || null;

    if (!map.has(key)) {
      map.set(key, { key, entityType, entityId, alerts: [] });
    }
    map.get(key).alerts.push(alert);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.alerts.length !== a.alerts.length) return b.alerts.length - a.alerts.length;
    const top = g => Math.min(...g.alerts.map(x => SEV_ORDER[x.severity] ?? 4));
    return top(a) - top(b);
  });
}

/** Highest severity across all alerts in a group. */
export function groupSeverity(incident) {
  const idx = Math.min(...incident.alerts.map(a => SEV_ORDER[a.severity] ?? 4));
  return Object.keys(SEV_ORDER)[idx] || 'Low';
}

/**
 * Derive a human-readable incident title from the alert group.
 * Falls back to tactic abbreviations joined with →.
 */
export function deriveIncidentTitle(incident) {
  const { alerts, entityId } = incident;
  if (alerts.length === 1) return alerts[0].title;

  const tactics   = [...new Set(alerts.map(a => a.mitre_tactic).filter(Boolean))];
  const tacticSet = new Set(tactics);
  const entity    = entityId ? ` — ${entityId}` : '';

  // Named attack patterns
  if (tacticSet.has('Impact') && tacticSet.has('Defense Evasion'))          return `Ransomware Staging${entity}`;
  if (tacticSet.has('Command and Control') && tacticSet.has('Impact'))       return `Active Compromise${entity}`;
  if (tacticSet.has('Persistence') && tacticSet.has('Privilege Escalation')) return `Privilege Escalation Chain${entity}`;
  if (tacticSet.has('Persistence') && tacticSet.has('Discovery'))            return `Post-Compromise Activity${entity}`;
  if (tacticSet.has('Defense Evasion') && tacticSet.has('Exfiltration'))     return `Stealth Exfiltration${entity}`;
  if (tacticSet.has('Exfiltration') && tacticSet.has('Execution'))           return `Execution + Exfiltration${entity}`;
  if (tactics.every(t => t === 'Initial Access'))                            return `Multi-Vector Phishing${entity}`;
  if (tacticSet.has('Privilege Escalation') && tacticSet.has('Persistence')) return `Persistence Chain${entity}`;

  // Generic: abbreviations in stage order
  const abbrs = KILL_CHAIN_STAGES
    .filter(s => tacticSet.has(s.id))
    .map(s => s.abbr)
    .join(' → ');
  return `${abbrs}${entity}`;
}
