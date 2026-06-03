/**
 * KillChainStrip.jsx
 * ─────────────────────────────────────────────────────────────────────
 * Two exports:
 *
 *   default  KillChainStrip   — full 14-stage grid (UserPage / AssetPage)
 *   named    CompactKillChain — active-stages-only pills (alert queue incident cards)
 */

import { getKillChainCoverage, KILL_CHAIN_STAGES } from '../services/incidentService.js';

// Severity → Tailwind classes for a stage box / pill
const SEV_STAGE = {
  Critical: 'bg-red-500/20 border-red-500/40 text-red-400',
  High:     'bg-orange-500/20 border-orange-500/40 text-orange-400',
  Medium:   'bg-yellow-500/20 border-yellow-500/40 text-yellow-400',
  Low:      'bg-blue-500/20 border-blue-500/40 text-blue-400',
};

// ── Compact variant ────────────────────────────────────────────────────────
// Renders only the stages that have alerts, as small colored pills with → arrows.
// Used inside IncidentCard in the alert queue.

export function CompactKillChain({ alerts }) {
  const coverage = getKillChainCoverage(alerts);
  const active   = KILL_CHAIN_STAGES.filter(s => coverage.has(s.id));

  if (active.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-0.5 mt-1.5">
      {active.flatMap((stage, i) => {
        const entry = coverage.get(stage.id);
        const pill  = (
          <span
            key={stage.id}
            title={`${stage.id}${entry.alerts.length > 1 ? ` (${entry.alerts.length} alerts)` : ''}`}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-default ${SEV_STAGE[entry.severity]}`}
          >
            {stage.abbr}{entry.alerts.length > 1 ? `×${entry.alerts.length}` : ''}
          </span>
        );
        if (i === 0) return [pill];
        return [
          <span key={`arr-${i}`} className="text-[#2a3f63] text-[9px]">→</span>,
          pill,
        ];
      })}
      <span className="text-[9px] text-[#3a5070] ml-1">kill chain</span>
    </div>
  );
}

// ── Full variant ───────────────────────────────────────────────────────────
// Shows all 14 MITRE stages in a grid. Active stages are highlighted with
// severity color and alert count; inactive stages are dimmed.

export default function KillChainStrip({ alerts = [], pastAlerts = [] }) {
  // Exclude FPs from history — they shouldn't count toward progression
  const combined  = [
    ...alerts,
    ...pastAlerts.filter(a => a.verdict !== 'False Positive'),
  ];
  const coverage  = getKillChainCoverage(combined);
  const stageCount = KILL_CHAIN_STAGES.length;

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-xl p-5">
      <h3 className="text-[10px] font-semibold text-[#7a9cc0] uppercase tracking-wider mb-3">
        MITRE ATT&amp;CK Kill Chain
      </h3>

      {coverage.size === 0 ? (
        <p className="text-xs text-[#4a6080]">No MITRE-mapped alerts in history.</p>
      ) : (
        <>
          {/* Stage boxes */}
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${stageCount}, minmax(0, 1fr))` }}
          >
            {KILL_CHAIN_STAGES.map(stage => {
              const entry    = coverage.get(stage.id);
              const isActive = !!entry;
              return (
                <div
                  key={stage.id}
                  title={isActive ? `${stage.id}: ${entry.alerts.length} alert${entry.alerts.length !== 1 ? 's' : ''}` : stage.id}
                  className={`flex flex-col items-center justify-center py-2 px-0.5 rounded border text-center transition-all ${
                    isActive
                      ? SEV_STAGE[entry.severity]
                      : 'bg-[#0a0f1e] border-[#1e2d4a]/40 opacity-30'
                  }`}
                >
                  {isActive && (
                    <span className="text-[11px] font-bold leading-none mb-0.5">
                      {entry.alerts.length}
                    </span>
                  )}
                  <span className="text-[9px] font-mono font-bold leading-none">
                    {stage.abbr}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Stage labels */}
          <div
            className="grid gap-0.5 mt-1"
            style={{ gridTemplateColumns: `repeat(${stageCount}, minmax(0, 1fr))` }}
          >
            {KILL_CHAIN_STAGES.map(stage => (
              <div key={stage.id} className="text-center overflow-hidden px-0.5">
                <span className="text-[7.5px] text-[#3a5070] leading-tight block truncate">
                  {stage.label}
                </span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 text-[9px] text-[#3a5070]">
            <span>Number = alerts at that stage</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              {Object.keys(SEV_STAGE).map(s => (
                <span key={s} className={`px-1 py-0.5 rounded border text-[8px] ${SEV_STAGE[s]}`}>
                  {s[0]}
                </span>
              ))}
              <span>= severity</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
