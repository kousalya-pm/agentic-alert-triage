import { useState, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { groupAlerts, groupSeverity, deriveIncidentTitle, buildIncidentAlert } from '../services/incidentService.js';
import { CompactKillChain } from './KillChainStrip.jsx';

function useDecisions() {
  const [decisions, setDecisions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('acme-soc-decisions') || '{}'); } catch { return {}; }
  });
  useEffect(() => {
    const refresh = () => {
      try { setDecisions(JSON.parse(localStorage.getItem('acme-soc-decisions') || '{}')); } catch {}
    };
    window.addEventListener('soc-decisions-updated', refresh);
    return () => window.removeEventListener('soc-decisions-updated', refresh);
  }, []);
  return decisions;
}

const SEV_COLOR = {
  Critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  High:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Low:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
const SEV_DOT = {
  Critical: 'bg-red-500',
  High:     'bg-orange-500',
  Medium:   'bg-yellow-500',
  Low:      'bg-blue-400',
};
const CAT_ICON = {
  'Email': '📧', 'Network': '🌐', 'Identity': '🔐',
  'DLP': '📁', 'Endpoint': '💻', 'Cloud': '☁️',
};

// ─── Main queue ────────────────────────────────────────────────────────────

export default function AlertQueue({ alerts, loading, selectedAlert, onSelectAlert, onEntityClick }) {
  const [search,    setSearch]    = useState('');
  const [filterSev, setFilterSev] = useState('All');
  const decisions = useDecisions();

  const filtered = alerts.filter(a => {
    const matchSev    = filterSev === 'All' || a.severity === filterSev;
    const matchSearch = !search ||
      a.title?.toLowerCase().includes(search.toLowerCase()) ||
      a.category?.toLowerCase().includes(search.toLowerCase()) ||
      a.user_id?.toLowerCase().includes(search.toLowerCase()) ||
      a.hostname?.toLowerCase().includes(search.toLowerCase());
    return matchSev && matchSearch;
  });

  const groups = groupAlerts(filtered);
  const incidentCount = groups.filter(g => g.alerts.length > 1).length;
  const countLabel = incidentCount > 0
    ? `${incidentCount} incident${incidentCount !== 1 ? 's' : ''} · ${filtered.length} alerts`
    : `${filtered.length} alerts`;

  return (
    <div className="w-80 shrink-0 flex flex-col border-r border-[#1e2d4a] bg-[#0a0f1e]">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-[#1e2d4a]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-[#7a9cc0] uppercase tracking-wider">Alert Queue</h2>
          <span className="text-[10px] text-[#7a9cc0]">{countLabel}</span>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#2a3f63]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search alerts..."
            className="w-full bg-[#0f1629] border border-[#1e2d4a] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#e2eaf5] placeholder-[#2a3f63] focus:outline-none focus:border-[#00d4ff]/60"
          />
        </div>

        {/* Severity filter */}
        <div className="flex gap-1 flex-wrap">
          {['All', 'Critical', 'High', 'Medium', 'Low'].map(s => (
            <button
              key={s}
              onClick={() => setFilterSev(s)}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                filterSev === s
                  ? s === 'All'
                    ? 'bg-[#00d4ff]/10 border-[#00d4ff]/30 text-[#00d4ff]'
                    : SEV_COLOR[s]
                  : 'bg-transparent border-[#1e2d4a] text-[#7a9cc0] hover:border-[#2a3f63]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-[#7a9cc0] text-xs">Loading alerts...</div>
        ) : groups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#7a9cc0] text-xs">No alerts match filter</div>
        ) : (
          groups.map(group =>
            group.alerts.length > 1 ? (
              <IncidentCard
                key={group.key}
                group={group}
                selectedAlert={selectedAlert}
                decisions={decisions}
                onSelectAlert={onSelectAlert}
                onEntityClick={onEntityClick}
              />
            ) : (
              <AlertRow
                key={group.alerts[0].alert_id}
                alert={group.alerts[0]}
                isSelected={selectedAlert?.alert_id === group.alerts[0].alert_id}
                decision={decisions[group.alerts[0].alert_id] || null}
                onClick={() => onSelectAlert(group.alerts[0])}
                onEntityClick={onEntityClick}
              />
            )
          )
        )}
      </div>
    </div>
  );
}

// Severity accent colours for incident cards
const INC_BORDER = {
  Critical: 'border-red-500/40',
  High:     'border-orange-500/40',
  Medium:   'border-yellow-500/40',
  Low:      'border-blue-500/40',
};
const INC_ACCENT = {
  Critical: 'bg-red-500/60',
  High:     'bg-orange-500/60',
  Medium:   'bg-yellow-500/60',
  Low:      'bg-blue-500/60',
};

// ─── Incident card ─────────────────────────────────────────────────────────

function IncidentCard({ group, selectedAlert, decisions, onSelectAlert, onEntityClick }) {
  // Selected if a constituent alert is active, OR if the incident itself was loaded
  const isIncidentActive = selectedAlert?._groupKey === group.key;
  const hasSelected      = isIncidentActive ||
    group.alerts.some(a => a.alert_id === selectedAlert?.alert_id);

  const [expanded, setExpanded] = useState(hasSelected);

  // Auto-expand whenever any alert in this incident becomes active
  useEffect(() => {
    if (hasSelected) setExpanded(true);
  }, [hasSelected]);

  const topSev = groupSeverity(group);
  const title  = deriveIncidentTitle(group);

  // Clicking the card (not the chevron) selects the incident — same as clicking an alert row
  const handleCardClick = () => {
    onSelectAlert(buildIncidentAlert(group));
    setExpanded(true);
  };

  return (
    <div className={`mx-1.5 my-1.5 rounded-xl border overflow-hidden bg-[#0c1628] ${INC_BORDER[topSev]} ${hasSelected ? 'ring-1 ring-[#00d4ff]/30' : ''}`}>

      {/* Severity accent line */}
      <div className={`h-0.5 w-full ${INC_ACCENT[topSev]}`} />

      {/* Incident header — clicking loads it into the central panel */}
      <div
        role="button"
        onClick={handleCardClick}
        className={`w-full text-left px-3 pt-2.5 pb-2 transition-colors cursor-pointer ${
          isIncidentActive ? 'bg-[#0f1e38]' : 'hover:bg-[#0d1a2e]'
        }`}
      >
        {/* Top row */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9px] font-bold text-[#00d4ff] uppercase tracking-wider shrink-0">
              ⬡ Incident
            </span>
            <span className="text-[9px] text-[#3a5070]">·</span>
            <span className="text-[9px] text-[#7a9cc0] shrink-0">{group.alerts.length} alerts</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV_COLOR[topSev]}`}>
              {topSev}
            </span>
            {/* Chevron: toggle expand only, doesn't change selection */}
            <ChevronDown
              size={13}
              onClick={e => { e.stopPropagation(); setExpanded(prev => !prev); }}
              className={`text-[#4a6080] hover:text-[#7a9cc0] transition-transform duration-150 shrink-0 cursor-pointer ${expanded ? 'rotate-180' : ''}`}
            />
          </div>
        </div>

        {/* Title */}
        <p className="text-xs font-semibold text-white leading-snug mb-1.5">{title}</p>

        {/* Entity link */}
        {group.entityId && (
          <button
            className="text-[10px] text-[#7a9cc0] hover:text-[#00d4ff] transition-colors mb-0.5"
            onClick={e => { e.stopPropagation(); onEntityClick?.(group.entityType, group.entityId); }}
          >
            {group.entityType === 'user' ? '👤' : '💻'} {group.entityId}
          </button>
        )}

        <CompactKillChain alerts={group.alerts} />
      </div>

      {/* Expanded constituent alert rows */}
      {expanded && (
        <div className="border-t border-[#1e3060]/60 bg-[#080d1a]">
          {group.alerts.map(alert => (
            <AlertRow
              key={alert.alert_id}
              alert={alert}
              isSelected={selectedAlert?.alert_id === alert.alert_id}
              decision={decisions[alert.alert_id] || null}
              onClick={() => onSelectAlert(alert)}
              onEntityClick={onEntityClick}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Decision badge ────────────────────────────────────────────────────────

const DECISION_BADGE = {
  confirm_tp: { label: 'TP Confirmed', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  mark_fp:    { label: 'False Positive', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  escalate:   { label: 'Escalated', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
};

// ─── Individual alert row ──────────────────────────────────────────────────

function AlertRow({ alert, isSelected, decision, onClick, onEntityClick, nested = false }) {
  const ts      = alert.timestamp ? new Date(alert.timestamp) : null;
  const timeStr = ts ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left border-b border-[#1e2d4a]/60 hover:bg-[#0f1629] transition-colors group border-l-2 ${
        isSelected
          ? 'bg-[#0f1629] border-l-[#00d4ff]'
          : 'border-l-transparent'
      } ${nested ? 'px-4 py-2.5' : 'px-3 py-3'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[alert.severity] || 'bg-gray-500'} ${alert.severity === 'Critical' ? 'pulse-dot' : ''}`} />
          <span className="text-[10px] text-[#7a9cc0] shrink-0">
            {CAT_ICON[alert.category] || '🔔'} {alert.category}
          </span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${SEV_COLOR[alert.severity] || ''}`}>
          {alert.severity}
        </span>
      </div>

      <p className="text-xs font-medium text-[#e2eaf5] leading-snug mb-1 line-clamp-2">{alert.title}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-[#7a9cc0]">
          {alert.user_id && (
            <div
              onClick={e => { e.stopPropagation(); onEntityClick?.('user', alert.user_id); }}
              className="hover:text-[#00d4ff] transition-colors cursor-pointer"
            >👤 {alert.user_id}</div>
          )}
          {alert.hostname && (
            <div
              onClick={e => { e.stopPropagation(); onEntityClick?.('asset', alert.hostname); }}
              className="hover:text-[#00d4ff] transition-colors cursor-pointer"
            >💻 {alert.hostname}</div>
          )}
        </div>
        <span className="text-[10px] text-[#7a9cc0]">{timeStr}</span>
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-[#7a9cc0]">{alert.alert_id}</span>
        {decision && DECISION_BADGE[decision.action] && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${DECISION_BADGE[decision.action].cls}`}>
            {DECISION_BADGE[decision.action].label}
          </span>
        )}
      </div>
    </button>
  );
}
