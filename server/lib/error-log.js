import crypto from 'crypto';
import { dbRun, dbAll, dbGet, getDatabase } from '../database.js';

const MESSAGE_MAX = 2000;
const STACK_MAX = 8000;
const ROW_CAP = 5000;

function truncate(value, max) {
  if (value == null) return null;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function dedupKey(source, message, route) {
  return crypto
    .createHash('sha1')
    .update(`${source}|${message}|${route ?? ''}`)
    .digest('hex');
}

/**
 * Insert or upsert an error row. Never throws.
 *  - source: 'server' | 'client'
 *  - message: required (truncated to 2000)
 *  - route: Express route pattern or background-job name (nullable)
 *  - stack: optional (truncated to 8000); filled lazily via COALESCE
 *  - userAgent: optional (client errors only); first occurrence wins
 */
export function logError({ source, message, route, stack, userAgent }) {
  try {
    const db = getDatabase();
    if (!db) return;

    const safeSource = source ?? 'server';
    const safeMessage = truncate(message ?? 'Unknown error', MESSAGE_MAX);
    const safeStack = truncate(stack, STACK_MAX);
    const safeRoute = route ?? null;
    const safeUserAgent = userAgent ?? null;
    const key = dedupKey(safeSource, safeMessage, safeRoute);
    const now = new Date().toISOString();

    dbRun(
      db,
      `
      INSERT INTO error_log (source, message, route, stack, user_agent, count, first_seen, last_seen, dedup_key)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(dedup_key) DO UPDATE SET
        count = count + 1,
        last_seen = excluded.last_seen,
        stack = COALESCE(error_log.stack, excluded.stack)
      `,
      [safeSource, safeMessage, safeRoute, safeStack, safeUserAgent, now, now, key]
    );
  } catch (err) {
    // Never let error-logging break a request path
    // eslint-disable-next-line no-console
    console.error('[error-log] logError failed:', err);
  }
}

export function getErrors({ limit = 500 } = {}) {
  const db = getDatabase();
  if (!db) return [];
  return dbAll(
    db,
    `SELECT id, source, message, route, stack, user_agent, count, first_seen, last_seen
     FROM error_log
     ORDER BY last_seen DESC
     LIMIT ?`,
    [limit]
  );
}

export function clearErrors() {
  const db = getDatabase();
  if (!db) return;
  dbRun(db, `DELETE FROM error_log`, []);
}

/**
 * Delete rows older than 24h, then enforce a hard cap of ROW_CAP rows
 * (deletes the oldest beyond the cap). Never throws.
 */
export function pruneOldErrors() {
  try {
    const db = getDatabase();
    if (!db) return;

    dbRun(db, `DELETE FROM error_log WHERE datetime(last_seen) < datetime('now', '-24 hours')`, []);

    const countRow = dbGet(db, `SELECT COUNT(*) AS c FROM error_log`, []);
    const total = countRow?.c ?? 0;
    if (total > ROW_CAP) {
      const overflow = total - ROW_CAP;
      dbRun(
        db,
        `DELETE FROM error_log
         WHERE id IN (SELECT id FROM error_log ORDER BY last_seen ASC LIMIT ?)`,
        [overflow]
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[error-log] pruneOldErrors failed:', err);
    logError({
      source: 'server',
      message: `errorlog:prune failed: ${err?.message ?? err}`,
      route: 'errorlog:prune',
      stack: err?.stack,
    });
  }
}
