import { useEffect } from 'react';
import { saveRun } from '../services/runHistoryService.js';

/**
 * Shared hook for auto-saving runs when investigation completes
 * Only saves when summary is available (run is complete)
 * Deduplication happens in saveRun() to prevent duplicate saves
 */
export function useRunAutosave({
  alertId,
  mode,
  plan,
  stepResults,
  summary,
  startTimeRef,
  extraData = {}  // mode-specific data (e.g., agentStates, tier results)
}) {
  // Save only when run is complete (summary available)
  useEffect(() => {
    if (alertId && summary) {
      const elapsed = Math.round((Date.now() - (startTimeRef?.current || Date.now())) / 1000) || 0;
      saveRun(alertId, {
        plan,
        stepResults: stepResults || [],
        summary,
        elapsed,
        mode,
        ...extraData,
      });
    }
  }, [alertId, summary, mode]);  // Only re-save if summary or mode changes
}
