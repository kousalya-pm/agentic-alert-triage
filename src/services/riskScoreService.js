/**
 * riskScoreService.js
 * ────────────────────────────────────────────────────────────────────
 * Computes a decaying risk score timeline for a user or asset.
 *
 * Decay model: Exponential (industry standard — Exabeam, Splunk UBA, Elastic)
 *   score(T) = Σ weight(alertᵢ) × 0.5^(days_since_alertᵢ / halfLifeDays)
 *
 * Key rules:
 *  • Open alerts (no verdict) → FULL weight, no decay while unresolved
 *  • Resolved True Positives  → exponential decay from alert timestamp
 *  • False Positives          → weight = 0 (excluded from score)
 *  • Score is capped at 100
 *
 * Half-life presets (3-way toggle in UI):
 *  fast   7d  — Aggressive: only very recent threats matter
 *  medium 14d — Standard: 2-week memory (default)
 *  slow   30d — Relaxed: month-long memory
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
 * @param {number} opts.days      Number of days to look back (default 90)
 * @param {number} opts.halfLife  Exponential decay half-life in days (default 14)
 * @returns {Array<{ date: Date, score: number, dayAlerts: Array }>}
 */
export function buildTimeline(allAlerts, { days = 90, halfLife = 14 } = {}) {
  const now = Date.now();

  // Pre-parse and categorise alerts
  const parsed = allAlerts
    .map(a => ({
      ...a,
      ts: new Date(a.timestamp).getTime(),
      weight: SEV_WEIGHTS[a.severity] || 5,
      isFP: a.verdict === 'False Positive',
      isOpen: !a.verdict, // open = no verdict yet
    }))
    .filter(a => !isNaN(a.ts) && !a.isFP);

  const points = [];

  for (let i = days; i >= 0; i--) {
    const T = now - i * MS_PER_DAY;

    // Score at time T
    let score = 0;
    for (const a of parsed) {
      if (a.ts > T) continue; // alert hasn't occurred yet at time T

      if (a.isOpen) {
        // Unresolved — stays at full weight (active threat)
        score += a.weight;
      } else {
        // Resolved — decay exponentially from alert timestamp
        const daysElapsed = (T - a.ts) / MS_PER_DAY;
        score += a.weight * Math.pow(0.5, daysElapsed / halfLife);
      }
    }

    // Alerts that fired on this calendar day (for dot markers)
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
