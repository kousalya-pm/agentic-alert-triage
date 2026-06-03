import { useState, useRef } from 'react';
import { Play, ChevronRight, FileDown, RotateCcw, Zap, Search, ShieldAlert, Loader2, Link2 } from 'lucide-react';
import { generateInvestigationPlan, generateFinalSummary, runQuickTriage, planEscalationSteps } from '../services/aiService.js';
import { executeTool } from '../services/toolService.js';
import { exportTriageReport } from '../services/reportService.js';
import { saveRun, getRuns } from '../services/runHistoryService.js';
import {
  DECISIONS_KEY, VERDICT_CONFIG, VERDICT_SHORT,
  RunHistoryBar, formatAge, AnalystActions, ResultDisplay, SummaryPanel,
} from './AgentWorkflow.jsx';

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
  T1_SCANNING: 't1_scanning',
  T1_ROUTING: 't1_routing',
  T2_PLANNING: 't2_planning',
  T2_INVESTIGATING: 't2_investigating',
  T2_SYNTHESIZING: 't2_synthesizing',
  T3_PLANNING: 't3_planning',
  T3_INVESTIGATING: 't3_investigating',
  T3_SYNTHESIZING: 't3_synthesizing',
  DONE: 'done',
  ERROR: 'error',
};

const SEV_COLOR = { Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-blue-400' };

// Deterministically pick ≤2 tools for Tier 1 quick scan from alert fields
function pickTier1Tools(alert) {
  const tools = [];
  if (alert.user_id) tools.push({ tool: 'user_lookup', parameters: { user_id: alert.user_id } });
  if (alert.src_ip) tools.push({ tool: 'watchlist_check', parameters: { indicator: alert.src_ip, type: 'ip' } });
  else if (alert.dst_ip) tools.push({ tool: 'watchlist_check', parameters: { indicator: alert.dst_ip, type: 'ip' } });
  else if (alert.hostname) tools.push({ tool: 'asset_lookup', parameters: { hostname: alert.hostname } });
  return tools.slice(0, 2);
}

export default function ChainWorkflow({ alert, settings, onOpenSettings, onEntityClick }) {
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [tier1Results, setTier1Results] = useState([]);
  const [routing, setRouting] = useState(null);
  const [tier2Plan, setTier2Plan] = useState(null);
  const [tier2Results, setTier2Results] = useState([]);
  const [tier2Summary, setTier2Summary] = useState(null);
  const [tier3Steps, setTier3Steps] = useState([]);
  const [tier3Results, setTier3Results] = useState([]);
  const [finalSummary, setFinalSummary] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [analystDecision, setAnalystDecision] = useState(() => loadDecisions()[alert.alert_id] || null);
  const [runHistory, setRunHistory] = useState(() => getRuns(alert.alert_id, 'chain'));
  const [viewingRunId, setViewingRunId] = useState(null);

  const startTime = useRef(null);
  const timerRef = useRef(null);

  const refreshHistory = () => setRunHistory(getRuns(alert.alert_id, 'chain'));

  const resetState = () => {
    setTier1Results([]); setRouting(null);
    setTier2Plan(null); setTier2Results([]); setTier2Summary(null);
    setTier3Steps([]); setTier3Results([]);
    setFinalSummary(null); setError(null); setElapsed(0);
  };

  const loadHistoricalRun = (run) => {
    setTier1Results(run.tier1Results || []);
    setRouting(run.routing || null);
    setTier2Plan(run.tier2Plan || null);
    setTier2Results(run.tier2Results || []);
    setTier2Summary(run.tier2Summary || null);
    setTier3Steps(run.tier3Steps || []);
    setTier3Results(run.tier3Results || []);
    setFinalSummary(run.summary);
    setElapsed(run.elapsed);
    setPhase(PHASE.DONE);
    setError(null);
    setViewingRunId(run.runId);
    setAnalystDecision(loadDecisions()[alert.alert_id] || null);
  };

  const startNewRun = () => {
    setViewingRunId(null);
    setPhase(PHASE.IDLE);
    resetState();
  };

  const handleAction = (decision) => {
    saveDecision(alert.alert_id, decision);
    setAnalystDecision(decision);
  };

  async function runTriage() {
    if (!settings.anthropicKey && !settings.openaiKey) { onOpenSettings(); return; }
    setViewingRunId(null);
    setPhase(PHASE.T1_SCANNING);
    resetState();
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    try {
      // ── TIER 1: Quick Scan ─────────────────────────────────────────────────
      const t1Tools = pickTier1Tools(alert);
      const t1Acc = [];
      for (const t of t1Tools) {
        const result = await executeTool(t.tool, t.parameters, settings);
        t1Acc.push({ tool: t.tool, parameters: t.parameters, result });
        setTier1Results([...t1Acc]);
      }

      setPhase(PHASE.T1_ROUTING);
      const routingDecision = await runQuickTriage(alert, t1Acc, settings);
      setRouting(routingDecision);

      if (routingDecision?.routing === 'CLOSE') {
        const closedSummary = buildClosedSummary(alert, routingDecision);
        setFinalSummary(closedSummary);
        setPhase(PHASE.DONE);
        clearInterval(timerRef.current);
        const fe = Math.floor((Date.now() - startTime.current) / 1000);
        saveRun(alert.alert_id, {
          plan: { investigation_steps: t1Acc.map(r => ({ tool: r.tool, question: `Quick scan: ${r.tool}`, parameters: r.parameters })) },
          stepResults: t1Acc.map(r => r.result),
          summary: closedSummary, elapsed: fe, mode: 'chain',
          tier1Results: t1Acc, routing: routingDecision,
          tier2Plan: null, tier2Results: [], tier2Summary: null,
          tier3Steps: [], tier3Results: [],
        });
        refreshHistory();
        return;
      }

      // ── TIER 2: Deep Investigation ─────────────────────────────────────────
      setPhase(PHASE.T2_PLANNING);
      const plan = await generateInvestigationPlan(alert, settings);
      setTier2Plan(plan);

      setPhase(PHASE.T2_INVESTIGATING);
      const t2Acc = [];
      for (const step of (plan.investigation_steps || [])) {
        const result = await executeTool(step.tool, step.parameters, settings);
        t2Acc.push({ ...step, result });
        setTier2Results([...t2Acc]);
      }

      setPhase(PHASE.T2_SYNTHESIZING);
      const t2Sum = await generateFinalSummary(alert, plan, t2Acc, settings);
      setTier2Summary(t2Sum);

      const escalate = t2Sum?.verdict === 'TRUE_POSITIVE' || t2Sum?.verdict === 'NEEDS_ESCALATION';
      if (!escalate) {
        setFinalSummary(t2Sum);
        setPhase(PHASE.DONE);
        clearInterval(timerRef.current);
        const fe = Math.floor((Date.now() - startTime.current) / 1000);
        saveRun(alert.alert_id, {
          plan, stepResults: t2Acc.map(r => r.result),
          summary: t2Sum, elapsed: fe, mode: 'chain',
          tier1Results: t1Acc, routing: routingDecision,
          tier2Plan: plan, tier2Results: t2Acc, tier2Summary: t2Sum,
          tier3Steps: [], tier3Results: [],
        });
        refreshHistory();
        return;
      }

      // ── TIER 3: Escalation Review ─────────────────────────────────────────
      setPhase(PHASE.T3_PLANNING);
      const allSoFar = [...t1Acc, ...t2Acc];
      const t3Plan = await planEscalationSteps(alert, t2Sum, allSoFar, settings);
      const t3StepList = t3Plan?.steps || [];
      setTier3Steps(t3StepList);

      setPhase(PHASE.T3_INVESTIGATING);
      const t3Acc = [];
      for (const step of t3StepList) {
        const result = await executeTool(step.tool, step.parameters, settings);
        t3Acc.push({ ...step, result });
        setTier3Results([...t3Acc]);
      }

      setPhase(PHASE.T3_SYNTHESIZING);
      const allResults = [...t1Acc, ...t2Acc, ...t3Acc];
      const syntheticPlan = {
        investigation_steps: allResults.map(r => ({
          tool: r.tool,
          question: r.question || `${r.tool} investigation`,
          parameters: r.parameters,
        })),
      };
      const t3FinalSummary = await generateFinalSummary(alert, syntheticPlan, allResults, settings);
      setFinalSummary(t3FinalSummary);
      setPhase(PHASE.DONE);
      clearInterval(timerRef.current);
      const fe = Math.floor((Date.now() - startTime.current) / 1000);
      saveRun(alert.alert_id, {
        plan: syntheticPlan, stepResults: allResults.map(r => r.result),
        summary: t3FinalSummary, elapsed: fe, mode: 'chain',
        tier1Results: t1Acc, routing: routingDecision,
        tier2Plan: plan, tier2Results: t2Acc, tier2Summary: t2Sum,
        tier3Steps: t3StepList, tier3Results: t3Acc,
      });
      refreshHistory();

    } catch (err) {
      clearInterval(timerRef.current);
      setPhase(PHASE.ERROR);
      setError(err.message || 'Unknown error');
    }
  }

  const isRunning = phase !== PHASE.IDLE && phase !== PHASE.DONE && phase !== PHASE.ERROR;
  const hasKey = settings.anthropicKey || settings.openaiKey;
  const tier1Active = phase !== PHASE.IDLE || tier1Results.length > 0;
  const tier2Active = [PHASE.T2_PLANNING, PHASE.T2_INVESTIGATING, PHASE.T2_SYNTHESIZING,
    PHASE.T3_PLANNING, PHASE.T3_INVESTIGATING, PHASE.T3_SYNTHESIZING, PHASE.DONE].includes(phase)
    && routing?.routing !== 'CLOSE' && tier2Results.length > 0 || tier2Plan !== null;
  const tier3Active = [PHASE.T3_PLANNING, PHASE.T3_INVESTIGATING, PHASE.T3_SYNTHESIZING].includes(phase)
    || tier3Results.length > 0 || tier3Steps.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <RunHistoryBar
        runs={runHistory}
        viewingRunId={viewingRunId}
        onLoad={loadHistoricalRun}
        onNewRun={startNewRun}
        isRunning={isRunning}
      />

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
            {isRunning && <span className="text-xs text-[#7a9cc0] font-mono">{elapsed}s</span>}
            {phase === PHASE.DONE && finalSummary && (
              <button
                onClick={() => exportTriageReport({
                  alert,
                  plan: tier2Plan || { investigation_steps: tier1Results },
                  stepResults: [...tier1Results, ...tier2Results, ...tier3Results].map(r => r.result),
                  summary: finalSummary, analystDecision, elapsed,
                })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#1e2d4a] hover:border-[#2a3f63] text-[#7a9cc0] hover:text-white transition-colors"
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
            ) : phase === PHASE.IDLE ? (
              <button
                onClick={runTriage}
                disabled={!hasKey}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-40"
              >
                <Play size={11} /> Run Chain
              </button>
            ) : phase === PHASE.DONE ? (
              <button
                onClick={startNewRun}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0f1629] border border-[#1e2d4a] text-[#7a9cc0] hover:text-white transition-colors"
              >
                <RotateCcw size={12} /> Re-run
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Chain body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

        {/* No key warning */}
        {phase === PHASE.IDLE && !hasKey && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Link2 size={32} className="text-amber-400/40" />
            <p className="text-sm text-[#4a6080]">Configure an AI API key to run chain triage</p>
            <button onClick={onOpenSettings} className="px-4 py-2 text-xs bg-[#00d4ff] text-[#0a0f1e] font-bold rounded-lg hover:bg-[#00b8d9] transition-colors">
              Open Settings
            </button>
          </div>
        )}

        {/* TIER 1 */}
        {tier1Active && (
          <TierSection number={1} title="Quick Scan" icon={Zap} color="amber"
            isActive={[PHASE.T1_SCANNING, PHASE.T1_ROUTING].includes(phase)}>
            {tier1Results.map((r, i) => (
              <ToolResultRow key={i} tool={r.tool} parameters={r.parameters} result={r.result} />
            ))}
            {phase === PHASE.T1_SCANNING && <SpinnerRow label="Executing quick scan…" color="amber" />}
            {phase === PHASE.T1_ROUTING && <SpinnerRow label="AI routing decision…" color="amber" />}
          </TierSection>
        )}

        {/* Routing gate 1 */}
        {routing && (
          <RoutingGate
            from="Tier 1" to={routing.routing === 'CLOSE' ? 'Closed' : 'Tier 2'}
            decision={routing.routing}
            rationale={routing.rationale}
            confidence={routing.confidence_pct}
            indicators={routing.key_indicators}
          />
        )}

        {/* TIER 2 */}
        {tier2Active && (
          <TierSection number={2} title="Deep Investigation" icon={Search} color="cyan"
            isActive={[PHASE.T2_PLANNING, PHASE.T2_INVESTIGATING, PHASE.T2_SYNTHESIZING].includes(phase)}>
            {phase === PHASE.T2_PLANNING && <SpinnerRow label="Planning investigation…" color="cyan" />}
            {tier2Results.map((r, i) => (
              <ToolResultRow key={i} tool={r.tool} parameters={r.parameters} result={r.result} question={r.question} />
            ))}
            {phase === PHASE.T2_INVESTIGATING && tier2Results.length < (tier2Plan?.investigation_steps?.length || 99) && (
              <SpinnerRow label="Investigating…" color="cyan" />
            )}
            {phase === PHASE.T2_SYNTHESIZING && <SpinnerRow label="Synthesizing findings…" color="cyan" />}
          </TierSection>
        )}

        {/* Routing gate 2 */}
        {tier2Summary && (() => {
          const escalate = tier2Summary.verdict === 'TRUE_POSITIVE' || tier2Summary.verdict === 'NEEDS_ESCALATION';
          return (
            <RoutingGate
              from="Tier 2" to={escalate ? 'Tier 3' : 'Closed'}
              decision={escalate ? 'ESCALATE' : 'CLOSE'}
              rationale={escalate
                ? `Tier 2 returned ${tier2Summary.verdict} (${tier2Summary.confidence_pct}% confidence) — escalation review required`
                : `Tier 2 returned ${tier2Summary.verdict} — no further escalation needed`}
              confidence={tier2Summary.confidence_pct}
            />
          );
        })()}

        {/* TIER 3 */}
        {tier3Active && (
          <TierSection number={3} title="Escalation Review" icon={ShieldAlert} color="orange"
            isActive={[PHASE.T3_PLANNING, PHASE.T3_INVESTIGATING, PHASE.T3_SYNTHESIZING].includes(phase)}>
            {phase === PHASE.T3_PLANNING && <SpinnerRow label="Planning escalation deep-dive…" color="orange" />}
            {tier3Results.map((r, i) => (
              <ToolResultRow key={i} tool={r.tool} parameters={r.parameters} result={r.result} question={r.question} />
            ))}
            {phase === PHASE.T3_INVESTIGATING && tier3Results.length < tier3Steps.length && (
              <SpinnerRow label="Deep-dive investigation…" color="orange" />
            )}
            {phase === PHASE.T3_SYNTHESIZING && <SpinnerRow label="Final synthesis across all tiers…" color="orange" />}
          </TierSection>
        )}

        {/* Final verdict */}
        {finalSummary && phase === PHASE.DONE && (
          <div className="space-y-3 pt-1">
            <SummaryPanel summary={finalSummary} elapsed={elapsed} alertId={alert.alert_id} />
            <AnalystActions decision={analystDecision} aiVerdict={finalSummary.verdict} onAction={handleAction} />
          </div>
        )}

        {/* Error */}
        {phase === PHASE.ERROR && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={startNewRun} className="mt-2 text-xs text-[#7a9cc0] hover:text-white underline">
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TIER_COLORS = {
  amber: {
    border: 'border-amber-500/30', headerBg: 'bg-amber-500/10',
    text: 'text-amber-400', dot: 'bg-amber-400',
  },
  cyan: {
    border: 'border-cyan-500/30', headerBg: 'bg-cyan-500/10',
    text: 'text-cyan-400', dot: 'bg-cyan-400',
  },
  orange: {
    border: 'border-orange-500/30', headerBg: 'bg-orange-500/10',
    text: 'text-orange-400', dot: 'bg-orange-400',
  },
};

function TierSection({ number, title, icon: Icon, color, isActive, children }) {
  const c = TIER_COLORS[color];
  return (
    <div className={`border ${c.border} rounded-lg overflow-hidden`}>
      <div className={`flex items-center gap-2 px-4 py-2 ${c.headerBg}`}>
        <Icon size={12} className={c.text} />
        <span className={`text-[11px] font-bold uppercase tracking-wide ${c.text}`}>
          Tier {number} — {title}
        </span>
        {isActive && <span className={`ml-auto w-2 h-2 rounded-full ${c.dot} animate-pulse`} />}
      </div>
      <div className="divide-y divide-[#1e2d4a] bg-[#0a0f1e]">
        {children}
      </div>
    </div>
  );
}

function RoutingGate({ from, to, decision, rationale, confidence, indicators }) {
  const isClose = decision === 'CLOSE';
  const isEscalate = decision === 'ESCALATE';
  const color = isClose
    ? { text: 'text-green-400', border: 'border-green-500/20', bg: 'bg-green-500/5', badge: 'bg-green-500/10 border-green-500/30 text-green-400' }
    : isEscalate
    ? { text: 'text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/5', badge: 'bg-red-500/10 border-red-500/30 text-red-400' }
    : { text: 'text-blue-400', border: 'border-blue-500/20', bg: 'bg-blue-500/5', badge: 'bg-blue-500/10 border-blue-500/30 text-blue-400' };

  return (
    <div className={`border ${color.border} ${color.bg} rounded-lg px-4 py-2.5`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono text-[#4a6080] uppercase">{from}</span>
        <ChevronRight size={10} className="text-[#4a6080]" />
        <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded ${color.badge}`}>
          {decision}
        </span>
        <ChevronRight size={10} className="text-[#4a6080]" />
        <span className="text-[10px] font-mono text-[#4a6080] uppercase">{to}</span>
        {confidence != null && (
          <span className="ml-auto text-[10px] text-[#4a6080]">{confidence}% confidence</span>
        )}
      </div>
      <p className={`text-xs mt-1 ${color.text}`}>{rationale}</p>
      {indicators && indicators.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {indicators.map((ind, i) => (
            <span key={i} className="px-1.5 py-0.5 text-[10px] font-mono bg-[#0f1629] border border-[#1e2d4a] rounded text-[#7a9cc0]">
              {ind}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolResultRow({ tool, parameters, result, question }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = result?.error;
  return (
    <div className="px-4 py-2">
      <button
        className="w-full flex items-center gap-2 text-left group"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-xs font-mono text-[#00d4ff] shrink-0">{tool}</span>
        {question && <span className="text-xs text-[#4a6080] truncate">{question}</span>}
        {hasError && <span className="text-[10px] text-red-400 ml-auto shrink-0">error</span>}
        <ChevronRight
          size={12}
          className={`ml-auto shrink-0 text-[#4a6080] transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 pl-2 border-l border-[#1e2d4a]">
          <ResultDisplay toolName={tool} result={result} />
        </div>
      )}
    </div>
  );
}

function SpinnerRow({ label, color }) {
  const textColor = { amber: 'text-amber-400', cyan: 'text-cyan-400', orange: 'text-orange-400' }[color] || 'text-[#7a9cc0]';
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 text-xs ${textColor}`}>
      <Loader2 size={12} className="animate-spin shrink-0" />
      {label}
    </div>
  );
}

// Builds a FALSE_POSITIVE summary when Tier 1 closes the alert without a full AI synthesis
function buildClosedSummary(alert, routingDecision) {
  return {
    verdict: 'FALSE_POSITIVE',
    confidence_pct: routingDecision?.confidence_pct || 80,
    risk_score: 1.0,
    executive_summary: `Alert closed at Tier 1 rapid scan. ${routingDecision?.rationale || ''}`,
    key_findings: routingDecision?.key_indicators || [],
    attack_narrative: 'Alert closed at Tier 1 based on initial scan evidence. No indicators of an active attack were found.',
    mitre_assessment: {
      tactic: alert.mitre_tactic || 'N/A',
      technique: alert.mitre_technique || 'N/A',
      technique_name: 'N/A',
    },
    recommended_actions: [
      { priority: 'MONITOR', action: 'No immediate action required. Alert flagged as false positive by Tier 1 rapid scan.', owner: 'SOC Analyst' },
    ],
    escalation_required: false,
    escalation_reason: null,
    analyst_notes: 'Closed by Tier 1 rapid triage. Full investigation was not required.',
  };
}
