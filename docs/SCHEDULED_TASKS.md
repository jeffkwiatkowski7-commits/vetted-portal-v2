# Scheduled Tasks

Claude-desktop-style recurring prompts. A user defines `{ name, prompt, cron, mcp_servers }`, and the prompt fires on cron through Cloud Scheduler → our `/api/scheduler/invoke` endpoint → `claude-direct.js`.

## Architecture

```
┌─────────────────┐      OIDC bearer       ┌────────────────────────┐
│ Cloud Scheduler │ ─────────────────────▶ │ POST /api/scheduler/   │
│  (one job per   │  body: { task_id }     │       invoke            │
│   task)         │                        │  verifies SA + audience │
└─────────────────┘                        └────────────┬───────────┘
                                                        │
                                                        ▼
                                            ┌────────────────────────┐
                                            │ runTask(task_id)       │
                                            │  · loads task          │
                                            │  · resolves MCP tools  │
                                            │  · calls claude-direct │
                                            │  · writes run row      │
                                            │  · creates notification│
                                            └────────────────────────┘
```

The Node container can scale to zero between invocations — Cloud Scheduler owns the cron firing, so nothing in our process needs to stay alive waiting.

## Files added

- `server/database.js` — `scheduled_tasks` and `scheduled_task_runs` tables
- `server/lib/scheduler.js` — CRUD + `runTask()` + tool definitions for Claude
- `server/scheduler-routes.js` — REST endpoints + Cloud Scheduler webhook
- `server/index.js` — mounts the router under `/api`
- `src/pages/TasksPage.tsx` — `/tasks` UI
- `src/api/index.ts` — `api.tasks.*` client
- `src/types/index.ts` — `ScheduledTask`, `ScheduledTaskRun`

## Routes

| Method | Path                       | Auth          | Purpose                                  |
|--------|----------------------------|---------------|------------------------------------------|
| GET    | `/api/tasks`               | `X-User-Id`   | list current user's tasks                |
| POST   | `/api/tasks`               | `X-User-Id`   | create task                              |
| GET    | `/api/tasks/:id`           | `X-User-Id`   | get task + recent runs                   |
| PUT    | `/api/tasks/:id`           | `X-User-Id`   | update task                              |
| DELETE | `/api/tasks/:id`           | `X-User-Id`   | delete task                              |
| POST   | `/api/tasks/:id/run`       | `X-User-Id`   | manual run                               |
| GET    | `/api/tasks/:id/runs`      | `X-User-Id`   | run history                              |
| POST   | `/api/scheduler/invoke`    | OIDC bearer   | Cloud Scheduler webhook (body: task_id)  |

## Environment variables

Add to `.env` (and `/data/.env` on the VM):

```
# Required for the Cloud Scheduler webhook to verify Google's OIDC token.
CLOUD_SCHEDULER_SA=task-runner@<project>.iam.gserviceaccount.com
CLOUD_SCHEDULER_AUDIENCE=https://<your-cloud-run-host>/api/scheduler/invoke

# Dev only — bypasses OIDC verification on /api/scheduler/invoke
SCHEDULER_DEV_BYPASS=false
```

Install the Google auth library on the server:

```bash
npm install google-auth-library
```

## GCP setup (one time)

```bash
PROJECT=<your-project>
REGION=us-central1
CLOUD_RUN_URL=https://<your-cloud-run-host>
SA_NAME=task-runner

# 1. Service account that Cloud Scheduler uses to call us
gcloud iam service-accounts create $SA_NAME \
  --display-name="Vetted Portal task runner" \
  --project=$PROJECT

# 2. Allow it to mint OIDC tokens (Cloud Scheduler does this for us)
gcloud iam service-accounts add-iam-policy-binding \
  $SA_NAME@$PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:service-$(gcloud projects describe $PROJECT --format='value(projectNumber)')@gcp-sa-cloudscheduler.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator

# 3. Enable required APIs
gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT
```

## Creating a Cloud Scheduler job per task

When a user creates a task with `schedule_type: 'cron'`, follow up with:

```bash
TASK_ID=<uuid>
CRON="0 9 * * MON-FRI"   # task.cron_expression

gcloud scheduler jobs create http vetted-task-$TASK_ID \
  --location=$REGION \
  --schedule="$CRON" \
  --time-zone="America/New_York" \
  --uri="$CLOUD_RUN_URL/api/scheduler/invoke" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body="{\"task_id\":\"$TASK_ID\"}" \
  --oidc-service-account-email="$SA_NAME@$PROJECT.iam.gserviceaccount.com" \
  --oidc-token-audience="$CLOUD_RUN_URL/api/scheduler/invoke" \
  --project=$PROJECT
```

For pause / resume:

```bash
gcloud scheduler jobs pause  vetted-task-$TASK_ID --location=$REGION
gcloud scheduler jobs resume vetted-task-$TASK_ID --location=$REGION
```

For delete:

```bash
gcloud scheduler jobs delete vetted-task-$TASK_ID --location=$REGION --quiet
```

### Automating job creation from the API

The current implementation persists the task locally and stores the eventual scheduler-job name in `scheduled_tasks.cloud_scheduler_job` but does **not** call `gcloud` itself. To close that loop, add `@google-cloud/scheduler` and create/update/delete the GCP job inside the `POST/PUT/DELETE /api/tasks` handlers in `scheduler-routes.js`.

```js
import { CloudSchedulerClient } from '@google-cloud/scheduler';
const client = new CloudSchedulerClient();
// client.createJob({ parent, job }) etc.
```

## Persistence gotcha

`server/database.js` writes SQLite to `./data/vetted_portal.db` inside the container. Cloud Run scales to zero by default, so unless the data dir is on a Cloud Storage volume mount or you migrate to Cloud SQL/Firestore, scheduled tasks are lost on cold start.

Two reasonable paths:

1. **Mount a GCS volume** at `/data` on Cloud Run (second-gen execution environment supports this). Quick, no schema changes.
2. **Move scheduled tasks into Firestore** alongside the lease data (`server/lib/firestore.js`). More work, but closer to the architecture you already use for leases.

Pick (1) for the demo, (2) before serving real users.

## Letting Claude manage tasks conversationally

`server/lib/scheduler.js` exports `SCHEDULER_TOOL_DEFINITIONS` and `buildSchedulerToolMap(userId)`. Wire them into the chat handler in `server/index.js` (the spot that calls `claudeDirectChatWithDocuments`) by appending the definitions to `claudeTools` and merging the map into `builtinToolMap`. Once that's done, the user can say "remind me every Monday at 9am to review the lease pipeline" and Claude will call `create_scheduled_task` directly.
