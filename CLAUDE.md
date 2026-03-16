# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run frontend (port 5173) + backend (port 3000) concurrently
npm run dev:frontend # Frontend only (Vite)
npm run dev:backend  # Backend only (Node.js/Express)
npm run build        # Production build (outputs to dist/)
npm start            # Run production server (serves dist/ + API on port 3000)
npm run seed         # Manually seed demo data into SQLite database
```

No test runner or linter is configured.

## Architecture

This is a **full-stack demo app** with a React/TypeScript frontend and a Node.js/Express backend. In dev mode, Vite proxies `/api/*` requests to `localhost:3000`.

### Frontend (`src/`)
- **Entry:** `main.tsx` → `App.tsx` (React Router v6 routing)
- **State:** Zustand store at `src/store/index.ts` — single global store for auth, chats, sidebar, toasts, notifications, demo mode, and search
- **API layer:** `src/api/index.ts` — all `fetch` calls go through here; sends `X-User-Id` header for auth
- **Types:** `src/types/index.ts` — all shared TypeScript interfaces (User, Chat, Project, etc.)
- **Routes:** `/` (chat), `/chat/:id`, `/projects`, `/library`, `/apps`, `/admin`, `/settings`

### Backend (`server/`)
- **Main server:** `server/index.js` — 1,200+ line Express app with 70+ REST endpoints
- **Database:** `server/database.js` — SQLite via `sql.js`; initializes schema and auto-seeds demo data on first run; stored at `./data/vetted_portal.db`
- **Mock AI:** `server/mock-responses.js` — generates fake AI responses (no real LLM calls)
- **Auth:** No passwords — login with email only (`POST /api/auth/login`); all endpoints check `X-User-Id` header

### Key Patterns
- **Authentication:** `requireAuth` middleware reads `X-User-Id` from request headers; user ID is stored in `localStorage` on the frontend
- **Database:** SQLite with WAL mode; all schema is in `server/database.js`; `server/seed.js` provides 26 users, 15 projects, 8 chats
- **AI responses:** `DEMO_MODE=true` in `.env` enables mock responses; no real API keys needed
- **File uploads:** Multer saves to `./data/uploads/`

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
```
