/**
 * Scheduled Task runner — executes a saved task by feeding its prompt
 * through claude-direct.js with the configured MCP servers attached.
 *
 * Designed to be invoked by:
 *   - Cloud Scheduler (cron) → POST /api/tasks/:id/run with OIDC token
 *   - The user clicking "Run now" in the UI
 *   - Claude itself, via the create_scheduled_task / run_scheduled_task tools
 *
 * Storage:
 *   - scheduled_tasks       — task definitions (one row per task)
 *   - scheduled_task_runs   — execution history (one row per run)
 *
 * Cron handling:
 *   We delegate the actual cron schedule to GCP Cloud Scheduler — it owns
 *   the firing logic. This module just computes a *display-only* next_run_at
 *   estimate and persists results when Cloud Scheduler invokes the run endpoint.
 *   This keeps the Node container free to scale to zero between invocations.
 */
import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbGet, dbRun, getDatabase } from '../database.js';
import { chatWithDocuments as claudeChat } from './claude-direct.js';
import mcpManager from './mcp-manager.js';

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function createTask(db, userId, fields) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const {
    name,
    description = null,
    prompt,
    model = null,
    system_prompt = null,
    project_id = null,
    mcp_servers = [],
    schedule_type = 'manual',
    cron_expression = null,
    timezone = 'UTC',
    enabled = 1,
    delivery = { type: 'notification' },
  } = fields;

  if (!name || !prompt) {
    throw new Error('name and prompt are required');
  }
  if (schedule_type === 'cron' && !cron_expression) {
    throw new Error('cron_expression is required when schedule_type is "cron"');
  }

  dbRun(db, `
    INSERT INTO scheduled_tasks (
      id, user_id, name, description, prompt, model, system_prompt,
      project_id, mcp_servers, schedule_type, cron_expression, timezone,
      enabled, delivery, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, userId, name, description, prompt, model, system_prompt,
    project_id, JSON.stringify(mcp_servers), schedule_type, cron_expression, timezone,
    enabled ? 1 : 0, JSON.stringify(delivery), now, now,
  ]);

  return getTask(db, id);
}

export function getTask(db, id) {
  const row = dbGet(db, 'SELECT * FROM scheduled_tasks WHERE id = ?', [id]);
  return row ? hydrate(row) : null;
}

export function listTasks(db, userId) {
  const rows = dbAll(db,
    'SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY updated_at DESC',
    [userId]
  );
  return rows.map(hydrate);
}

export function updateTask(db, id, fields) {
  const existing = getTask(db, id);
  if (!existing) throw new Error('Task not found');

  const merged = { ...existing, ...fields };
  const now = new Date().toISOString();

  dbRun(db, `
    UPDATE scheduled_tasks SET
      name = ?, description = ?, prompt = ?, model = ?, system_prompt = ?,
      project_id = ?, mcp_servers = ?, schedule_type = ?, cron_expression = ?,
      timezone = ?, enabled = ?, delivery = ?, updated_at = ?
    WHERE id = ?
  `, [
    merged.name, merged.description, merged.prompt, merged.model, merged.system_prompt,
    merged.project_id, JSON.stringify(merged.mcp_servers || []),
    merged.schedule_type, merged.cron_expression, merged.timezone,
    merged.enabled ? 1 : 0, JSON.stringify(merged.delivery || { type: 'notification' }),
    now, id,
  ]);

  return getTask(db, id);
}

export function deleteTask(db, id) {
  dbRun(db, 'DELETE FROM scheduled_task_runs WHERE task_id = ?', [id]);
  dbRun(db, 'DELETE FROM scheduled_tasks WHERE id = ?', [id]);
}

export function listRuns(db, taskId, limit = 20) {
  return dbAll(db, `
    SELECT * FROM scheduled_task_runs
    WHERE task_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `, [taskId, limit]);
}

function hydrate(row) {
  return {
    ...row,
    enabled: !!row.enabled,
    mcp_servers: safeJson(row.mcp_servers, []),
    delivery: safeJson(row.delivery, { type: 'notification' }),
  };
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Run a task once. Records a row in scheduled_task_runs, updates the task's
 * last_run_at / last_status, and dispatches the result per task.delivery.
 *
 * Returns { run, task, text } on success or throws on error after recording.
 */
export async function runTask(db, taskId, { trigger = 'manual', onStep = null } = {}) {
  const task = getTask(db, taskId);
  if (!task) throw new Error('Task not found');
  if (!task.enabled && trigger === 'scheduler') {
    return { skipped: true, reason: 'disabled' };
  }

  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  dbRun(db, `
    INSERT INTO scheduled_task_runs (id, task_id, started_at, status, trigger)
    VALUES (?, ?, ?, 'running', ?)
  `, [runId, taskId, startedAt, trigger]);

  try {
    // Resolve MCP tools for this task
    const { claudeTools, mcpToolMap } = await resolveMcpTools(db, task.mcp_servers || []);

    const result = await claudeChat(
      [],                              // no docs (project files could be wired later)
      task.prompt,
      [],                              // no chat history — fresh run
      task.system_prompt,
      task.user_id,
      onStep,
      task.model || null,
      { claudeTools, mcpToolMap, mcpManager, builtinToolMap: {}, images: [] }
    );

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    dbRun(db, `
      UPDATE scheduled_task_runs
      SET finished_at = ?, status = 'success', result_text = ?, duration_ms = ?
      WHERE id = ?
    `, [finishedAt, result.text || '', durationMs, runId]);

    dbRun(db, `
      UPDATE scheduled_tasks
      SET last_run_at = ?, last_status = 'success', last_error = NULL, updated_at = ?
      WHERE id = ?
    `, [finishedAt, finishedAt, taskId]);

    await dispatchResult(db, task, result.text || '');

    return { run: { id: runId, status: 'success' }, task, text: result.text };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const message = err?.message || String(err);

    dbRun(db, `
      UPDATE scheduled_task_runs
      SET finished_at = ?, status = 'error', error_message = ?, duration_ms = ?
      WHERE id = ?
    `, [finishedAt, message, Date.now() - startMs, runId]);

    dbRun(db, `
      UPDATE scheduled_tasks
      SET last_run_at = ?, last_status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `, [finishedAt, message, finishedAt, taskId]);

    throw err;
  }
}

/**
 * Look up the task's selected MCP servers and ask the manager for their tools.
 * Mirrors the shape claude-direct.js expects (claudeTools + mcpToolMap).
 */
async function resolveMcpTools(db, serverIds) {
  if (!serverIds || serverIds.length === 0) return { claudeTools: [], mcpToolMap: {} };

  const placeholders = serverIds.map(() => '?').join(',');
  const servers = dbAll(db,
    `SELECT * FROM mcp_servers WHERE enabled = 1 AND id IN (${placeholders})`,
    serverIds
  );

  const claudeTools = [];
  const mcpToolMap = {};

  for (const server of servers) {
    let tools = [];
    try {
      tools = await mcpManager.getTools(server);
    } catch (err) {
      console.warn(`[scheduler] failed to load tools for ${server.name}:`, err.message);
      continue;
    }
    for (const t of tools) {
      const namespaced = `${server.id}__${t.name}`;
      claudeTools.push({
        name: namespaced,
        description: t.description || '',
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      });
      mcpToolMap[namespaced] = {
        serverConfig: server,
        serverName: server.name,
        originalName: t.name,
      };
    }
  }
  return { claudeTools, mcpToolMap };
}

/**
 * Dispatch the run result to the user. Today: in-app notification.
 * Easy extensions: write a chat message, send email, post to Slack via MCP.
 */
async function dispatchResult(db, task, text) {
  const delivery = task.delivery || { type: 'notification' };

  if (delivery.type === 'notification') {
    const id = uuidv4();
    const preview = (text || '').slice(0, 240);
    dbRun(db, `
      INSERT INTO notifications (id, user_id, type, title, body, link_url, is_read, created_at)
      VALUES (?, ?, 'scheduled_task', ?, ?, ?, 0, ?)
    `, [
      id, task.user_id,
      `Task "${task.name}" finished`,
      preview,
      `/tasks/${task.id}`,
      new Date().toISOString(),
    ]);
    return;
  }

  // Future: 'chat' (append to a chat), 'email' (SendGrid), 'slack' (MCP), etc.
  console.log(`[scheduler] delivery type "${delivery.type}" not implemented; dropping result for task ${task.id}`);
}

// ---------------------------------------------------------------------------
// Tool-use definitions — exposed to Claude so it can manage tasks conversationally.
// Wire these into chatWithDocuments via the `claudeTools` arg + a builtinToolMap.
// ---------------------------------------------------------------------------

export const SCHEDULER_TOOL_DEFINITIONS = [
  {
    name: 'create_scheduled_task',
    description:
      'Create a recurring or one-off scheduled task. Use when the user asks ' +
      'to "remind me", "every morning", "each Monday", "schedule a daily report", ' +
      'or any phrasing that implies a future-recurring prompt. Returns the saved task id.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short human-readable label.' },
        prompt: { type: 'string', description: 'The full prompt to send to the model when this task fires.' },
        cron_expression: { type: 'string', description: 'Optional 5-field cron, e.g. "0 9 * * MON-FRI" for 9am weekdays.' },
        schedule_type: { type: 'string', enum: ['cron', 'manual', 'once'] },
        mcp_servers: { type: 'array', items: { type: 'string' }, description: 'IDs of MCP servers to enable for this run.' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List the user\'s scheduled tasks.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task by id.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

/**
 * Build the builtinToolMap that claude-direct.js will dispatch to when the
 * model invokes one of the SCHEDULER_TOOL_DEFINITIONS above.
 */
export function buildSchedulerToolMap(userId) {
  const db = getDatabase();
  return {
    create_scheduled_task: async (args) => {
      const task = createTask(db, userId, args);
      return `Created task "${task.name}" (id: ${task.id}). It will run on schedule "${task.cron_expression || task.schedule_type}".`;
    },
    list_scheduled_tasks: async () => {
      const rows = listTasks(db, userId);
      if (rows.length === 0) return 'No scheduled tasks.';
      return rows.map(t => `- ${t.name} [${t.id}] — ${t.schedule_type}${t.cron_expression ? ` (${t.cron_expression})` : ''}, last_status=${t.last_status || 'never'}`).join('\n');
    },
    delete_scheduled_task: async ({ id }) => {
      deleteTask(db, id);
      return `Deleted task ${id}.`;
    },
  };
}
