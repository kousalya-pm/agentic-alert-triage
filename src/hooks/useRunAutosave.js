import { useEffect } from 'react';
import { saveRun } from '../services/runHistoryService.js';

/**
 * Shared hook for auto-saving runs at any investigation stage
 * Handles both intermediate progress and cleanup on unmount
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
  // Auto-save on state changes
  useEffect(() => {
    if (alertId && (stepResults?.length > 0 || summary)) {
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
  }, [alertId, plan, stepResults, summary, mode]);

  // Save on unmount (when navigating away)
  useEffect(() => {
    return () => {
      if (alertId && (stepResults?.length > 0 || summary)) {
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
    };
  }, [alertId, plan, stepResults, summary, mode]);
}
