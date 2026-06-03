import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Shield, ArrowLeft, User, AlertTriangle, ExternalLink } from 'lucide-react';
import { lookupUser, loadCSV } from '../services/csvService.js';
import RiskTimeline from '../components/RiskTimeline.jsx';
import KillChainStrip from '../components/KillChainStrip.jsx';

export default function UserPage() {
  const { userId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [pastAlerts, setPastAlerts] = useState([]);

  useEffect(() => {
    lookupUser(userId).then(d => { setData(d); setLoading(false); });
    loadCSV('alerts.csv').then(rows => setAlerts(rows.filter(a => a.user_id === userId)));
    loadCSV('past_alerts.csv').then(rows => setPastAlerts(rows.filter(a => a.user_id === userId)));
  }, [userId]);

  const risk = parseInt(data?.risk_score) || 0;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-[#e2eaf5]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#0f1629] border-b border-[#1e2d4a]">
        <div className="flex items-center gap-3">
          <Shield className="text-[#00d4ff]" size={20} />
          <span className="font-bold text-sm text-white">Acme Corp SOC</span>
          <span className="text-[#7a9cc0] text-xs">· User Profile</span>
        </div>
        <Link to="/" className="flex items-center gap-1.5 text-xs text-[#7a9cc0] hover:text-[#00d4ff] transition-colors">
          <ArrowLeft size={13} /> Back to Alert Queue
        </Link>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-[#7a9cc0] gap-2">
            <span className="spinner" /> Loading user profile...
          </div>
        ) : !data ? (
          <div className="text-center py-16">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-white font-semibold">User not found: {userId}</p>
            <p className="text-[#7a9cc0] text-sm mt-1">This user ID doesn't exist in the employee directory.</p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="flex items-start gap-5 mb-8">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
                <User size={28} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">{data.full_name}</h1>
                  <span className={`px-2.5 py-1 text-xs rounded-full border font-medium ${
                    data.status === 'active'
                      ? 'bg-green-500/10 text-green-400 border-green-500/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30'
                  }`}>{data.status}</span>
                  <span className={`px-2.5 py-1 text-xs rounded-full border font-medium ${
                    risk > 70 ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                    risk > 40 ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                    'bg-green-500/10 text-green-400 border-green-500/30'
                  }`}>Risk: {data.risk_score}/100</span>
                </div>
                <p className="text-[#7a9cc0] mt-1">{data.title} · {data.department}</p>
                <p className="text-[#7a9cc0] text-sm">{data.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Identity */}
              <Card title="Identity">
                <Row label="Employee ID" value={data.user_id} mono />
                <Row label="Department" value={data.department} />
                <Row label="Title" value={data.title} />
                <Row label="Manager" value={data.manager} />
                <Row label="Location" value={data.location} />
                <Row label="Type" value={data.employee_type} />
                <Row label="Start date" value={data.start_date} />
                {data.end_date && <Row label="End date" value={data.end_date} highlight="red" />}
              </Card>

              {/* Access & risk */}
              <Card title="Access & Risk">
                <Row label="MFA enabled" value={data.mfa_enabled} highlight={data.mfa_enabled === 'yes' ? 'green' : 'red'} />
                <Row label="VPN access" value={data.vpn_access} />
                <Row label="Admin access" value={data.admin_access} highlight={data.admin_access === 'yes' ? 'orange' : undefined} />
                <Row label="Risk score" value={`${data.risk_score} / 100`} highlight={risk > 70 ? 'red' : risk > 40 ? 'orange' : 'green'} />
              </Card>

              {/* Last activity */}
              <Card title="Last Activity">
                <Row label="Last login" value={data.last_login ? new Date(data.last_login).toLocaleString() : '—'} />
                <Row label="IP address" value={data.last_login_ip} mono />
                <Row label="Location" value={data.last_login_location} />
                {data.notes && (
                  <div className="mt-3 pt-3 border-t border-[#1e2d4a]">
                    <p className="text-[10px] text-[#7a9cc0] uppercase tracking-wider mb-1">Analyst Notes</p>
                    <p className="text-xs text-yellow-300 leading-relaxed">{data.notes}</p>
                  </div>
                )}
              </Card>
            </div>

            {/* Risk timeline */}
            <div className="mt-8">
              <RiskTimeline alerts={alerts} pastAlerts={pastAlerts} />
            </div>

            {/* Kill chain */}
            <div className="mt-4">
              <KillChainStrip alerts={alerts} pastAlerts={pastAlerts} />
            </div>

            {/* Alert history */}
            {(alerts.length > 0 || pastAlerts.length > 0) && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-white mb-4">Alert History</h2>
                <div className="space-y-6">
                  {alerts.length > 0 && (
                    <AlertTable title="Open Alerts" rows={alerts} />
                  )}
                  {pastAlerts.length > 0 && (
                    <AlertTable title="Past Alerts" rows={pastAlerts} historical />
                  )}
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
                {!historical ? (
                  <Link to={`/alerts/${a.alert_id}`} className="font-mono text-[#00d4ff] hover:text-white transition-colors">{a.alert_id}</Link>
                ) : (
                  <span className="font-mono">{a.alert_id}</span>
                )}
                <span>·</span>
                <span>{a.category}</span>
                {a.timestamp && <><span>·</span><span>{new Date(a.timestamp).toLocaleDateString()}</span></>}
                {historical && a.verdict && (
                  <><span>·</span>
                  <span className={a.verdict === 'True Positive' ? 'text-red-400' : 'text-green-400'}>{a.verdict}</span></>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
