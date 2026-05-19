/**
 * Team Schedules — recurring orchestrator runs bound to a team.
 *
 * A schedule fires by:
 *   1. Creating a chat owned by the schedule's owner with active_team_id set
 *   2. Posting the schedule's prompt to that chat via an internal HTTP call
 *      to /api/chats/:id/messages (drains the SSE stream server-side)
 *   3. Recording a row in team_schedule_runs and updating last_run_at / next_run_at
 *
 * The polling loop (started from server/index.js) calls runDueSchedules()
 * once a minute. cron_expression is parsed by cron-parser.
 */
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';
import { dbGet, dbAll, dbRun } from '../database.js';
import { getTeam } from './teams.js';

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

export function validateCron(expression, timezone = 'UTC') {
  CronExpressionParser.parse(expression, { tz: timezone });
}

export function computeNextRun(expression, timezone = 'UTC', after = new Date()) {
  const interval = CronExpressionParser.parse(expression, {
    tz: timezone,
    currentDate: after,
  });
  return interval.next().toDate().toISOString();
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listSchedulesForTeam(db, teamId) {
  return dbAll(
    db,
    `SELECT * FROM team_schedules WHERE team_id = ? ORDER BY created_at ASC`,
    [teamId],
  );
}

export function getSchedule(db, scheduleId) {
  return dbGet(db, 'SELECT * FROM team_schedules WHERE id = ?', [scheduleId]);
}

export function createSchedule(db, ownerId, teamId, fields) {
  const {
    name = null,
    cron_expression,
    timezone = 'UTC',
    prompt,
    enabled = 1,
  } = fields;

  if (!cron_expression) throw new Error('cron_expression is required');
  if (!prompt || !prompt.trim()) throw new Error('prompt is required');
  validateCron(cron_expression, timezone);

  const id = uuidv4();
  const now = new Date().toISOString();
  const nextRunAt = enabled ? computeNextRun(cron_expression, timezone) : null;

  dbRun(
    db,
    `INSERT INTO team_schedules
       (id, team_id, owner_id, name, cron_expression, timezone, prompt, enabled, last_run_at, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, teamId, ownerId, name, cron_expression, timezone, prompt, enabled ? 1 : 0, nextRunAt, now, now],
  );

  return getSchedule(db, id);
}

export function updateSchedule(db, scheduleId, fields) {
  const existing = getSchedule(db, scheduleId);
  if (!existing) return null;

  const merged = { ...existing, ...fields };
  if (merged.cron_expression) {
    validateCron(merged.cron_expression, merged.timezone || 'UTC');
  }

  const willBeEnabled = merged.enabled ? 1 : 0;
  const cronChanged = fields.cron_expression && fields.cron_expression !== existing.cron_expression;
  const tzChanged = fields.timezone && fields.timezone !== existing.timezone;
  const enabledChanged = 'enabled' in fields && willBeEnabled !== existing.enabled;

  let nextRunAt = existing.next_run_at;
  if (willBeEnabled && (cronChanged || tzChanged || enabledChanged)) {
    nextRunAt = computeNextRun(merged.cron_expression, merged.timezone || 'UTC');
  } else if (!willBeEnabled) {
    nextRunAt = null;
  }

  const now = new Date().toISOString();
  dbRun(
    db,
    `UPDATE team_schedules
       SET name = ?, cron_expression = ?, timezone = ?, prompt = ?, enabled = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      merged.name ?? null,
      merged.cron_expression,
      merged.timezone || 'UTC',
      merged.prompt,
      willBeEnabled,
      nextRunAt,
      now,
      scheduleId,
    ],
  );

  return getSchedule(db, scheduleId);
}

export function deleteSchedule(db, scheduleId) {
  dbRun(db, 'DELETE FROM team_schedules WHERE id = ?', [scheduleId]);
}

export function listRuns(db, scheduleId, limit = 20) {
  return dbAll(
    db,
    `SELECT * FROM team_schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?`,
    [scheduleId, limit],
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Execute a single schedule. Creates a chat, posts the prompt, drains the SSE
 * stream until the orchestrator finishes (or errors), and records a run row.
 *
 * Returns the team_schedule_runs row after completion.
 */
export async function runSchedule(db, scheduleId, { port } = {}) {
  const sched = getSchedule(db, scheduleId);
  if (!sched) throw new Error(`schedule ${scheduleId} not found`);

  const team = getTeam(db, sched.team_id);
  if (!team) throw new Error(`team ${sched.team_id} not found`);

  const startedAt = new Date().toISOString();
  const chatId = uuidv4();
  const title = sched.name || `[scheduled] ${team.name}`;
  const defaultModel = process.env.SCHEDULE_DEFAULT_MODEL || 'gemini';

  dbRun(
    db,
    `INSERT INTO chats (id, user_id, project_id, title, model, temperature, system_prompt, is_shared, active_team_id, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 0.7, NULL, 0, ?, ?, ?)`,
    [chatId, sched.owner_id, title, defaultModel, sched.team_id, startedAt, startedAt],
  );

  const runId = uuidv4();
  dbRun(
    db,
    `INSERT INTO team_schedule_runs (id, schedule_id, chat_id, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`,
    [runId, scheduleId, chatId, startedAt],
  );

  const targetPort = port || process.env.PORT || 3000;
  let runError = null;

  try {
    const resp = await fetch(`http://127.0.0.1:${targetPort}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': sched.owner_id,
      },
      body: JSON.stringify({ content: sched.prompt }),
    });

    if (!resp.ok) {
      throw new Error(`chat endpoint returned ${resp.status}`);
    }

    // Drain SSE until the server ends the stream. The chat handler persists
    // its own messages and agent_run rows; we only need to wait for completion.
    if (resp.body) {
      const reader = resp.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // The chat handler swallows AI-side errors and writes them as a normal
    // assistant message (e.g. "The AI service could not authenticate...").
    // Without this check those runs look healthy. Reuse the same prefix list
    // the chat handler uses to suppress usage logging.
    const lastAssistant = dbGet(
      db,
      `SELECT content FROM messages
       WHERE chat_id = ? AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 1`,
      [chatId],
    );
    if (!lastAssistant) {
      runError = 'no assistant response was produced';
    } else {
      const c = lastAssistant.content || '';
      if (
        c.startsWith('The AI service') ||
        c.startsWith('Sorry, I was unable') ||
        c.startsWith('The AI model')
      ) {
        runError = c.length > 240 ? c.slice(0, 240) + '…' : c;
      }
    }
  } catch (err) {
    runError = err?.message || String(err);
  }

  const finishedAt = new Date().toISOString();
  dbRun(
    db,
    `UPDATE team_schedule_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?`,
    [runError ? 'error' : 'success', runError, finishedAt, runId],
  );

  // Always advance next_run_at, even on error — a hung downstream shouldn't
  // wedge the schedule into a tight retry loop.
  const nextRunAt = sched.enabled
    ? computeNextRun(sched.cron_expression, sched.timezone || 'UTC')
    : null;

  dbRun(
    db,
    `UPDATE team_schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
    [finishedAt, nextRunAt, finishedAt, scheduleId],
  );

  return dbGet(db, 'SELECT * FROM team_schedule_runs WHERE id = ?', [runId]);
}

/**
 * Find every enabled schedule whose next_run_at has passed and run them.
 * Runs sequentially to avoid a thundering herd of orchestrator turns.
 */
export async function runDueSchedules(db, { port } = {}) {
  const nowIso = new Date().toISOString();
  const due = dbAll(
    db,
    `SELECT id FROM team_schedules
     WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?`,
    [nowIso],
  );

  for (const row of due) {
    try {
      await runSchedule(db, row.id, { port });
    } catch (err) {
      console.error('[team-schedules] runSchedule failed for', row.id, err?.message || err);
    }
  }

  return due.length;
}

let pollHandle = null;

/**
 * Start the polling loop. Runs every `intervalMs` (default 60s).
 * Idempotent — calling twice does nothing the second time.
 */
export function startScheduleLoop(db, { port, intervalMs = 60_000 } = {}) {
  if (pollHandle) return;
  const tick = async () => {
    try {
      await runDueSchedules(db, { port });
    } catch (err) {
      console.error('[team-schedules] poll tick failed:', err?.message || err);
    }
  };
  pollHandle = setInterval(tick, intervalMs);
  if (typeof pollHandle.unref === 'function') pollHandle.unref();
  // Run once on boot so a server that was down through a fire window catches up.
  setTimeout(tick, 5_000);
}

export function stopScheduleLoop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}
