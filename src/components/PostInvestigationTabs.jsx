import { useState } from 'react';
import PlaybookPanel from './PlaybookPanel.jsx';
import SimilarCasesPanel from './SimilarCasesPanel.jsx';
import TracePanel from './TracePanel.jsx';
import McpRegistryPanel from './McpRegistryPanel.jsx';

export default function PostInvestigationTabs({ alert, summary, settings, trace }) {
  const verdict = summary?.verdict;
  const hasPlaybook = verdict === 'TRUE_POSITIVE' || verdict === 'NEEDS_ESCALATION';

  const tabs = [
    ...(hasPlaybook ? [{ id: 'playbook', label: 'Remediation Playbook' }] : []),
    { id: 'similar', label: 'Similar Cases' },
    { id: 'trace',   label: 'Agent Trace' },
    { id: 'mcp',     label: 'MCP Tools' },
  ];

  const [activeTab, setActiveTab] = useState(hasPlaybook ? 'playbook' : 'similar');

  return (
    <div>
      {/* Tab strip */}
      <div className="flex border-b border-[#30363d] bg-[#0d1117] rounded-t-xl overflow-hidden">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-white border-b-2 border-[#00d4ff] bg-[#161b22]'
                : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22]/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content — all mounted, inactive hidden to preserve state */}
      {hasPlaybook && (
        <div style={{ display: activeTab === 'playbook' ? 'block' : 'none' }}>
          <PlaybookPanel alert={alert} summary={summary} settings={settings} />
        </div>
      )}
      <div style={{ display: activeTab === 'similar' ? 'block' : 'none' }}>
        <SimilarCasesPanel alert={alert} />
      </div>
      <div style={{ display: activeTab === 'trace' ? 'block' : 'none' }}>
        <TracePanel trace={trace} />
      </div>
      <div style={{ display: activeTab === 'mcp' ? 'block' : 'none' }}>
        <McpRegistryPanel trace={trace} />
      </div>
    </div>
  );
}
