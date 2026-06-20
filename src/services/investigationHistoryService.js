import fs from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const CSV_FILE = path.join(DATA_DIR, 'investigation_history.csv');

// CSV column order (matches schema in implementation plan)
const CSV_HEADER = 'alert_id,timestamp,mode,verdict,ai_score,analyst_decision,accuracy_flag,tools_used,investigation_time_sec,kill_chain_tactics,asset_criticality,data_sensitivity';

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Initialize CSV with header if not exists
function ensureCSVHeader() {
  ensureDataDir();
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, CSV_HEADER + '\n', 'utf-8');
  }
}

// Escape CSV field (handle quotes, commas, newlines)
function escapeCSVField(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Parse CSV line into object
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  const headers = CSV_HEADER.split(',');
  const obj = {};
  headers.forEach((header, i) => {
    obj[header.trim()] = fields[i] ? fields[i].trim() : '';
  });
  return obj;
}

// Convert investigation object to CSV row
function investigationToCSVRow(investigation) {
  const {
    alertId,
    timestamp = new Date().toISOString(),
    mode,
    verdict,
    aiScore,
    analystDecision = '',
    accuracyFlag = '',
    toolsUsed = [],
    investigationTimeSec = 0,
    killChainTactics = [],
    assetCriticality = '',
    dataSensitivity = ''
  } = investigation;

  // Convert arrays to pipe-delimited strings
  const toolsStr = Array.isArray(toolsUsed) ? toolsUsed.join('|') : toolsUsed;
  const tacticsStr = Array.isArray(killChainTactics) ? killChainTactics.join('|') : killChainTactics;

  const fields = [
    alertId,
    timestamp,
    mode,
    verdict,
    aiScore,
    analystDecision,
    accuracyFlag,
    toolsStr,
    investigationTimeSec,
    tacticsStr,
    assetCriticality,
    dataSensitivity
  ];

  return fields.map(escapeCSVField).join(',');
}

// Convert CSV row to investigation object
function csvRowToInvestigation(line) {
  return parseCSVLine(line);
}

/**
 * Save a new investigation to CSV
 * @param {Object} investigation - Investigation data
 * @returns {Object} - { id, savedAt, historyCount }
 */
export async function saveInvestigation(investigation) {
  ensureCSVHeader();

  try {
    const csvRow = investigationToCSVRow(investigation);
    const timestamp = investigation.timestamp || new Date().toISOString();

    // Append to CSV
    fs.appendFileSync(CSV_FILE, csvRow + '\n', 'utf-8');

    // Get count of investigations
    const content = fs.readFileSync(CSV_FILE, 'utf-8');
    const historyCount = content.split('\n').length - 2; // Subtract header and trailing newline

    return {
      id: `${investigation.alertId}-${timestamp}`,
      savedAt: timestamp,
      historyCount
    };
  } catch (err) {
    throw new Error(`Failed to save investigation: ${err.message}`);
  }
}

/**
 * Retrieve all investigation history
 * @returns {Array} - Array of investigation objects
 */
export async function getInvestigationHistory() {
  ensureCSVHeader();

  try {
    const content = fs.readFileSync(CSV_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith(CSV_HEADER));

    return lines.map(line => csvRowToInvestigation(line));
  } catch (err) {
    throw new Error(`Failed to retrieve investigation history: ${err.message}`);
  }
}

/**
 * Retrieve investigations for a specific alert
 * @param {string} alertId - Alert ID to filter by
 * @returns {Array} - Investigations for this alert
 */
export async function getInvestigationsForAlert(alertId) {
  const history = await getInvestigationHistory();
  return history.filter(inv => inv.alert_id === alertId);
}

/**
 * Retrieve investigations for a specific mode
 * @param {string} mode - Workflow mode (standard/adaptive/parallel/chain)
 * @returns {Array} - Investigations in this mode
 */
export async function getInvestigationsByMode(mode) {
  const history = await getInvestigationHistory();
  return history.filter(inv => inv.mode === mode);
}

/**
 * Compute accuracy statistics
 * @returns {Object} - Overall accuracy metrics
 */
export async function computeAccuracyStats() {
  const history = await getInvestigationHistory();

  const total = history.filter(inv => inv.accuracy_flag).length;
  const correct = history.filter(inv => inv.accuracy_flag === 'correct').length;
  const incorrect = history.filter(inv => inv.accuracy_flag === 'incorrect').length;

  const byMode = {};
  ['standard', 'adaptive', 'parallel', 'chain'].forEach(mode => {
    const modeInvs = history.filter(inv => inv.mode === mode && inv.accuracy_flag);
    const modeCorrect = modeInvs.filter(inv => inv.accuracy_flag === 'correct').length;
    byMode[mode] = {
      total: modeInvs.length,
      correct: modeCorrect,
      accuracy: modeInvs.length > 0 ? (modeCorrect / modeInvs.length).toFixed(2) : 'N/A'
    };
  });

  return {
    overall_accuracy: total > 0 ? (correct / total).toFixed(2) : 'N/A',
    total_investigations: history.length,
    verified_investigations: total,
    correct,
    incorrect,
    by_mode: byMode
  };
}
