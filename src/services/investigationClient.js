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
export function buildInvestigationPayload(alert, mode, summary, investigationTimeSec, plan, trace = null) {
  const toolsUsed = plan?.investigation_steps
    ? plan.investigation_steps.map(step => step.tool)
    : [];

  const killChainTactics = summary?.mitre_assessment?.tactic
    ? [summary.mitre_assessment.tactic]
    : [];

  const traceColumns = trace?.totals ? {
    totalInputTokens: trace.totals.inputTokens,
    totalOutputTokens: trace.totals.outputTokens,
    cacheCreationTokens: trace.totals.cacheCreationTokens,
    cacheReadTokens: trace.totals.cacheReadTokens,
    estimatedCostUsd: Math.round(trace.totals.estimatedCostUsd * 1e6) / 1e6,
    cacheSavingsUsd: Math.round(trace.totals.cacheSavingsUsd * 1e6) / 1e6,
    aiCallsCount: trace.totals.aiCallsCount,
    toolCallsCount: trace.totals.toolCallsCount,
    modelUsed: trace.totals.model_used || '',
  } : {};

  return {
    alertId: alert.alert_id,
    alertCategory: alert.category || '',
    timestamp: new Date().toISOString(),
    mode,
    verdict: summary?.verdict || 'UNKNOWN',
    aiScore: summary?.risk_score || 0,
    toolsUsed,
    investigationTimeSec,
    killChainTactics,
    assetCriticality: alert.asset_criticality || 'Unknown',
    dataSensitivity: alert.data_sensitivity || 'Unknown',
    fullTrace: trace || null,
    ...traceColumns,
  };
}

/**
 * Fetch similar past cases with analyst feedback and format as a prompt context block.
 * Used to inject active learning context into the planning step.
 */
export async function fetchSimilarCasesContext(alertId, alertCategory) {
  if (!alertCategory) return null;
  try {
    const response = await fetch(`${API_BASE}/investigations`);
    if (!response.ok) return null;
    const body = await response.json();
    const all = body.data || body || [];

    const candidates = all.filter(inv =>
      inv.alert_id !== alertId &&
      inv.alert_category === alertCategory &&
      inv.accuracy_flag && inv.accuracy_flag !== 'pending' &&
      inv.analyst_decision
    );

    if (candidates.length === 0) return null;

    const recent = candidates
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 4);

    const lines = recent.map(inv => {
      const correct = inv.accuracy_flag === 'correct';
      const topTools = (inv.tools_used || '').split('|').filter(Boolean).slice(0, 3).join(', ') || 'none';
      const tactics = inv.kill_chain_tactics
        ? ` [${inv.kill_chain_tactics.split('|').filter(Boolean).join(', ')}]` : '';
      return `• ${inv.alert_id} (${inv.mode}): AI→${inv.verdict} → analyst: ${inv.analyst_decision} ${correct ? '✓ CORRECT' : '✗ INCORRECT'}${tactics}. Key tools: ${topTools}`;
    });

    return {
      text: `📋 PAST CASE INSIGHTS — ${recent.length} similar "${alertCategory}" alert${recent.length !== 1 ? 's' : ''} with analyst validation:\n${lines.join('\n')}\n\nCalibrate your investigation focus and verdict confidence based on these patterns.`,
      count: recent.length,
      category: alertCategory,
    };
  } catch {
    return null;
  }
}

export async function getInvestigationTrace(alertId, timestamp) {
  try {
    const safeTs = timestamp.replace(/[:.]/g, '-');
    const response = await fetch(`${API_BASE}/traces/${alertId}_${safeTs}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Record analyst feedback on an investigation
 * @param {string} alertId - Alert ID
 * @param {string} timestamp - Investigation timestamp
 * @param {string} analystDecision - What analyst confirmed (TP/FP/Escalate)
 * @returns {Promise<Object>} - Feedback recording result
 */
export async function recordAnalystFeedback(alertId, timestamp, analystDecision) {
  try {
    const response = await fetch(`${API_BASE}/investigations/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId, timestamp, analystDecision })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[v1.1] Feedback recorded:', data);
    return data;
  } catch (err) {
    console.error('Failed to record analyst feedback:', err);
    throw err;
  }
}
