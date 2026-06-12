const HISTORY_KEY = 'acme-soc-run-history';
const MAX_RUNS_PER_MODE = 10;  // Changed: 10 runs per mode, not 5 global
const CURRENT_VERSION = 2;

function loadAll() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; }
}

// One-time migration: remap old ALT-2024-xxx keys → ALT-2026-xxx
// (alert IDs were shifted +2 years in the June 2026 data update)
function migrateAlertIds() {
  try {
    const all = loadAll();
    let changed = false;
    const updated = {};
    for (const [key, val] of Object.entries(all)) {
      const newKey = key.replace(/^ALT-2024-/, 'ALT-2026-');
      if (newKey !== key) changed = true;
      updated[newKey] = val;
    }
    if (changed) localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}
migrateAlertIds();

// mode: 'standard' | 'adaptive' | 'parallel' | 'chain'
// extras: any additional mode-specific data (e.g. agentStates for parallel)
export function saveRun(alertId, { plan, stepResults, summary, elapsed, mode = 'standard', ...extras }) {
  const all = loadAll();
  const allRuns = all[alertId] || [];

  // NEW: Only save once per run (check if last run is identical timestamp within 1 second)
  // This prevents duplicate saves from useRunAutosave cleanup
  const now = Date.now();
  const lastRun = allRuns[0];
  if (lastRun && lastRun.mode === mode && (now - new Date(lastRun.timestamp).getTime()) < 1000) {
    // Skip duplicate save — same mode, same second
    return lastRun;
  }

  const newRun = {
    version: CURRENT_VERSION,
    runId: `${alertId}_${mode}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    verdict: summary?.verdict || 'INCONCLUSIVE',
    elapsed,
    mode,
    plan,
    stepResults,
    summary,
    ...extras,
  };

  // Keep MAX_RUNS_PER_MODE per alert, but preserve runs from all modes
  all[alertId] = [newRun, ...allRuns].slice(0, MAX_RUNS_PER_MODE);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  return newRun;
}

// Pass mode to get only runs from that mode; omit to get all runs.
// v1 runs (no version field) are silently dropped — incompatible with new UI.
export function getRuns(alertId, mode = null) {
  const all = loadAll()[alertId] || [];
  const versioned = all.filter(r => (r.version || 1) >= CURRENT_VERSION);
  if (!mode) return versioned;
  return versioned.filter(r => (r.mode || 'standard') === mode);
}
