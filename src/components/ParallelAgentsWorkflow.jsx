import { useState, useEffect, useRef } from 'react';
import { Play, AlertTriangle, CheckCircle, XCircle, FileDown, Users, Cpu } from 'lucide-react';
import { runSpecialistAgent, synthesizeSpecialistReports } from '../services/aiService.js';
import { executeTool, TOOLS } from '../services/toolService.js';
import { exportTriageReport } from '../services/reportService.js';
import { saveRun, getRuns } from '../services/runHistoryService.js';
import {
  DECISIONS_KEY, VERDICT_CONFIG, VERDICT_SHORT,
  EscalationTicketModal, RunHistoryBar, formatAge,
  AnalystActions, SummaryPanel, RiskLevelBadge,
} from './AgentWorkflow.jsx';
import { computeRiskLevel, oneLineSummary } from '../services/riskHeuristic.js';

// ─── Specialist definitions ────────────────────────────────────────────────────

const SPECIALISTS = [
  {
    id: 'identity',
    name: 'Identity Agent',
    icon: '👤',
    focus: 'User identity, authentication history, access patterns, and behavioural anomalies',
    colorBg: 'bg-blue-500/10',
    colorBorder: 'border-blue-500/30',
    colorBorderActive: 'border-blue-500/60',
    colorText: 'text-blue-400',
    colorDot: 'bg-blue-500',
    riskColors: { CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30', HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30', MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', LOW: 'text-green-400 bg-green-500/10 border-green-500/30' },
  },
  {
    id: 'network',
    name: 'Network Agent',
    icon: '🌐',
    focus: 'IP reputation, geolocation, network infrastructure, and threat actor attribution',
    colorBg: 'bg-purple-500/10',
    colorBorder: 'border-purple-500/30',
    colorBorderActive: 'border-purple-500/60',
    colorText: 'text-purple-400',
    colorDot: 'bg-purple-500',
    riskColors: { CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30', HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30', MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', LOW: 'text-green-400 bg-green-500/10 border-green-500/30' },
  },
  {
    id: 'threat_intel',
    name: 'Threat Intel Agent',
    icon: '🔍',
    focus: 'Known threat actors, malware families, IOC correlation, and watchlist matching',
    colorBg: 'bg-orange-500/10',
    colorBorder: 'border-orange-500/30',
    colorBorderActive: 'border-orange-500/60',
    colorText: 'text-orange-400',
    colorDot: 'bg-orange-500',
    riskColors: { CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30', HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30', MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', LOW: 'text-green-400 bg-green-500/10 border-green-500/30' },
  },
  {
    id: 'endpoint',
    name: 'Endpoint Agent',
    icon: '💻',
    focus: 'Device security posture, EDR coverage, patch compliance, and asset criticality',
    colorBg: 'bg-green-500/10',
    colorBorder: 'border-green-500/30',
    colorBorderActive: 'border-green-500/60',
    colorText: 'text-green-400',
    colorDot: 'bg-green-500',
    riskColors: { CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30', HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30', MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', LOW: 'text-green-400 bg-green-500/10 border-green-500/30' },
  },
];

// Assign tool calls to each specialist based on what's available in the alert
function assignTools(specialistId, alert) {
  // Try to extract a URL from the description field
  const descUrl = (() => {
    const raw = alert.description || '';
    const m = raw.match(/hxxps?:\/\/[^\s"'[\]]+/i) || raw.match(/https?:\/\/[^\s"'[\]]+/i);
    if (!m) return null;
    return m[0].replace(/^hxxp/i, 'http');
  })();

  const externalIp = alert.dst_ip || alert.src_ip;

  switch (specialistId) {
    case 'identity': {
      const calls = [];
      if (alert.user_id) calls.push({ tool: 'user_lookup', parameters: { user_id: alert.user_id } });
      if (alert.user_id || alert.src_ip)
        calls.push({ tool: 'siem_query', parameters: { user_id: alert.user_id || '', src_ip: alert.src_ip || '' } });
      return calls;
    }
    case 'network': {
      const calls = [];
      if (externalIp) {
        calls.push({ tool: 'ip_geo',        parameters: { ip: externalIp } });
        calls.push({ tool: 'abuseipdb',     parameters: { ip: externalIp } });
        calls.push({ tool: 'virustotal_ip', parameters: { ip: externalIp } });
      }
      return calls;
    }
    case 'threat_intel': {
      const calls = [];
      const indicator = externalIp || alert.hostname;
      if (indicator) calls.push({ tool: 'watchlist_check', parameters: { indicator } });
      if (descUrl) {
        calls.push({ tool: 'virustotal_url', parameters: { url: descUrl } });
        calls.push({ tool: 'urlscan',        parameters: { q: descUrl } });
      }
      return calls;
    }
    case 'endpoint': {
      const calls = [];
      if (alert.hostname) calls.push({ tool: 'asset_lookup', parameters: { hostname: alert.hostname } });
      return calls;
    }
    default:
      return [];
  }
}

// ─── State helpers ─────────────────────────────────────────────────────────────

function loadDecisions() {
  try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) || '{}'); } catch { return {}; }
}
function saveDecision(alertId, decision) {
  const all = loadDecisions();
  all[alertId] = decision;
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(all));
}

const PHASE = { IDLE: 'idle', RUNNING: 'running', SYNTHESIZING: 'synthesizing', DONE: 'done', ERROR: 'error' };

const initAgentState = () =>
  Object.fromEntries(SPECIALISTS.map(s => [s.id, { status: 'pending', report: null, toolCalls: [], toolResults: [], error: null }]));

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ParallelAgentsWorkflow({ alert, settings, onOpenSettings, onEntityClick, onRunningChange }) {
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [agentStates, setAgentStates] = useState(initAgentState);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [riskLabel, setRiskLabel] = useState('UNKNOWN');
  const [analystDecision, setAnalystDecision] = useState(() => loadDecisions()[alert.alert_id] || null);
  const [runHistory, setRunHistory] = useState(() => getRuns(alert.alert_id, 'parallel'));
  const [viewingRunId, setViewingRunId] = useState(null);
  const [escalationTicket, setEscalationTicket] = useState(null);
  const startTime = useRef(null);
  const timerRef = useRef(null);
  const bottomRef = useRef(null);

  const refreshHistory = () => setRunHistory(getRuns(alert.alert_id, 'parallel'));

  // Auto-save run at any investigation stage so switching away doesn't lose progress
  useEffect(() => {
    if (alert?.alert_id && (Object.keys(agentStates).length > 0 || finalSummary)) {
      saveRun(alert.alert_id, {
        plan,
        stepResults: [],  // Parallel agents don't use sequential steps
        summary: finalSummary,
        elapsed: Math.round((Date.now() - (startTime.current || Date.now())) / 1000) || 0,
        mode: 'parallel',
        agentStates,
      });
    }
  }, [alert?.alert_id, agentStates, finalSummary, plan]);

  const loadHistoricalRun = (run) => {
    const states = run.agentStates || initAgentState();
    setAgentStates(states);
    setSummary(run.summary);
    setElapsed(run.elapsed);
    setPhase(PHASE.DONE);
    setError(null);
    setViewingRunId(run.runId);
    setAnalystDecision(loadDecisions()[alert.alert_id] || null);
    // Recompute risk label from stored tool results
    const allToolResults = Object.values(states).flatMap(s =>
      (s.toolResults || []).map(tr => ({ tool: tr.tool, result: tr.result }))
    );
    if (allToolResults.length > 0) setRiskLabel(computeRiskLevel(allToolResults));
  };

  const startNewRun = () => {
    setViewingRunId(null);
    setPhase(PHASE.IDLE);
    setAgentStates(initAgentState());
    setSummary(null);
    setError(null);
    setElapsed(0);
    setRiskLabel('UNKNOWN');
  };

  const handleAnalystAction = (action, note = '') => {
    if (!action) {
      saveDecision(alert.alert_id, null);
      setAnalystDecision(null);
      setEscalationTicket(null);
      window.dispatchEvent(new Event('soc-decisions-updated'));
      return;
    }
    const decision = {
      action, note,
      alert_id: alert.alert_id,
      alert_severity: alert.severity,
      alert_category: alert.category,
      ai_verdict: summary?.verdict,
      elapsed_seconds: elapsed,
      timestamp: new Date().toISOString(),
      analyst: 'You',
    };
    saveDecision(alert.alert_id, decision);
    setAnalystDecision(decision);
    window.dispatchEvent(new Event('soc-decisions-updated'));

    if (action === 'escalate') {
      const num = 100 + parseInt(alert.alert_id?.replace(/\D/g, '') || '0', 10);
      const priority = { Critical: 'P1 — Critical', High: 'P2 — High', Medium: 'P3 — Medium', Low: 'P4 — Low' }[alert.severity] || 'P2 — High';
      setEscalationTicket({
        ticketId: `INC-2024-${num}`, priority, title: alert.title, alertId: alert.alert_id,
        assignedTo: 'IR Team / Tier 2 SOC', createdAt: new Date().toISOString(),
        verdict: summary?.verdict, riskScore: summary?.risk_score, mitre: summary?.mitre_assessment,
        escalationReason: summary?.escalation_reason || note || 'Manual escalation by analyst',
        analystNote: note, executiveSummary: summary?.executive_summary,
      });
    }
  };

  useEffect(() => {
    if (phase === PHASE.RUNNING || phase === PHASE.SYNTHESIZING) {
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentStates, phase]);

  // Update live risk label as each agent completes their tool calls
  useEffect(() => {
    const allToolResults = Object.values(agentStates).flatMap(s =>
      (s.toolResults || []).map(tr => ({ tool: tr.tool, result: tr.result }))
    );
    if (allToolResults.length > 0) {
      setRiskLabel(computeRiskLevel(allToolResults));
    }
  }, [agentStates]);

  const runTriage = async () => {
    if (!settings?.anthropicKey && !settings?.openaiKey) {
      setError('No AI API key configured. Please add your Anthropic or OpenAI key in Settings.');
      setPhase(PHASE.ERROR);
      return;
    }

    startTime.current = Date.now();
    setPhase(PHASE.RUNNING);
    setSummary(null);
    setError(null);
    setElapsed(0);
    setRiskLabel('UNKNOWN');
    setAnalystDecision(null);

    // Assign tools upfront — no AI call needed for planning
    const assignments = SPECIALISTS.map(s => ({
      ...s,
      toolCalls: assignTools(s.id, alert),
    }));

    // Initialise all agents as running simultaneously
    setAgentStates(Object.fromEntries(
      assignments.map(a => [a.id, { status: 'running', report: null, toolCalls: a.toolCalls, toolResults: [], error: null }])
    ));

    // Run one specialist: execute its tools then call AI for analysis
    const runAgent = async (assignment) => {
      try {
        // Execute tool calls sequentially within this agent
        const toolResults = [];
        for (const tc of assignment.toolCalls) {
          const result = await executeTool(tc.tool, tc.parameters, settings);
          toolResults.push(result);
        }

        // Build the combined input for the AI call
        const toolCallsWithResults = assignment.toolCalls.map((tc, i) => ({
          tool: tc.tool,
          parameters: tc.parameters,
          result: toolResults[i],
        }));

        const report = await runSpecialistAgent(alert, assignment, toolCallsWithResults, settings);

        setAgentStates(prev => ({
          ...prev,
          [assignment.id]: { status: 'done', report, toolCalls: assignment.toolCalls, toolResults, error: null },
        }));
        return { id: assignment.id, report };
      } catch (err) {
        setAgentStates(prev => ({
          ...prev,
          [assignment.id]: { ...prev[assignment.id], status: 'error', error: err.message },
        }));
        return { id: assignment.id, report: null };
      }
    };

    try {
      // All 4 agents fire simultaneously
      const results = await Promise.all(assignments.map(runAgent));

      // Build the specialist reports object for the orchestrator
      const specialistReports = Object.fromEntries(
        results.map(r => [r.id, r.report || { relevant: false, findings: ['Agent failed'], risk_contribution: 'LOW' }])
      );

      setPhase(PHASE.SYNTHESIZING);
      const finalSummary = await synthesizeSpecialistReports(alert, specialistReports, settings);
      setSummary(finalSummary);
      setPhase(PHASE.DONE);
      clearInterval(timerRef.current);

      const finalElapsed = Math.floor((Date.now() - startTime.current) / 1000);

      // Snapshot agent states for history (capture current value)
      const finalAgentStates = Object.fromEntries(
        results.map(r => {
          const assignment = assignments.find(a => a.id === r.id);
          return [r.id, { status: r.report ? 'done' : 'error', report: r.report, toolCalls: assignment.toolCalls, toolResults: [] }];
        })
      );

      saveRun(alert.alert_id, {
        plan: { investigation_steps: [] },
        stepResults: [],
        summary: finalSummary,
        elapsed: finalElapsed,
        mode: 'parallel',
        agentStates: finalAgentStates,
      });
      refreshHistory();

    } catch (err) {
      setError(err.message);
      setPhase(PHASE.ERROR);
      clearInterval(timerRef.current);
    }
  };

  const SEV_COLOR = { Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-blue-400' };
  const isRunning = phase === PHASE.RUNNING || phase === PHASE.SYNTHESIZING;
  // Notify parent when this workflow starts/stops so the mode selector can lock
  useEffect(() => {
    onRunningChange?.(isRunning);
    return () => onRunningChange?.(false);
  }, [isRunning, onRunningChange]);

  const allDone = SPECIALISTS.every(s => agentStates[s.id]?.status === 'done' || agentStates[s.id]?.status === 'error');

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Alert header ── */}
      <div className="shrink-0 px-5 py-3 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] text-[#8b949e] font-mono">{alert.alert_id}</span>
              <span className={`text-xs font-semibold ${SEV_COLOR[alert.severity] || 'text-gray-400'}`}>{alert.severity}</span>
              <span className="text-xs text-[#8b949e] bg-[#30363d] px-2 py-0.5 rounded-full">{alert.category}</span>
              <span className="text-xs text-[#8b949e]">{alert.source_tool}</span>
            </div>
            <h1 className="text-sm font-semibold text-white leading-snug">{alert.title}</h1>
            <p className="text-xs text-[#8b949e] mt-1 leading-relaxed line-clamp-2">{alert.description}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-[#7a9cc0] flex-wrap">
              {alert.timestamp && <span>🕐 {new Date(alert.timestamp).toLocaleString()}</span>}
              {alert.user_id && <button onClick={() => onEntityClick?.('user', alert.user_id)} className="hover:text-[#00d4ff] transition-colors">👤 {alert.user_id}</button>}
              {alert.hostname && <button onClick={() => onEntityClick?.('asset', alert.hostname)} className="hover:text-[#00d4ff] transition-colors">💻 {alert.hostname}</button>}
              {alert.src_ip && <span>📡 {alert.src_ip}</span>}
              {alert.mitre_tactic && <span>🎯 {alert.mitre_tactic} · {alert.mitre_technique}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(phase !== PHASE.IDLE || viewingRunId) && (
              <RiskLevelBadge level={riskLabel} showScore={phase === PHASE.DONE || !!viewingRunId} aiScore={summary?.risk_score} />
            )}
            {phase !== PHASE.IDLE && !viewingRunId && (
              <span className="text-xs text-[#7a9cc0] font-mono">{elapsed}s</span>
            )}
            {phase === PHASE.DONE && summary && (
              <button
                onClick={() => exportTriageReport({ alert, plan: { investigation_steps: [] }, stepResults: [], summary, analystDecision, elapsed })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#1e2d4a] hover:border-[#2a3f63] text-[#7a9cc0] hover:text-white transition-colors"
              >
                <FileDown size={13} /> Export PDF
              </button>
            )}
            {viewingRunId ? (
              <button onClick={startNewRun} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f1629] border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors">
                ↺ New Run
              </button>
            ) : (
              <button
                onClick={runTriage}
                disabled={isRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#00d4ff] hover:bg-[#00b8d9] text-[#0a0f1e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {phase === PHASE.IDLE || phase === PHASE.DONE || phase === PHASE.ERROR
                  ? <><Play size={12} /> {phase === PHASE.DONE || phase === PHASE.ERROR ? 'Re-run' : 'Run AI Triage'}</>
                  : <><span className="spinner" /> Running...</>
                }
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Run history ── */}
      {runHistory.length > 0 && (
        <RunHistoryBar
          runs={runHistory}
          viewingRunId={viewingRunId}
          onLoad={loadHistoricalRun}
          onNewRun={startNewRun}
          isRunning={isRunning}
        />
      )}

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* IDLE */}
        {phase === PHASE.IDLE && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Users size={20} className="text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-white font-semibold mb-1">Parallel Specialist Agents</p>
              <p className="text-xs text-[#7a9cc0] max-w-sm leading-relaxed">
                Four specialist agents investigate simultaneously — each from their own domain.
                An Orchestrator then synthesises all reports into a final verdict.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-xs text-left">
              {SPECIALISTS.map(s => (
                <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${s.colorBg} ${s.colorBorder}`}>
                  <span className="text-sm">{s.icon}</span>
                  <span className={`text-[11px] font-medium ${s.colorText}`}>{s.name}</span>
                </div>
              ))}
            </div>
            {runHistory.length > 0 && (
              <button onClick={() => loadHistoricalRun(runHistory[0])} className="flex items-center gap-1.5 text-xs text-[#7a9cc0] hover:text-[#00d4ff] transition-colors underline underline-offset-2">
                or load latest run ({formatAge(runHistory[0].timestamp)})
              </button>
            )}
          </div>
        )}

        {/* ERROR */}
        {phase === PHASE.ERROR && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
            <div className="flex items-center gap-2 mb-2 font-semibold text-red-400"><AlertTriangle size={15} /> Error</div>
            {error}
            {error?.includes('API key') && (
              <button onClick={onOpenSettings} className="mt-3 block text-xs underline text-red-400 hover:text-red-300">Open Settings →</button>
            )}
          </div>
        )}

        {/* ── Agent cards grid ── */}
        {phase !== PHASE.IDLE && (
          <>
            <div className="text-[10px] text-[#4a6080] uppercase tracking-wider font-semibold flex items-center gap-2">
              <Users size={11} />
              Specialist Agents — running in parallel
            </div>

            <div className="grid grid-cols-2 gap-3">
              {SPECIALISTS.map(s => {
                const state = agentStates[s.id];
                const status = state?.status || 'pending';
                const report = state?.report;
                const toolCalls = state?.toolCalls || [];

                return (
                  <div
                    key={s.id}
                    className={`border rounded-xl overflow-hidden transition-all ${
                      status === 'running'  ? `${s.colorBorderActive} ${s.colorBg}` :
                      status === 'done'     ? `${s.colorBorder} bg-[#161b22]` :
                      status === 'error'    ? 'border-red-500/30 bg-red-500/5' :
                                              'border-[#21262d] bg-[#0d1117] opacity-40'
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{s.icon}</span>
                        <span className={`text-xs font-semibold ${s.colorText}`}>{s.name}</span>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    {/* Tool chips */}
                    {toolCalls.length > 0 && (
                      <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-white/5">
                        {toolCalls.map((tc, i) => {
                          const meta = TOOLS[tc.tool] || {};
                          return (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 bg-[#0d1117] border border-[#30363d] rounded text-[#7a9cc0]">
                              {meta.icon} {meta.label || tc.tool}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {toolCalls.length === 0 && status !== 'pending' && (
                      <div className="px-3 py-2 border-b border-white/5">
                        <span className="text-[9px] text-[#4a6080] italic">No relevant indicators for this alert type</span>
                      </div>
                    )}

                    {/* Running state */}
                    {status === 'running' && (
                      <div className="px-3 py-3 flex items-center gap-2">
                        <span className="spinner" style={{ width: 12, height: 12 }} />
                        <span className="text-[11px] text-[#7a9cc0]">Querying {toolCalls.length} source{toolCalls.length !== 1 ? 's' : ''}...</span>
                      </div>
                    )}

                    {/* Error state */}
                    {status === 'error' && (
                      <div className="px-3 py-3">
                        <p className="text-[11px] text-red-400">{state.error}</p>
                      </div>
                    )}

                    {/* Done — findings */}
                    {status === 'done' && report && (
                      <div className="px-3 py-3 space-y-2">
                        {/* Risk contribution */}
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-[#4a6080] uppercase tracking-wider">Risk Contribution</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.riskColors[report.risk_contribution] || s.riskColors.LOW}`}>
                            {report.risk_contribution}
                          </span>
                        </div>
                        {/* Findings */}
                        {report.relevant === false ? (
                          <p className="text-[11px] text-[#4a6080] italic">Not applicable for this alert type.</p>
                        ) : (
                          <ul className="space-y-1">
                            {(report.findings || []).slice(0, 3).map((f, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#c9d1d9]">
                                <span className={`${s.colorText} shrink-0 mt-0.5`}>→</span>
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* Recommendation */}
                        {report.recommendation && (
                          <p className={`text-[10px] ${s.colorText} border-t border-white/5 pt-2 mt-1`}>
                            💡 {report.recommendation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Orchestrator section ── */}
        {(phase === PHASE.SYNTHESIZING || (phase === PHASE.DONE && allDone)) && (
          <div className={`border rounded-xl overflow-hidden tool-call-enter ${
            phase === PHASE.SYNTHESIZING ? 'border-violet-500/40 bg-violet-500/5' : 'border-[#30363d] bg-[#161b22]'
          }`}>
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
              <Cpu size={14} className="text-violet-400 shrink-0" />
              <span className="text-xs font-semibold text-violet-400">Orchestrator Agent</span>
              {phase === PHASE.SYNTHESIZING && (
                <span className="text-[10px] text-[#7a9cc0] ml-1">— synthesising all specialist reports...</span>
              )}
              {phase === PHASE.DONE && (
                <span className="text-[10px] text-[#7a9cc0] ml-1">— synthesis complete</span>
              )}
            </div>
            {phase === PHASE.SYNTHESIZING && (
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="spinner" style={{ borderTopColor: '#a78bfa' }} />
                <span className="text-xs text-violet-300">
                  Reading {SPECIALISTS.length} specialist reports and producing final verdict...
                </span>
              </div>
            )}
            {phase === PHASE.DONE && summary && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-[#7a9cc0]">
                  Verdict based on: {SPECIALISTS.filter(s => agentStates[s.id]?.report?.relevant !== false).map(s => s.name).join(', ')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Final verdict ── */}
        {summary && phase === PHASE.DONE && (
          <SummaryPanel summary={summary} elapsed={elapsed} alertId={alert.alert_id} />
        )}

        {/* ── Analyst actions ── */}
        {phase === PHASE.DONE && (
          <AnalystActions
            decision={analystDecision}
            aiVerdict={summary?.verdict}
            onAction={handleAnalystAction}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {escalationTicket && (
        <EscalationTicketModal ticket={escalationTicket} onClose={() => setEscalationTicket(null)} />
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (status === 'pending') return <span className="text-[9px] text-[#4a6080] px-1.5 py-0.5 rounded border border-[#21262d]">Waiting</span>;
  if (status === 'running') return (
    <span className="flex items-center gap-1 text-[9px] text-blue-400">
      <span className="spinner" style={{ width: 10, height: 10, borderTopColor: '#60a5fa' }} />
      Running
    </span>
  );
  if (status === 'done') return (
    <span className="flex items-center gap-1 text-[9px] text-green-400">
      <CheckCircle size={10} /> Done
    </span>
  );
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-[9px] text-red-400">
      <XCircle size={10} /> Error
    </span>
  );
  return null;
}
