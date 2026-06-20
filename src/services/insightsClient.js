/**
 * Client-side service for investigation insights
 * Fetches analytics insights from backend API
 */

const API_BASE = 'http://localhost:3001/api';

/**
 * Get investigation insights
 * @returns {Promise<Object>} - Insights data or empty object if unavailable
 */
export async function getInsights() {
  try {
    const response = await fetch(`${API_BASE}/insights`);

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No insights yet
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || null;
  } catch (err) {
    console.warn('Failed to retrieve insights:', err);
    return null;
  }
}

/**
 * Format insights for use in agent prompts
 */
export function formatInsightsForPrompt(insights) {
  if (!insights) return '';

  const lines = ['HISTORICAL LEARNING FROM PAST INVESTIGATIONS:'];

  // Overall accuracy
  if (insights.overall_accuracy !== null) {
    lines.push(`- Overall agent accuracy: ${Math.round(insights.overall_accuracy * 100)}%`);
  }

  // Total investigations
  if (insights.total_investigations > 0) {
    lines.push(`- Based on ${insights.total_investigations} past investigations`);
  }

  // Top tools
  if (insights.top_tools && insights.top_tools.length > 0) {
    const topToolsList = insights.top_tools
      .slice(0, 3)
      .map(t => `${t.tool} (${Math.round(t.accuracy * 100)}%)`)
      .join(', ');
    lines.push(`- Most effective tools: ${topToolsList}`);
  }

  // Mode performance
  if (insights.mode_performance) {
    const modes_with_data = Object.entries(insights.mode_performance)
      .filter(([, perf]) => perf.accuracy !== null && perf.total_runs > 0)
      .map(([mode, perf]) => `${mode} (${Math.round(perf.accuracy * 100)}% in ${perf.avg_time_sec}s)`)
      .join(', ');
    if (modes_with_data) {
      lines.push(`- Workflow performance: ${modes_with_data}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get similar cases for an alert
 */
export function getSimilarCases(insights, alertId) {
  if (!insights || !insights.similar_cases) return [];
  return insights.similar_cases[alertId] || [];
}

/**
 * Format similar cases for prompt
 */
export function formatSimilarCasesForPrompt(similarCases) {
  if (!similarCases || similarCases.length === 0) return '';

  const lines = ['SIMILAR PAST CASES:'];
  similarCases.forEach((case_, i) => {
    lines.push(
      `${i + 1}. Alert ${case_.alert_id}: ${case_.verdict} (${Math.round(case_.similarity * 100)}% similar)`
    );
  });

  return lines.join('\n');
}
