import { useState, useEffect } from 'react';
import { Shield, CheckCircle, XCircle, Clock, Loader, ChevronDown, ChevronRight, Zap, AlertTriangle } from 'lucide-react';
import { generatePlaybook } from '../services/aiService.js';

const API_BASE = 'http://localhost:3001/api';

const PRIORITY_META = {
  IMMEDIATE:  { label: 'Immediate',   color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  SHORT_TERM: { label: 'Short Term',  color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  MONITOR:    { label: 'Monitor',     color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
};

const SYSTEM_ICON = {
  firewall: '🔒',
  identity: '👤',
  endpoint: '🖥️',
  siem:     '📊',
  ticketing:'🎫',
};

function ActionCard({ action, onApprove, onReject, status, executing }) {
  const priority = PRIORITY_META[action.priority] || PRIORITY_META.MONITOR;
  const icon = SYSTEM_ICON[action.target_system_icon] || '⚙️';

  return (
    <div className={`border rounded-xl p-4 transition-all duration-300 ${
      status === 'approved' ? 'border-green-500/40 bg-green-500/5' :
      status === 'rejected' ? 'border-[#30363d] bg-[#0d1117] opacity-50' :
      'border-[#30363d] bg-[#161b22]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        {/* Left: action info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{icon}</span>
            <span className="text-sm font-semibold text-white">{action.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priority.color}`}>
              {priority.label}
            </span>
            {action.reversible && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[#21262d] text-[#8b949e] border-[#30363d]">
                Reversible
              </span>
            )}
          </div>
          <p className="text-xs text-[#8b949e] mb-1.5">{action.description}</p>
          <div className="flex items-center gap-1.5 text-[10px] text-[#4b5563]">
            <span className="font-mono bg-[#0d1117] px-1.5 py-0.5 rounded border border-[#21262d]">
              {action.target_system}
            </span>
            {action.reversible && action.reversal_note && (
              <span className="text-[#4b5563] italic">↩ {action.reversal_note}</span>
            )}
          </div>
        </div>

        {/* Right: action buttons or status */}
        <div className="shrink-0 flex items-center gap-2">
          {status === 'approved' && (
            <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <CheckCircle size={14} />
              Executed
            </div>
          )}
          {status === 'rejected' && (
            <div className="flex items-center gap-1.5 text-xs text-[#8b949e]">
              <XCircle size={14} />
              Rejected
            </div>
          )}
          {status === 'pending' && (
            <>
              <button
                onClick={onReject}
                disabled={executing}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#8b949e] border border-[#30363d] rounded-lg hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                <XCircle size={11} /> Reject
              </button>
              <button
                onClick={onApprove}
                disabled={executing}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-green-600/20 border border-green-500/40 rounded-lg hover:bg-green-600/30 transition-colors disabled:opacity-40"
              >
                {executing ? <Loader size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                {executing ? 'Executing…' : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const playbookCacheKey = (alertId) => `playbook-cache-${alertId}`;

export default function PlaybookPanel({ alert, summary, settings }) {
  const [actions, setActions] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [executing, setExecuting] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const verdict = summary?.verdict;
  const shouldGenerate = verdict === 'TRUE_POSITIVE' || verdict === 'NEEDS_ESCALATION';

  // Persist statuses (approve/reject decisions) whenever they change
  useEffect(() => {
    if (!alert?.alert_id || actions.length === 0) return;
    const cached = localStorage.getItem(playbookCacheKey(alert.alert_id));
    if (!cached) return;
    try {
      const data = JSON.parse(cached);
      localStorage.setItem(playbookCacheKey(alert.alert_id), JSON.stringify({ ...data, statuses }));
    } catch {}
  }, [statuses]);

  useEffect(() => {
    if (!shouldGenerate || !settings) { setLoading(false); return; }

    // Return cached playbook if available
    try {
      const cached = localStorage.getItem(playbookCacheKey(alert.alert_id));
      if (cached) {
        const { actions: cachedActions, statuses: cachedStatuses } = JSON.parse(cached);
        if (Array.isArray(cachedActions) && cachedActions.length > 0) {
          setActions(cachedActions);
          setStatuses(cachedStatuses || Object.fromEntries(cachedActions.map(a => [a.action_id, 'pending'])));
          setLoading(false);
          return;
        }
      }
    } catch {}

    generatePlaybook(alert, summary, settings)
      .then(parsed => {
        const list = Array.isArray(parsed) ? parsed : [];
        const initialStatuses = Object.fromEntries(list.map(a => [a.action_id, 'pending']));
        setActions(list);
        setStatuses(initialStatuses);
        localStorage.setItem(playbookCacheKey(alert.alert_id), JSON.stringify({ actions: list, statuses: initialStatuses }));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleApprove = async (action) => {
    setExecuting(prev => ({ ...prev, [action.action_id]: true }));
    try {
      await fetch(`${API_BASE}/playbook/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.action_id, alertId: alert.alert_id, title: action.title }),
      });
      setStatuses(prev => ({ ...prev, [action.action_id]: 'approved' }));
    } catch {
      setStatuses(prev => ({ ...prev, [action.action_id]: 'approved' })); // still mark done (mock)
    } finally {
      setExecuting(prev => ({ ...prev, [action.action_id]: false }));
    }
  };

  const handleReject = (action) => {
    setStatuses(prev => ({ ...prev, [action.action_id]: 'rejected' }));
  };

  if (!shouldGenerate) return null;

  const approvedCount = Object.values(statuses).filter(s => s === 'approved').length;
  const pendingCount = Object.values(statuses).filter(s => s === 'pending').length;

  return (
    <div className="border border-orange-500/30 bg-[#1a110a] rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-orange-500/5 transition-colors"
      >
        <Shield size={14} className="text-orange-400 shrink-0" />
        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm font-semibold text-orange-300">Remediation Playbook</span>
          {loading && <Loader size={12} className="animate-spin text-orange-400" />}
          {!loading && actions.length > 0 && (
            <>
              <span className="text-xs text-[#8b949e]">
                {actions.length} proposed action{actions.length !== 1 ? 's' : ''}
              </span>
              {approvedCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400 border border-green-500/30 rounded">
                  {approvedCount} executed
                </span>
              )}
              {pendingCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 rounded">
                  {pendingCount} pending
                </span>
              )}
            </>
          )}
        </div>
        <div className="text-[#8b949e]">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-[#8b949e] py-2">
              <Loader size={12} className="animate-spin" />
              Generating remediation playbook…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 py-2">
              <AlertTriangle size={12} />
              Failed to generate playbook: {error}
            </div>
          )}

          {!loading && !error && actions.length === 0 && (
            <div className="text-xs text-[#8b949e] py-2">No actions generated.</div>
          )}

          {actions.map(action => (
            <ActionCard
              key={action.action_id}
              action={action}
              status={statuses[action.action_id] || 'pending'}
              executing={!!executing[action.action_id]}
              onApprove={() => handleApprove(action)}
              onReject={() => handleReject(action)}
            />
          ))}

          {actions.length > 0 && (
            <p className="text-[10px] text-[#4b5563] pt-1 border-t border-[#21262d]">
              ⚠️ Actions are simulated — connect real integrations (Zscaler API, Okta, CrowdStrike) in production
            </p>
          )}
        </div>
      )}
    </div>
  );
}
