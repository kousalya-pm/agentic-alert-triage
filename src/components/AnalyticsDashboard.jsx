import { useState, useEffect } from 'react';
import {
  BarChart2, Target, Clock, CheckCircle, TrendingUp, RefreshCw,
  AlertTriangle, Shield, Zap, GitMerge, Users, Activity, LineChart,
  Wrench, DollarSign, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const API_BASE = 'http://localhost:3001/api';

// ─── KPI card ─────────────────────────────────────────────────────────────────

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

// ─── Horizontal bar chart (custom div — already works fine) ───────────────────

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

// ─── Recharts donut ───────────────────────────────────────────────────────────

const DONUT_TOOLTIP_STYLE = {
  backgroundColor: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e6edf3',
};

function DonutChart({ segments, centerLabel, centerSub }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;

  const CustomLabel = ({ cx, cy }) => (
    <>
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#e6edf3" fontSize={22} fontWeight="bold">
        {centerLabel ?? total}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#8b949e" fontSize={11}>
        {centerSub ?? 'total'}
      </text>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              cx="50%"
              cy="50%"
              innerRadius="52%"
              outerRadius="72%"
              dataKey="value"
              strokeWidth={0}
              labelLine={false}
              label={<CustomLabel />}
            >
              {segments.map((seg, i) => (
                <Cell key={i} fill={seg.color} />
              ))}
            </Pie>
            <ReTooltip
              contentStyle={DONUT_TOOLTIP_STYLE}
              formatter={(val, name) => [`${val} (${Math.round((val / total) * 100)}%)`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[#8b949e]">{seg.label}</span>
            <span className="text-white font-medium ml-auto">{seg.value}</span>
            <span className="text-[#7a9cc0]">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recharts accuracy area chart ─────────────────────────────────────────────

const AREA_TOOLTIP_STYLE = {
  backgroundColor: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e6edf3',
};

function AccuracyTrendChart({ data }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-[#8b949e]">
        Need at least 2 verified investigations for a trend line
      </div>
    );
  }

  const trending = data[data.length - 1].cumulative_accuracy >= data[0].cumulative_accuracy;
  const lineColor = trending ? '#4ade80' : '#f87171';

  const chartData = data.map((d, i) => ({
    name: d.date || `#${i + 1}`,
    accuracy: Math.round(d.cumulative_accuracy * 100),
  }));

  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis dataKey="name" tick={{ fill: '#4b5563', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
            tick={{ fill: '#4b5563', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <ReTooltip
            contentStyle={AREA_TOOLTIP_STYLE}
            formatter={val => [`${val}%`, 'Cumulative accuracy']}
          />
          <Area
            type="monotone"
            dataKey="accuracy"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#accGrad)"
            dot={{ r: 4, fill: '#fff', stroke: lineColor, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: lineColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Recharts cost area chart ──────────────────────────────────────────────────

function CostTrendChart({ data }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-[#8b949e]">
        Need at least 2 traced investigations for a cost trend
      </div>
    );
  }

  const lineColor = '#00d4ff';
  const fmt = v => v < 0.001 ? `$${(v * 1000).toFixed(2)}m` : `$${v.toFixed(4)}`;

  const chartData = data.map((d, i) => ({
    name: d.date || `#${i + 1}`,
    cost: d.cost_usd,
  }));

  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.2} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis dataKey="name" tick={{ fill: '#4b5563', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={fmt}
            tick={{ fill: '#4b5563', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <ReTooltip
            contentStyle={AREA_TOOLTIP_STYLE}
            formatter={val => [fmt(val), 'Cost']}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#costGrad)"
            dot={{ r: 4, fill: '#fff', stroke: lineColor, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: lineColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Mode performance row ─────────────────────────────────────────────────────

const MODE_META = {
  standard: { icon: Zap,      label: 'Standard', color: 'text-[#00d4ff]' },
  adaptive: { icon: Activity, label: 'Adaptive', color: 'text-purple-400' },
  parallel: { icon: Users,    label: 'Parallel', color: 'text-green-400'  },
  chain:    { icon: GitMerge, label: 'Chain',    color: 'text-orange-400' },
};

function ModeRow({ mode, stats }) {
  const meta = MODE_META[mode] || { label: mode, color: 'text-white' };
  const Icon = meta.icon;
  const { accuracy, avg_time_sec, total_runs, verified_runs } = stats;
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
      <span className="text-sm text-white w-20 shrink-0">{meta.label}</span>
      <div className="flex-1 flex items-center gap-6 text-xs">
        <div className="flex flex-col">
          <span className={`font-bold text-sm ${accColor}`}>{accPct != null ? `${accPct}%` : '—'}</span>
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
      {accPct != null && (
        <div className="w-16 h-1.5 bg-[#21262d] rounded-full overflow-hidden shrink-0">
          <div
            className={`h-full rounded-full ${accPct >= 80 ? 'bg-green-400' : accPct >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${accPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Tool colour chips ────────────────────────────────────────────────────────

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

// ─── Investigations table ─────────────────────────────────────────────────────

const VERDICT_COLOR = {
  TP: 'text-red-400', FP: 'text-green-400',
  NEEDS_ESCALATION: 'text-yellow-400', UNKNOWN: 'text-[#8b949e]',
};
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
                ) : <span className="text-[#7a9cc0] italic">—</span>}
              </td>
              <td className="py-2 pr-4 text-[#8b949e]">{row.investigation_time_sec ? `${row.investigation_time_sec}s` : '—'}</td>
              <td className="py-2 text-[#7a9cc0]">{timeSince(row.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-[#21262d] text-white border border-[#30363d]'
          : 'text-[#8b949e] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [insights, setInsights] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [tab, setTab] = useState('performance');
  const [showAllTools, setShowAllTools] = useState(false);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [insRes, histRes] = await Promise.all([
        fetch(`${API_BASE}/insights`),
        fetch(`${API_BASE}/investigations`),
      ]);
      if (insRes.ok) {
        const d = await insRes.json();
        setInsights(d.data || d);
      }
      if (histRes.ok) {
        const d = await histRes.json();
        setHistory((d.data || []).slice().reverse());
      }
    } catch {
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

  // ── Derived ───────────────────────────────────────────────────────────────────

  const overallAccPct = insights.overall_accuracy != null ? Math.round(insights.overall_accuracy * 100) : null;
  const topTool = insights.top_tools?.[0]?.tool ?? '—';
  const allTimes = history.filter(r => r.investigation_time_sec).map(r => Number(r.investigation_time_sec));
  const avgTime = allTimes.length ? Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length) : null;

  const allToolBars = Object.entries(insights.tool_effectiveness || {})
    .map(([tool, acc]) => ({ label: tool, value: acc, display: `${Math.round(acc * 100)}%` }))
    .sort((a, b) => b.value - a.value);
  const toolBars = showAllTools ? allToolBars : allToolBars.slice(0, 5);
  const toolColor = v => v >= 0.8 ? 'bg-green-500' : v >= 0.6 ? 'bg-yellow-500' : 'bg-red-500';

  const verdictCounts = history.reduce((acc, row) => {
    const v = row.verdict || 'UNKNOWN'; acc[v] = (acc[v] || 0) + 1; return acc;
  }, {});
  const verdictSegments = [
    { label: 'True Positive',   value: verdictCounts['TP']               || 0, color: '#f87171' },
    { label: 'False Positive',  value: verdictCounts['FP']               || 0, color: '#4ade80' },
    { label: 'Escalate',        value: verdictCounts['NEEDS_ESCALATION'] || 0, color: '#fbbf24' },
    { label: 'Unknown',         value: verdictCounts['UNKNOWN']          || 0, color: '#4b5563' },
  ].filter(s => s.value > 0);

  const accCounts = history.reduce((acc, row) => {
    const f = row.accuracy_flag || 'pending'; acc[f] = (acc[f] || 0) + 1; return acc;
  }, {});
  const accSegments = [
    { label: 'Correct',   value: accCounts['correct']  || 0, color: '#4ade80' },
    { label: 'Incorrect', value: accCounts['incorrect'] || 0, color: '#f87171' },
    { label: 'Pending',   value: accCounts['pending'] || (history.length - (accCounts['correct'] || 0) - (accCounts['incorrect'] || 0)), color: '#6b7280' },
  ].filter(s => s.value > 0);

  const hasCost = insights.token_totals?.traced_investigations > 0;
  const tt = insights.token_totals || {};
  const avgCost = tt.traced_investigations > 0 ? (tt.total_cost_usd / tt.traced_investigations) : 0;
  const costBars = Object.entries(insights.cost_by_mode || {}).map(([mode, s]) => ({
    label: MODE_META[mode]?.label ?? mode,
    value: s.avg_cost_usd,
    display: `$${s.avg_cost_usd.toFixed(5)} · ${s.count} run${s.count !== 1 ? 's' : ''}`,
  }));

  const hasModelRouting = insights.accuracy_by_model && Object.keys(insights.accuracy_by_model).length > 0;
  const MODEL_META_MAP = {
    'claude-opus-4-8':           { label: 'Opus 4.8',   tier: 'Complex',    color: 'text-purple-400', badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
    'claude-sonnet-4-6':         { label: 'Sonnet 4.6', tier: 'Standard',   color: 'text-[#00d4ff]',  badge: 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/30' },
    'claude-haiku-4-5-20251001': { label: 'Haiku 4.5',  tier: 'Fast/Cheap', color: 'text-green-400',  badge: 'bg-green-500/15 text-green-400 border-green-500/30' },
  };
  const ROUTING_RULES = [
    { condition: 'Critical severity',                                            model: 'Opus 4.8',         color: 'text-red-400'      },
    { condition: 'High severity',                                                model: 'Sonnet 4.6',       color: 'text-yellow-400'   },
    { condition: 'Medium / Low severity',                                        model: 'Haiku 4.5',        color: 'text-green-400'    },
    { condition: 'Lateral Movement / Ransomware / Insider Threat / Exfiltration',model: 'Opus 4.8 (override)',color: 'text-red-400'   },
    { condition: 'Playbook generation (any severity)',                           model: 'Sonnet+ min',      color: 'text-[#00d4ff]'   },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#0d1117] p-6 space-y-5">

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
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard icon={Shield}      iconColor="bg-[#00d4ff]/10 text-[#00d4ff]"
          label="Total Investigations" value={insights.total_investigations ?? 0}
          sub={`${insights.verified_investigations ?? 0} with analyst feedback`} />
        <KpiCard icon={Target}
          iconColor={overallAccPct >= 80 ? 'bg-green-500/10 text-green-400' : overallAccPct >= 60 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}
          label="Overall AI Accuracy" value={overallAccPct != null ? `${overallAccPct}%` : '—'}
          sub="based on analyst decisions" />
        <KpiCard icon={CheckCircle} iconColor="bg-purple-500/10 text-purple-400"
          label="Top Tool" value={topTool}
          sub={insights.top_tools?.[0] ? `${Math.round(insights.top_tools[0].accuracy * 100)}% accuracy` : ''} />
        <KpiCard icon={Clock}       iconColor="bg-orange-500/10 text-orange-400"
          label="Avg Investigation Time" value={avgTime != null ? `${avgTime}s` : '—'}
          sub={`across ${history.length} run${history.length !== 1 ? 's' : ''}`} />
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-[#21262d] pb-1">
        <TabBtn active={tab === 'performance'} onClick={() => setTab('performance')}>Performance</TabBtn>
        <TabBtn active={tab === 'tools'}       onClick={() => setTab('tools')}>Tools</TabBtn>
        {hasCost && <TabBtn active={tab === 'cost'} onClick={() => setTab('cost')}>Cost</TabBtn>}
        <TabBtn active={tab === 'history'}     onClick={() => setTab('history')}>History</TabBtn>
      </div>

      {/* ══ PERFORMANCE TAB ══════════════════════════════════════════════════════ */}
      {tab === 'performance' && (
        <div className="space-y-5">

          {/* Mode perf + Verdict mix */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Activity size={14} className="text-[#00d4ff]" /> Mode Performance
              </h2>
              {Object.entries(insights.mode_performance || {}).map(([mode, stats]) => (
                <ModeRow key={mode} mode={mode} stats={stats} />
              ))}
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Target size={14} className="text-[#00d4ff]" /> AI Verdict Mix
              </h2>
              {verdictSegments.length > 0
                ? <DonutChart segments={verdictSegments} centerLabel={history.length} centerSub="runs" />
                : <div className="text-[#8b949e] text-xs py-4 text-center">No data yet</div>}
            </div>
          </div>

          {/* Accuracy over time + Feedback status */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <LineChart size={14} className="text-[#00d4ff]" /> Accuracy Over Time
                <span className="text-xs text-[#8b949e] font-normal ml-auto">cumulative</span>
              </h2>
              <AccuracyTrendChart data={insights.accuracy_trend} />
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <CheckCircle size={14} className="text-[#00d4ff]" /> Feedback Status
              </h2>
              {accSegments.length > 0
                ? <DonutChart segments={accSegments} centerLabel={`${overallAccPct ?? 0}%`} centerSub="accuracy" />
                : <div className="text-[#8b949e] text-xs py-4 text-center">No feedback yet</div>}
            </div>
          </div>

          {/* Category accuracy */}
          {insights.category_performance && Object.keys(insights.category_performance).length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-[#00d4ff]" /> Accuracy by Alert Category
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
                              pct == null ? 'bg-[#30363d]' : pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
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
        </div>
      )}

      {/* ══ TOOLS TAB ════════════════════════════════════════════════════════════ */}
      {tab === 'tools' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">

            {/* Tool effectiveness */}
            <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-[#00d4ff]" /> Tool Effectiveness
                <span className="text-xs text-[#8b949e] font-normal ml-auto">accuracy in correct investigations</span>
              </h2>
              {allToolBars.length > 0 ? (
                <>
                  <HBarChart data={toolBars} colorFn={toolColor} />
                  {allToolBars.length > 5 && (
                    <button
                      onClick={() => setShowAllTools(v => !v)}
                      className="mt-3 flex items-center gap-1 text-xs text-[#7a9cc0] hover:text-white transition-colors"
                    >
                      {showAllTools ? <><ChevronUp size={12} /> Show top 5</> : <><ChevronDown size={12} /> Show all {allToolBars.length} tools</>}
                    </button>
                  )}
                </>
              ) : (
                <div className="text-[#8b949e] text-xs py-4 text-center">No tool data yet</div>
              )}
            </div>

            {/* Tools by category */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Wrench size={14} className="text-[#00d4ff]" /> By Category
              </h2>
              {insights.tools_by_category && Object.keys(insights.tools_by_category).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(insights.tools_by_category).map(([cat, tools]) => (
                    <div key={cat}>
                      <div className="text-[10px] text-[#7a9cc0] font-medium mb-1.5">{cat}</div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(tools).map(([tool, count]) => (
                          <span key={tool} className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${TOOL_COLOR[tool] || TOOL_DEFAULT}`}>
                            {tool}{count > 1 && <span className="opacity-60"> ×{count}</span>}
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
        </div>
      )}

      {/* ══ COST TAB ═════════════════════════════════════════════════════════════ */}
      {tab === 'cost' && hasCost && (
        <div className="space-y-5">

          {/* Cost KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard icon={DollarSign} iconColor="bg-cyan-500/10 text-cyan-400"
              label="Total AI Cost" value={`$${tt.total_cost_usd.toFixed(4)}`}
              sub={`${tt.traced_investigations} traced run${tt.traced_investigations !== 1 ? 's' : ''}`} />
            <KpiCard icon={Zap} iconColor="bg-green-500/10 text-green-400"
              label="Cache Hit Rate" value={`${tt.overall_cache_hit_pct}%`}
              sub="prompt cache reuse" />
            <KpiCard icon={BarChart2} iconColor="bg-purple-500/10 text-purple-400"
              label="Avg Cost / Run" value={`$${avgCost.toFixed(5)}`}
              sub="per investigation" />
            <KpiCard icon={TrendingUp} iconColor="bg-yellow-500/10 text-yellow-400"
              label="Cache Savings" value={`$${tt.total_savings_usd.toFixed(5)}`}
              sub="vs no-cache pricing" />
          </div>

          {/* Cost by mode + Cost over time */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <DollarSign size={14} className="text-[#00d4ff]" /> Avg Cost by Mode
              </h2>
              {costBars.length > 0
                ? <HBarChart data={costBars} colorFn={() => 'bg-cyan-500'} />
                : <div className="text-[#8b949e] text-xs py-4 text-center">No cost data yet</div>}
            </div>

            <div className="col-span-2 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <LineChart size={14} className="text-[#00d4ff]" /> Cost Over Time
                <span className="text-xs text-[#8b949e] font-normal ml-auto">per traced investigation</span>
              </h2>
              <CostTrendChart data={insights.cost_over_time} />
            </div>
          </div>

          {/* Model routing */}
          {hasModelRouting && (() => {
            const rows = Object.entries(insights.accuracy_by_model).map(([model, stats]) => ({
              model, meta: MODEL_META_MAP[model] || { label: model, tier: 'Unknown', color: 'text-[#8b949e]', badge: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' }, ...stats,
            }));
            const totalRuns = rows.reduce((s, r) => s + r.total_runs, 0);
            const opusAvgCost = rows.find(r => r.model === 'claude-opus-4-8')?.avg_cost_usd || 0.005;
            const actualTotal = rows.reduce((s, r) => s + r.total_cost_usd, 0);
            const allOpusTotal = totalRuns * opusAvgCost;
            const savings = allOpusTotal - actualTotal;
            const savingsPct = allOpusTotal > 0 ? Math.round((savings / allOpusTotal) * 100) : 0;
            return (
              <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <GitMerge size={14} className="text-purple-400" /> Model Routing Performance
                  <span className="text-xs text-[#8b949e] font-normal ml-auto">{totalRuns} routed runs</span>
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">Cost vs Accuracy by Tier</p>
                    <div className="space-y-2">
                      {rows.map(r => (
                        <div key={r.model} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-semibold ${r.meta.color}`}>{r.meta.label}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${r.meta.badge}`}>{r.meta.tier}</span>
                            </div>
                            <span className="text-[10px] text-[#8b949e]">{r.total_runs} run{r.total_runs !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-[10px] text-[#8b949e]">Accuracy</p>
                              <p className={`text-sm font-bold ${r.accuracy !== null ? (r.accuracy >= 0.8 ? 'text-green-400' : r.accuracy >= 0.6 ? 'text-yellow-400' : 'text-red-400') : 'text-[#4b5563]'}`}>
                                {r.accuracy !== null ? `${Math.round(r.accuracy * 100)}%` : 'N/A'}
                              </p>
                              <p className="text-[9px] text-[#4b5563]">{r.verified_runs} verified</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#8b949e]">Avg Cost</p>
                              <p className="text-sm font-bold text-white">${(r.avg_cost_usd * 100).toFixed(3)}¢</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#8b949e]">Total Spend</p>
                              <p className="text-sm font-bold text-white">${r.total_cost_usd.toFixed(4)}</p>
                            </div>
                          </div>
                          <div className="mt-2 h-1 bg-[#21262d] rounded-full overflow-hidden">
                            <div className="h-full rounded-full"
                              style={{
                                width: `${Math.round((r.total_runs / totalRuns) * 100)}%`,
                                backgroundColor: r.meta.color.includes('purple') ? '#a78bfa' : r.meta.color.includes('green') ? '#4ade80' : '#00d4ff',
                              }} />
                          </div>
                          <p className="text-[9px] text-[#4b5563] mt-0.5">{Math.round((r.total_runs / totalRuns) * 100)}% of all runs</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">Routing Policy</p>
                    <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3 space-y-2">
                      {ROUTING_RULES.map((rule, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className="text-[#4b5563] mt-0.5">→</span>
                          <div className="flex-1">
                            <span className="text-[#8b949e]">{rule.condition}</span>
                            <span className="mx-1.5 text-[#4b5563]">·</span>
                            <span className={`font-medium ${rule.color}`}>{rule.model}</span>
                          </div>
                        </div>
                      ))}
                      <p className="text-[9px] text-[#4b5563] pt-2 border-t border-[#21262d]">
                        Category overrides take precedence. Playbook uses Sonnet minimum regardless of alert tier.
                      </p>
                    </div>
                    {savings > 0 && (
                      <div className="mt-3 bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                        <p className="text-[10px] text-[#8b949e] mb-1">vs All-Opus Baseline</p>
                        <p className="text-lg font-bold text-green-400">{savingsPct}% cost saved</p>
                        <p className="text-[10px] text-[#8b949e]">${savings.toFixed(4)} saved across {totalRuns} runs</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ HISTORY TAB ══════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield size={14} className="text-[#00d4ff]" /> Investigation History
            <span className="text-xs text-[#8b949e] font-normal ml-auto">{history.length} total</span>
          </h2>
          <InvestigationsTable rows={history.slice(0, 30)} />
        </div>
      )}

      <div className="text-[10px] text-[#7a9cc0] text-right pb-2">
        Last refreshed: {lastRefresh.toLocaleTimeString()}
      </div>
    </div>
  );
}
