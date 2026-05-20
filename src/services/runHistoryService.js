const HISTORY_KEY = 'acme-soc-run-history';
const MAX_RUNS_PER_ALERT = 5;

function loadAll() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; }
}

export function saveRun(alertId, { plan, stepResults, summary, elapsed }) {
  const all = loadAll();
  const runs = all[alertId] || [];
  const newRun = {
    runId: `run-${Date.now()}`,
    timestamp: new Date().toISOString(),
    verdict: summary?.verdict || 'INCONCLUSIVE',
    elapsed,
    plan,
    stepResults,
    summary,
  };
  all[alertId] = [newRun, ...runs].slice(0, MAX_RUNS_PER_ALERT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  return newRun;
}

export function getRuns(alertId) {
  return loadAll()[alertId] || [];
}
