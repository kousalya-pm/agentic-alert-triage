/**
 * Utility to sync existing localStorage decisions to backend
 * Run this once to retroactively update CSV with your marked decisions
 */

export async function syncDecisionsToBackend() {
  const DECISIONS_KEY = 'acme-soc-decisions';
  const RUN_HISTORY_KEY = 'acme-soc-run-history';
  const API_BASE = 'http://localhost:3001/api';

  try {
    // Get all decisions from localStorage
    const decisionsRaw = localStorage.getItem(DECISIONS_KEY);
    if (!decisionsRaw) {
      console.log('[v1.1] No decisions found in localStorage');
      return { status: 'no_data', message: 'No decisions to sync' };
    }

    const decisionsMap = JSON.parse(decisionsRaw);
    const alertIds = Object.keys(decisionsMap);

    if (alertIds.length === 0) {
      console.log('[v1.1] No decisions to sync');
      return { status: 'no_data', message: 'No decisions to sync' };
    }

    console.log(`[v1.1] Found ${alertIds.length} decisions to sync...`);

    // Get run history (stored as single object with alertId keys)
    const runHistoryRaw = localStorage.getItem(RUN_HISTORY_KEY);
    const allRunHistory = runHistoryRaw ? JSON.parse(runHistoryRaw) : {};

    // Build decision records
    const decisions = [];
    for (const alertId of alertIds) {
      const decision = decisionsMap[alertId];
      if (!decision || !decision.action) {
        console.log(`[v1.1] Skipping ${alertId}: no action`);
        continue;
      }

      // Get runs for this alert
      const runs = allRunHistory[alertId];
      if (!runs || runs.length === 0) {
        console.log(`[v1.1] Skipping ${alertId}: no run history`);
        continue;
      }

      // Map action to decision format
      const actionMap = {
        tp: 'TP',
        fp: 'FP',
        escalate: 'Escalate',
        confirm_tp: 'TP',
        mark_fp: 'FP',
        TP: 'TP',
        FP: 'FP',
        Escalate: 'Escalate'
      };

      const analystDecision = actionMap[decision.action];
      if (!analystDecision) {
        console.log(`[v1.1] Skipping ${alertId}: unknown action ${decision.action}`);
        continue;
      }

      // Add each run as a separate decision record
      for (const run of runs) {
        decisions.push({
          alertId,
          timestamp: run.timestamp,
          decision: analystDecision
        });
      }
    }

    if (decisions.length === 0) {
      console.log('[v1.1] No valid decisions found to sync');
      return { status: 'no_valid_data', message: 'No valid decisions to sync', debugInfo: { decisionsCount: alertIds.length, runHistoryKeys: Object.keys(allRunHistory).length } };
    }

    console.log(`[v1.1] Syncing ${decisions.length} decision records...`);

    // Send to backend
    const response = await fetch(`${API_BASE}/investigations/bulk-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[v1.1] Sync complete:', result);

    return result;
  } catch (err) {
    console.error('[v1.1] Sync failed:', err);
    throw err;
  }
}

/**
 * Quick command to run in browser console:
 * import { syncDecisionsToBackend } from '/src/services/feedbackSync.js'
 * await syncDecisionsToBackend()
 *
 * Or from Node.js CLI after building:
 * node -e "const sync = require('./dist/feedbackSync.js'); sync.syncDecisionsToBackend().then(r => console.log(r))"
 */
