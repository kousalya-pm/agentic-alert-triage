import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

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
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
const SEV_DOT = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Medium: 'bg-yellow-500',
  Low: 'bg-blue-400',
};
const CAT_ICON = {
  'Email': '📧',
  'Network': '🌐',
  'Identity': '🔐',
  'DLP': '📁',
  'Endpoint': '💻',
  'Cloud': '☁️',
};

export default function AlertQueue({ alerts, loading, selectedAlert, onSelectAlert, onEntityClick }) {
  const [search, setSearch] = useState('');
  const [filterSev, setFilterSev] = useState('All');
  const decisions = useDecisions();

  const filtered = alerts.filter(a => {
    const matchSev = filterSev === 'All' || a.severity === filterSev;
    const matchSearch = !search ||
      a.title?.toLowerCase().includes(search.toLowerCase()) ||
      a.category?.toLowerCase().includes(search.toLowerCase()) ||
      a.user_id?.toLowerCase().includes(search.toLowerCase());
    return matchSev && matchSearch;
  });

  return (
    <div className="w-80 shrink-0 flex flex-col border-r border-[#1e2d4a] bg-[#0a0f1e]">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-[#1e2d4a]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-[#7a9cc0] uppercase tracking-wider">Alert Queue</h2>
          <span className="text-xs text-[#7a9cc0]">{filtered.length} alerts</span>
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
                    : SEV_COLOR[s] + ' border'
                  : 'bg-transparent border-[#1e2d4a] text-[#7a9cc0] hover:border-[#2a3f63]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-[#7a9cc0] text-xs">Loading alerts...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#7a9cc0] text-xs">No alerts match filter</div>
        ) : (
          filtered.map(alert => (
            <AlertRow
              key={alert.alert_id}
              alert={alert}
              isSelected={selectedAlert?.alert_id === alert.alert_id}
              decision={decisions[alert.alert_id] || null}
              onClick={() => onSelectAlert(alert)}
              onEntityClick={onEntityClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

const DECISION_BADGE = {
  confirm_tp: { label: 'TP Confirmed', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  mark_fp:    { label: 'False Positive', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  escalate:   { label: 'Escalated', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
};

function AlertRow({ alert, isSelected, decision, onClick, onEntityClick }) {
  const ts = alert.timestamp ? new Date(alert.timestamp) : null;
  const timeStr = ts
    ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-[#1e2d4a] hover:bg-[#0f1629] transition-colors group ${
        isSelected ? 'bg-[#0f1629] border-l-2 border-l-[#00d4ff]' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[alert.severity] || 'bg-gray-500'} ${alert.severity === 'Critical' ? 'pulse-dot' : ''}`} />
          <span className="text-[10px] text-[#7a9cc0] shrink-0">{CAT_ICON[alert.category] || '🔔'} {alert.category}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV_COLOR[alert.severity] || ''}`}>
            {alert.severity}
          </span>
        </div>
      </div>

      <p className="text-xs font-medium text-[#e2eaf5] leading-snug mb-1 line-clamp-2">{alert.title}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-[#7a9cc0]">
          {alert.user_id && (
            <button
              onClick={e => { e.stopPropagation(); onEntityClick?.('user', alert.user_id); }}
              className="hover:text-[#00d4ff] transition-colors"
            >👤 {alert.user_id}</button>
          )}
          {alert.hostname && (
            <button
              onClick={e => { e.stopPropagation(); onEntityClick?.('asset', alert.hostname); }}
              className="hover:text-[#00d4ff] transition-colors"
            >💻 {alert.hostname}</button>
          )}
        </div>
        <span className="text-[10px] text-[#7a9cc0]">{timeStr}</span>
      </div>

      <div className="flex items-center justify-between mt-1">
        {alert.alert_id && (
          <span className="text-[10px] text-[#7a9cc0]">{alert.alert_id}</span>
        )}
        {decision && DECISION_BADGE[decision.action] && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${DECISION_BADGE[decision.action].cls}`}>
            {DECISION_BADGE[decision.action].label}
          </span>
        )}
      </div>
    </button>
  );
}
