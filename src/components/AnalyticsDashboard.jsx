import { useState, useEffect } from 'react';
import { BarChart2, Target, Clock, CheckCircle, TrendingUp, RefreshCw, AlertTriangle, Shield, Zap, GitMerge, Users, Activity, LineChart, Wrench } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

// ─── Shared chart components (mirrors Dashboard.jsx style) ────────────────────

function KpiCard({ icon: Icon, iconColor, label, value, sub }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col gap-2">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColor}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs text-[#8b949e]">{label}</div>
      </div>
      {sub && <div className="text-[10px] text-[#7a9cc0]">{sub}</div>}
    </div>
  );
}

function HBarChart({ data, colorFn }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-3">
      {data.map(({ label, value, display }) => (
        <div key={label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[#8b949e] font-mono">{label}</span>
            <span className="text-white font-medium">{display ?? value}</span>
          </div>
          <div className="h-2 bg-[#0d1117] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${colorFn(value)}`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments, centerLabel, centerSub, size = 120 }) {
  const r = 42, cx = 60, cy = 60, circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 120 120" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#21262d" strokeWidth="16" />
        {segments.map((seg, i) => {
          const dash = (seg.value / total) * circumference;
          const gap = circumference - dash;
          const el = (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px', transition: 'stroke-dasharray 0.7s ease' }}
            />
          );
          offset += dash;
          return el;
        })}
        <text x="60" y="55" textAnchor="middle" fill="#e6edf3" fontSize="16" fontWeight="bold">{centerLabel ?? total}</text>
        <text x="60" y="68" textAnchor="middle" fill="#8b949e" fontSize="7">{centerSub ?? 'total'}</text>
      </svg>
      <div className="space-y-2">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[#8b949e]">{seg.label}</span>
            <span className="text-white font-medium ml-auto pl-4">{seg.value}</span>
            <span className="text-[#7a9cc0]">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mode performance row ─────────────────────────────────────────────────────

const MODE_META = {
  standard: { icon: Zap, label: 'Standard', color: 'text-[#00d4ff]' },
  adaptive:  { icon: Activity, label: 'Adaptive', color: 'text-purple-400' },
  parallel:  { icon: Users, label: 'Parallel', color: 'text-green-400' },
  chain:     { icon: GitMerge, label: 'Chain', color: 'text-orange-400' },
};

function ModeRow({ mode, stats }) {
  const meta = MODE_META[mode] || { label: mode, color: 'text-white' };
  const Icon = meta.icon;
  const { accuracy, avg_time_sec, total_runs, verified_runs } = stats;
  const hasData = total_runs > 0;
  const accPct = accuracy != null ? Math.round(accuracy * 100) : null;
  const accColor = accPct == null ? 'text-[#8b949e]'
    : accPct >= 80 ? 'text-green-400'
    : accPct >= 60 ? 'text-yellow-400'
    : 'text-red-400';

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#21262d] last:border-0">
      <div className={`w-6 h-6 rounded flex items-center justify-center bg-[#21262d] ${meta.color}`}>
        {Icon && <Icon size={12} />}
      </div>
      <span className="text-sm text-white w-20">{meta.label}</span>
      <div className="flex-1 flex items-center gap-6 text-xs">
        <div className="flex flex-col">
          <span className={`font-bold text-sm ${accColor}`}>
            {accPct != null ? `${accPct}%` : '—'}
          </span>
          <span className="text-[#8b949e]">accuracy</span>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-bold text-sm">{total_runs}</span>
          <span className="text-[#8b949e]">runs</span>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-bold text-sm">{verified_runs}</span>
          <span className="text-[#8b949e]">verified</span>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-bold text-sm">
            {avg_time_sec != null ? `${Math.round(avg_time_sec)}s` : '—'}
          </span>
          <span className="text-[#8b949e]">avg time</span>
        </div>
      </div>
      {!hasData && <span className="text-[10px] text-[#7a9cc0] italic">no data</span>}
      {hasData && accPct != null && (
        <div className="w-16 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${accPct >= 80 ? 'bg-green-400' : accPct >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${accPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Accuracy trend SVG line chart ───────────────────────────────────────────

function AccuracyTrendChart({ data }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-[#8b949e]">
        Need at least 2 verified investigations for a trend line
      </div>
    );
  }

  const W = 100, H = 72;
  const padL = 26, padR = 10, padT = 6, padB = 14;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = data.length;
  const xPt = i => padL + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yPt = v => padT + (1 - v) * chartH;

  const pts = data.map((d, i) => ({ x: xPt(i), y: yPt(d.cumulative_accuracy), ...d }));
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPath = [
    `M ${pts[0].x} ${yPt(0)}`,
    `L ${pts[0].x} ${pts[0].y}`,
    ...pts.slice(1).map(p => `L ${p.x} ${p.y}`),
    `L ${pts[n - 1].x} ${yPt(0)}`, 'Z',
  ].join(' ');

  const trending = pts[n - 1].cumulative_accuracy >= pts[0].cumulative_accuracy;
  const lineColor = trending ? '#4ade80' : '#f87171';
  const last = pts[n - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
      {[0, 0.5, 1].map(v => (
        <line key={v} x1={padL} y1={yPt(v)} x2={W - padR} y2={yPt(v)}
          stroke="#21262d" strokeWidth="0.5" strokeDasharray={v === 0.5 ? '2 2' : undefined} />
      ))}
      {[0, 0.5, 1].map(v => (
        <text key={v} x={padL - 2} y={yPt(v) + 3} textAnchor="end" fill="#4b5563" fontSize="5">
          {Math.round(v * 100)}%
        </text>
      ))}
      <path d={areaPath} fill={lineColor} opacity="0.1" />
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill={lineColor} />)}
      <text x={Math.min(last.x + 2, W - padR - 2)} y={last.y - 3}
        fill={lineColor} fontSize="5" fontWeight="bold" textAnchor={last.x > W * 0.8 ? 'end' : 'start'}>
        {Math.round(last.cumulative_accuracy * 100)}%
      </text>
    </svg>
  );
}

// ─── Tools by category display ────────────────────────────────────────────────

const TOOL_COLOR = {
  user_lookup:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  asset_lookup:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
  siem_query:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  watchlist_check: 'bg-red-500/10 text-red-400 border-red-500/20',
  ip_geo:          'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  whois:           'bg-teal-500/10 text-teal-400 border-teal-500/20',
  abuseipdb:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
  virustotal_ip:   'bg-pink-500/10 text-pink-400 border-pink-500/20',
  virustotal_url:  'bg-pink-500/10 text-pink-400 border-pink-500/20',
  urlscan:         'bg-green-500/10 text-green-400 border-green-500/20',
};
const TOOL_DEFAULT = 'bg-[#21262d] text-[#8b949e] border-[#30363d]';

// ─── Recent investigations table ──────────────────────────────────────────────

const VERDICT_COLOR = { TP: 'text-red-400', FP: 'text-green-400', NEEDS_ESCALATION: 'text-yellow-400', UNKNOWN: 'text-[#8b949e]' };
const ACC_BADGE = {
  correct:   'bg-green-500/10 text-green-400 border-green-500/20',
  incorrect: 'bg-red-500/10 text-red-400 border-red-500/20',
  '':        'bg-[#21262d] text-[#8b949e] border-[#30363d]',
};

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

function InvestigationsTable({ rows }) {
  if (!rows.length) {
    return <div className="text-center py-8 text-[#8b949e] text-sm">No investigations recorded yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#21262d] text-[#8b949e]">
            <th className="text-left py-2 pr-4 font-medium">Alert</th>
            <th className="text-left py-2 pr-4 font-medium">Mode</th>
            <th className="text-left py-2 pr-4 font-medium">AI Verdict</th>
            <th className="text-left py-2 pr-4 font-medium">Analyst</th>
            <th className="text-left py-2 pr-4 font-medium">Result</th>
            <th className="text-left py-2 pr-4 font-medium">Time</th>
            <th className="text-left py-2 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#21262d]/50 hover:bg-[#161b22]/50">
              <td className="py-2 pr-4 font-mono text-[#00d4ff]">{row.alert_id || '—'}</td>
              <td className="py-2 pr-4 capitalize text-[#8b949e]">{row.mode || '—'}</td>
              <td className={`py-2 pr-4 font-medium ${VERDICT_COLOR[row.verdict] || 'text-white'}`}>
                {row.verdict === 'NEEDS_ESCALATION' ? 'ESCALATE' : (row.verdict || '—')}
              </td>
              <td className="py-2 pr-4 text-white">{row.analyst_decision || <span className="text-[#7a9cc0] italic">pending</span>}</td>
              <td className="py-2 pr-4">
                {row.accuracy_flag ? (
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ACC_BADGE[row.accuracy_flag] || ACC_BADGE['']}`}>
                    {row.accuracy_flag}
                  </span>
                ) : (
                  <span className="text-[#7a9cc0] italic">—</span>
                )}
              </td>
              <td className="py-2 pr-4 text-[#8b949e]">
                {row.investigation_time_sec ? `${row.investigation_time_sec}s` : '—'}
              </td>
              <td className="py-2 text-[#7a9cc0]">{timeSince(row.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [insights, setInsights] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [insRes, histRes] = await Promise.all([
        fetch(`${API_BASE}/insights`),
        fetch(`${API_BASE}/investigations`),
      ]);

      if (insRes.ok) {
        const insData = await insRes.json();
        setInsights(insData.data || insData);
      } else {
        setInsights(null);
      }

      if (histRes.ok) {
        const histData = await histRes.json();
        // Most recent first
        setHistory((histData.data || []).slice().reverse());
      }
    } catch (err) {
      setError('Could not reach the backend. Make sure the proxy server is running on port 3001.');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#8b949e] text-sm gap-2">
        <BarChart2 size={16} className="animate-pulse" /> Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
        <AlertTriangle size={24} className="text-yellow-400" />
        <p className="text-[#8b949e]">{error}</p>
        <button onClick={fetchAll} className="px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-md text-xs text-white hover:border-[#00d4ff]/40 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
        <BarChart2 size={32} className="text-[#30363d]" />
        <p className="text-white font-medium">No analytics yet</p>
        <p className="text-[#8b949e] text-xs max-w-xs text-center">
          Run a few investigations and mark them as TP / FP / Escalate to start generating insights.
        </p>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────────

  const overallAccPct = insights.overall_accuracy != null
    ? Math.round(insights.overall_accuracy * 100)
    : null;

  const topTool = insights.top_tools?.[0]?.tool ?? '—';

  const allTimes = history.filter(r => r.investigation_time_sec).map(r => Number(r.investigation_time_sec));
  const avgTime = allTimes.length ? Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length) : null;

  // Tool effectiveness bars
  const toolBars = Object.entries(insights.tool_effectiveness || {})
    .map(([tool, acc]) => ({ label: tool, value: acc, display: `${Math.round(acc * 100)}%` }))
    .sort((a, b) => b.value - a.value);

  const toolColor = (val) => {
    if (val >= 0.8) return 'bg-green-500';
    if (val >= 0.6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Verdict distribution from history
  const verdictCounts = history.reduce((acc, row) => {
    const v = row.verdict || 'UNKNOWN';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  const verdictSegments = [
    { label: 'TP', value: verdictCounts['TP'] || 0, color: '#f87171' },
    { label: 'FP', value: verdictCounts['FP'] || 0, color: '#4ade80' },
    { label: 'Escalate', value: verdictCounts['NEEDS_ESCALATION'] || 0, color: '#fbbf24' },
    { label: 'Unknown', value: verdictCounts['UNKNOWN'] || 0, color: '#4b5563' },
  ].filter(s => s.value > 0);

  // Accuracy flag distribution
  const accCounts = history.reduce((acc, row) => {
    const f = row.accuracy_flag || 'pending';
    acc[f] = (acc[f] || 0) + 1;
    return acc;
  }, {});
  const accSegments = [
    { label: 'Correct', value: accCounts['correct'] || 0, color: '#4ade80' },
    { label: 'Incorrect', value: accCounts['incorrect'] || 0, color: '#f87171' },
    { label: 'Pending', value: accCounts['pending'] || (history.length - (accCounts['correct'] || 0) - (accCounts['incorrect'] || 0)), color: '#6b7280' },
  ].filter(s => s.value > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0d1117] p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart2 size={18} className="text-[#00d4ff]" />
            Agent Insights
          </h1>
          <p className="text-xs text-[#8b949e] mt-0.5">AI triage performance from investigation history</p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7a9cc0] hover:text-white border border-[#30363d] hover:border-[#00d4ff]/40 rounded-md transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          icon={Shield}
          iconColor="bg-[#00d4ff]/10 text-[#00d4ff]"
          label="Total Investigations"
          value={insights.total_investigations ?? 0}
          sub={`${insights.verified_investigations ?? 0} with analyst feedback`}
        />
        <KpiCard
          icon={Target}
          iconColor={overallAccPct >= 80 ? 'bg-green-500/10 text-green-400' : overallAccPct >= 60 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}
          label="Overall AI Accuracy"
          value={overallAccPct != null ? `${overallAccPct}%` : '—'}
          sub="based on analyst decisions"
        />
        <KpiCard
          icon={CheckCircle}
          iconColor="bg-purple-500/10 text-purple-400"
          label="Top Tool"
          value={topTool}
          sub={insights.top_tools?.[0] ? `${Math.round(insights.top_tools[0].accuracy * 100)}% accuracy` : ''}
        />
        <KpiCard
          icon={Clock}
          iconColor="bg-orange-500/10 text-orange-400"
          label="Avg Investigation Time"
          value={avgTime != null ? `${avgTime}s` : '—'}
          sub={`across ${history.length} run${history.length !== 1 ? 's' : ''}`}
        />
      </div>

      {/* ── Row 2: Tool effectiveness + Verdict donut ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-[#00d4ff]" />
            Tool Effectiveness
            <span className="text-xs text-[#8b949e] font-normal ml-auto">accuracy when used in a correct investigation</span>
          </h2>
          {toolBars.length > 0 ? (
            <HBarChart data={toolBars} colorFn={toolColor} />
          ) : (
            <div className="text-[#8b949e] text-xs py-4 text-center">No tool data yet</div>
          )}
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Target size={14} className="text-[#00d4ff]" />
            AI Verdict Mix
          </h2>
          {verdictSegments.length > 0 ? (
            <DonutChart
              segments={verdictSegments}
              centerLabel={history.length}
              centerSub="runs"
              size={110}
            />
          ) : (
            <div className="text-[#8b949e] text-xs py-4 text-center">No data yet</div>
          )}
        </div>
      </div>

      {/* ── Row 3: Mode performance + Accuracy distribution ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Activity size={14} className="text-[#00d4ff]" />
            Mode Performance
          </h2>
          {Object.entries(insights.mode_performance || {}).map(([mode, stats]) => (
            <ModeRow key={mode} mode={mode} stats={stats} />
          ))}
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle size={14} className="text-[#00d4ff]" />
            Feedback Status
          </h2>
          {accSegments.length > 0 ? (
            <DonutChart
              segments={accSegments}
              centerLabel={`${overallAccPct ?? 0}%`}
              centerSub="accuracy"
              size={110}
            />
          ) : (
            <div className="text-[#8b949e] text-xs py-4 text-center">No feedback yet</div>
          )}
        </div>
      </div>

      {/* ── Row 4: Category performance ── */}
      {insights.category_performance && Object.keys(insights.category_performance).length > 0 && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-[#00d4ff]" />
            Accuracy by Alert Category
            <span className="text-xs text-[#8b949e] font-normal ml-auto">% correct per category</span>
          </h2>
          <div className="space-y-3">
            {Object.entries(insights.category_performance)
              .sort((a, b) => (b[1].verified_runs || 0) - (a[1].verified_runs || 0))
              .map(([cat, stats]) => {
                const pct = stats.accuracy != null ? Math.round(stats.accuracy * 100) : null;
                return (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#8b949e]">{cat}</span>
                      <span className="text-white font-medium flex items-center gap-2">
                        <span className="text-[#7a9cc0]">{stats.total_runs} run{stats.total_runs !== 1 ? 's' : ''}</span>
                        <span>{pct != null ? `${pct}%` : 'no feedback'}</span>
                      </span>
                    </div>
                    <div className="h-2 bg-[#0d1117] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          pct == null ? 'bg-[#30363d]' :
                          pct >= 80 ? 'bg-green-500' :
                          pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: pct != null ? `${pct}%` : '100%', opacity: pct != null ? 1 : 0.2 }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Row 5: Accuracy trend + Tools by category ── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Accuracy over time */}
        <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <LineChart size={14} className="text-[#00d4ff]" />
            Accuracy Over Time
            <span className="text-xs text-[#8b949e] font-normal ml-auto">cumulative — does it improve?</span>
          </h2>
          {insights.accuracy_trend && insights.accuracy_trend.length >= 2 ? (
            <>
              <AccuracyTrendChart data={insights.accuracy_trend} />
              <div className="flex items-center justify-between text-[10px] text-[#8b949e] mt-1">
                <span>Investigation #1 · {insights.accuracy_trend[0]?.date}</span>
                <span>Latest · {insights.accuracy_trend[insights.accuracy_trend.length - 1]?.date}</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-20 text-xs text-[#8b949e]">
              Need at least 2 verified investigations for a trend line
            </div>
          )}
        </div>

        {/* Tools by category */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Wrench size={14} className="text-[#00d4ff]" />
            Tools by Category
          </h2>
          {insights.tools_by_category && Object.keys(insights.tools_by_category).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(insights.tools_by_category).map(([cat, tools]) => (
                <div key={cat}>
                  <div className="text-[10px] text-[#7a9cc0] font-medium mb-1.5">{cat}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(tools).map(([tool, count]) => (
                      <span key={tool}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${TOOL_COLOR[tool] || TOOL_DEFAULT}`}>
                        {tool} {count > 1 && <span className="opacity-60">×{count}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#8b949e] text-center py-4">No category data yet</div>
          )}
        </div>
      </div>

      {/* ── Row 6: Recent investigations table ── */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Shield size={14} className="text-[#00d4ff]" />
          Investigation History
          <span className="text-xs text-[#8b949e] font-normal ml-auto">{history.length} total</span>
        </h2>
        <InvestigationsTable rows={history.slice(0, 20)} />
      </div>

      <div className="text-[10px] text-[#7a9cc0] text-right pb-2">
        Last refreshed: {lastRefresh.toLocaleTimeString()}
      </div>
    </div>
  );
}
