import { useState, useRef, useEffect } from 'react';
import { Send, Terminal } from 'lucide-react';
import { TOOLS, executeTool } from '../services/toolService.js';

// Pre-populate tool params from alert context
const PREFILL = {
  user_lookup:    (a) => ({ user_id: a.user_id || a.src_user || '' }),
  asset_lookup:   (a) => ({ hostname: a.hostname || a.src_host || '' }),
  siem_query:     (a) => ({ user_id: a.user_id || a.src_user || '', ip_address: a.src_ip || '' }),
  watchlist_check:(a) => ({ indicator: a.src_ip || '', type: 'ip' }),
  ip_geo:         (a) => ({ ip: a.src_ip || '' }),
  whois:          (a) => ({ ip: a.src_ip || '' }),
  abuseipdb:      (a) => ({ ip: a.src_ip || '' }),
  virustotal_ip:  (a) => ({ ip: a.src_ip || '' }),
  virustotal_url: (a) => ({ url: a.dst_ip || a.domain || '' }),
  urlscan:        (a) => ({ url: a.dst_ip || a.domain || '' }),
};

function highlightClass(color) {
  const map = { red: 'text-red-400', yellow: 'text-yellow-400', orange: 'text-orange-400', green: 'text-green-400' };
  return map[color] || 'text-[#e6edf3]';
}

function formatFields(toolName, result) {
  if (!result || result.error) return null;
  switch (toolName) {
    case 'user_lookup':
      if (!result.found) return [{ label: 'Status', value: 'User not found', color: 'red' }];
      return [
        { label: 'Name',    value: result.full_name || result.name || '' },
        { label: 'Dept',    value: result.department || '' },
        { label: 'Role',    value: result.job_title || result.role || '' },
        { label: 'Risk',    value: result.risk_score ? `${result.risk_score}/100` : '', color: parseInt(result.risk_score) > 70 ? 'red' : parseInt(result.risk_score) > 40 ? 'yellow' : 'green' },
        { label: 'Account', value: result.account_status || result.status || '' },
        { label: 'MFA',     value: String(result.mfa_enabled) === 'true' ? 'Enabled' : String(result.mfa_enabled) === 'false' ? 'Disabled' : '' },
      ].filter(f => f.value);
    case 'asset_lookup':
      if (!result.found) return [{ label: 'Status', value: 'Asset not found', color: 'red' }];
      return [
        { label: 'OS',          value: result.os || '' },
        { label: 'Patch',       value: result.patch_level || '' },
        { label: 'Criticality', value: result.criticality || '', color: result.criticality === 'Critical' ? 'red' : result.criticality === 'High' ? 'orange' : null },
        { label: 'EDR',         value: result.edr_status || '' },
        { label: 'Owner',       value: result.owner || '' },
      ].filter(f => f.value);
    case 'siem_query':
      return [
        { label: 'Past alerts', value: `${result.total_results || 0} found`, color: result.total_results > 5 ? 'red' : result.total_results > 0 ? 'yellow' : 'green' },
        ...(result.alerts?.slice(0, 3).map(a => ({
          label: a.alert_type || a.type || 'Alert',
          value: (a.description || a.alert_id || '').slice(0, 70),
        })) || []),
      ].filter(f => f.value);
    case 'watchlist_check':
      return [
        { label: 'Watchlist hit', value: (result.match || result.matched) ? 'YES — on watchlist' : 'No match', color: (result.match || result.matched) ? 'red' : 'green' },
        { label: 'Hits', value: String((result.indicators || result.hits || []).length) },
      ];
    case 'ip_geo':
      return [
        { label: 'Country', value: result.country || '' },
        { label: 'City',    value: result.city || '' },
        { label: 'ISP',     value: result.isp || result.org || '' },
        { label: 'Proxy',   value: result.proxy ? 'Yes' : 'No', color: result.proxy ? 'red' : null },
        { label: 'Hosting', value: result.hosting ? 'Yes' : 'No', color: result.hosting ? 'orange' : null },
      ].filter(f => f.value);
    case 'whois':
      return [
        { label: 'Org',     value: result.org || result.organization || '' },
        { label: 'ASN',     value: result.as || result.asn || '' },
        { label: 'Country', value: result.country || '' },
      ].filter(f => f.value);
    case 'abuseipdb':
      return [
        { label: 'Abuse score', value: `${result.abuseConfidenceScore ?? 0}%`, color: result.abuseConfidenceScore > 80 ? 'red' : result.abuseConfidenceScore > 40 ? 'yellow' : 'green' },
        { label: 'Reports',     value: String(result.totalReports ?? 0) },
        { label: 'Tor',         value: result.isTor ? 'Yes' : 'No', color: result.isTor ? 'red' : null },
        { label: 'ISP',         value: result.isp || '' },
      ].filter(f => f.value !== undefined && f.value !== '');
    case 'virustotal_ip':
    case 'virustotal_url':
      return [
        { label: 'Malicious',  value: `${result.malicious ?? 0} engines`, color: result.malicious > 5 ? 'red' : result.malicious > 0 ? 'yellow' : 'green' },
        { label: 'Suspicious', value: `${result.suspicious ?? 0} engines` },
      ];
    case 'urlscan':
      return [
        { label: 'Verdict', value: result.verdict || 'Unknown', color: result.verdict === 'malicious' ? 'red' : result.verdict === 'suspicious' ? 'yellow' : 'green' },
        { label: 'Scans',   value: String(result.total || 0) },
        { label: 'Tags',    value: (result.tags || []).join(', ') || '' },
      ].filter(f => f.value);
    default:
      return Object.entries(result).filter(([k]) => k !== 'duration_ms').slice(0, 6).map(([k, v]) => ({ label: k, value: String(v).slice(0, 60) }));
  }
}

function CheckCard({ check }) {
  const meta = TOOLS[check.tool];
  const ts = new Date(check.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (check.type !== 'tool') {
    return (
      <div className="border border-[#30363d] rounded-lg px-3 py-2.5 bg-[#0d1117]">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">Analyst check</span>
          <span className="text-[10px] text-[#4b5563] ml-auto">{ts}</span>
        </div>
        <div className="text-[11px] font-mono text-[#4b5563] italic mb-1">"{check.query}"</div>
        <div className="text-xs text-[#8b949e]">{check.error}</div>
      </div>
    );
  }

  const fields = formatFields(check.tool, check.result);

  return (
    <div className="border border-[#30363d] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#161b22]">
        <span className="text-sm">{meta?.icon || '⚙️'}</span>
        <code className="text-xs text-[#e6edf3] font-mono">{check.tool}</code>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">Analyst check</span>
        {check.loading
          ? <span className="text-[10px] text-[#8b949e] ml-auto animate-pulse">Running…</span>
          : <span className="text-[10px] text-[#4b5563] ml-auto">{ts}{check.result?.duration_ms ? ` · ${check.result.duration_ms}ms` : ''}</span>}
      </div>
      <div className="px-3 py-2.5 bg-[#0d1117]">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
          {Object.entries(check.params || {}).filter(([, v]) => v).map(([k, v]) => (
            <span key={k} className="text-[10px] text-[#8b949e]">
              <span className="text-[#4b5563]">{k}=</span>
              <span className="font-mono text-[#00d4ff]">{v}</span>
            </span>
          ))}
        </div>
        {check.loading && <div className="text-xs text-[#4b5563] animate-pulse">Fetching…</div>}
        {!check.loading && check.result?.error && <div className="text-xs text-red-400">{check.result.error}</div>}
        {!check.loading && fields && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-[11px] text-[#4b5563]">{f.label}:</span>
                <span className={`text-[11px] font-semibold ${highlightClass(f.color)}`}>{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParamChips({ params, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-[#21262d]">
      {Object.entries(params).map(([key, val]) => (
        <div key={key} className="flex items-center gap-0.5 bg-[#21262d] border border-[#30363d] rounded px-2 py-1">
          <span className="text-[10px] text-[#4b5563]">{key}=</span>
          <input
            value={val}
            onChange={e => onChange(prev => ({ ...prev, [key]: e.target.value }))}
            className="text-xs text-[#00d4ff] bg-transparent outline-none min-w-[50px] max-w-[160px] font-mono"
          />
        </div>
      ))}
      <span className="text-[10px] text-[#4b5563] self-center">· edit then press Enter to run</span>
    </div>
  );
}

export default function AnalystChatBox({ alert, settings, runId }) {
  // Storage key scoped to the specific run so checks don't bleed across runs
  const storageKey = runId ? `analyst-checks-${runId}` : `analyst-checks-${alert?.alert_id}`;

  const [input, setInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedTool, setSelectedTool] = useState(null);
  const [params, setParams] = useState({});
  const [checks, setChecks] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const inputRef = useRef(null);
  const checksEndRef = useRef(null);

  // Re-load checks when switching between runs
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setChecks(saved ? JSON.parse(saved) : []);
    } catch { setChecks([]); }
  }, [storageKey]);

  // Persist checks to localStorage so they survive navigation
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(checks));
  }, [checks, storageKey]);

  useEffect(() => {
    if (checks.length > 0) {
      checksEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [checks.length]);

  function getPrefilledParams(toolName) {
    if (!alert || !PREFILL[toolName]) return {};
    return PREFILL[toolName](alert);
  }

  function handleInputChange(e) {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/')) {
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      if (!val) { setSelectedTool(null); setParams({}); }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setInput('');
      setSelectedTool(null);
      setParams({});
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectTool(toolName) {
    setSelectedTool(toolName);
    setParams(getPrefilledParams(toolName));
    setInput(`/${toolName}`);
    setShowDropdown(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith('/')) {
      setChecks(prev => [...prev, {
        id: Date.now(), type: 'nl', query: trimmed,
        error: 'Natural language queries are not yet supported — use /tool_name syntax to call a specific tool.',
        timestamp: new Date().toISOString(),
      }]);
      setInput('');
      return;
    }

    const toolName = trimmed.slice(1).split(/\s/)[0];
    if (!TOOLS[toolName]) {
      setChecks(prev => [...prev, {
        id: Date.now(), type: 'unknown', query: trimmed,
        error: `Unknown tool: "${toolName}". Type / to see available tools.`,
        timestamp: new Date().toISOString(),
      }]);
      setInput('');
      setSelectedTool(null);
      setParams({});
      return;
    }

    const runParams = selectedTool === toolName ? params : getPrefilledParams(toolName);
    const checkId = Date.now();

    setChecks(prev => [...prev, {
      id: checkId, type: 'tool', tool: toolName, params: runParams,
      result: null, loading: true, timestamp: new Date().toISOString(),
    }]);
    setInput('');
    setSelectedTool(null);
    setParams({});

    try {
      const result = await executeTool(toolName, runParams, settings);
      setChecks(prev => prev.map(c => c.id === checkId ? { ...c, result, loading: false } : c));
    } catch (err) {
      setChecks(prev => prev.map(c => c.id === checkId ? { ...c, result: { error: err.message }, loading: false } : c));
    }
  }

  const toolQuery = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
  const filteredTools = Object.entries(TOOLS).filter(([name]) => name.startsWith(toolQuery) || name.includes(toolQuery));

  return (
    <div className="border border-[#30363d] rounded-xl overflow-hidden mt-3">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
        <Terminal size={12} className="text-amber-400" />
        <span className="text-xs font-medium text-[#e6edf3]">Analyst Console</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20 font-mono">via MCP</span>
        <span className="text-[10px] text-[#4b5563] ml-auto">type / for tools · results logged as analyst checks</span>
      </div>

      {/* Check log */}
      {checks.length > 0 && (
        <div className="p-3 space-y-2 max-h-72 overflow-y-auto border-b border-[#21262d] bg-[#0d1117]">
          {checks.map(check => <CheckCard key={check.id} check={check} />)}
          <div ref={checksEndRef} />
        </div>
      )}

      {/* Tool autocomplete list — inline, never clipped by parent overflow */}
      {showDropdown && filteredTools.length > 0 && (
        <div className="bg-[#161b22] border-b border-[#30363d] max-h-56 overflow-y-auto">
          {filteredTools.map(([name, meta]) => (
            <button
              key={name}
              onMouseDown={e => { e.preventDefault(); selectTool(name); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#21262d] text-left transition-colors border-b border-[#21262d] last:border-0"
            >
              <span className="text-sm shrink-0">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-[#e6edf3] font-mono">{name}</code>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[#0d1117] text-[#8b949e] border border-[#30363d]">
                    {meta.category}
                  </span>
                </div>
                <p className="text-[10px] text-[#4b5563] truncate mt-0.5">{meta.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Param chips — shown when tool selected */}
      {selectedTool && Object.keys(params).length > 0 && (
        <ParamChips params={params} onChange={setParams} />
      )}

      {/* Input row */}
      <div className="bg-[#0d1117]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-[#4b5563] text-xs font-mono shrink-0 select-none">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type /tool_name to run a check, or ask a question…"
            className="flex-1 bg-transparent text-sm text-[#e6edf3] placeholder-[#4b5563] outline-none font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onMouseDown={e => { e.preventDefault(); handleSubmit(); }}
            disabled={!input.trim()}
            className="shrink-0 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 disabled:opacity-30 transition-colors"
          >
            <Send size={12} />
          </button>
        </div>
      </div>

    </div>
  );
}
