import { useState, useEffect, useCallback } from 'react';
import { Shield, Settings, Activity, AlertTriangle, LayoutDashboard, ListFilter } from 'lucide-react';
import AlertQueue from './components/AlertQueue.jsx';
import AgentWorkflow from './components/AgentWorkflow.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Dashboard from './components/Dashboard.jsx';
import { loadAlerts } from './services/csvService.js';

const DEFAULT_SETTINGS = {
  aiProvider: 'anthropic',
  anthropicKey: '',
  openaiKey: '',
  abuseipdbKey: '',
  virusTotalKey: '',
  urlScanKey: '',
};

export default function App() {
  const [alerts, setAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState('queue'); // 'queue' | 'dashboard'
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('acme-soc-settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      // One-time migration from original project's localStorage key
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

  useEffect(() => {
    loadAlerts().then(data => {
      setAlerts(data);
      setLoading(false);
    });
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
        <div className="flex items-center gap-3">
          <Shield className="text-[#00d4ff]" size={22} />
          <div>
            <span className="font-bold text-sm text-white">Acme Corp</span>
            <span className="text-[#7a9cc0] text-xs ml-2">· SOC Alert Triage</span>
          </div>
          <span className="ml-2 px-2 py-0.5 text-xs bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 rounded-full">AI-Powered</span>
        </div>

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

          {/* API status pill */}
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
          <Dashboard alerts={alerts} />
        ) : (
          <>
            {/* Left: Alert queue */}
            <AlertQueue
              alerts={alerts}
              loading={loading}
              selectedAlert={selectedAlert}
              onSelectAlert={setSelectedAlert}
            />

            {/* Right: Agent workflow / triage panel */}
            <div className="flex-1 overflow-hidden">
              {selectedAlert ? (
                <AgentWorkflow
                  key={selectedAlert.alert_id}
                  alert={selectedAlert}
                  settings={settings}
                  onOpenSettings={() => setShowSettings(true)}
                />
              ) : (
                <EmptyState onOpenSettings={() => setShowSettings(true)} hasKey={hasApiKey} />
              )}
            </div>
          </>
        )}
      </div>

      {/* Settings modal */}
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
