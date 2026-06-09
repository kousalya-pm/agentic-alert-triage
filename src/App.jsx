import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { Shield, Settings, Activity, AlertTriangle, LayoutDashboard, ListFilter, Zap, GitMerge, Users, Link2, ChevronDown } from 'lucide-react';
import AlertQueue from './components/AlertQueue.jsx';
import AgentWorkflow from './components/AgentWorkflow.jsx';
import AdaptiveWorkflow from './components/AdaptiveWorkflow.jsx';
import ParallelAgentsWorkflow from './components/ParallelAgentsWorkflow.jsx';
import ChainWorkflow from './components/ChainWorkflow.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Dashboard from './components/Dashboard.jsx';
import EntityPanel from './components/EntityPanel.jsx';
import UserPage from './pages/UserPage.jsx';
import AssetPage from './pages/AssetPage.jsx';
import { loadAlerts } from './services/csvService.js';
import { groupAlerts, buildIncidentAlert } from './services/incidentService.js';

const DEFAULT_SETTINGS = {
  aiProvider: 'anthropic',
  anthropicKey: '',
  openaiKey: '',
  abuseipdbKey: '',
  virusTotalKey: '',
  urlScanKey: '',
};

// ─── Top-level router ────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/alerts/:alertId" element={<MainApp />} />
      <Route path="/users/:userId" element={<UserPage />} />
      <Route path="/assets/:hostname" element={<AssetPage />} />
    </Routes>
  );
}

// ─── Main app layout ─────────────────────────────────────────────────────────
function MainApp() {
  const { alertId } = useParams();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState('queue');
  const [entityPanel, setEntityPanel] = useState(null); // { type: 'user'|'asset', id }
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('acme-soc-settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      const legacy = localStorage.getItem('mcg-soc-settings');
      if (legacy) {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(legacy) };
        localStorage.setItem('acme-soc-settings', JSON.stringify(parsed));
        return parsed;
      }
      return DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });
  const [loading, setLoading] = useState(true);
  const [triageMode, setTriageMode] = useState('standard');
  const [isTriageRunning, setIsTriageRunning] = useState(false);

  useEffect(() => {
    loadAlerts().then(data => {
      setAlerts(data);
      setLoading(false);
    });
  }, []);

  // Select alert from URL — runs on initial load and whenever alertId changes
  useEffect(() => {
    if (!alertId || alerts.length === 0) return;

    // Check if URL is for an incident (INC-*) or regular alert (ALT-*)
    if (alertId.startsWith('INC-')) {
      // Reconstruct incident from its key
      // Key format: INC-{entity_id} where entity_id is user_id, hostname, or src_ip
      const incidentKey = alertId.substring(4); // Remove 'INC-' prefix
      const groups = groupAlerts(alerts);
      const incidentGroup = groups.find(g => g.key === incidentKey);

      if (incidentGroup) {
        const incidentAlert = buildIncidentAlert(incidentGroup);
        setSelectedAlert(incidentAlert);
        setActiveView('queue');
      }
    } else {
      // Regular alert lookup
      const found = alerts.find(a => a.alert_id === alertId);
      if (found) {
        setSelectedAlert(found);
        setActiveView('queue');
      }
    }
  }, [alertId, alerts]);

  const handleSelectAlert = useCallback((alert) => {
    setSelectedAlert(alert);
    setIsTriageRunning(false); // new alert always resets the running lock
    navigate(`/alerts/${alert.alert_id}`, { replace: true });
    setActiveView('queue');
  }, [navigate]);

  // Toggle entity panel — clicking same entity again closes it
  const handleEntityClick = useCallback((type, id) => {
    setEntityPanel(prev =>
      prev && prev.type === type && prev.id === id ? null : { type, id }
    );
  }, []);

  const handleSaveSettings = useCallback((newSettings) => {
    setSettings(newSettings);
    localStorage.setItem('acme-soc-settings', JSON.stringify(newSettings));
    setShowSettings(false);
  }, []);

  const stats = {
    critical: alerts.filter(a => a.severity === 'Critical').length,
    high: alerts.filter(a => a.severity === 'High').length,
    open: alerts.filter(a => a.status === 'open').length,
  };

  const hasApiKey = settings.anthropicKey || settings.openaiKey;

  return (
    <div className="flex flex-col h-screen bg-[#0a0f1e] text-[#e2eaf5]">
      {/* ── Top nav ── */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#0f1629] border-b border-[#1e2d4a] shrink-0 cyber-glow">
        <button
          onClick={() => { setSelectedAlert(null); navigate('/'); }}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          title="Go to home / clear selection"
        >
          <Shield className="text-[#00d4ff]" size={22} />
          <div className="text-left">
            <span className="font-bold text-sm text-white">Acme Corp</span>
            <span className="text-[#7a9cc0] text-xs ml-2">· SOC Alert Triage</span>
          </div>
          <span className="ml-2 px-2 py-0.5 text-xs bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 rounded-full">AI-Powered</span>
        </button>

        <div className="flex items-center gap-6">
          {/* View tabs */}
          <div className="flex items-center bg-[#0a0f1e] border border-[#1e2d4a] rounded-lg p-0.5">
            <button
              onClick={() => setActiveView('queue')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
                activeView === 'queue' ? 'bg-[#0f1629] text-[#00d4ff] border border-[#1e2d4a]' : 'text-[#7a9cc0] hover:text-white'
              }`}
            >
              <ListFilter size={12} /> Alert Queue
            </button>
            <button
              onClick={() => setActiveView('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
                activeView === 'dashboard' ? 'bg-[#0f1629] text-[#00d4ff] border border-[#1e2d4a]' : 'text-[#7a9cc0] hover:text-white'
              }`}
            >
              <LayoutDashboard size={12} /> Dashboard
            </button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 pulse-dot" />
              <span className="text-[#7a9cc0]">Critical:</span>
              <span className="text-red-400 font-bold">{stats.critical}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-[#7a9cc0]">High:</span>
              <span className="text-orange-400 font-bold">{stats.high}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity size={12} className="text-[#7a9cc0]" />
              <span className="text-[#7a9cc0]">Open:</span>
              <span className="text-[#00d4ff] font-bold">{stats.open}</span>
            </div>
          </div>

          {!hasApiKey && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-full hover:bg-yellow-500/20 transition-colors"
            >
              <AlertTriangle size={11} />
              Add AI API Key
            </button>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7a9cc0] hover:text-white border border-[#1e2d4a] hover:border-[#2a3f63] rounded-md transition-colors"
          >
            <Settings size={13} />
            Settings
          </button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">
        {activeView === 'dashboard' ? (
          <div className="flex-1 overflow-hidden">
            <Dashboard alerts={alerts} />
          </div>
        ) : (
          <>
            {/* Left: Alert queue */}
            <AlertQueue
              alerts={alerts}
              loading={loading}
              selectedAlert={selectedAlert}
              onSelectAlert={handleSelectAlert}
              onEntityClick={handleEntityClick}
            />

            {/* Center: Triage panel */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Mode selector — 4 cards */}
              <div className="shrink-0 grid grid-cols-4 gap-px bg-[#1e2d4a] border-b border-[#1e2d4a]">
                {[
                  {
                    id: 'standard',
                    icon: <Zap size={13} />,
                    label: 'Standard',
                    sub: 'Plan → Execute → Synthesize',
                    active: 'bg-[#0f1a2e] text-[#00d4ff] border-b-2 border-[#00d4ff]',
                    idle: 'bg-[#0a0f1e] text-[#4a6080] hover:text-[#7a9cc0] hover:bg-[#0d1525]',
                  },
                  {
                    id: 'adaptive',
                    icon: <GitMerge size={13} />,
                    label: 'Adaptive',
                    sub: 'Re-plans mid-investigation',
                    active: 'bg-[#0d1f24] text-cyan-400 border-b-2 border-cyan-500',
                    idle: 'bg-[#0a0f1e] text-[#4a6080] hover:text-[#7a9cc0] hover:bg-[#0d1525]',
                  },
                  {
                    id: 'parallel',
                    icon: <Users size={13} />,
                    label: 'Parallel',
                    sub: '4 specialist agents at once',
                    active: 'bg-[#150d24] text-violet-400 border-b-2 border-violet-500',
                    idle: 'bg-[#0a0f1e] text-[#4a6080] hover:text-[#7a9cc0] hover:bg-[#0d1525]',
                  },
                  {
                    id: 'chain',
                    icon: <Link2 size={13} />,
                    label: 'Chain',
                    sub: 'Tier 1 → 2 → 3 escalation',
                    active: 'bg-[#1a130a] text-amber-400 border-b-2 border-amber-500',
                    idle: 'bg-[#0a0f1e] text-[#4a6080] hover:text-[#7a9cc0] hover:bg-[#0d1525]',
                  },
                ].map(m => {
                  const isActive  = triageMode === m.id;
                  const isLocked  = isTriageRunning && !isActive; // other tabs locked while running
                  return (
                    <button
                      key={m.id}
                      onClick={() => !isLocked && setTriageMode(m.id)}
                      title={isLocked ? 'A triage is running — finish or wait before switching mode' : undefined}
                      className={`relative flex flex-col items-center gap-0.5 px-2 py-2 text-center transition-all ${
                        isActive ? m.active : isLocked ? 'bg-[#0a0f1e] text-[#2a3f50] cursor-not-allowed' : m.idle
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                        {m.icon}
                        {m.label}
                        {/* Pulse dot: shown on active tab while triage is running */}
                        {isActive && isTriageRunning && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] pulse-dot" />
                        )}
                      </div>
                      <span className="text-[9px] opacity-60 leading-tight">{m.sub}</span>
                    </button>
                  );
                })}
              </div>

              {selectedAlert ? (
                triageMode === 'adaptive' ? (
                  <AdaptiveWorkflow
                    key={selectedAlert.alert_id + '-adaptive'}
                    alert={selectedAlert}
                    settings={settings}
                    onOpenSettings={() => setShowSettings(true)}
                    onEntityClick={handleEntityClick}
                    onRunningChange={setIsTriageRunning}
                  />
                ) : triageMode === 'parallel' ? (
                  <ParallelAgentsWorkflow
                    key={selectedAlert.alert_id + '-parallel'}
                    alert={selectedAlert}
                    settings={settings}
                    onOpenSettings={() => setShowSettings(true)}
                    onEntityClick={handleEntityClick}
                    onRunningChange={setIsTriageRunning}
                  />
                ) : triageMode === 'chain' ? (
                  <ChainWorkflow
                    key={selectedAlert.alert_id + '-chain'}
                    alert={selectedAlert}
                    settings={settings}
                    onOpenSettings={() => setShowSettings(true)}
                    onEntityClick={handleEntityClick}
                    onRunningChange={setIsTriageRunning}
                  />
                ) : (
                  <AgentWorkflow
                    key={selectedAlert.alert_id + '-standard'}
                    alert={selectedAlert}
                    settings={settings}
                    onOpenSettings={() => setShowSettings(true)}
                    onEntityClick={handleEntityClick}
                    onRunningChange={setIsTriageRunning}
                  />
                )
              ) : (
                <EmptyState onOpenSettings={() => setShowSettings(true)} hasKey={hasApiKey} />
              )}
            </div>

            {/* Right: Entity panel (slide in) */}
            {entityPanel && (
              <EntityPanel
                entity={entityPanel}
                onClose={() => setEntityPanel(null)}
                onEntityClick={handleEntityClick}
              />
            )}
          </>
        )}
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ onOpenSettings, hasKey }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 px-8">
      <div className="w-16 h-16 rounded-2xl bg-[#00d4ff]/10 border border-[#00d4ff]/20 flex items-center justify-center mb-2 cyber-glow">
        <Shield size={32} className="text-[#00d4ff]" />
      </div>
      <h2 className="text-xl font-semibold text-white">Select an alert to begin triage</h2>
      <p className="text-[#8b949e] max-w-sm text-sm leading-relaxed">
        The AI agent will automatically investigate the alert — querying internal systems and external threat intelligence — then deliver a verdict and recommended actions.
      </p>
      {!hasKey && (
        <button
          onClick={onOpenSettings}
          className="mt-2 px-4 py-2 bg-[#00d4ff] hover:bg-[#00b8d9] text-[#0a0f1e] text-sm font-bold rounded-lg transition-colors"
        >
          Configure AI API Key →
        </button>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 max-w-sm text-xs text-left">
        {[
          ['👤', 'AD User Lookup', 'Employee context & risk score'],
          ['🖥️', 'CMDB Asset Check', 'Device criticality & patch level'],
          ['📊', 'SIEM History', 'Prior alerts on same user/IP'],
          ['🌍', 'IP Geolocation', 'ip-api.com — live'],
          ['🚨', 'AbuseIPDB', 'Community IP reputation'],
          ['🦠', 'VirusTotal', '70+ AV vendor check'],
        ].map(([icon, label, sub]) => (
          <div key={label} className="flex items-start gap-2 p-2 bg-[#0f1629] border border-[#1e2d4a] rounded-lg">
            <span className="text-base">{icon}</span>
            <div>
              <div className="text-white font-medium">{label}</div>
              <div className="text-[#8b949e]">{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
