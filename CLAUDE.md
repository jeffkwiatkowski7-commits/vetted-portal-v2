# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run frontend (port 5173) + backend (port 3000) concurrently
npm run dev:frontend # Frontend only (Vite) — /api/* will 404 without the backend
npm run dev:backend  # Backend only (Node.js/Express)
npm run build        # Production build (Vite → dist/)
npm start            # Run production server (server/index.js serves dist/ + API on 3000)
npm run seed         # Manually seed demo data into SQLite database
```

No test runner or linter is configured.

## Additional docs in repo root

For deeper reference, see `API_REFERENCE.md` (full route list), `BACKEND_QUICKSTART.md`, `SERVER_DOCUMENTATION.md`, and `FEATURES.md`. Treat them as authoritative for endpoint shapes; this file is the architecture overview.

## Architecture

This is a **full-stack demo app** with a React/TypeScript frontend and a Node.js/Express backend. In dev mode, Vite proxies `/api/*` requests to `localhost:3000`.

### Frontend (`src/`)
- **Entry:** `main.tsx` → `App.tsx` (React Router v6 routing)
- **State:** Zustand store at `src/store/index.ts` — single global store for auth, chats, sidebar, toasts, notifications, demo mode, and search
- **API layer:** `src/api/index.ts` — all `fetch` calls go through here; sends `X-User-Id` header for auth
- **Types:** `src/types/index.ts` — all shared TypeScript interfaces (User, Chat, Project, etc.)
- **Routes:**
  - Chat: `/`, `/chat/:id`
  - Workspace: `/projects`, `/library`, `/skills`, `/skills/new`, `/skills/:id/edit`
  - Admin: `/admin` (and sub-pages, including `/admin/tool-sets`)
  - Standalone: `/lease-chat`, `/apps`, `/integrations`, `/settings`

### Backend (`server/`)
- **Main server:** `server/index.js` — 2,300+ line Express app with 70+ REST endpoints
- **Lease routes:** `server/lease-routes.js` — separate router (~500 lines) for all `/api/leases/*` endpoints
- **Database:** `server/database.js` — SQLite via `sql.js`; initializes schema and auto-seeds demo data on first run; stored at `./data/vetted_portal.db`
- **Mock AI:** `server/mock-responses.js` — context-aware fake AI responses when `DEMO_MODE=true`
- **Auth:** `requireAuth` middleware reads `X-User-Id` header; `requireAdmin` middleware checks admin role. Login throttles `last_login_at` updates to 1/hour per user

### AI Backends (`server/lib/`)
Three AI integrations coexist — which one is used depends on configuration:
- **`gemini.js`** — Vertex AI Gemini: `ocrPdf()`, `extractLeaseData()`, `chatWithLeases()`, `chatCrossPortfolio()`, `chatWithDocuments()`
- **`claude-direct.js`** — Anthropic SDK (direct API via `Opus_API_KEY`): `chatWithDocuments()` with native PDF support (100-page limit), MCP tool integration, and Gemini Flash summarization for non-relevant PDFs
- **`claude.js`** — Alternative Claude integration via Vertex AI SDK
- **`tavily.js`** — Optional web search integration
- **`config.js`** — GCP config via env vars; uses Application Default Credentials (ADC) — no explicit key files

### MCP (Model Context Protocol) System
- **`server/lib/mcp-manager.js`** — Singleton that manages MCP server child processes with lazy startup and 10-minute idle reap
- **Database:** `mcp_servers` table stores server configs (command, args, env_vars, enabled). Default servers seeded: `mcp-memory`, `mcp-sequential-thinking`
- **Tool namespacing:** Tools loaded from MCP servers are prefixed as `serverId__toolName` and integrated into chat context
- **Per-chat selection:** Chats store which MCP servers are active (`mcp_servers` JSON column on `chats` table)
- **Admin UI:** `/admin/tool-sets` (AdminMcpPage.tsx) for managing MCP server configurations
- **Endpoints:** `GET/POST/PUT/DELETE /api/admin/mcp-servers`, `GET /api/mcp-servers`, `PUT /api/chats/:id/mcp-servers`

### RAG System
- **`server/lib/rag.js`** — Text extraction, chunking, and query for project files
- **`server/lib/embeddings.js`** — Embedding generation for semantic search
- **`server/lib/gcs.js`** — Google Cloud Storage uploads for project files
- **`server/lib/firestore.js`** — Firestore queries for lease data (separate from SQLite)
- **Flow:** File upload → text extraction (PDF/DOCX/TXT/MD) → chunking → embedding → Firestore storage → semantic retrieval at chat time

### Lease Bot
- **`src/pages/LeaseChatPage.tsx`** — standalone page at `/lease-chat`; upload PDF leases, view ingestion logs, chat with lease data
- **SSE streaming:** Lease ingestion (`POST /api/leases/ingest`) and chat (`POST /api/leases/chat`) stream progress via Server-Sent Events with 15-second heartbeats; `LeaseChatPage` has a local `readSSE()` parser
- Lease data is stored in Firestore (collections configurable via env vars), separate from the SQLite database

### Key Patterns
- **Database:** SQLite with WAL mode; all schema is in `server/database.js`; `server/seed.js` provides 26 users, 15 projects, 8 chats
- **AI responses:** `DEMO_MODE=true` enables mock responses for main chat; lease bot always calls real Vertex AI
- **File uploads:** Multer saves to `./data/uploads/`, max 50MB (configurable via `MAX_FILE_SIZE_MB`)
- **SSE streaming:** Used for chat messages, lease ingestion, and lease chat — all with heartbeat keepalives
- **Error tracking:** In-memory ring buffer (100 entries) for error history with timestamps and stack traces
- **JSON limit:** 10MB for request payloads
- **CORS:** Enabled for all origins

## Gotchas

- **`Opus_API_KEY`** is the Anthropic API key — the name is historical, not Opus-specific. `claude-direct.js` reads it directly.
- **Demo seed runs once.** `SEED_DEMO_DATA=true` only takes effect on first boot when the DB is empty. To reseed: delete `./data/vetted_portal.db` and restart, or run `npm run seed`.
- **Two upload dirs.** Local dev uses `./data/uploads/`; the deployed VM uses `/data/uploads/` (absolute). Don't conflate them when debugging file paths.
- **VM `/data/.env` is separate from repo `.env`.** Editing the local `.env` does not affect production. The VM env file is updated manually via SSH.

## Design System

Brand colors (defined in `tailwind.config.js`):
- Primary: `#1A1A1A` (near-black), Accent: `#C4A962` (gold)
- Fonts: Playfair Display (headings), Inter (body), JetBrains Mono (code)

## Demo Credentials

Login with any email — no password required:
- `admin@vetted.com` — admin role
- `james.wilson@company.com` — regular user
- Any `firstname.lastname@company.com` pattern from seeded users

## Environment (`.env`)

```
DEMO_MODE=true
SEED_DEMO_DATA=true
DATABASE_PATH=./data/vetted_portal.db
UPLOAD_DIR=./data/uploads
PORT=3000

# Lease bot (Vertex AI) — requires GCP ADC credentials
GCP_PROJECT=bill-leases
GCP_LOCATION=us-central1
MODEL_ID=gemini-3-flash-preview
FIRESTORE_LEASES_COLLECTION=leases
FIRESTORE_PROPERTIES_COLLECTION=properties

# Claude direct API (bypasses Vertex AI)
Opus_API_KEY=<anthropic-api-key>

# Optional integrations
TAVILY_API_KEY=<tavily-key>
GCS_BUCKET=<gcs-bucket-name>
MAX_FILE_SIZE_MB=50
```
