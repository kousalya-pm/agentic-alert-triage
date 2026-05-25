const HISTORY_KEY = 'acme-soc-run-history';
const MAX_RUNS_PER_ALERT = 5;

function loadAll() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; }
}

// mode: 'standard' | 'adaptive' | 'parallel'
// extras: any additional mode-specific data (e.g. agentStates for parallel)
export function saveRun(alertId, { plan, stepResults, summary, elapsed, mode = 'standard', ...extras }) {
  const all = loadAll();
  const runs = all[alertId] || [];
  const newRun = {
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
  all[alertId] = [newRun, ...runs].slice(0, MAX_RUNS_PER_ALERT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  return newRun;
}

// Pass mode to get only runs from that mode; omit to get all runs
export function getRuns(alertId, mode = null) {
  const runs = loadAll()[alertId] || [];
  if (!mode) return runs;
  return runs.filter(r => (r.mode || 'standard') === mode);
}
