/**
 * In-memory log buffer for real-time SSE progress updates.
 */

const MAX_ENTRIES = 500;
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

let logs = [];

export function addLog(source, message, level = "info") {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
  console.log(`[${source}] ${message}`);
  logs.push(entry);
  // Prune old entries
  const cutoff = Date.now() - MAX_AGE_MS;
  logs = logs.filter((e) => new Date(e.timestamp).getTime() > cutoff);
  if (logs.length > MAX_ENTRIES) {
    logs = logs.slice(logs.length - MAX_ENTRIES);
  }
}

export function getLogs(since) {
  if (!since) return [...logs];
  const sinceDate = new Date(since).getTime();
  return logs.filter((e) => new Date(e.timestamp).getTime() > sinceDate);
}

export function clearLogs() {
  logs = [];
}
