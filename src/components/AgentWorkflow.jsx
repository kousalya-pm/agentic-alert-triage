import { useState, useEffect, useRef } from 'react';
import { useRunAutosave } from '../hooks/useRunAutosave.js';
import { Link } from 'react-router-dom';
import { Play, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle, HelpCircle, ArrowUpRight, Clock, ThumbsUp, ThumbsDown, TrendingUp, MessageSquare, User, FileDown, History, RotateCcw, Ticket, Copy, X, TrendingDown, Minus, Check } from 'lucide-react';
import { generateInvestigationPlan, generateFinalSummary } from '../services/aiService.js';
import { executeTool, TOOLS } from '../services/toolService.js';
import { exportTriageReport } from '../services/reportService.js';
import { saveRun, getRuns } from '../services/runHistoryService.js';
import { computeRiskLevel, oneLineSummary, RISK_LEVEL_CONFIG } from '../services/riskHeuristic.js';
import { saveInvestigation, buildInvestigationPayload, recordAnalystFeedback } from '../services/investigationClient.js';
import { getInsights } from '../services/insightsClient.js';
import SimilarCasesPanel from './SimilarCasesPanel.jsx';

export const DECISIONS_KEY = 'acme-soc-decisions';
const ACTIONS_KEY = 'acme-soc-action-checks';

function loadDecisions() {
  try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) || '{}'); } catch { return {}; }
}
function saveDecision(alertId, decision) {
  const all = loadDecisions();
  all[alertId] = decision;
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(all));
}

// ── Action-check helpers ──────────────────────────────────────────────────────
function loadActionChecks(alertId) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIONS_KEY) || '{}');
    return all[alertId] || {};
  } catch { return {}; }
}
function saveActionChecks(alertId, checks) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIONS_KEY) || '{}');
    all[alertId] = checks;
    localStorage.setItem(ACTIONS_KEY, JSON.stringify(all));
  } catch {}
}

const PHASE = { IDLE: 'idle', PLANNING: 'planning', INVESTIGATING: 'investigating', SYNTHESIZING: 'synthesizing', DONE: 'done', ERROR: 'error' };

export const VERDICT_CONFIG = {
  TRUE_POSITIVE:     { color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',    icon: XCircle,       label: 'True Positive' },
  FALSE_POSITIVE:    { color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',icon: CheckCircle,   label: 'False Positive' },
  NEEDS_ESCALATION:  { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30',icon: ArrowUpRight, label: 'Escalate' },
  INCONCLUSIVE:      { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30',icon: HelpCircle,   label: 'Inconclusive' },
};

export const PRIORITY_COLOR = { IMMEDIATE: 'text-red-400', SHORT_TERM: 'text-orange-400', MONITOR: 'text-blue-400' };

export default function AgentWorkflow({ alert, settings, onOpenSettings, onEntityClick, onRunningChange }) {
  // Guard: alert must be present and have required fields
  if (!alert) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#7a9cc0]">
        <div className="text-center">
          <p className="text-sm mb-2">No alert selected</p>
          <p className="text-xs text-[#4a6080]">Click an alert to begin triage</p>
        </div>
      </div>
    );
  }

  // If alert doesn't have required fields, show warning but try to render
  const alertId = alert?.alert_id || alert?.id;
  if (!alertId) {
    console.error('Alert missing alert_id:', alert);
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        <div className="text-center">
          <p className="text-sm mb-2">Invalid alert structure</p>
          <p className="text-xs text-red-300">{JSON.stringify(alert).substring(0, 100)}</p>
        </div>
      </div>
    );
  }

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [plan, setPlan] = useState(null);
  const [stepResults, setStepResults] = useState([]);
  const [activeStep, setActiveStep] = useState(-1);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [elapsed, setElapsed] = useState(0);
  const [riskLabel, setRiskLabel] = useState('UNKNOWN');
  const [analystDecision, setAnalystDecision] = useState(() => loadDecisions()[alert.alert_id] || null);
  const [insights, setInsights] = useState(null);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  // Notify parent when this workflow starts/stops running so the mode selector can lock
  const isRunningNow = phase === PHASE.PLANNING || phase === PHASE.INVESTIGATING || phase === PHASE.SYNTHESIZING;
  useEffect(() => {
    onRunningChange?.(isRunningNow);
    return () => onRunningChange?.(false); // release lock when unmounted
  }, [isRunningNow, onRunningChange]);
  const [runHistory, setRunHistory] = useState(() => getRuns(alert.alert_id, 'standard'));
  const [viewingRunId, setViewingRunId] = useState(null);
  const [escalationTicket, setEscalationTicket] = useState(null);
  const startTime = useRef(null);
  const timerRef = useRef(null);
  const bottomRef = useRef(null);

  const refreshHistory = () => setRunHistory(getRuns(alert.alert_id, 'standard'));

  // Auto-save run at any stage (replaces separate auto-save + cleanup effects)
  useRunAutosave({
    alertId: alert.alert_id,
    mode: 'standard',
    plan,
    stepResults,
    summary,
    startTimeRef: startTime,
  });

  const loadHistoricalRun = (run) => {
    setPlan(run.plan);
    setStepResults(run.stepResults);
    setSummary(run.summary);
    setElapsed(run.elapsed);
    setPhase(PHASE.DONE);
    setError(null);
    setActiveStep(-1);
    setExpandedSteps({});
    setViewingRunId(run.runId);
    setAnalystDecision(loadDecisions()[alert.alert_id] || null);
    // Recompute risk label from stored results
    if (run.plan?.investigation_steps && run.stepResults) {
      const toolResults = run.stepResults.map((r, j) => ({ tool: run.plan.investigation_steps[j]?.tool, result: r }));
      setRiskLabel(computeRiskLevel(toolResults));
    }
  };

  const startNewRun = () => {
    setViewingRunId(null);
    setPhase(PHASE.IDLE);
    setPlan(null);
    setStepResults([]);
    setSummary(null);
    setError(null);
    setExpandedSteps({});
    setElapsed(0);
    setRiskLabel('UNKNOWN');
  };

  const handleAnalystAction = async (action, note = '') => {
    if (!action) {
      // Undo
      saveDecision(alert.alert_id, null);
      setAnalystDecision(null);
      setEscalationTicket(null);
      window.dispatchEvent(new Event('soc-decisions-updated'));
      return;
    }
    const decision = {
      action,
      note,
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

    // Record feedback to improve learning (v1.1)
    try {
      const decisionMap = { tp: 'TP', fp: 'FP', escalate: 'Escalate', confirm_tp: 'TP', mark_fp: 'FP' };
      const analystDecision = decisionMap[action] || action;

      // Find the investigation timestamp from run history
      if (runHistory.length > 0) {
        const latestRun = runHistory[0];
        await recordAnalystFeedback(alert.alert_id, latestRun.timestamp, analystDecision);
        console.log('[v1.1] Analyst feedback recorded:', { alertId: alert.alert_id, decision: analystDecision });
      }
    } catch (err) {
      console.warn('[v1.1] Failed to record feedback:', err);
      // Don't block UX if feedback recording fails
    }

    if (action === 'escalate') {
      const num = 100 + parseInt(alert.alert_id?.replace(/\D/g, '') || '0', 10);
      const priority = { Critical: 'P1 — Critical', High: 'P2 — High', Medium: 'P3 — Medium', Low: 'P4 — Low' }[alert.severity] || 'P2 — High';
      setEscalationTicket({
        ticketId: `INC-2024-${num}`,
        priority,
        title: alert.title,
        alertId: alert.alert_id,
        assignedTo: 'IR Team / Tier 2 SOC',
        createdAt: new Date().toISOString(),
        verdict: summary?.verdict,
        riskScore: summary?.risk_score,
        mitre: summary?.mitre_assessment,
        escalationReason: summary?.escalation_reason || note || 'Manual escalation by analyst',
        analystNote: note,
        executiveSummary: summary?.executive_summary,
      });
    }
  };

  useEffect(() => {
    if (phase !== PHASE.IDLE && phase !== PHASE.DONE && phase !== PHASE.ERROR) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stepResults, phase]);

  const toggleStep = (i) => setExpandedSteps(prev => ({ ...prev, [i]: !prev[i] }));

  const runTriage = async () => {
    if (!settings?.anthropicKey && !settings?.openaiKey) {
      setError('No AI API key configured. Please add your Anthropic or OpenAI key in Settings.');
      setPhase(PHASE.ERROR);
      return;
    }

    setPhase(PHASE.PLANNING);
    setPlan(null);
    setStepResults([]);
    setActiveStep(-1);
    setSummary(null);
    setError(null);
    setExpandedSteps({});
    setElapsed(0);
    setRiskLabel('UNKNOWN');
    setAnalystDecision(null);
    startTime.current = Date.now();

    try {
      // ── Fetch insights for historical learning (v1.1) ──
      const fetchedInsights = await getInsights();
      setInsights(fetchedInsights);
      console.log('[v1.1] Fetched insights:', fetchedInsights);

      // ── Phase 1: Generate investigation plan ──
      const investigationPlan = await generateInvestigationPlan(alert, settings, fetchedInsights);
      console.log('[v1.1] Investigation plan rationale:', investigationPlan.investigation_steps?.[0]?.rationale);
      setPlan(investigationPlan);
      setPhase(PHASE.INVESTIGATING);

      // ── Phase 2: Execute each tool call sequentially ──
      const results = [];
      for (let i = 0; i < investigationPlan.investigation_steps.length; i++) {
        setActiveStep(i);
        const step = investigationPlan.investigation_steps[i];
        const result = await executeTool(step.tool, step.parameters, settings);
        results.push(result);
        setStepResults([...results]);
        // Update live risk label after each tool completes
        const toolResults = results.map((r, j) => ({ tool: investigationPlan.investigation_steps[j].tool, result: r }));
        setRiskLabel(computeRiskLevel(toolResults));
        // Small delay for visual effect
        await new Promise(r => setTimeout(r, 300));
      }
      setActiveStep(-1);

      // ── Phase 3: Synthesize final verdict ──
      setPhase(PHASE.SYNTHESIZING);
      const finalSummary = await generateFinalSummary(alert, investigationPlan, results, settings);
      setSummary(finalSummary);
      setPhase(PHASE.DONE);
      clearInterval(timerRef.current);
      const finalElapsed = Math.floor((Date.now() - startTime.current) / 1000);
      saveRun(alert.alert_id, { plan: investigationPlan, stepResults: results, summary: finalSummary, elapsed: finalElapsed, mode: 'standard' });

      // Save investigation to history (v1.1)
      try {
        const payload = buildInvestigationPayload(alert, 'standard', finalSummary, finalElapsed, investigationPlan);
        await saveInvestigation(payload);
      } catch (err) {
        console.warn('Failed to save investigation to history:', err);
      }

      refreshHistory();

    } catch (err) {
      setError(err.message);
      setPhase(PHASE.ERROR);
      clearInterval(timerRef.current);
    }
  };

  const SEV_COLOR = { Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-blue-400' };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Alert header bar */}
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
              {alert.user_id && (
                <button
                  onClick={() => onEntityClick?.('user', alert.user_id)}
                  className="hover:text-[#00d4ff] transition-colors"
                >👤 {alert.user_id}</button>
              )}
              {alert.hostname && (
                <button
                  onClick={() => onEntityClick?.('asset', alert.hostname)}
                  className="hover:text-[#00d4ff] transition-colors"
                >💻 {alert.hostname}</button>
              )}
              {alert.src_ip && <span>📡 {alert.src_ip}</span>}
              {alert.mitre_tactic && <span>🎯 {alert.mitre_tactic} · {alert.mitre_technique}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Live risk label — shown when running or done */}
            {(phase !== PHASE.IDLE || viewingRunId) && (
              <RiskLevelBadge level={phase === PHASE.DONE || viewingRunId ? riskLabel : riskLabel} showScore={phase === PHASE.DONE || !!viewingRunId} aiScore={summary?.risk_score} />
            )}
            {phase !== PHASE.IDLE && !viewingRunId && (
              <span className="text-xs text-[#7a9cc0] font-mono">{elapsed}s</span>
            )}
            {phase === PHASE.DONE && summary && (
              <button
                onClick={() => exportTriageReport({ alert, plan, stepResults, summary, analystDecision, elapsed })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#1e2d4a] hover:border-[#2a3f63] text-[#7a9cc0] hover:text-white transition-colors"
                title="Export triage report as PDF"
              >
                <FileDown size={13} /> Export PDF
              </button>
            )}
            {viewingRunId ? (
              <button
                onClick={startNewRun}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f1629] border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors"
              >
                <RotateCcw size={12} /> New Run
              </button>
            ) : (
              <button
                onClick={runTriage}
                disabled={phase === PHASE.PLANNING || phase === PHASE.INVESTIGATING || phase === PHASE.SYNTHESIZING}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#00d4ff] hover:bg-[#00b8d9] text-[#0a0f1e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {phase === PHASE.IDLE || phase === PHASE.DONE || phase === PHASE.ERROR ? (
                  <><Play size={12} /> {phase === PHASE.DONE || phase === PHASE.ERROR ? 'Re-run Triage' : 'Run AI Triage'}</>
                ) : (
                  <><span className="spinner" /> Investigating...</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Run history bar */}
      {runHistory.length > 0 && (
        <RunHistoryBar
          runs={runHistory}
          viewingRunId={viewingRunId}
          onLoad={loadHistoricalRun}
          onNewRun={startNewRun}
          isRunning={phase === PHASE.PLANNING || phase === PHASE.INVESTIGATING || phase === PHASE.SYNTHESIZING}
        />
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* IDLE state */}
        {phase === PHASE.IDLE && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <button
              onClick={runTriage}
              className="w-12 h-12 rounded-xl bg-[#00d4ff]/10 border border-[#00d4ff]/20 flex items-center justify-center hover:bg-[#00d4ff]/20 hover:border-[#00d4ff]/40 transition-colors"
              title="Run AI Triage"
            >
              <Play size={20} className="text-[#00d4ff]" />
            </button>
            <p className="text-sm text-[#7a9cc0]">Click the button or <strong className="text-white">Run AI Triage</strong> above to start the autonomous investigation</p>
            {runHistory.length > 0 && (
              <button
                onClick={() => loadHistoricalRun(runHistory[0])}
                className="flex items-center gap-1.5 text-xs text-[#7a9cc0] hover:text-[#00d4ff] transition-colors underline underline-offset-2"
              >
                <History size={12} /> or load latest run ({formatAge(runHistory[0].timestamp)})
              </button>
            )}
          </div>
        )}

        {/* ERROR state */}
        {phase === PHASE.ERROR && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
            <div className="flex items-center gap-2 mb-2 font-semibold text-red-400">
              <AlertTriangle size={15} /> Investigation Error
            </div>
            {error}
            {error?.includes('API key') && (
              <button onClick={onOpenSettings} className="mt-3 block text-xs underline text-red-400 hover:text-red-300">
                Open Settings →
              </button>
            )}
          </div>
        )}

        {/* Planning phase */}
        {(phase === PHASE.PLANNING) && (
          <div className="p-4 bg-[#161b22] border border-[#30363d] rounded-xl">
            <div className="flex items-center gap-2 text-sm text-[#8b949e]">
              <span className="spinner" />
              <span>AI agent is analyzing the alert and building investigation plan...</span>
            </div>
          </div>
        )}

        {/* Historical Learning Context (v1.1) */}
        {insights && insights.total_investigations > 0 && (
          <div className="p-4 bg-[#0d1f2a] border border-[#1e4d5c] rounded-xl">
            <button
              onClick={() => setInsightsExpanded(!insightsExpanded)}
              className="w-full flex items-start justify-between gap-3 text-left"
            >
              <div className="flex-1">
                <h3 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">📊 Historical Learning Active</h3>
                <p className="text-sm text-[#e2eaf5]">
                  Agent using insights from <strong>{insights.total_investigations}</strong> past investigations
                  {insights.overall_accuracy !== null && ` • Overall accuracy: ${Math.round(insights.overall_accuracy * 100)}%`}
                </p>
              </div>
              <div className="text-[#7a9cc0] shrink-0">
                {insightsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
            </button>

            {insightsExpanded && (
              <div className="mt-3 space-y-2 pt-3 border-t border-[#1e4d5c]">
                {/* Top tools */}
                {insights.top_tools && insights.top_tools.length > 0 && (
                  <div>
                    <p className="text-xs text-[#7a9cc0] font-semibold mb-1">Most Effective Tools:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {insights.top_tools.slice(0, 5).map((t, i) => (
                        <span key={i} className="text-xs px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-cyan-300">
                          {t.tool}: {Math.round(t.accuracy * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mode performance */}
                {insights.mode_performance && (
                  <div>
                    <p className="text-xs text-[#7a9cc0] font-semibold mb-1">Workflow Performance:</p>
                    <div className="space-y-1">
                      {['standard', 'adaptive', 'parallel', 'chain'].map(mode => {
                        const perf = insights.mode_performance[mode];
                        if (!perf || perf.total_runs === 0) return null;
                        return (
                          <div key={mode} className="text-xs text-[#8b949e]">
                            <span className="capitalize font-medium text-[#e2eaf5]">{mode}:</span> {perf.total_runs} runs • {perf.accuracy ? `${Math.round(perf.accuracy * 100)}% accurate` : 'pending'} • {perf.avg_time_sec}s avg
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Investigation plan */}
        {plan && (
          <div className="p-4 bg-[#161b22] border border-[#30363d] rounded-xl tool-call-enter">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Agent Assessment</h3>
                <p className="text-sm text-white">{plan.alert_summary}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full border shrink-0 ${
                plan.initial_risk_assessment === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                plan.initial_risk_assessment === 'HIGH' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                plan.initial_risk_assessment === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                'bg-blue-500/10 text-blue-400 border-blue-500/30'
              }`}>
                Initial: {plan.initial_risk_assessment}
              </span>
            </div>
            {plan.key_concerns?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {plan.key_concerns.map((c, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-[#0d1117] border border-[#30363d] rounded-full text-[#8b949e]">⚠ {c}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step-by-step tool calls */}
        {plan?.investigation_steps?.map((step, i) => (
          <ToolStepCard
            key={i}
            step={step}
            index={i}
            isActive={activeStep === i}
            isDone={i < stepResults.length}
            isExpanded={!!expandedSteps[i]}
            result={stepResults[i]}
            onToggle={() => toggleStep(i)}
          />
        ))}

        {/* Synthesizing */}
        {phase === PHASE.SYNTHESIZING && (
          <div className="p-4 bg-[#161b22] border border-blue-500/30 rounded-xl tool-call-enter">
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <span className="spinner" />
              <span>Synthesizing all evidence into final verdict...</span>
            </div>
          </div>
        )}

        {/* Final Summary */}
        {summary && phase === PHASE.DONE && (
          <SummaryPanel summary={summary} elapsed={elapsed} alertId={alert.alert_id} />
        )}

        {/* Similar past cases (same category) */}
        {phase === PHASE.DONE && <SimilarCasesPanel alert={alert} />}

        {/* Analyst Action Buttons */}
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
        <EscalationTicketModal
          ticket={escalationTicket}
          onClose={() => setEscalationTicket(null)}
        />
      )}
    </div>
  );
}

// ─── Escalation Ticket Modal ──────────────────────────────────────────────────
export function EscalationTicketModal({ ticket, onClose }) {
  const [copied, setCopied] = useState(false);

  const copyTicketId = () => {
    navigator.clipboard.writeText(ticket.ticketId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const PRIORITY_COLOR = {
    'P1 — Critical': 'text-red-400 bg-red-500/10 border-red-500/40',
    'P2 — High':     'text-orange-400 bg-orange-500/10 border-orange-500/40',
    'P3 — Medium':   'text-yellow-400 bg-yellow-500/10 border-yellow-500/40',
    'P4 — Low':      'text-blue-400 bg-blue-500/10 border-blue-500/40',
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0f1e]/80 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-[#0f1629] border border-[#1e2d4a] rounded-2xl shadow-2xl overflow-hidden tool-call-enter">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2d4a] bg-orange-500/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
              <Ticket size={18} className="text-orange-400" />
            </div>
            <div>
              <div className="text-xs text-[#7a9cc0] uppercase tracking-wider">Escalation Ticket Created</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white font-mono">{ticket.ticketId}</span>
                <button
                  onClick={copyTicketId}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[#1e2d4a] text-[#7a9cc0] hover:text-[#00d4ff] hover:border-[#00d4ff]/40 transition-colors"
                >
                  <Copy size={9} /> {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#7a9cc0] hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Ticket body */}
        <div className="px-5 py-4 space-y-3">
          {/* Status + priority row */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/30 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              Escalated — Awaiting Tier 2
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${PRIORITY_COLOR[ticket.priority] || PRIORITY_COLOR['P2 — High']}`}>
              {ticket.priority}
            </span>
          </div>

          {/* Title */}
          <div>
            <div className="text-[10px] text-[#7a9cc0] uppercase tracking-wider mb-0.5">Alert</div>
            <div className="text-sm text-white font-medium leading-snug">{ticket.title}</div>
          </div>

          {/* Key fields grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <TicketRow label="Alert ID"     value={ticket.alertId} mono />
            <TicketRow label="Assigned To"  value={ticket.assignedTo} />
            <TicketRow label="AI Verdict"   value={ticket.verdict?.replace(/_/g, ' ')} highlight={ticket.verdict === 'TRUE_POSITIVE' ? 'red' : 'orange'} />
            <TicketRow label="Risk Score"   value={ticket.riskScore != null ? `${ticket.riskScore}/10` : '—'} highlight={ticket.riskScore >= 7 ? 'red' : 'yellow'} />
            {ticket.mitre && (
              <TicketRow label="MITRE"      value={`${ticket.mitre.technique} · ${ticket.mitre.tactic}`} />
            )}
            <TicketRow label="Created"      value={new Date(ticket.createdAt).toLocaleString()} />
          </div>

          {/* Escalation reason */}
          {ticket.escalationReason && (
            <div className="p-3 bg-[#0a0f1e] border border-[#1e2d4a] rounded-lg">
              <div className="text-[10px] text-[#7a9cc0] uppercase tracking-wider mb-1">Escalation Reason</div>
              <p className="text-xs text-[#e2eaf5] leading-relaxed">{ticket.escalationReason}</p>
            </div>
          )}

          {/* Analyst note */}
          {ticket.analystNote && (
            <div className="p-3 bg-[#0a0f1e] border border-[#1e2d4a] rounded-lg">
              <div className="text-[10px] text-[#7a9cc0] uppercase tracking-wider mb-1">Analyst Note</div>
              <p className="text-xs text-[#e2eaf5] italic">"{ticket.analystNote}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e2d4a] flex items-center justify-between bg-[#0a0f1e]/40">
          <span className="text-[10px] text-[#7a9cc0]">Simulated · ServiceNow ITSM</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-[#00d4ff] hover:bg-[#00b8d9] text-[#0a0f1e] rounded-lg transition-colors"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}

export function TicketRow({ label, value, mono, highlight }) {
  const color = highlight === 'red' ? 'text-red-400' : highlight === 'orange' ? 'text-orange-400' :
    highlight === 'yellow' ? 'text-yellow-400' : 'text-[#e2eaf5]';
  return (
    <div>
      <div className="text-[10px] text-[#7a9cc0] mb-0.5">{label}</div>
      <div className={`${color} ${mono ? 'font-mono' : ''} text-xs`}>{value || '—'}</div>
    </div>
  );
}

// ─── Run History Bar ─────────────────────────────────────────────────────────
export const VERDICT_SHORT = {
  TRUE_POSITIVE:    { label: 'TP',  color: 'text-red-400 border-red-500/40 bg-red-500/10' },
  FALSE_POSITIVE:   { label: 'FP',  color: 'text-green-400 border-green-500/40 bg-green-500/10' },
  NEEDS_ESCALATION: { label: 'ESC', color: 'text-orange-400 border-orange-500/40 bg-orange-500/10' },
  INCONCLUSIVE:     { label: '?',   color: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10' },
};

export function RunHistoryBar({ runs, viewingRunId, onLoad, onNewRun, isRunning }) {
  return (
    <div className="shrink-0 px-5 py-2 border-b border-[#1e2d4a] bg-[#0a0f1e] flex items-center gap-2 overflow-x-auto">
      <div className="flex items-center gap-1.5 text-[10px] text-[#7a9cc0] shrink-0">
        <History size={11} />
        <span className="uppercase tracking-wider font-semibold">Run History</span>
      </div>
      <div className="w-px h-4 bg-[#1e2d4a] shrink-0" />
      <div className="flex items-center gap-1.5">
        {runs.map((run, i) => {
          const vc = VERDICT_SHORT[run.verdict] || VERDICT_SHORT.INCONCLUSIVE;
          const isActive = viewingRunId === run.runId;
          const age = formatAge(run.timestamp);
          return (
            <button
              key={run.runId}
              onClick={() => isActive ? null : onLoad(run)}
              disabled={isRunning}
              title={`Run ${runs.length - i}: ${run.verdict} · ${run.elapsed}s · ${new Date(run.timestamp).toLocaleString()}`}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors shrink-0 ${
                isActive
                  ? `${vc.color} ring-1 ring-[#00d4ff]/40`
                  : `${vc.color} opacity-70 hover:opacity-100`
              } disabled:cursor-not-allowed`}
            >
              <span className="font-bold">{vc.label}</span>
              <span className="text-[#7a9cc0]">·</span>
              <span className="font-mono">{run.elapsed}s</span>
              <span className="text-[#7a9cc0]">·</span>
              <span className="text-[#7a9cc0]">{age}</span>
              {i === 0 && !isActive && <span className="ml-0.5 text-[#00d4ff] opacity-70">latest</span>}
            </button>
          );
        })}
      </div>
      {viewingRunId && (
        <>
          <div className="w-px h-4 bg-[#1e2d4a] shrink-0" />
          <button
            onClick={onNewRun}
            disabled={isRunning}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#00d4ff]/30 text-[#00d4ff] text-[10px] font-medium hover:bg-[#00d4ff]/10 transition-colors shrink-0"
          >
            <RotateCcw size={10} /> New Run
          </button>
        </>
      )}
    </div>
  );
}

export function formatAge(timestamp) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Shared Tool Step Card ────────────────────────────────────────────────────
/**
 * Renders a single investigation step — collapsed by default, expands on click.
 *
 * Props:
 *   step       — { tool, question, rationale, parameters, dynamic? }
 *   index      — step number (0-based)
 *   isActive   — currently executing
 *   isDone     — result is available
 *   isExpanded — user toggled open
 *   result     — raw tool result object (may be null while pending/running)
 *   onToggle   — called when the header row is clicked
 *   isDynamic  — (Adaptive mode) cyan accent + "Added by agent" banner
 */
export function ToolStepCard({ step, index, isActive, isDone, isExpanded, result, onToggle, isDynamic = false }) {
  const toolMeta = TOOLS[step.tool] || {};

  const borderBg = isDynamic
    ? isActive ? 'border-cyan-500/60 bg-[#0d1f24]'
      : isDone ? 'border-cyan-500/30 bg-[#0d1a1f]'
      :          'border-cyan-500/15 bg-[#0d1117] opacity-60'
    : isActive  ? 'border-blue-500/50 bg-[#1c2128]'
    : isDone    ? 'border-[#30363d] bg-[#161b22]'
    :             'border-[#21262d] bg-[#0d1117] opacity-50';

  const iconBg = isActive        ? 'bg-blue-500/20 text-blue-400'
    : isDone && isDynamic        ? 'bg-cyan-500/20 text-cyan-400'
    : isDone                     ? 'bg-green-500/20 text-green-400'
    :                              'bg-[#30363d] text-[#8b949e]';

  return (
    <div className={`border rounded-xl overflow-hidden transition-all tool-call-enter ${borderBg}`}>

      {/* Dynamic step badge — Adaptive mode only */}
      {isDynamic && (
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0">
          <span className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider">✦ Added by agent</span>
          <span className="text-[10px] text-[#7a9cc0]">— {step.rationale?.split('.')[0]}</span>
        </div>
      )}

      {/* Header row — always visible, click to expand/collapse */}
      <button
        onClick={() => isDone && onToggle()}
        className="w-full flex items-start gap-3 p-3 text-left"
      >
        {/* Status icon */}
        <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${iconBg}`}>
          {isActive ? <span className="spinner" style={{ width: 12, height: 12 }} /> : isDone ? '✓' : index + 1}
        </div>

        {/* Tool label + summary line */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{toolMeta.icon || '🔧'}</span>
            <span className="text-xs font-semibold text-white">{toolMeta.label || step.tool}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              toolMeta.category === 'external'
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                : 'bg-green-500/10 text-green-400 border-green-500/20'
            }`}>{toolMeta.category === 'external' ? 'External' : 'Internal'}</span>
          </div>
          {/* Collapsed: 1-line result summary. Pending/active: the question. */}
          {isDone && !isExpanded && result ? (
            <p className="text-xs text-[#7a9cc0] mt-0.5 truncate">{oneLineSummary(step.tool, result)}</p>
          ) : (
            <>
              <p className="text-xs text-[#8b949e] mt-0.5 italic truncate">"{step.question}"</p>
              {step.rationale && (
                <p className="text-xs text-[#7a9cc0] mt-1 leading-relaxed">{step.rationale}</p>
              )}
            </>
          )}
        </div>

        {/* Chevron */}
        {isDone && (
          <div className="shrink-0 text-[#7a9cc0]">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        )}
      </button>

      {/* Params bar — only when running or expanded */}
      {(isActive || (isDone && isExpanded)) && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {Object.entries(step.parameters || {}).map(([k, v]) => (
            <span key={k} className="font-mono text-[10px] px-2 py-0.5 bg-[#0d1117] border border-[#30363d] rounded text-[#8b949e]">
              <span className="text-blue-400">{k}</span>=<span className="text-orange-300">{String(v)}</span>
            </span>
          ))}
          {result?.duration_ms && (
            <span className="text-[10px] text-[#7a9cc0] ml-auto flex items-center gap-0.5">
              <Clock size={10} />{result.duration_ms}ms
            </span>
          )}
        </div>
      )}

      {/* Expanded result panel */}
      {isDone && isExpanded && result && (
        <div className="px-3 pb-3">
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
            {result.simulated && (
              <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 mb-2">
                <AlertTriangle size={10} /> Simulated response — add API key for real data
              </div>
            )}
            <ResultDisplay toolName={step.tool} result={result} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Risk Level Badge ─────────────────────────────────────────────────────────

/** Derive a qualitative label from the AI's 0–10 score, used once the run is done. */
function aiScoreToLevel(score) {
  if (score == null) return null;
  if (score >= 8) return 'CRITICAL';
  if (score >= 5) return 'ELEVATED';
  if (score >= 2) return 'SUSPICIOUS';
  return 'UNKNOWN';
}

/**
 * Displays a qualitative risk label that updates live during a run.
 * Once done (showScore=true + aiScore provided), the label is derived from the
 * AI score so heuristic and AI verdict never contradict each other.
 */
export function RiskLevelBadge({ level = 'UNKNOWN', showScore = false, aiScore = null }) {
  // When the run is complete and the AI returned a score, override the heuristic label
  const displayLevel = (showScore && aiScore != null) ? (aiScoreToLevel(aiScore) || level) : level;
  const cfg = RISK_LEVEL_CONFIG[displayLevel] || RISK_LEVEL_CONFIG.UNKNOWN;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span>{cfg.label}</span>
      {showScore && aiScore != null && (
        <span className="text-[10px] opacity-70 font-mono">· {aiScore}/10</span>
      )}
    </div>
  );
}

// ─── Analyst Action Buttons ───────────────────────────────────────────────────
export function AnalystActions({ decision, aiVerdict, onAction }) {
  const [showNoteFor, setShowNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const noteRef = useRef(null);

  useEffect(() => {
    if (showNoteFor) noteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [showNoteFor]);

  const submit = (action) => {
    onAction(action, note.trim());
    setShowNoteFor(null);
    setNote('');
  };

  const ACTIONS = [
    {
      id: 'confirm_tp',
      label: 'Confirm True Positive',
      sub: 'Agree with AI — this is a real threat',
      icon: ThumbsDown,
      color: 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20',
      activeColor: 'bg-red-500/20 border-red-500 text-red-300',
      recommended: aiVerdict === 'TRUE_POSITIVE' || aiVerdict === 'NEEDS_ESCALATION',
      immediate: false,
    },
    {
      id: 'mark_fp',
      label: 'Mark False Positive',
      sub: 'Legitimate activity — close this alert',
      icon: ThumbsUp,
      color: 'bg-green-500/10 border-green-500/40 text-green-400 hover:bg-green-500/20',
      activeColor: 'bg-green-500/20 border-green-500 text-green-300',
      recommended: aiVerdict === 'FALSE_POSITIVE',
      immediate: false,
    },
    {
      id: 'escalate',
      label: 'Escalate',
      sub: 'Create ticket → Tier 2 / IR team',
      icon: TrendingUp,
      color: 'bg-orange-500/10 border-orange-500/40 text-orange-400 hover:bg-orange-500/20',
      activeColor: 'bg-orange-500/20 border-orange-500 text-orange-300',
      recommended: aiVerdict === 'NEEDS_ESCALATION',
      immediate: false,
    },
  ];

  // Already decided — show the recorded decision
  if (decision) {
    const cfg = ACTIONS.find(a => a.id === decision.action);
    const IIcon = cfg?.icon || CheckCircle;
    return (
      <div className={`rounded-xl border p-4 tool-call-enter ${
        decision.action === 'confirm_tp' ? 'bg-red-500/10 border-red-500/30' :
        decision.action === 'mark_fp'    ? 'bg-green-500/10 border-green-500/30' :
                                           'bg-orange-500/10 border-orange-500/30'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <IIcon size={18} className={
              decision.action === 'confirm_tp' ? 'text-red-400 shrink-0 mt-0.5' :
              decision.action === 'mark_fp'    ? 'text-green-400 shrink-0 mt-0.5' :
                                                 'text-orange-400 shrink-0 mt-0.5'
            } />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white">{cfg?.label}</span>
                {decision.action === 'escalate' && decision.ticketId && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded font-mono">{decision.ticketId}</span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-[#7a9cc0] rounded">Decision Recorded</span>
              </div>
              {decision.note && (
                <p className="text-xs text-[#7a9cc0] mt-1 italic">"{decision.note}"</p>
              )}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-[#7a9cc0]">
                <User size={10} />{decision.analyst}
                <span>·</span>
                <span>{new Date(decision.timestamp).toLocaleString()}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => onAction(null)}
            className="text-[10px] text-[#7a9cc0] hover:text-white underline shrink-0"
          >
            Undo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#1e2d4a] bg-[#0f1629] p-4 tool-call-enter">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} className="text-[#7a9cc0]" />
        <h3 className="text-xs font-semibold text-[#7a9cc0] uppercase tracking-wider">Analyst Decision</h3>
        <span className="text-[10px] text-[#7a9cc0]">— override or confirm the AI verdict</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {ACTIONS.map(a => {
          const AIcon = a.icon;
          const isActive = showNoteFor === a.id;
          return (
            <button
              key={a.id}
              onClick={() => {
                if (a.immediate) {
                  onAction(a.id, '');
                } else {
                  setShowNoteFor(isActive ? null : a.id);
                  setNote('');
                }
              }}
              className={`relative flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all ${
                isActive ? a.activeColor : a.color
              }`}
            >
              {a.recommended && (
                <span className="absolute -top-2 left-2 text-[9px] px-1.5 py-0.5 bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 rounded-full">AI suggests</span>
              )}
              <AIcon size={15} className="shrink-0" />
              <span className="text-xs font-semibold leading-snug">{a.label}</span>
              <span className="text-[10px] opacity-70 leading-snug">{a.sub}</span>
            </button>
          );
        })}
      </div>

      {showNoteFor && (
        <div ref={noteRef} className="space-y-2 tool-call-enter">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add analyst notes (optional)..."
            rows={2}
            className="w-full bg-[#0a0f1e] border border-[#1e2d4a] rounded-lg px-3 py-2 text-xs text-[#e2eaf5] placeholder-[#2a3f63] focus:outline-none focus:border-[#00d4ff]/60 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => submit(showNoteFor)}
              className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Confirm & Record Decision
            </button>
            <button
              onClick={() => { setShowNoteFor(null); setNote(''); }}
              className="px-3 py-1.5 text-xs text-[#8b949e] hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Result display ───────────────────────────────────────────────────────────
export function ResultDisplay({ toolName, result }) {
  if (result?.error) {
    return <p className="text-xs text-red-400">Error: {result.error}</p>;
  }

  // User lookup
  if (toolName === 'user_lookup') {
    if (!result.found) return <p className="text-xs text-[#8b949e]">User not found: {result.user_id}</p>;
    return (
      <div className="space-y-1.5">
        <Row label="Name" value={result.full_name} />
        <Row label="Dept / Title" value={`${result.department} — ${result.title}`} />
        <Row label="Manager" value={result.manager} />
        <Row label="Status" value={result.status} highlight={result.status !== 'active' ? 'red' : 'green'} />
        <Row label="Risk Score" value={`${result.risk_score}/100`} highlight={result.risk_score > 60 ? 'red' : result.risk_score > 30 ? 'yellow' : 'green'} />
        <Row label="MFA" value={result.mfa_enabled} highlight={result.mfa_enabled === 'yes' ? 'green' : 'red'} />
        <Row label="Last Login" value={`${result.last_login_location} · ${result.last_login}`} />
        {result.notes && <Row label="Notes" value={result.notes} highlight="yellow" />}
      </div>
    );
  }

  // Asset lookup
  if (toolName === 'asset_lookup') {
    if (!result.found) return <p className="text-xs text-[#8b949e]">Asset not found: {result.hostname}</p>;
    return (
      <div className="space-y-1.5">
        <Row label="Asset" value={`${result.hostname} (${result.type})`} />
        <Row label="OS" value={result.os} />
        <Row label="Criticality" value={result.criticality} highlight={result.criticality === 'Critical' ? 'red' : result.criticality === 'High' ? 'orange' : 'green'} />
        <Row label="Patch Level" value={result.patch_level} highlight={parseInt(result.patch_level) < 90 ? 'yellow' : 'green'} />
        <Row label="EDR" value={result.edr_installed} highlight={result.edr_installed !== 'No' ? 'green' : 'red'} />
        <Row label="Critical Vulns" value={result.open_vulns_critical} highlight={result.open_vulns_critical > 0 ? 'red' : 'green'} />
        {result.notes && <Row label="Notes" value={result.notes} highlight="yellow" />}
      </div>
    );
  }

  // SIEM query
  if (toolName === 'siem_query') {
    if (result.total_results === 0) return <p className="text-xs text-green-400">✓ No prior related alerts found</p>;
    return (
      <div className="space-y-2">
        <p className="text-xs text-orange-400 font-medium">{result.total_results} prior alert(s) found for this user/IP</p>
        {result.alerts?.map((a, i) => (
          <div key={i} className="text-xs border border-[#30363d] rounded p-2 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${a.verdict === 'True Positive' ? 'text-red-400' : 'text-green-400'}`}>{a.verdict}</span>
              <Link to={`/alerts/${a.alert_id}`} className="text-[#00d4ff] hover:text-white transition-colors font-mono">{a.alert_id}</Link>
              <span className="text-[#7a9cc0]">{new Date(a.timestamp).toLocaleDateString()}</span>
            </div>
            <div className="text-[#8b949e]">{a.title}</div>
            <div className="text-[#7a9cc0] italic">{a.analyst_notes}</div>
          </div>
        ))}
      </div>
    );
  }

  // Watchlist
  if (toolName === 'watchlist_check') {
    if (!result.matched) return <p className="text-xs text-green-400">✓ Indicator not on internal watchlist</p>;
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-400 font-medium">⚠ {result.hits.length} watchlist hit(s) for: {result.indicator}</p>
        {result.hits?.map((h, i) => (
          <div key={i} className="text-xs border border-red-500/30 bg-red-500/5 rounded p-2 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-red-400 font-medium">{h.confidence} Confidence</span>
              <span className="text-[#8b949e]">{h.threat_category}</span>
            </div>
            <div className="text-[#8b949e]">{h.description}</div>
            <div className="text-[#7a9cc0]">Source: {h.source}</div>
          </div>
        ))}
      </div>
    );
  }

  // IP geo
  if (toolName === 'ip_geo' || toolName === 'whois') {
    const d = result.data || result;
    return (
      <div className="space-y-1.5">
        {d.country && <Row label="Location" value={`${d.city || ''} ${d.regionName || ''}, ${d.country} ${d.countryCode ? `(${d.countryCode})` : ''}`} highlight={['RU','CN','KP','IR','BY'].includes(d.countryCode) ? 'red' : 'green'} />}
        {d.isp && <Row label="ISP" value={d.isp} />}
        {d.org && <Row label="Org" value={d.org} />}
        {d.as && <Row label="ASN" value={d.as} />}
        {d.query && <Row label="IP" value={d.query} />}
      </div>
    );
  }

  // AbuseIPDB
  if (toolName === 'abuseipdb') {
    const d = result.data || {};
    return (
      <div className="space-y-1.5">
        <Row label="Abuse Score" value={`${d.abuseConfidenceScore}%`} highlight={d.abuseConfidenceScore > 50 ? 'red' : d.abuseConfidenceScore > 10 ? 'yellow' : 'green'} />
        <Row label="Total Reports" value={d.totalReports} />
        <Row label="Distinct Reporters" value={d.numDistinctUsers} />
        <Row label="Is Tor" value={d.isTor ? 'YES' : 'No'} highlight={d.isTor ? 'red' : 'green'} />
        <Row label="Usage Type" value={d.usageType} />
        <Row label="Country" value={d.countryCode} highlight={['RU','CN','KP','IR'].includes(d.countryCode) ? 'red' : 'green'} />
        {d.lastReportedAt && <Row label="Last Reported" value={d.lastReportedAt} />}
      </div>
    );
  }

  // VirusTotal IP
  if (toolName === 'virustotal_ip') {
    const stats = result.data?.last_analysis_stats || result.last_analysis_stats || {};
    const rep = result.data?.reputation ?? null;
    return (
      <div className="space-y-1.5">
        <Row label="Malicious" value={stats.malicious || 0} highlight={(stats.malicious || 0) > 5 ? 'red' : (stats.malicious || 0) > 0 ? 'yellow' : 'green'} />
        <Row label="Suspicious" value={stats.suspicious || 0} />
        <Row label="Harmless" value={stats.harmless || 0} />
        {rep !== null && <Row label="Reputation" value={rep} highlight={rep < -10 ? 'red' : rep < 0 ? 'yellow' : 'green'} />}
        {stats.tags?.length > 0 && <Row label="Tags" value={stats.tags.join(', ')} highlight="red" />}
      </div>
    );
  }

  // VirusTotal URL / URLScan
  if (toolName === 'virustotal_url' || toolName === 'urlscan') {
    const stats = result.data?.last_analysis_stats || {};
    const results = result.data?.results || [];
    return (
      <div className="space-y-1.5">
        {stats.malicious !== undefined && (
          <Row label="Malicious" value={stats.malicious} highlight={stats.malicious > 5 ? 'red' : stats.malicious > 0 ? 'yellow' : 'green'} />
        )}
        {results.length > 0 && results.map((r, i) => (
          <div key={i} className="text-xs border border-[#30363d] rounded p-2">
            <div className="text-[#8b949e]">URL: {r.task?.url}</div>
            <div className="text-[#8b949e]">Domain: {r.page?.domain} · IP: {r.page?.ip}</div>
            {r.verdicts?.overall?.malicious && (
              <div className="text-red-400 font-medium">⚠ Flagged malicious by URLScan</div>
            )}
          </div>
        ))}
        {result.simulated && <p className="text-[10px] text-[#7a9cc0] italic">Simulated data</p>}
      </div>
    );
  }

  // Fallback: show raw JSON
  return (
    <pre className="text-[10px] text-[#8b949e] overflow-auto max-h-40 whitespace-pre-wrap">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export function Row({ label, value, highlight }) {
  const val = value === null || value === undefined ? '—' : String(value);
  const color = highlight === 'red' ? 'text-red-400' :
                highlight === 'orange' ? 'text-orange-400' :
                highlight === 'yellow' ? 'text-yellow-400' :
                highlight === 'green' ? 'text-green-400' :
                'text-white';
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-[#7a9cc0] w-24 shrink-0">{label}</span>
      <span className={color}>{val}</span>
    </div>
  );
}

// ─── Summary / Verdict panel ──────────────────────────────────────────────────
export function SummaryPanel({ summary, elapsed, alertId }) {
  const verdict = VERDICT_CONFIG[summary.verdict] || VERDICT_CONFIG.INCONCLUSIVE;
  const VIcon = verdict.icon;

  const [actionChecks, setActionChecks] = useState(() => loadActionChecks(alertId));

  const toggleCheck = (index) => {
    const current = actionChecks[index];
    const updated = {
      ...actionChecks,
      [index]: current?.checked ? null : { checked: true, at: new Date().toISOString() },
    };
    setActionChecks(updated);
    saveActionChecks(alertId, updated);
  };

  const doneCount = Object.values(actionChecks).filter(c => c?.checked).length;
  const totalCount = summary.recommended_actions?.length ?? 0;

  return (
    <div className="border border-[#30363d] rounded-xl overflow-hidden tool-call-enter">
      {/* Verdict banner */}
      <div className={`px-4 py-3 border-b border-[#30363d] flex items-center justify-between ${verdict.bg}`}>
        <div className="flex items-center gap-3">
          <VIcon size={20} className={verdict.color} />
          <div>
            <div className="text-xs text-[#8b949e] uppercase tracking-wider">Verdict</div>
            <div className={`text-lg font-bold ${verdict.color}`}>{verdict.label}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-[#8b949e]">Risk Score</div>
            <div className={`text-2xl font-bold ${summary.risk_score >= 7 ? 'text-red-400' : summary.risk_score >= 4 ? 'text-yellow-400' : 'text-green-400'}`}>
              {summary.risk_score}<span className="text-sm text-[#8b949e]">/10</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[#8b949e]">Confidence</div>
            <div className="text-2xl font-bold text-white">{summary.confidence_pct}<span className="text-sm text-[#8b949e]">%</span></div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[#8b949e]">Triage Time</div>
            <div className="text-2xl font-bold text-white">{elapsed}<span className="text-sm text-[#8b949e]">s</span></div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Executive summary */}
        <div>
          <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">Executive Summary</h3>
          <p className="text-sm text-[#e6edf3] leading-relaxed">{summary.executive_summary}</p>
        </div>

        {/* Attack narrative */}
        {summary.attack_narrative && (
          <div>
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">Attack Narrative</h3>
            <p className="text-xs text-[#8b949e] leading-relaxed italic">{summary.attack_narrative}</p>
          </div>
        )}

        {/* Key findings */}
        {summary.key_findings?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">Key Findings</h3>
            <ul className="space-y-1.5">
              {summary.key_findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-blue-400 shrink-0 mt-0.5">→</span>
                  <span className="text-[#e6edf3]">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* MITRE ATT&CK */}
        {summary.mitre_assessment && (
          <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">MITRE ATT&CK</h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded">{summary.mitre_assessment.tactic}</span>
              <span className="font-mono text-blue-400">{summary.mitre_assessment.technique}</span>
              <span className="text-[#8b949e]">{summary.mitre_assessment.technique_name}</span>
            </div>
          </div>
        )}

        {/* Recommended actions */}
        {totalCount > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Recommended Actions</h3>
              {doneCount > 0 && (
                <span className="text-[10px] text-green-400">
                  {doneCount}/{totalCount} actioned
                </span>
              )}
            </div>
            <div className="space-y-2">
              {summary.recommended_actions.map((a, i) => {
                const check = actionChecks[i];
                const isDone = !!check?.checked;
                return (
                  <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all ${
                    isDone
                      ? 'bg-green-500/5 border-green-500/20 opacity-60'
                      : 'bg-[#0d1117] border-[#30363d]'
                  }`}>
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(i)}
                      title={isDone ? 'Mark as not done' : 'Mark as actioned'}
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isDone
                          ? 'bg-green-500/20 border-green-500/50'
                          : 'border-[#4a6080] hover:border-green-500/50 hover:bg-green-500/10'
                      }`}
                    >
                      {isDone && <Check size={10} className="text-green-400" />}
                    </button>
                    {/* Priority badge */}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      a.priority === 'IMMEDIATE'  ? 'bg-red-500/20 text-red-400' :
                      a.priority === 'SHORT_TERM' ? 'bg-orange-500/20 text-orange-400' :
                                                    'bg-blue-500/20 text-blue-400'
                    }`}>{a.priority}</span>
                    {/* Action text + audit trail */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${isDone ? 'line-through text-[#4a6080]' : 'text-[#e6edf3]'}`}>
                        {a.action}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#7a9cc0]">
                        <span>Owner: {a.owner}</span>
                        {isDone && check?.at && (
                          <>
                            <span className="text-[#30363d]">·</span>
                            <span className="text-green-400">
                              ✓ Actioned {new Date(check.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Escalation */}
        {summary.escalation_required && (
          <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg flex items-start gap-2">
            <ArrowUpRight size={15} className="text-orange-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-orange-400 mb-0.5">Escalation Required</div>
              <div className="text-xs text-[#8b949e]">{summary.escalation_reason}</div>
            </div>
          </div>
        )}

        {/* Analyst notes */}
        {summary.analyst_notes && (
          <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-[#8b949e] italic">
            📝 {summary.analyst_notes}
          </div>
        )}
      </div>
    </div>
  );
}
