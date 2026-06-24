import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Clock, ExternalLink } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

function timeSince(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const VERDICT_BADGE = {
  TRUE_POSITIVE:    'bg-red-500/10 text-red-400 border-red-500/20',
  FALSE_POSITIVE:   'bg-green-500/10 text-green-400 border-green-500/20',
  NEEDS_ESCALATION: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  INCONCLUSIVE:     'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const VERDICT_SHORT = {
  TRUE_POSITIVE: 'TP', FALSE_POSITIVE: 'FP',
  NEEDS_ESCALATION: 'ESCALATE', INCONCLUSIVE: '?',
};

const ACC_COLOR = {
  correct:   'text-green-400',
  incorrect: 'text-red-400',
};

export default function SimilarCasesPanel({ alert }) {
  const [cases, setCases] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!alert?.category) { setLoaded(true); return; }

    fetch(`${API_BASE}/investigations`)
      .then(r => r.json())
      .then(data => {
        const all = data.data || [];
        const similar = all
          .filter(row =>
            row.alert_category === alert.category &&
            row.alert_id !== alert.alert_id &&
            row.analyst_decision  // only decided cases are useful
          )
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 3);
        setCases(similar);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [alert?.alert_id, alert?.category]);

  if (!loaded || cases.length === 0) return null;

  return (
    <div className="mx-5 mb-2 border border-[#1e2d4a] rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0f1629] border-b border-[#1e2d4a]">
        <GitBranch size={13} className="text-[#7a9cc0]" />
        <span className="text-xs font-semibold text-white">Similar Past Cases</span>
        <span className="text-[10px] text-[#8b949e] ml-1">— {alert.category} — how were they resolved?</span>
        <span className="ml-auto text-[10px] text-[#00d4ff] bg-[#00d4ff]/10 border border-[#00d4ff]/20 px-1.5 py-0.5 rounded-full">
          {cases.length} found
        </span>
      </div>
      <div className="divide-y divide-[#1e2d4a]">
        {cases.map((c, i) => (
          <button
            key={i}
            onClick={() => navigate(`/alerts/${c.alert_id}`)}
            className="w-full flex items-center gap-3 px-4 py-2.5 bg-[#0a0f1e] text-xs hover:bg-[#0f172a] transition-colors text-left group"
          >
            <span className="font-mono text-[#00d4ff] shrink-0 w-32 truncate group-hover:underline">{c.alert_id}</span>
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium shrink-0 ${VERDICT_BADGE[c.verdict] || VERDICT_BADGE.INCONCLUSIVE}`}>
              {VERDICT_SHORT[c.verdict] || c.verdict || '—'}
            </span>
            <span className="text-[#8b949e] shrink-0">→</span>
            <span className="text-white font-medium shrink-0">{c.analyst_decision || '—'}</span>
            {c.accuracy_flag && ACC_COLOR[c.accuracy_flag] && (
              <span className={`text-[10px] shrink-0 ${ACC_COLOR[c.accuracy_flag]}`}>
                ({c.accuracy_flag})
              </span>
            )}
            <span className="ml-auto text-[#7a9cc0] shrink-0 flex items-center gap-1">
              <Clock size={10} />
              {timeSince(c.timestamp)}
              <ExternalLink size={9} className="opacity-0 group-hover:opacity-60 transition-opacity" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
