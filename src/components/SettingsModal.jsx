import { useState } from 'react';
import { X, Eye, EyeOff, Shield, ExternalLink, CheckCircle } from 'lucide-react';

export default function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...settings });
  const [show, setShow] = useState({});
  const [saved, setSaved] = useState(false);

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toggleShow = (key) => setShow(s => ({ ...s, [key]: !s[key] }));

  const handleSave = () => {
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">SOC Triage Settings</h2>
          </div>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-6">
          {/* AI Provider */}
          <section>
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-3">AI Provider</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { id: 'anthropic', label: 'Claude (Anthropic)', sub: 'claude-sonnet-4-6 · Recommended', icon: '🟠' },
                { id: 'openai', label: 'GPT-4o (OpenAI)', sub: 'gpt-4o', icon: '🟢' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => update('aiProvider', p.id)}
                  className={`p-3 text-left border rounded-lg transition-colors ${
                    form.aiProvider === p.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[#30363d] hover:border-[#484f58]'
                  }`}
                >
                  <div className="text-base mb-1">{p.icon}</div>
                  <div className="text-xs font-medium text-white">{p.label}</div>
                  <div className="text-[10px] text-[#8b949e]">{p.sub}</div>
                </button>
              ))}
            </div>

            <ApiKeyField
              label="Anthropic API Key"
              placeholder="sk-ant-api03-..."
              value={form.anthropicKey}
              onChange={v => update('anthropicKey', v)}
              show={show.anthropicKey}
              onToggle={() => toggleShow('anthropicKey')}
              link="https://console.anthropic.com/settings/keys"
              linkLabel="Get key at console.anthropic.com →"
            />

            <ApiKeyField
              label="OpenAI API Key"
              placeholder="sk-proj-..."
              value={form.openaiKey}
              onChange={v => update('openaiKey', v)}
              show={show.openaiKey}
              onToggle={() => toggleShow('openaiKey')}
              link="https://platform.openai.com/api-keys"
              linkLabel="Get key at platform.openai.com →"
            />
          </section>

          {/* External threat intel */}
          <section>
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-1">External Threat Intel APIs</h3>
            <p className="text-[10px] text-[#484f58] mb-3">
              All free with signup. Without keys, realistic simulated data is shown.
            </p>

            <ApiKeyField
              label="AbuseIPDB API Key"
              placeholder="Your AbuseIPDB key..."
              value={form.abuseipdbKey}
              onChange={v => update('abuseipdbKey', v)}
              show={show.abuseipdbKey}
              onToggle={() => toggleShow('abuseipdbKey')}
              link="https://www.abuseipdb.com/register"
              linkLabel="Free signup at abuseipdb.com →"
              badge="Free"
            />

            <ApiKeyField
              label="VirusTotal API Key"
              placeholder="Your VirusTotal key..."
              value={form.virusTotalKey}
              onChange={v => update('virusTotalKey', v)}
              show={show.virusTotalKey}
              onToggle={() => toggleShow('virusTotalKey')}
              link="https://www.virustotal.com/gui/join-us"
              linkLabel="Free signup at virustotal.com →"
              badge="Free · 4 req/min"
            />

            <ApiKeyField
              label="URLScan.io API Key"
              placeholder="Your URLScan key (optional)..."
              value={form.urlScanKey}
              onChange={v => update('urlScanKey', v)}
              show={show.urlScanKey}
              onToggle={() => toggleShow('urlScanKey')}
              link="https://urlscan.io/user/signup"
              linkLabel="Free signup at urlscan.io →"
              badge="Optional"
            />
          </section>

          {/* Internal data sources */}
          <section>
            <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">Internal Data Sources</h3>
            <div className="space-y-1.5">
              {[
                ['👤 Active Directory / LDAP', 'employees.csv', 'Live'],
                ['🖥️ CMDB (ServiceNow)', 'assets.csv', 'Live'],
                ['📊 SIEM (Microsoft Sentinel)', 'past_alerts.csv', 'Live'],
                ['🔍 Threat Watchlist', 'watchlist.csv', 'Live'],
                ['🌍 IP Geolocation (ip-api.com)', 'No key needed', 'Live · Free'],
              ].map(([label, source, status]) => (
                <div key={label} className="flex items-center justify-between text-xs p-2 bg-[#0d1117] border border-[#30363d] rounded-lg">
                  <span className="text-[#8b949e]">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[#484f58] font-mono text-[10px]">{source}</span>
                    <span className="text-green-400 text-[10px]">✓ {status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[#30363d]">
          <p className="text-[10px] text-[#484f58]">Keys stored in browser localStorage only</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[#8b949e] border border-[#30363d] rounded-lg hover:border-[#484f58] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              {saved ? <><CheckCircle size={12} /> Saved!</> : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiKeyField({ label, placeholder, value, onChange, show, onToggle, link, linkLabel, badge }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-[#8b949e]">{label}</label>
        <div className="flex items-center gap-2">
          {badge && <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded">{badge}</span>}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
              {linkLabel} <ExternalLink size={9} />
            </a>
          )}
        </div>
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 pr-9 py-2 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-blue-500/60 font-mono"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );
}
