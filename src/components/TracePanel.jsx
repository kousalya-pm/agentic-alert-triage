import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Zap } from 'lucide-react';

function fmt(n) { return (n ?? 0).toLocaleString(); }
function fmtCost(n) { return `$${(n ?? 0).toFixed(4)}`; }
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TracePanel({ trace }) {
  const [expanded, setExpanded] = useState(false);

  if (!trace?.totals) return null;

  const { totals, aiCalls = [], toolCalls = [] } = trace;
  const totalTokens = totals.inputTokens + totals.outputTokens +
    totals.cacheCreationTokens + totals.cacheReadTokens;

  return (
    <div className="mx-5 mb-2 border border-[#1e2d4a] rounded-xl overflow-hidden text-[11px]">

      {/* ── Collapsed header ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-[#080c1a] hover:bg-[#0a0f1e] transition-colors"
      >
        <Activity size={11} className="text-[#7a9cc0] shrink-0" />
        <span className="font-semibold text-white">Trace</span>
        <span className="text-[#8b949e]">—</span>
        <span className="text-[#8b949e]">{totals.aiCallsCount} AI calls</span>
        <span className="text-[#30363d]">·</span>
        <span className="text-[#8b949e]">{totals.toolCallsCount} tools</span>
        <span className="text-[#30363d]">·</span>
        <span className="text-[#8b949e]">{fmt(totalTokens)} tokens</span>
        <span className="text-[#30363d]">·</span>
        <span className="text-white font-medium">{fmtCost(totals.estimatedCostUsd)}</span>
        {totals.cacheHitPct > 0 && (
          <>
            <span className="text-[#30363d]">·</span>
            <span className="text-green-400 flex items-center gap-0.5">
              <Zap size={9} />
              {totals.cacheHitPct}% cached
            </span>
          </>
        )}
        <span className="ml-auto text-[#8b949e]">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#1e2d4a] divide-y divide-[#1e2d4a]">

          {/* ── AI Calls ── */}
          <div className="px-4 py-3 bg-[#060a14]">
            <div className="text-[9px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
              AI Calls
            </div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[#8b949e]">
                  <th className="text-left pb-1.5 font-normal">Function</th>
                  <th className="text-right pb-1.5 font-normal pr-3">Input</th>
                  <th className="text-right pb-1.5 font-normal pr-3">Output</th>
                  <th className="text-right pb-1.5 font-normal pr-3">Cache</th>
                  <th className="text-right pb-1.5 font-normal pr-3">Latency</th>
                  <th className="text-right pb-1.5 font-normal">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2d4a]/40">
                {aiCalls.map((call, i) => (
                  <tr key={i}>
                    <td className="py-1 font-mono text-white">{call.name}</td>
                    <td className="py-1 text-right text-[#8b949e] pr-3">{fmt(call.inputTokens)}</td>
                    <td className="py-1 text-right text-[#8b949e] pr-3">{fmt(call.outputTokens)}</td>
                    <td className="py-1 text-right pr-3">
                      {call.cacheReadTokens > 0 ? (
                        <span className="text-green-400">⚡ {fmt(call.cacheReadTokens)}</span>
                      ) : call.cacheCreationTokens > 0 ? (
                        <span className="text-yellow-500">✦ {fmt(call.cacheCreationTokens)}</span>
                      ) : (
                        <span className="text-[#30363d]">—</span>
                      )}
                    </td>
                    <td className="py-1 text-right text-[#8b949e] pr-3">{fmtMs(call.latencyMs)}</td>
                    <td className="py-1 text-right text-white">{fmtCost(call.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#30363d]">
                  <td className="pt-1.5 text-[#8b949e] font-semibold">Total</td>
                  <td className="pt-1.5 text-right text-[#8b949e] pr-3">{fmt(totals.inputTokens)}</td>
                  <td className="pt-1.5 text-right text-[#8b949e] pr-3">{fmt(totals.outputTokens)}</td>
                  <td className="pt-1.5 text-right text-green-400 pr-3">
                    {totals.cacheReadTokens > 0 ? `⚡ ${fmt(totals.cacheReadTokens)}` : '—'}
                  </td>
                  <td className="pt-1.5 pr-3" />
                  <td className="pt-1.5 text-right text-white font-semibold">{fmtCost(totals.estimatedCostUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Tool Calls ── */}
          {toolCalls.length > 0 && (
            <div className="px-4 py-3 bg-[#060a14]">
              <div className="text-[9px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                Tool Calls
              </div>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-[#8b949e]">
                    <th className="text-left pb-1.5 font-normal w-32">Tool</th>
                    <th className="text-left pb-1.5 font-normal">Parameters</th>
                    <th className="text-right pb-1.5 font-normal w-16">Latency</th>
                    <th className="text-right pb-1.5 font-normal w-10">OK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2d4a]/40">
                  {toolCalls.map((tc, i) => (
                    <tr key={i}>
                      <td className="py-1 font-mono text-[#00d4ff]">{tc.tool}</td>
                      <td className="py-1 text-[#8b949e] max-w-xs truncate">
                        {Object.entries(tc.parameters || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
                      </td>
                      <td className="py-1 text-right text-[#8b949e]">{fmtMs(tc.latencyMs)}</td>
                      <td className="py-1 text-right">
                        {tc.status === 'ok'
                          ? <span className="text-green-400">✓</span>
                          : <span className="text-red-400">✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Cache savings callout ── */}
          {totals.cacheSavingsUsd > 0.00005 && (
            <div className="px-4 py-2 bg-green-500/5 flex items-center gap-2">
              <Zap size={10} className="text-green-400 shrink-0" />
              <span className="text-green-400 text-[10px]">
                Prompt caching saved {fmtCost(totals.cacheSavingsUsd)} on this run
                ({totals.cacheHitPct}% of input tokens served from cache at 10% cost)
              </span>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
