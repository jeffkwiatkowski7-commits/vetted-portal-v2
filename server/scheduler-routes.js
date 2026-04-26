/**
 * Scheduler API routes
 *
 *   GET    /api/tasks                   — list current user's tasks
 *   POST   /api/tasks                   — create task
 *   GET    /api/tasks/:id               — get task
 *   PUT    /api/tasks/:id               — update task
 *   DELETE /api/tasks/:id               — delete task
 *   POST   /api/tasks/:id/run           — run task once (manual trigger from UI)
 *   GET    /api/tasks/:id/runs          — list run history
 *
 *   POST   /api/scheduler/invoke        — entry point for Cloud Scheduler / Cloud Tasks.
 *                                         Authenticated via OIDC bearer token, NOT X-User-Id.
 *
 * NOTE: requireAuth + db are injected from server/index.js when the router is mounted.
 */
import { Router } from 'express';
import {
  createTask, getTask, listTasks, updateTask, deleteTask,
  listRuns, runTask,
} from './lib/scheduler.js';
import { logError } from './lib/error-log.js';

export default function schedulerRoutes({ db, requireAuth }) {
  const router = Router();

  // -------------------------------------------------------------------------
  // User-facing CRUD
  // -------------------------------------------------------------------------

  router.get('/tasks', requireAuth, (req, res) => {
    res.json({ tasks: listTasks(db, req.user.id) });
  });

  router.post('/tasks', requireAuth, (req, res) => {
    try {
      const task = createTask(db, req.user.id, req.body || {});
      res.status(201).json({ task });
    } catch (err) {
      logError({ source: 'scheduler', message: err.message, route: 'POST /tasks' });
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/tasks/:id', requireAuth, (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task || task.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ task, runs: listRuns(db, task.id) });
  });

  router.put('/tasks/:id', requireAuth, (req, res) => {
    const existing = getTask(db, req.params.id);
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found' });
    }
    try {
      const task = updateTask(db, req.params.id, req.body || {});
      res.json({ task });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/tasks/:id', requireAuth, (req, res) => {
    const existing = getTask(db, req.params.id);
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found' });
    }
    deleteTask(db, req.params.id);
    res.json({ success: true });
  });

  router.post('/tasks/:id/run', requireAuth, async (req, res) => {
    const existing = getTask(db, req.params.id);
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found' });
    }
    try {
      const result = await runTask(db, req.params.id, { trigger: 'manual' });
      res.json(result);
    } catch (err) {
      logError({ source: 'scheduler', message: err.message, route: 'POST /tasks/:id/run' });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/tasks/:id/runs', requireAuth, (req, res) => {
    const existing = getTask(db, req.params.id);
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ runs: listRuns(db, req.params.id, Number(req.query.limit) || 50) });
  });

  // -------------------------------------------------------------------------
  // Cloud Scheduler webhook
  //
  // This endpoint is what Cloud Scheduler / Cloud Tasks hit on cron. It does NOT
  // use X-User-Id auth — it verifies an OIDC bearer token signed by Google whose
  // service-account email matches CLOUD_SCHEDULER_SA. See docs/SCHEDULED_TASKS.md.
  // -------------------------------------------------------------------------

  router.post('/scheduler/invoke', verifyCloudSchedulerOidc, async (req, res) => {
    const { task_id } = req.body || {};
    if (!task_id) return res.status(400).json({ error: 'task_id required' });

    const task = getTask(db, task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.enabled) return res.json({ skipped: true, reason: 'disabled' });

    try {
      const result = await runTask(db, task_id, { trigger: 'scheduler' });
      res.json({ ok: true, run_id: result.run?.id });
    } catch (err) {
      logError({ source: 'scheduler', message: err.message, route: 'POST /scheduler/invoke' });
      // Return 500 so Cloud Scheduler retries per its retry config
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Verify the request came from Cloud Scheduler / Cloud Tasks.
 * Google signs an OIDC token whose `email` claim is the SA you configured
 * on the scheduler job. We verify that token using google-auth-library.
 *
 * In production set:
 *   CLOUD_SCHEDULER_SA=<service-account-email>
 *   CLOUD_SCHEDULER_AUDIENCE=<full URL of /api/scheduler/invoke>
 *
 * In dev, set SCHEDULER_DEV_BYPASS=true to skip verification.
 */
async function verifyCloudSchedulerOidc(req, res, next) {
  if (process.env.SCHEDULER_DEV_BYPASS === 'true') return next();

  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer (.+)$/i);
  if (!match) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    // Lazy import — google-auth-library is only needed in production
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: match[1],
      audience: process.env.CLOUD_SCHEDULER_AUDIENCE,
    });
    const payload = ticket.getPayload();
    const expectedSa = process.env.CLOUD_SCHEDULER_SA;
    if (expectedSa && payload.email !== expectedSa) {
      return res.status(403).json({ error: 'SA mismatch' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: `Invalid OIDC token: ${err.message}` });
  }
}
