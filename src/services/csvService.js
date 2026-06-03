import Papa from 'papaparse';

const cache = {};

export async function loadCSV(filename) {
  if (cache[filename]) return cache[filename];
  const response = await fetch(`/data/${filename}`);
  const text = await response.text();
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  cache[filename] = result.data;
  return result.data;
}

export async function lookupUser(userId) {
  const employees = await loadCSV('employees.csv');
  return employees.find(e => e.user_id === userId) || null;
}

export async function lookupAsset(hostname) {
  const assets = await loadCSV('assets.csv');
  return assets.find(a => a.hostname === hostname || a.ip_address === hostname) || null;
}

export async function queryPastAlerts(userId, srcIp, hostname = null, limit = 5) {
  const past = await loadCSV('past_alerts.csv');
  return past
    .filter(a =>
      (userId   && a.user_id  === userId)  ||
      (srcIp    && a.src_ip   === srcIp)   ||
      (hostname && a.hostname === hostname)
    )
    .slice(0, limit);
}

export async function checkWatchlist(indicator) {
  const watchlist = await loadCSV('watchlist.csv');
  return watchlist.filter(w =>
    w.active === 'yes' &&
    (w.indicator === indicator ||
     (indicator && indicator.includes(w.indicator)) ||
     (w.indicator && w.indicator.includes(indicator)))
  );
}

export async function loadAlerts() {
  return loadCSV('alerts.csv');
}
