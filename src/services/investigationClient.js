/**
 * Client-side service for investigation history
 * Calls backend API to persist investigations to CSV
 */

const API_BASE = 'http://localhost:3001/api';

/**
 * Save an investigation to history
 * @param {Object} investigation - Investigation data
 * @returns {Promise<Object>} - API response
 */
export async function saveInvestigation(investigation) {
  try {
    const response = await fetch(`${API_BASE}/investigations/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(investigation)
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Failed to save investigation:', err);
    throw err;
  }
}

/**
 * Get all investigation history
 * @returns {Promise<Array>} - Array of investigations
 */
export async function getInvestigationHistory() {
  try {
    const response = await fetch(`${API_BASE}/investigations`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.error('Failed to retrieve investigation history:', err);
    return [];
  }
}

/**
 * Extract investigation data from workflow results
 * Call this after AI triage completes to prepare data for saving
 */
export function buildInvestigationPayload(alert, mode, summary, investigationTimeSec, plan) {
  const toolsUsed = plan?.investigation_steps
    ? plan.investigation_steps.map(step => step.tool)
    : [];

  const killChainTactics = summary?.mitre_assessment
    ? Object.keys(summary.mitre_assessment).filter(
        tactic => summary.mitre_assessment[tactic].detected
      )
    : [];

  return {
    alertId: alert.alert_id,
    mode,
    verdict: summary?.verdict || 'UNKNOWN',
    aiScore: summary?.risk_score || 0,
    toolsUsed,
    investigationTimeSec,
    killChainTactics,
    assetCriticality: alert.asset_criticality || 'Unknown',
    dataSensitivity: alert.data_sensitivity || 'Unknown'
  };
}
