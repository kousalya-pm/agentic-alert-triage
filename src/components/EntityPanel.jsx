import { useState, useEffect } from 'react';
import { X, ExternalLink, Copy, Check, User, Monitor, AlertTriangle, ChevronRight } from 'lucide-react';
import { lookupUser, lookupAsset, loadCSV } from '../services/csvService.js';

export default function EntityPanel({ entity, onClose, onEntityClick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [relatedAlerts, setRelatedAlerts] = useState([]);

  const pageUrl = `${window.location.origin}/${entity.type === 'user' ? 'users' : 'assets'}/${entity.id}`;

  useEffect(() => {
    setLoading(true);
    setData(null);
    setRelatedAlerts([]);
    const lookup = entity.type === 'user' ? lookupUser(entity.id) : lookupAsset(entity.id);
    lookup.then(d => { setData(d); setLoading(false); });

    // Load related alerts from current queue
    loadCSV('alerts.csv').then(alerts => {
      const related = alerts.filter(a =>
        entity.type === 'user' ? a.user_id === entity.id : a.hostname === entity.id
      ).slice(0, 5);
      setRelatedAlerts(related);
    });
  }, [entity.type, entity.id]);

  const copyLink = () => {
    navigator.clipboard.writeText(pageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const SEV = {
    Critical: 'text-red-400 bg-red-500/10 border-red-500/30',
    High: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    Low: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  };

  return (
    <div className="w-80 shrink-0 flex flex-col border-l border-[#1e2d4a] bg-[#0a0f1e] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d4a] bg-[#0f1629] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            entity.type === 'user' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
          }`}>
            {entity.type === 'user' ? <User size={14} /> : <Monitor size={14} />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{entity.id}</div>
            <div className="text-[10px] text-[#7a9cc0]">{entity.type === 'user' ? 'Employee' : 'Asset'}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-[#7a9cc0] hover:text-white transition-colors shrink-0 ml-2">
          <X size={15} />
        </button>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e2d4a] bg-[#0a0f1e] shrink-0">
        <button
          onClick={() => window.open(pageUrl, '_blank')}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-md bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] hover:bg-[#00d4ff]/20 transition-colors"
        >
          <ExternalLink size={10} /> Open in new tab
        </button>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-md border border-[#1e2d4a] text-[#7a9cc0] hover:text-white hover:border-[#2a3f63] transition-colors"
        >
          {copied ? <><Check size={10} /> Copied!</> : <><Copy size={10} /> Copy link</>}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-[#7a9cc0] text-xs gap-2">
            <span className="spinner" style={{ width: 12, height: 12 }} /> Loading...
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-24 text-[#7a9cc0] text-xs">
            <AlertTriangle size={13} className="mr-2" /> Not found: {entity.id}
          </div>
        ) : entity.type === 'user' ? (
          <UserDetail data={data} onAssetClick={id => onEntityClick('asset', id)} />
        ) : (
          <AssetDetail data={data} onUserClick={id => onEntityClick('user', id)} />
        )}

        {/* Related alerts */}
        {relatedAlerts.length > 0 && (
          <div className="px-4 py-3 border-t border-[#1e2d4a]">
            <div className="text-[10px] text-[#7a9cc0] uppercase tracking-wider font-semibold mb-2">
              Related Alerts ({relatedAlerts.length})
            </div>
            <div className="space-y-1.5">
              {relatedAlerts.map(a => (
                <div key={a.alert_id} className="text-[10px] p-2 bg-[#0f1629] border border-[#1e2d4a] rounded-lg">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] ${SEV[a.severity] || ''}`}>{a.severity}</span>
                    <span className="text-[#7a9cc0] font-mono">{a.alert_id}</span>
                  </div>
                  <div className="text-[#e2eaf5] leading-snug line-clamp-2">{a.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, highlight, mono }) {
  const color = highlight === 'red' ? 'text-red-400' : highlight === 'green' ? 'text-green-400' :
    highlight === 'yellow' ? 'text-yellow-400' : highlight === 'orange' ? 'text-orange-400' : 'text-[#e2eaf5]';
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-[#1e2d4a]/50 last:border-0">
      <span className="text-[10px] text-[#7a9cc0] shrink-0 pt-0.5">{label}</span>
      <span className={`text-[11px] text-right ${color} ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="px-4 py-3 border-b border-[#1e2d4a]">
      <div className="text-[10px] text-[#7a9cc0] uppercase tracking-wider font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function UserDetail({ data, onAssetClick }) {
  const risk = parseInt(data.risk_score) || 0;
  const riskColor = risk > 70 ? 'red' : risk > 40 ? 'orange' : 'green';
  return (
    <>
      {/* Identity */}
      <Section title="Identity">
        <Field label="Full name" value={data.full_name} />
        <Field label="Email" value={data.email} mono />
        <Field label="Title" value={data.title} />
        <Field label="Department" value={data.department} />
        <Field label="Manager" value={data.manager} />
        <Field label="Location" value={data.location} />
        <Field label="Type" value={data.employee_type} />
      </Section>

      {/* Risk & access */}
      <Section title="Risk & Access">
        <Field label="Status" value={data.status} highlight={data.status === 'active' ? 'green' : 'red'} />
        <Field label="Risk score" value={`${data.risk_score} / 100`} highlight={riskColor} />
        <Field label="MFA" value={data.mfa_enabled} highlight={data.mfa_enabled === 'yes' ? 'green' : 'red'} />
        <Field label="VPN access" value={data.vpn_access} />
        <Field label="Admin access" value={data.admin_access} highlight={data.admin_access === 'yes' ? 'orange' : undefined} />
        <Field label="Start date" value={data.start_date} />
        {data.end_date && <Field label="End date" value={data.end_date} highlight="red" />}
      </Section>

      {/* Last activity */}
      <Section title="Last Activity">
        <Field label="Last login" value={data.last_login ? new Date(data.last_login).toLocaleString() : '—'} />
        <Field label="Last login IP" value={data.last_login_ip} mono />
        <Field label="Location" value={data.last_login_location} />
      </Section>

      {data.notes && (
        <Section title="Notes">
          <p className="text-[11px] text-yellow-300 leading-relaxed">{data.notes}</p>
        </Section>
      )}
    </>
  );
}

function AssetDetail({ data, onUserClick }) {
  const critColor = { Critical: 'red', High: 'orange', Medium: 'yellow', Low: 'green' }[data.criticality];
  const patch = parseInt(data.patch_level) || 0;
  return (
    <>
      {/* Identity */}
      <Section title="Device">
        <Field label="Hostname" value={data.hostname} mono />
        <Field label="Asset ID" value={data.asset_id} mono />
        <Field label="Type" value={data.type} />
        <Field label="OS" value={data.os} />
        <Field label="IP address" value={data.ip_address} mono />
        <Field label="Department" value={data.department} />
        <Field label="Location" value={data.location} />
      </Section>

      {/* Security */}
      <Section title="Security Posture">
        <Field label="Criticality" value={data.criticality} highlight={critColor} />
        <Field label="Patch level" value={data.patch_level} highlight={patch < 90 ? 'yellow' : 'green'} />
        <Field label="Antivirus" value={data.antivirus} highlight={data.antivirus ? 'green' : 'red'} />
        <Field label="EDR" value={data.edr_installed} highlight={data.edr_installed !== 'No' ? 'green' : 'red'} />
        <Field label="Encrypted" value={data.encrypted} highlight={data.encrypted === 'yes' ? 'green' : 'red'} />
        <Field label="Critical vulns" value={data.open_vulns_critical} highlight={parseInt(data.open_vulns_critical) > 0 ? 'red' : 'green'} />
        <Field label="High vulns" value={data.open_vulns_high} highlight={parseInt(data.open_vulns_high) > 0 ? 'orange' : 'green'} />
        <Field label="Last seen" value={data.last_seen ? new Date(data.last_seen).toLocaleString() : '—'} />
      </Section>

      {/* Owner */}
      {data.owner_user_id && (
        <Section title="Owner">
          <button
            onClick={() => onUserClick(data.owner_user_id)}
            className="flex items-center gap-2 text-[11px] text-[#00d4ff] hover:text-white transition-colors"
          >
            <User size={11} /> {data.owner_user_id} <ChevronRight size={11} />
          </button>
        </Section>
      )}

      {data.notes && (
        <Section title="Notes">
          <p className="text-[11px] text-yellow-300 leading-relaxed">{data.notes}</p>
        </Section>
      )}
    </>
  );
}
