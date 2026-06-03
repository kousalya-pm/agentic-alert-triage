/**
 * riskScoreService.js
 * ────────────────────────────────────────────────────────────────────
 * Computes a decaying risk score timeline for a user or asset.
 *
 * Decay model: Exponential (industry standard — Exabeam, Splunk UBA, Elastic)
 *   score(T) = Σ weight(alertᵢ) × 0.5^(days_since_alertᵢ / halfLifeDays)
 *
 * Key rules:
 *  • Open alerts (no decision)      → FULL weight, no decay
 *  • Analyst confirmed FALSE_POSITIVE → weight = 0 immediately
 *  • Analyst confirmed TRUE_POSITIVE  → decay begins from decision timestamp
 *  • Resolved past alerts (CSV verdict) → decay from alert timestamp
 *  • Score is capped at 100
 */

export const SEV_WEIGHTS = { Critical: 30, High: 20, Medium: 10, Low: 5 };

/** Shared decay constant used by all risk score views (full chart + sparkline). */
export const HALF_LIFE = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Build a day-by-day timeline array.
 *
 * @param {Array}  allAlerts  Combined open + past alerts for this entity
 * @param {object} opts
 * @param {number} opts.days      Days to look back (default 90)
 * @param {number} opts.halfLife  Decay half-life in days (default HALF_LIFE)
 * @param {object} opts.decisions Analyst decisions map { alertId → decision }
 *                                from localStorage 'acme-soc-decisions'
 * @returns {Array<{ date: Date, score: number, dayAlerts: Array }>}
 */
export function buildTimeline(allAlerts, { days = 90, halfLife = HALF_LIFE, decisions = {} } = {}) {
  const now = Date.now();

  // Pre-parse — exclude CSV-level False Positives upfront
  const parsed = allAlerts
    .map(a => ({
      ...a,
      ts: new Date(a.timestamp).getTime(),
      weight: SEV_WEIGHTS[a.severity] || 5,
      isFP: a.verdict === 'False Positive',
      isOpen: !a.verdict, // open = no verdict from CSV
    }))
    .filter(a => !isNaN(a.ts) && !a.isFP);

  const points = [];

  for (let i = days; i >= 0; i--) {
    const T = now - i * MS_PER_DAY;

    let score = 0;
    for (const a of parsed) {
      if (a.ts > T) continue;

      if (a.isOpen) {
        // Check analyst decision for this open alert
        const dec = decisions[a.alert_id];

        if (dec?.action === 'false_positive') {
          // Analyst confirmed FP — remove from score entirely
          continue;
        } else if (dec?.action === 'confirm_tp') {
          // Analyst closed as TP — decay begins from decision timestamp
          const closedTs = new Date(dec.timestamp).getTime();
          if (T < closedTs) {
            score += a.weight;           // before close: still full weight
          } else {
            const daysElapsed = (T - closedTs) / MS_PER_DAY;
            score += a.weight * Math.pow(0.5, daysElapsed / halfLife);
          }
        } else {
          // No decision yet (or escalated) — active, full weight
          score += a.weight;
        }
      } else {
        // Resolved past alert — decay from alert timestamp
        const daysElapsed = (T - a.ts) / MS_PER_DAY;
        score += a.weight * Math.pow(0.5, daysElapsed / halfLife);
      }
    }

    // Alert dot markers for this calendar day
    const dayAlerts = allAlerts.filter(a => {
      const ts = new Date(a.timestamp).getTime();
      return ts >= T - MS_PER_DAY / 2 && ts < T + MS_PER_DAY / 2;
    });

    points.push({ date: new Date(T), score: Math.min(100, score), dayAlerts });
  }

  return points;
}

/** Current (rightmost) score from a built timeline */
export function currentScore(timeline) {
  return timeline.length ? timeline[timeline.length - 1].score : 0;
}

/**
 * Score change vs N days ago.
 * Positive = score rose (worse). Negative = score dropped (better).
 */
export function scoreDelta(timeline, compareDays = 7) {
  if (timeline.length <= compareDays) return null;
  const cur = timeline[timeline.length - 1].score;
  const ref = timeline[Math.max(0, timeline.length - 1 - compareDays)].score;
  return cur - ref;
}
