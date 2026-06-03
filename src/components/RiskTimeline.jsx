/**
 * RiskTimeline.jsx
 * ─────────────────────────────────────────────────────────────────────
 * Two exports:
 *   default  RiskTimeline  — full interactive chart (UserPage / AssetPage)
 *   named    RiskSparkline — compact sparkline (EntityPanel)
 *
 * Pure SVG — no charting library dependency.
 * Responsive: uses ResizeObserver to fill its container.
 */

import { useState, useMemo, useRef, useEffect, useId } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { buildTimeline, currentScore, scoreDelta } from '../services/riskScoreService.js';

const HALF_LIFE = 30; // Fixed: 30-day exponential decay half-life

// ─── Shared helpers ────────────────────────────────────────────────────────────

const SEV_DOT = {
  Critical: '#ef4444',
  High:     '#f97316',
  Medium:   '#eab308',
  Low:      '#60a5fa',
};

function scoreColor(s) {
  if (s >= 80) return '#ef4444';
  if (s >= 60) return '#f97316';
  if (s >= 30) return '#eab308';
  return '#00d4ff';
}

function scoreTailwind(s) {
  if (s >= 80) return 'text-red-400';
  if (s >= 60) return 'text-orange-400';
  if (s >= 30) return 'text-yellow-400';
  return 'text-[#00d4ff]';
}

function topSeverity(alerts) {
  for (const sev of ['Critical', 'High', 'Medium', 'Low']) {
    if (alerts.some(a => a.severity === sev)) return sev;
  }
  return 'Low';
}

function useContainerWidth(ref) {
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return width;
}

// ─── Full Timeline Chart ───────────────────────────────────────────────────────

export default function RiskTimeline({ alerts = [], pastAlerts = [] }) {
  const uid        = useId();
  const containerRef = useRef(null);
  const svgWidth   = useContainerWidth(containerRef);

  const [days,  setDays]  = useState(90);
  const [hover, setHover] = useState(null); // { i, x, y, point }

  const allAlerts = useMemo(() => [...alerts, ...pastAlerts], [alerts, pastAlerts]);
  const timeline  = useMemo(
    () => buildTimeline(allAlerts, { days, halfLife: HALF_LIFE }),
    [allAlerts, days]
  );

  const score = currentScore(timeline);
  const delta = scoreDelta(timeline, 7);
  const n     = timeline.length;

  // ── SVG geometry ─────────────────────────────────────────────────
  const H   = 165;
  const PAD = { l: 38, r: 14, t: 14, b: 26 };
  const W   = svgWidth;
  const cW  = Math.max(1, W - PAD.l - PAD.r);
  const cH  = H - PAD.t - PAD.b;

  const xScale = i  => PAD.l + (i / Math.max(1, n - 1)) * cW;
  const yScale = s  => PAD.t + cH - (Math.min(100, Math.max(0, s)) / 100) * cH;

  const linePath = timeline
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.score).toFixed(1)}`)
    .join(' ');
  const fillPath = n > 0
    ? `${linePath} L${xScale(n - 1).toFixed(1)},${(PAD.t + cH).toFixed(1)} L${PAD.l.toFixed(1)},${(PAD.t + cH).toFixed(1)} Z`
    : '';

  // Alert dot positions
  const alertEvents = timeline
    .map((p, i) => p.dayAlerts.length > 0 ? { i, point: p, x: xScale(i), y: yScale(p.score) } : null)
    .filter(Boolean);

  // X-axis tick positions (5 ticks evenly spaced)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const i = Math.round(frac * (n - 1));
    return {
      i,
      x: xScale(i),
      label: i === n - 1
        ? 'Today'
        : timeline[i]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) || '',
    };
  });

  // ── Mouse interaction ────────────────────────────────────────────
  const handleMouseMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i  = Math.max(0, Math.min(n - 1, Math.round((mx - PAD.l) / cW * (n - 1))));
    const pt = timeline[i];
    if (pt) setHover({ i, x: xScale(i), y: yScale(pt.score), point: pt });
  };

  const gradId = `rft_${uid}`;

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-xl p-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[10px] font-semibold text-[#7a9cc0] uppercase tracking-wider">
            Risk Score Timeline
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-2xl font-bold font-mono ${scoreTailwind(score)}`}>
              {score.toFixed(0)}
            </span>
            <span className="text-sm text-[#4a6080]">/ 100</span>
            {delta !== null && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${
                delta > 1  ? 'text-red-400' :
                delta < -1 ? 'text-green-400' : 'text-[#7a9cc0]'
              }`}>
                {delta > 1 ? <TrendingUp size={11} /> : delta < -1 ? <TrendingDown size={11} /> : <Minus size={11} />}
                {delta > 0 ? '+' : ''}{delta.toFixed(0)} vs 7d ago
              </span>
            )}
          </div>
        </div>

        {/* Window toggle */}
        <div className="flex items-center bg-[#0a0f1e] border border-[#1e2d4a] rounded p-0.5 gap-0.5">
          {[30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                days === d ? 'bg-[#1e2d4a] text-white' : 'text-[#4a6080] hover:text-[#7a9cc0]'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* ── SVG chart ── */}
      <div ref={containerRef} className="relative w-full">
        <svg
          width={W} height={H}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#00d4ff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00d4ff" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Risk zone bands */}
          <rect x={PAD.l} y={yScale(100)} width={cW} height={yScale(80) - yScale(100)} fill="rgba(239,68,68,0.06)" />
          <rect x={PAD.l} y={yScale(80)}  width={cW} height={yScale(60) - yScale(80)}  fill="rgba(249,115,22,0.04)" />
          <rect x={PAD.l} y={yScale(60)}  width={cW} height={yScale(30) - yScale(60)}  fill="rgba(234,179,8,0.03)"  />

          {/* Dashed grid lines */}
          {[25, 50, 75].map(v => (
            <line key={v}
              x1={PAD.l} x2={PAD.l + cW} y1={yScale(v)} y2={yScale(v)}
              stroke="#1e2d4a" strokeWidth={1} strokeDasharray="3,3"
            />
          ))}
          {/* Top + bottom axis lines */}
          <line x1={PAD.l} x2={PAD.l + cW} y1={yScale(100)} y2={yScale(100)} stroke="#1e2d4a" strokeWidth={1} />
          <line x1={PAD.l} x2={PAD.l + cW} y1={PAD.t + cH}  y2={PAD.t + cH}  stroke="#1e2d4a" strokeWidth={1} />
          <line x1={PAD.l} x2={PAD.l}       y1={PAD.t}        y2={PAD.t + cH}  stroke="#1e2d4a" strokeWidth={1} />

          {/* Y-axis labels */}
          {[0, 25, 50, 75, 100].map(v => (
            <text key={v} x={PAD.l - 5} y={yScale(v) + 3.5}
              textAnchor="end" fontSize={9} fill="#3a5070" fontFamily="monospace"
            >{v}</text>
          ))}

          {/* Area fill */}
          {fillPath && <path d={fillPath} fill={`url(#${gradId})`} />}

          {/* Score line */}
          {linePath && (
            <path d={linePath} fill="none"
              stroke="#00d4ff" strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round"
            />
          )}

          {/* Alert dots — colored by highest severity that day */}
          {alertEvents.map(({ i, point, x, y }) => {
            const top   = topSeverity(point.dayAlerts);
            const color = SEV_DOT[top];
            const count = point.dayAlerts.length;
            const r     = count > 1 ? 6.5 : 5;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={r} fill={color} stroke="#0a0f1e" strokeWidth={1.5} />
                {count > 1 && (
                  <text x={x} y={y + 3.5} textAnchor="middle"
                    fontSize={8} fill="#0a0f1e" fontWeight="bold"
                  >{count}</text>
                )}
              </g>
            );
          })}

          {/* Hover crosshair */}
          {hover && (
            <g>
              <line
                x1={hover.x} x2={hover.x} y1={PAD.t} y2={PAD.t + cH}
                stroke="#00d4ff" strokeWidth={0.5} strokeOpacity={0.4}
              />
              <circle cx={hover.x} cy={hover.y} r={3.5}
                fill="#00d4ff" stroke="#0a0f1e" strokeWidth={1.5}
              />
            </g>
          )}

          {/* X-axis date labels */}
          {xTicks.map(({ i, x, label }) => (
            <text key={i} x={x} y={PAD.t + cH + 18}
              textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}
              fontSize={9} fill="#3a5070"
            >{label}</text>
          ))}
        </svg>

        {/* Hover tooltip */}
        {hover?.point && (
          <div
            className="absolute bg-[#111827] border border-[#2a3f63] rounded-lg px-2.5 py-2 text-xs pointer-events-none z-10 shadow-xl min-w-[120px]"
            style={{
              left: Math.min(hover.x + 12, W - 170),
              top:  Math.max(4, hover.y - 58),
            }}
          >
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className={`font-bold font-mono text-sm ${scoreTailwind(hover.point.score)}`}>
                {hover.point.score.toFixed(0)}
              </span>
              <span className="text-[#4a6080]">/ 100</span>
            </div>
            <div className="text-[#7a9cc0] text-[10px]">
              {hover.point.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            {hover.point.dayAlerts.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-[#1e2d4a] space-y-1">
                {hover.point.dayAlerts.map((a, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full mt-0.5 shrink-0"
                      style={{ background: SEV_DOT[a.severity] || '#7a9cc0' }}
                    />
                    <span className="text-[10px] text-[#e2eaf5] leading-snug">
                      {a.severity}: {a.title?.length > 38 ? a.title.slice(0, 38) + '…' : a.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer legend ── */}
      <div className="flex items-center gap-4 mt-1.5 text-[9px] text-[#3a5070]">
        <span>30-day decay · open alerts undecayed</span>
        <span className="flex items-center gap-2">
          {Object.entries(SEV_DOT).map(([sev, col]) => (
            <span key={sev} className="flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col }} />
              {sev}
            </span>
          ))}
        </span>
        <span>Open alerts: no decay</span>
      </div>
    </div>
  );
}

// ─── Compact Sparkline (EntityPanel) ──────────────────────────────────────────

export function RiskSparkline({ alerts = [], pastAlerts = [] }) {
  const uid        = useId();
  const containerRef = useRef(null);
  const svgWidth   = useContainerWidth(containerRef);

  const allAlerts = useMemo(() => [...alerts, ...pastAlerts], [alerts, pastAlerts]);
  const timeline  = useMemo(
    () => buildTimeline(allAlerts, { days: 30, halfLife: 14 }),
    [allAlerts]
  );

  const score = currentScore(timeline);
  const delta = scoreDelta(timeline, 7);
  const n     = timeline.length;

  const W   = Math.max(10, svgWidth);
  const H   = 44;
  const PAD = { l: 0, r: 0, t: 3, b: 14 };
  const cW  = W;
  const cH  = H - PAD.t - PAD.b;

  const xScale = i => (i / Math.max(1, n - 1)) * cW;
  const yScale = s => PAD.t + cH - (Math.min(100, Math.max(0, s)) / 100) * cH;

  const linePath = timeline
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.score).toFixed(1)}`)
    .join(' ');
  const fillPath = n > 0
    ? `${linePath} L${xScale(n - 1).toFixed(1)},${(PAD.t + cH).toFixed(1)} L0,${(PAD.t + cH).toFixed(1)} Z`
    : '';

  const lc      = scoreColor(score);
  const gradId  = `rfs_${uid}`;

  // Alert day ticks (rug plot on baseline)
  const alertTicks = timeline
    .map((p, i) => p.dayAlerts.length > 0 ? { i, dayAlerts: p.dayAlerts } : null)
    .filter(Boolean);

  return (
    <div>
      {/* Score row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#7a9cc0]">30-day risk trend</span>
        <div className="flex items-center gap-1.5">
          {delta !== null && Math.abs(delta) > 0.5 && (
            <span className={`text-[9px] flex items-center gap-0.5 ${delta > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {delta > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
              {delta > 0 ? '+' : ''}{delta.toFixed(0)}
            </span>
          )}
          <span className={`text-xs font-bold font-mono ${scoreTailwind(score)}`}>
            {score.toFixed(0)}
            <span className="text-[9px] text-[#3a5070] font-normal">/100</span>
          </span>
        </div>
      </div>

      {/* Sparkline SVG */}
      <div ref={containerRef} className="w-full">
        <svg width={W} height={H} className="block overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={lc} stopOpacity="0.3" />
              <stop offset="100%" stopColor={lc} stopOpacity="0"   />
            </linearGradient>
          </defs>

          {/* Area */}
          {fillPath && <path d={fillPath} fill={`url(#${gradId})`} />}

          {/* Line */}
          {linePath && (
            <path d={linePath} fill="none" stroke={lc} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round"
            />
          )}

          {/* Alert ticks on baseline */}
          {alertTicks.map(({ i, dayAlerts }) => {
            const top   = topSeverity(dayAlerts);
            const color = SEV_DOT[top];
            const x     = xScale(i);
            return (
              <line key={i}
                x1={x} x2={x}
                y1={PAD.t + cH} y2={PAD.t + cH - 7}
                stroke={color} strokeWidth={1.5} strokeLinecap="round"
              />
            );
          })}

          {/* Baseline */}
          <line x1={0} x2={W} y1={PAD.t + cH} y2={PAD.t + cH} stroke="#1e2d4a" strokeWidth={1} />

          {/* Date labels */}
          <text x={1} y={H - 2} fontSize={8} fill="#3a5070">-30d</text>
          <text x={W - 1} y={H - 2} textAnchor="end" fontSize={8} fill="#3a5070">Today</text>
        </svg>
      </div>
    </div>
  );
}
