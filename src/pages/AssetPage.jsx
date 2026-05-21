import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Shield, ArrowLeft, Monitor, AlertTriangle, ExternalLink, User } from 'lucide-react';
import { lookupAsset, lookupUser, loadCSV } from '../services/csvService.js';

export default function AssetPage() {
  const { hostname } = useParams();
  const [data, setData] = useState(null);
  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [pastAlerts, setPastAlerts] = useState([]);

  useEffect(() => {
    lookupAsset(hostname).then(async d => {
      setData(d);
      setLoading(false);
      if (d?.owner_user_id) {
        const u = await lookupUser(d.owner_user_id);
        setOwner(u);
      }
    });
    loadCSV('alerts.csv').then(rows => setAlerts(rows.filter(a => a.hostname === hostname)));
    loadCSV('past_alerts.csv').then(rows => setPastAlerts(rows.filter(a => a.hostname === hostname)));
  }, [hostname]);

  const critColor = { Critical: 'red', High: 'orange', Medium: 'yellow', Low: 'green' }[data?.criticality];
  const patch = parseInt(data?.patch_level) || 0;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-[#e2eaf5]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#0f1629] border-b border-[#1e2d4a]">
        <div className="flex items-center gap-3">
          <Shield className="text-[#00d4ff]" size={20} />
          <span className="font-bold text-sm text-white">Acme Corp SOC</span>
          <span className="text-[#7a9cc0] text-xs">· Asset Profile</span>
        </div>
        <Link to="/" className="flex items-center gap-1.5 text-xs text-[#7a9cc0] hover:text-[#00d4ff] transition-colors">
          <ArrowLeft size={13} /> Back to Alert Queue
        </Link>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-[#7a9cc0] gap-2">
            <span className="spinner" /> Loading asset profile...
          </div>
        ) : !data ? (
          <div className="text-center py-16">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-white font-semibold">Asset not found: {hostname}</p>
            <p className="text-[#7a9cc0] text-sm mt-1">This hostname doesn't exist in the CMDB.</p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="flex items-start gap-5 mb-8">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
                <Monitor size={28} className="text-purple-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold text-white font-mono">{data.hostname}</h1>
                  <span className={`px-2.5 py-1 text-xs rounded-full border font-medium ${
                    critColor === 'red' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    critColor === 'orange' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                    critColor === 'yellow' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                    'bg-green-500/10 text-green-400 border-green-500/30'
                  }`}>{data.criticality}</span>
                  <span className={`px-2.5 py-1 text-xs rounded-full border font-medium ${
                    patch < 90 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'
                  }`}>Patch: {data.patch_level}</span>
                </div>
                <p className="text-[#7a9cc0] mt-1">{data.type} · {data.os}</p>
                <p className="text-[#7a9cc0] text-sm font-mono">{data.ip_address}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Device details */}
              <Card title="Device">
                <Row label="Asset ID" value={data.asset_id} mono />
                <Row label="Type" value={data.type} />
                <Row label="OS" value={data.os} />
                <Row label="IP address" value={data.ip_address} mono />
                <Row label="Department" value={data.department} />
                <Row label="Location" value={data.location} />
                <Row label="Last seen" value={data.last_seen ? new Date(data.last_seen).toLocaleString() : '—'} />
              </Card>

              {/* Security posture */}
              <Card title="Security Posture">
                <Row label="Criticality" value={data.criticality} highlight={critColor} />
                <Row label="Patch level" value={data.patch_level} highlight={patch < 90 ? 'yellow' : 'green'} />
                <Row label="Antivirus" value={data.antivirus} highlight={data.antivirus ? 'green' : 'red'} />
                <Row label="EDR" value={data.edr_installed} highlight={data.edr_installed !== 'No' ? 'green' : 'red'} />
                <Row label="Encrypted" value={data.encrypted} highlight={data.encrypted === 'yes' ? 'green' : 'red'} />
                <Row label="Critical vulns" value={data.open_vulns_critical} highlight={parseInt(data.open_vulns_critical) > 0 ? 'red' : 'green'} />
                <Row label="High vulns" value={data.open_vulns_high} highlight={parseInt(data.open_vulns_high) > 0 ? 'orange' : 'green'} />
              </Card>

              {/* Owner */}
              <Card title="Owner">
                {owner ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                        <User size={14} className="text-blue-400" />
                      </div>
                      <div>
                        <div className="text-sm text-white font-medium">{owner.full_name}</div>
                        <div className="text-[10px] text-[#7a9cc0]">{owner.title}</div>
                      </div>
                    </div>
                    <Row label="Department" value={owner.department} />
                    <Row label="Risk score" value={`${owner.risk_score}/100`} highlight={parseInt(owner.risk_score) > 70 ? 'red' : parseInt(owner.risk_score) > 40 ? 'orange' : 'green'} />
                    <Row label="Status" value={owner.status} highlight={owner.status === 'active' ? 'green' : 'red'} />
                    <div className="mt-3">
                      <Link to={`/users/${data.owner_user_id}`} className="flex items-center gap-1.5 text-[11px] text-[#00d4ff] hover:text-white transition-colors">
                        <ExternalLink size={11} /> View full profile
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[#7a9cc0]">{data.owner_user_id || 'No owner assigned'}</p>
                )}
                {data.notes && (
                  <div className="mt-3 pt-3 border-t border-[#1e2d4a]">
                    <p className="text-[10px] text-[#7a9cc0] uppercase tracking-wider mb-1">Notes</p>
                    <p className="text-xs text-yellow-300 leading-relaxed">{data.notes}</p>
                  </div>
                )}
              </Card>
            </div>

            {/* Alert history */}
            {(alerts.length > 0 || pastAlerts.length > 0) && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-white mb-4">Alert History</h2>
                <div className="space-y-6">
                  {alerts.length > 0 && <AlertTable title="Open Alerts" rows={alerts} />}
                  {pastAlerts.length > 0 && <AlertTable title="Past Alerts" rows={pastAlerts} historical />}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-xl p-5">
      <h3 className="text-xs font-semibold text-[#7a9cc0] uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, highlight, mono }) {
  const color = highlight === 'red' ? 'text-red-400' : highlight === 'green' ? 'text-green-400' :
    highlight === 'yellow' ? 'text-yellow-400' : highlight === 'orange' ? 'text-orange-400' : 'text-[#e2eaf5]';
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-[#1e2d4a]/50 last:border-0">
      <span className="text-[10px] text-[#7a9cc0] shrink-0">{label}</span>
      <span className={`text-xs text-right ${color} ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

const SEV_COLOR = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  High: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  Medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  Low: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

function AlertTable({ title, rows, historical }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[#7a9cc0] uppercase tracking-wider mb-2">{title}</h3>
      <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-xl overflow-hidden">
        {rows.map((a, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-[#1e2d4a] last:border-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${SEV_COLOR[a.severity] || ''}`}>{a.severity}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white font-medium leading-snug">{a.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#7a9cc0]">
                <span className="font-mono">{a.alert_id}</span>
                <span>·</span>
                <span>{a.category}</span>
                {a.timestamp && <><span>·</span><span>{new Date(a.timestamp).toLocaleDateString()}</span></>}
                {historical && a.verdict && (
                  <><span>·</span>
                  <span className={a.verdict === 'True Positive' ? 'text-red-400' : 'text-green-400'}>{a.verdict}</span></>
                )}
              </div>
            </div>
            {!historical && (
              <Link to={`/alerts/${a.alert_id}`} className="shrink-0">
                <ExternalLink size={12} className="text-[#7a9cc0] hover:text-[#00d4ff]" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
