import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Play, AlertTriangle, FileDown, GitMerge, History, RotateCcw, Sparkles } from 'lucide-react';
import { generateInvestigationPlan, generateFinalSummary, checkForAdditionalSteps } from '../services/aiService.js';
import { executeTool } from '../services/toolService.js';
import { exportTriageReport } from '../services/reportService.js';
import { saveRun, getRuns } from '../services/runHistoryService.js';
import {
  DECISIONS_KEY, VERDICT_CONFIG, VERDICT_SHORT, PRIORITY_COLOR,
  EscalationTicketModal, RunHistoryBar, formatAge,
  AnalystActions, ResultDisplay, SummaryPanel, RiskLevelBadge, ToolStepCard,
} from './AgentWorkflow.jsx';
import { computeRiskLevel } from '../services/riskHeuristic.js';

// Max dynamic steps the agent can inject during a single run
const MAX_DYNAMIC_STEPS = 2;

function loadDecisions() {
  try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) || '{}'); } catch { return {}; }
}
function saveDecision(alertId, decision) {
  const all = loadDecisions();
  all[alertId] = decision;
  localStorage.setItem(DECISIONS_KEY, JSON.stringify(all));
}

const PHASE = {
  IDLE: 'idle',
  PLANNING: 'planning',
  INVESTIGATING: 'investigating',
  RECONSIDERING: 'reconsidering',   // new — agent is checking if more steps needed
  SYNTHESIZING: 'synthesizing',
  DONE: 'done',
  ERROR: 'error',
};

export default function AdaptiveWorkflow({ alert, settings, onOpenSettings, onEntityClick }) {
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [plan, setPlan] = useState(null);
  const [stepResults, setStepResults] = useState([]);
  const [activeStep, setActiveStep] = useState(-1);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [elapsed, setElapsed] = useState(0);
  const [dynamicStepsAdded, setDynamicStepsAdded] = useState(0);
  const [riskLabel, setRiskLabel] = useState('UNKNOWN');
  const [analystDecision, setAnalystDecision] = useState(() => loadDecisions()[alert.alert_id] || null);
  const [runHistory, setRunHistory] = useState(() => getRuns(alert.alert_id, 'adaptive'));
  const [viewingRunId, setViewingRunId] = useState(null);
  const [escalationTicket, setEscalationTicket] = useState(null);
  const startTime = useRef(null);
  const timerRef = useRef(null);
  const bottomRef = useRef(null);

  const refreshHistory = () => setRunHistory(getRuns(alert.alert_id, 'adaptive'));

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
    setDynamicStepsAdded(run.plan?.investigation_steps?.filter(s => s.dynamic).length || 0);
    setAnalystDecision(loadDecisions()[alert.alert_id] || null);
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
    setDynamicStepsAdded(0);
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
        ticketId: `INC-2024-${num}`,
        priority, title: alert.title, alertId: alert.alert_id,
        assignedTo: 'IR Team / Tier 2 SOC',
        createdAt: new Date().toISOString(),
        verdict: summary?.verdict, riskScore: summary?.risk_score,
        mitre: summary?.mitre_assessment,
        escalationReason: summary?.escalation_reason || note || 'Manual escalation by analyst',
        analystNote: note, executiveSummary: summary?.executive_summary,
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
    setDynamicStepsAdded(0);
    setRiskLabel('UNKNOWN');
    setAnalystDecision(null);
    startTime.current = Date.now();

    try {
      // ── Phase 1: Generate initial investigation plan ──
      const initialPlan = await generateInvestigationPlan(alert, settings);

      // Work with a mutable steps array so we can splice in dynamic steps
      const steps = [...initialPlan.investigation_steps];
      const livePlan = { ...initialPlan, investigation_steps: steps };
      setPlan({ ...livePlan });
      setPhase(PHASE.INVESTIGATING);

      // ── Phase 2: Execute steps, re-evaluate after each one ──
      const results = [];
      let dynCount = 0;

      for (let i = 0; i < steps.length; i++) {
        setActiveStep(i);

        const result = await executeTool(steps[i].tool, steps[i].parameters, settings);
        results.push(result);
        setStepResults([...results]);
        // Update live risk label after each tool completes
        const toolResults = results.map((r, j) => ({ tool: steps[j].tool, result: r }));
        setRiskLabel(computeRiskLevel(toolResults));
        await new Promise(r => setTimeout(r, 250));

        // ── Re-planning check (only while under cap) ──
        if (dynCount < MAX_DYNAMIC_STEPS) {
          setActiveStep(-1);
          setPhase(PHASE.RECONSIDERING);

          try {
            const currentPlan = { ...initialPlan, investigation_steps: [...steps] };
            const check = await checkForAdditionalSteps(alert, currentPlan, results, settings);

            if (check?.add_step && check?.step?.tool && check?.step?.parameters) {
              const newStep = {
                ...check.step,
                step_id: steps.length + 1,
                dynamic: true,
              };
              steps.push(newStep);
              dynCount++;
              setDynamicStepsAdded(dynCount);
              // Sync plan state so the step list re-renders with the new step
              setPlan({ ...initialPlan, investigation_steps: [...steps] });
            }
          } catch {
            // Re-planning is best-effort — failures don't abort the run
          }

          setPhase(PHASE.INVESTIGATING);
        }
      }

      setActiveStep(-1);

      // ── Phase 3: Synthesise with the full (expanded) step list ──
      setPhase(PHASE.SYNTHESIZING);
      const finalPlan = { ...initialPlan, investigation_steps: [...steps] };
      const finalSummary = await generateFinalSummary(alert, finalPlan, results, settings);
      setSummary(finalSummary);
      setPhase(PHASE.DONE);
      clearInterval(timerRef.current);

      const finalElapsed = Math.floor((Date.now() - startTime.current) / 1000);
      saveRun(alert.alert_id, {
        plan: finalPlan,
        stepResults: results,
        summary: finalSummary,
        elapsed: finalElapsed,
        mode: 'adaptive',
      });
      refreshHistory();

    } catch (err) {
      setError(err.message);
      setPhase(PHASE.ERROR);
      clearInterval(timerRef.current);
    }
  };

  const SEV_COLOR = { Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-blue-400' };
  const isRunning = phase === PHASE.PLANNING || phase === PHASE.INVESTIGATING ||
                    phase === PHASE.RECONSIDERING || phase === PHASE.SYNTHESIZING;

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
              {alert.user_id && (
                <button onClick={() => onEntityClick?.('user', alert.user_id)} className="hover:text-[#00d4ff] transition-colors">
                  👤 {alert.user_id}
                </button>
              )}
              {alert.hostname && (
                <button onClick={() => onEntityClick?.('asset', alert.hostname)} className="hover:text-[#00d4ff] transition-colors">
                  💻 {alert.hostname}
                </button>
              )}
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
                onClick={() => exportTriageReport({ alert, plan, stepResults, summary, analystDecision, elapsed })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#1e2d4a] hover:border-[#2a3f63] text-[#7a9cc0] hover:text-white transition-colors"
                title="Export triage report"
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
                disabled={isRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#00d4ff] hover:bg-[#00b8d9] text-[#0a0f1e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {phase === PHASE.IDLE || phase === PHASE.DONE || phase === PHASE.ERROR ? (
                  <><Play size={12} /> {phase === PHASE.DONE || phase === PHASE.ERROR ? 'Re-run' : 'Run AI Triage'}</>
                ) : (
                  <><span className="spinner" /> Investigating...</>
                )}
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
          <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <GitMerge size={20} className="text-cyan-400" />
            </div>
            <div>
              <p className="text-sm text-white font-semibold mb-1">Adaptive Re-Planning Mode</p>
              <p className="text-xs text-[#7a9cc0] max-w-sm leading-relaxed">
                The agent generates an initial investigation plan, then re-evaluates after
                each tool result — dynamically adding new steps if a finding warrants it.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#7a9cc0] px-3 py-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
              <Sparkles size={11} className="text-cyan-400 shrink-0" />
              Up to {MAX_DYNAMIC_STEPS} additional steps can be injected mid-investigation
            </div>
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

        {/* ERROR */}
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

        {/* Planning */}
        {phase === PHASE.PLANNING && (
          <div className="p-4 bg-[#161b22] border border-[#30363d] rounded-xl">
            <div className="flex items-center gap-2 text-sm text-[#8b949e]">
              <span className="spinner" />
              <span>Agent is analysing the alert and building an initial investigation plan...</span>
            </div>
          </div>
        )}

        {/* Plan summary card */}
        {plan && (
          <div className="p-4 bg-[#161b22] border border-[#30363d] rounded-xl tool-call-enter">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">Agent Assessment</h3>
                <p className="text-sm text-white">{plan.alert_summary}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full border shrink-0 ${
                plan.initial_risk_assessment === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                plan.initial_risk_assessment === 'HIGH'     ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                plan.initial_risk_assessment === 'MEDIUM'   ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
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

        {/* Step list — uses shared ToolStepCard; isDynamic prop adds cyan accent */}
        {plan?.investigation_steps?.map((step, i) => (
          <div key={i}>
            <ToolStepCard
              step={step}
              index={i}
              isActive={activeStep === i}
              isDone={i < stepResults.length}
              isExpanded={!!expandedSteps[i]}
              result={stepResults[i]}
              onToggle={() => toggleStep(i)}
              isDynamic={!!step.dynamic}
            />

            {/* Reconsidering indicator — shown after the last completed step */}
            {phase === PHASE.RECONSIDERING && i === stepResults.length - 1 && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 bg-cyan-500/5 border border-cyan-500/20 rounded-xl tool-call-enter">
                <span className="spinner" style={{ borderTopColor: '#22d3ee', width: 14, height: 14 }} />
                <span className="text-xs text-cyan-400">
                  Agent reviewing findings — deciding whether additional investigation is needed...
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Dynamic steps summary badge */}
        {dynamicStepsAdded > 0 && (phase === PHASE.SYNTHESIZING || phase === PHASE.DONE) && (
          <div className="flex items-center gap-2 px-3 py-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg tool-call-enter">
            <Sparkles size={12} className="text-cyan-400 shrink-0" />
            <span className="text-xs text-cyan-300">
              Agent added <strong>{dynamicStepsAdded}</strong> step{dynamicStepsAdded > 1 ? 's' : ''} dynamically based on findings
            </span>
          </div>
        )}

        {/* Synthesising */}
        {phase === PHASE.SYNTHESIZING && (
          <div className="p-4 bg-[#161b22] border border-blue-500/30 rounded-xl tool-call-enter">
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <span className="spinner" />
              <span>Synthesising all evidence into final verdict...</span>
            </div>
          </div>
        )}

        {/* Final summary */}
        {summary && phase === PHASE.DONE && (
          <SummaryPanel summary={summary} elapsed={elapsed} alertId={alert.alert_id} />
        )}

        {/* Analyst actions */}
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
