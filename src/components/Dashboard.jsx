import { useState, useEffect } from 'react';
import { Activity, TrendingDown, TrendingUp, Clock, Shield, AlertTriangle, CheckCircle, XCircle, HelpCircle, ArrowUpRight, Target, RefreshCw } from 'lucide-react';
import { loadCSV } from '../services/csvService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msToHrs(ms) { return ms / 3_600_000; }
function fmtHrs(h) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// Deterministic simulated MTTD — consistent across renders
function simulateMTTD(alertId, severity) {
  const hash = [...(alertId || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const ranges = { Critical: [0.5, 4], High: [4, 18], Medium: [12, 48], Low: [24, 96] };
  const [min, max] = ranges[severity] || [4, 24];
  return min + ((hash % 97) / 97) * (max - min);
}

function loadDecisions() {
  try { return Object.values(JSON.parse(localStorage.getItem('mcg-soc-decisions') || '{}')); }
  catch { return []; }
}

// ─── Metric card ─────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconColor, label, value, sub, trend, trendGood }) {
  const TIcon = trend === 'up' ? TrendingUp : TrendingDown;
  const trendColor = (trend === 'up') === trendGood ? 'text-green-400' : 'text-red-400';
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColor}`}>
          <Icon size={16} />
        </div>
        {trend && <TIcon size={14} className={trendColor} />}
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs text-[#8b949e]">{label}</div>
      </div>
      {sub && <div className="text-[10px] text-[#484f58]">{sub}</div>}
    </div>
  );
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
function HBarChart({ data, colorFn }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map(({ label, value, pct }) => (
        <div key={label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[#8b949e]">{label}</span>
            <span className="text-white font-medium">{value}</span>
          </div>
          <div className="h-2 bg-[#0d1117] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${colorFn(label)}`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SVG Donut chart ──────────────────────────────────────────────────────────
function DonutChart({ segments, size = 120 }) {
  const r = 42, cx = 60, cy = 60, circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 120 120">
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
        <text x="60" y="57" textAnchor="middle" fill="#e6edf3" fontSize="16" fontWeight="bold">{total}</text>
        <text x="60" y="70" textAnchor="middle" fill="#8b949e" fontSize="8">alerts</text>
      </svg>
      <div className="space-y-1.5">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[#8b949e]">{seg.label}</span>
            <span className="text-white font-medium ml-auto">{seg.value}</span>
            <span className="text-[#484f58]">({Math.round(seg.value / total * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard({ alerts }) {
  const [pastAlerts, setPastAlerts] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const refresh = () => {
    setDecisions(loadDecisions());
    setLastRefresh(new Date());
    window.dispatchEvent(new Event('soc-decisions-updated'));
  };

  useEffect(() => {
    loadCSV('past_alerts.csv').then(data => {
      setPastAlerts(data);
      setDecisions(loadDecisions());
      setLoading(false);
    });
    const handler = () => setDecisions(loadDecisions());
    window.addEventListener('soc-decisions-updated', handler);
    return () => window.removeEventListener('soc-decisions-updated', handler);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#8b949e] text-sm gap-2">
        <span className="spinner" /> Loading metrics...
      </div>
    );
  }

  // ── Metric calculations ──────────────────────────────────────────────────────

  // MTTR — from past_alerts with closed_at (True Positives only for incident response)
  const closedAlerts = pastAlerts.filter(a => a.closed_at && a.timestamp);
  const tpAlerts = closedAlerts.filter(a => a.verdict === 'True Positive');
  const avgMTTR_ms = tpAlerts.length
    ? tpAlerts.reduce((s, a) => s + (new Date(a.closed_at) - new Date(a.timestamp)), 0) / tpAlerts.length
    : 0;
  const avgMTTR_hrs = msToHrs(avgMTTR_ms);

  // MTTD — simulated but consistent, applied to true positives
  const mttdValues = tpAlerts.map(a => simulateMTTD(a.alert_id, a.severity));
  const avgMTTD_hrs = mttdValues.length
    ? mttdValues.reduce((s, v) => s + v, 0) / mttdValues.length
    : 0;

  // FP Rate — closed alerts
  const fpCount = closedAlerts.filter(a => a.verdict === 'False Positive').length;
  const fpRate = closedAlerts.length ? Math.round((fpCount / closedAlerts.length) * 100) : 0;

  // AI Triage Avg — from localStorage decisions that have elapsed_seconds
  const triaged = decisions.filter(d => d.elapsed_seconds > 0);
  const avgTriageS = triaged.length
    ? Math.round(triaged.reduce((s, d) => s + d.elapsed_seconds, 0) / triaged.length)
    : null;

  // Open queue stats
  const openAlerts = alerts.filter(a => a.status === 'open');
  const critHighCount = openAlerts.filter(a => a.severity === 'Critical' || a.severity === 'High').length;

  // Alerts by category (current queue)
  const catCounts = openAlerts.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1; return acc;
  }, {});
  const catData = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  const catColor = {
    Email: 'bg-blue-500', Network: 'bg-purple-500', Identity: 'bg-orange-500',
    DLP: 'bg-yellow-500', Endpoint: 'bg-red-500', Cloud: 'bg-cyan-500',
  };

  // Severity donut (current open alerts)
  const sevSegments = [
    { label: 'Critical', value: openAlerts.filter(a => a.severity === 'Critical').length, color: '#ef4444' },
    { label: 'High',     value: openAlerts.filter(a => a.severity === 'High').length,     color: '#f97316' },
    { label: 'Medium',   value: openAlerts.filter(a => a.severity === 'Medium').length,   color: '#eab308' },
    { label: 'Low',      value: openAlerts.filter(a => a.severity === 'Low').length,      color: '#3b82f6' },
  ].filter(s => s.value > 0);

  // Verdict donut (historical)
  const verdictSegments = [
    { label: 'True Positive',  value: pastAlerts.filter(a => a.verdict === 'True Positive').length,  color: '#ef4444' },
    { label: 'False Positive', value: pastAlerts.filter(a => a.verdict === 'False Positive').length, color: '#22c55e' },
  ];

  // Analyst decisions summary (this session)
  const decisionCounts = {
    confirm_tp: decisions.filter(d => d.action === 'confirm_tp').length,
    mark_fp:    decisions.filter(d => d.action === 'mark_fp').length,
    escalate:   decisions.filter(d => d.action === 'escalate').length,
  };

  // Top MITRE tactics
  const tacticCounts = openAlerts.reduce((acc, a) => {
    if (a.mitre_tactic) acc[a.mitre_tactic] = (acc[a.mitre_tactic] || 0) + 1; return acc;
  }, {});
  const topTactics = Object.entries(tacticCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // MTTR by category (historical)
  const mttrBycat = {};
  closedAlerts.forEach(a => {
    if (!a.category) return;
    const hrs = msToHrs(new Date(a.closed_at) - new Date(a.timestamp));
    if (!mttrBycat[a.category]) mttrBycat[a.category] = [];
    mttrBycat[a.category].push(hrs);
  });
  const mttrCatData = Object.entries(mttrBycat)
    .map(([label, vals]) => ({ label, value: parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)) }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#30363d] bg-[#161b22] shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">SOC Metrics Dashboard</h2>
          <p className="text-[10px] text-[#484f58]">
            Historical: past_alerts.csv · Current queue: {openAlerts.length} open · Session decisions: {decisions.length}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#484f58]">Refreshed {lastRefresh.toLocaleTimeString()}</span>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#8b949e] border border-[#30363d] hover:border-[#484f58] hover:text-white rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">

        {/* ── Row 1: KPI Cards ── */}
        <div className="grid grid-cols-5 gap-4">
          <KpiCard
            icon={Clock}
            iconColor="bg-blue-500/20 text-blue-400"
            label="Avg MTTD"
            value={fmtHrs(avgMTTD_hrs)}
            sub={`Across ${tpAlerts.length} true positives`}
            trend="down"
            trendGood={true}
          />
          <KpiCard
            icon={Activity}
            iconColor="bg-purple-500/20 text-purple-400"
            label="Avg MTTR"
            value={fmtHrs(avgMTTR_hrs)}
            sub={`From detection to close`}
            trend="down"
            trendGood={true}
          />
          <KpiCard
            icon={Target}
            iconColor="bg-yellow-500/20 text-yellow-400"
            label="FP Rate"
            value={`${fpRate}%`}
            sub={`${fpCount} of ${closedAlerts.length} alerts`}
            trend={fpRate > 50 ? 'up' : 'down'}
            trendGood={false}
          />
          <KpiCard
            icon={Shield}
            iconColor="bg-green-500/20 text-green-400"
            label="AI Triage Avg"
            value={avgTriageS ? `${avgTriageS}s` : '—'}
            sub={triaged.length ? `${triaged.length} alerts triaged this session` : 'Run triage to populate'}
          />
          <KpiCard
            icon={AlertTriangle}
            iconColor="bg-red-500/20 text-red-400"
            label="Open Alerts"
            value={openAlerts.length}
            sub={`${critHighCount} Critical / High priority`}
            trend="up"
            trendGood={false}
          />
        </div>

        {/* ── Row 2: Category bars + Severity donut ── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Open Alerts by Category</h3>
            <HBarChart
              data={catData}
              colorFn={(label) => catColor[label] || 'bg-gray-500'}
            />
          </div>

          <div className="col-span-1 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-4">Severity Distribution</h3>
            <DonutChart segments={sevSegments} />
          </div>

          <div className="col-span-1 bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Historical Verdict Split</h3>
            <p className="text-[10px] text-[#484f58] mb-4">{pastAlerts.length} closed alerts</p>
            <DonutChart segments={verdictSegments} />
          </div>
        </div>

        {/* ── Row 3: MTTR by category + Session decisions ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">MTTR by Category</h3>
            <p className="text-[10px] text-[#484f58] mb-4">Average hours from detection to close (historical)</p>
            <HBarChart
              data={mttrCatData}
              colorFn={(label) => catColor[label] || 'bg-gray-500'}
            />
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Analyst Decisions — This Session</h3>
            <p className="text-[10px] text-[#484f58] mb-4">Actions you've taken via the triage panel</p>

            {decisions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
                <p className="text-xs text-[#484f58]">No decisions recorded yet.</p>
                <p className="text-[10px] text-[#484f58]">Triage an alert and click Confirm TP / Mark FP / Escalate.</p>
              </div>
            ) : (
              <>
                {/* Summary pills */}
                <div className="flex gap-2 mb-4">
                  <div className="flex-1 text-center p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="text-lg font-bold text-red-400">{decisionCounts.confirm_tp}</div>
                    <div className="text-[10px] text-[#8b949e]">TP Confirmed</div>
                  </div>
                  <div className="flex-1 text-center p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <div className="text-lg font-bold text-green-400">{decisionCounts.mark_fp}</div>
                    <div className="text-[10px] text-[#8b949e]">False Positives</div>
                  </div>
                  <div className="flex-1 text-center p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                    <div className="text-lg font-bold text-orange-400">{decisionCounts.escalate}</div>
                    <div className="text-[10px] text-[#8b949e]">Escalated</div>
                  </div>
                </div>

                {/* Decision list */}
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {[...decisions].reverse().map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 bg-[#0d1117] border border-[#30363d] rounded-lg">
                      <span className={`shrink-0 ${
                        d.action === 'confirm_tp' ? 'text-red-400' :
                        d.action === 'mark_fp' ? 'text-green-400' : 'text-orange-400'
                      }`}>
                        {d.action === 'confirm_tp' ? '🔴' : d.action === 'mark_fp' ? '🟢' : '🟠'}
                      </span>
                      <span className="text-[#8b949e] font-mono shrink-0">{d.alert_id}</span>
                      <span className="text-[#484f58]">{d.alert_category}</span>
                      {d.elapsed_seconds > 0 && (
                        <span className="ml-auto text-[10px] text-blue-400 shrink-0">{d.elapsed_seconds}s</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Row 4: MITRE tactics + Benchmark comparison ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Top MITRE ATT&CK Tactics</h3>
            <p className="text-[10px] text-[#484f58] mb-4">Current open alert queue</p>
            <div className="space-y-2">
              {topTactics.map(([tactic, count], i) => (
                <div key={tactic} className="flex items-center gap-3">
                  <span className="text-[10px] text-[#484f58] w-4 text-right">{i + 1}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-xs text-[#8b949e]">{tactic}</span>
                    <div className="flex-1 h-1.5 bg-[#0d1117] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full"
                        style={{ width: `${(count / openAlerts.length) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-white font-medium shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Industry Benchmark</h3>
            <p className="text-[10px] text-[#484f58] mb-4">MCG vs Financial Services sector avg (BFSI 2025)</p>
            <div className="space-y-3">
              {[
                { label: 'MTTD', mcg: fmtHrs(avgMTTD_hrs), industry: '72h', good: avgMTTD_hrs < 72, mcgRaw: avgMTTD_hrs, industryRaw: 72 },
                { label: 'MTTR', mcg: fmtHrs(avgMTTR_hrs), industry: '24h', good: avgMTTR_hrs < 24, mcgRaw: avgMTTR_hrs, industryRaw: 24 },
                { label: 'FP Rate', mcg: `${fpRate}%`, industry: '65%', good: fpRate < 65, mcgRaw: fpRate, industryRaw: 65 },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#8b949e]">{row.label}</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${row.good ? 'text-green-400' : 'text-red-400'}`}>MCG: {row.mcg}</span>
                      <span className="text-[#484f58]">Industry: {row.industry}</span>
                      {row.good
                        ? <CheckCircle size={12} className="text-green-400" />
                        : <XCircle size={12} className="text-red-400" />
                      }
                    </div>
                  </div>
                  <div className="h-2 bg-[#0d1117] rounded-full overflow-hidden relative">
                    {/* Industry benchmark line */}
                    <div className="absolute top-0 bottom-0 w-px bg-[#484f58]" style={{ left: '60%' }} />
                    <div
                      className={`h-full rounded-full ${row.good ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min((row.mcgRaw / (row.industryRaw * 1.5)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-[#484f58] mt-2">Benchmark source: Picus Security BFSI Report 2025</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
