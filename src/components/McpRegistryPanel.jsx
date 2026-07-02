import { useState, useEffect } from 'react';
import { Plug, ChevronDown, ChevronRight } from 'lucide-react';

const MCP_BASE = 'http://localhost:3002';

const CATEGORY_META = {
  user_lookup:    { icon: '👤', category: 'Identity' },
  asset_lookup:   { icon: '🖥️', category: 'Endpoint' },
  siem_query:     { icon: '📊', category: 'SIEM' },
  watchlist_check:{ icon: '🔍', category: 'Threat Intel' },
  ip_geo:         { icon: '🌍', category: 'Network' },
  whois:          { icon: '🔎', category: 'Network' },
  abuseipdb:      { icon: '🚨', category: 'Threat Intel' },
  virustotal_ip:  { icon: '🦠', category: 'Threat Intel' },
  virustotal_url: { icon: '🦠', category: 'Threat Intel' },
  urlscan:        { icon: '🌐', category: 'Network' },
};

function SchemaField({ name, schema }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <code className="text-[#00d4ff] shrink-0">{name}</code>
      <span className="text-[#4b5563]">{schema.type}</span>
      {schema.required && <span className="text-red-400/70 text-[10px]">required</span>}
      <span className="text-[#8b949e] flex-1">{schema.description}</span>
    </div>
  );
}

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_META[tool.name] || { icon: '⚙️', category: 'Tool' };
  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];

  return (
    <div className="border border-[#30363d] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#161b22]/50 transition-colors"
      >
        <span className="text-sm shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-xs text-[#e6edf3] font-mono">{tool.name}</code>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
              {meta.category}
            </span>
          </div>
          <p className="text-[11px] text-[#8b949e] mt-0.5 leading-snug truncate">{tool.description}</p>
        </div>
        <div className="text-[#4b5563] shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-[#21262d] bg-[#0d1117]">
          <p className="text-[11px] text-[#8b949e] mt-2 mb-2 leading-relaxed">{tool.description}</p>
          {Object.keys(props).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-[#4b5563] uppercase tracking-wider mb-1">Input schema</p>
              {Object.entries(props).map(([k, v]) => (
                <SchemaField key={k} name={k} schema={{ ...v, required: required.includes(k) }} />
              ))}
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-[#21262d]">
            <code className="text-[10px] text-[#4b5563]">POST /mcp/call · tools/call · {tool.name}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default function McpRegistryPanel({ trace }) {
  const [tools, setTools] = useState([]);
  const [status, setStatus] = useState('connecting'); // connecting | online | offline

  useEffect(() => {
    fetch(`${MCP_BASE}/mcp/tools`)
      .then(r => r.json())
      .then(d => { setTools(d.tools || []); setStatus('online'); })
      .catch(() => setStatus('offline'));
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Server status */}
      <div className="flex items-center gap-2">
        <Plug size={13} className={status === 'online' ? 'text-green-400' : status === 'offline' ? 'text-red-400' : 'text-yellow-400'} />
        <span className="text-xs font-medium text-[#e6edf3]">acme-soc-tools</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
          status === 'online'  ? 'bg-green-500/10 text-green-400 border-green-500/30' :
          status === 'offline' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                                 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
        }`}>
          {status === 'online' ? 'MCP server online · port 3002' : status === 'offline' ? 'MCP server offline' : 'connecting…'}
        </span>
        <span className="text-[10px] text-[#4b5563] ml-auto">@modelcontextprotocol/sdk · stdio + HTTP</span>
      </div>

      {status === 'offline' && (
        <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
          Start the MCP server: <code className="text-[#00d4ff]">node mcp-server.js --http</code>
        </div>
      )}

      {/* Tool registry */}
      {tools.length > 0 && (
        <div>
          <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">
            {tools.length} registered tools
          </p>
          <div className="space-y-1.5">
            {tools.map(t => <ToolCard key={t.name} tool={t} />)}
          </div>
        </div>
      )}

      {/* Claude Desktop config */}
      <div className="border border-[#30363d] rounded-lg p-3 bg-[#0d1117]">
        <p className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2">Claude Desktop config</p>
        <pre className="text-[11px] text-[#e6edf3] font-mono leading-relaxed overflow-x-auto">{`{
  "mcpServers": {
    "acme-soc-tools": {
      "command": "node",
      "args": ["${typeof window !== 'undefined' ? window.location.hostname === 'localhost' ? '/path/to/mcp-server.js' : '/path/to/mcp-server.js' : '/path/to/mcp-server.js'}"]
    }
  }
}`}</pre>
        <p className="text-[10px] text-[#4b5563] mt-2">
          Replace with absolute path · restart Claude Desktop · tools appear automatically
        </p>
      </div>
    </div>
  );
}
