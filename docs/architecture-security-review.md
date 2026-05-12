# Architecture & Security Review

**Scope:** Vetted Portal v2 — client/server boundary, authentication, session handling, MCP secret lifecycle, and trust model. Audience is 10–15 small-business users sharing a hosted deployment.

**Method:** Read of the current codebase (frontend `src/`, backend `server/`) with file:line citations. Findings are described before recommendations; recommendations are prioritized at the end.

---

## TL;DR

The shape is sound: secrets stay server-side, the React client is a render layer, and the backend owns business logic. The three things that need work before this is a product 10–15 paying users trust:

1. **Session identity is a raw user UUID in `localStorage`, unsigned, no expiry, sent in a custom header.** Anyone who reads `localStorage` or guesses a UUID can impersonate any user indefinitely.
2. **MCP server `env_vars` (third-party API keys) are stored in plaintext SQLite, returned plaintext in admin API responses, and displayed plaintext in the admin form.** A breach of the DB file or a screenshot of the admin page leaks every connected service.
3. **`mcp-manager.js` spawns each MCP child with `{ ...process.env, ...envVars }`.** Your `Opus_API_KEY`, GCP ADC, DB path, and everything else in the parent env is handed to every MCP subprocess — including ones the model can invoke tools on.

Everything else is polish. Details below.

---

## 1. Client / Server Boundary

### What lives where today

| Layer | Holds | Notes |
|---|---|---|
| **React client** (`src/`) | UI state, current user identity (UUID), per-chat selections, drafts | Zustand store at [src/store/index.ts](../src/store/index.ts). API layer at [src/api/index.ts](../src/api/index.ts) is the only network surface — sends `X-User-Id` header on every call. |
| **Node backend** (`server/`) | SQLite DB, all third-party API keys, file uploads, MCP child processes, AI provider clients (Anthropic/Gemini), tool dispatch | Single Express app [server/index.js](../server/index.js); auxiliary lib in [server/lib/](../server/lib/). |
| **Anthropic / Vertex / Tavily / etc.** | Stateless API calls only — server-mediated, never client | Keys read from `process.env` server-side only. |
| **MCP child processes** | Per-server tool execution, hold tenant tokens (Slack/GitHub/Notion/etc.) at runtime | Spawned by [server/lib/mcp-manager.js](../server/lib/mcp-manager.js) lazily, reaped after 10 min idle. |

### Best practice for this app shape

- **Client should be a thin shell.** Render, route, hold the session token, post user actions. No business logic that affects another user's state.
- **Server is the only place secrets exist** — bundled JS is publicly readable, so any token in the client is leaked.
- **Database is the source of truth.** Anything in the client (selections, drafts, MCP toggles) should be reconstructable from the DB on refresh.
- **Tool execution stays server-side.** The model and the model's tools both run with the server's auth, never the user's bearer. Token-on-behalf-of-user flows go through the server.

### What's correct today

- Third-party keys (`Opus_API_KEY`, `TAVILY_API_KEY`, GCP ADC) are read only on the server — confirmed in [server/lib/claude-direct.js:15](../server/lib/claude-direct.js#L15), [server/lib/tavily.js:6](../server/lib/tavily.js#L6). None ever flows into an API response.
- API key creation flow (`POST /api/admin/api-keys`) hashes the key with SHA-256, shows the plaintext **once** at creation, then only returns `key_preview` afterward — [server/index.js:3524-3547](../server/index.js#L3524). This pattern is correct and should be the model for MCP secrets.
- All data routes are behind `requireAuth`. Lease bot reuses the same middleware ([server/lease-routes.js:64](../server/lease-routes.js#L64)).

### What needs work

- **No real session abstraction.** A `sessions` table exists ([server/index.js:3569](../server/index.js#L3569)) but is queried only for display — never used to validate requests. See §2.
- **CORS is wide open.** `app.use(cors())` with no options ([server/index.js:135](../server/index.js#L135)) = `*` for origin/methods/headers. For a multi-tenant SaaS this should be locked to your own domain(s).
- **Two upload directories.** Local dev uses `./data/uploads/`; VM uses `/data/uploads/`. Already documented as a gotcha; mostly an ops issue, but worth straightening when Dockerizing.

---

## 2. Authentication & Session Handling

### Current flow

1. User posts email+password to `POST /api/auth/login` ([server/index.js:560](../server/index.js#L560)).
2. Server looks up email, checks `status === 'active'`, bcrypt-compares password, throttles `last_login_at` write to 1/hour, returns the user object (sans `password_hash`).
3. Client stores `userId` (UUID) in `localStorage` ([src/components/auth/LoginPage.tsx:27](../src/components/auth/LoginPage.tsx#L27)).
4. Every API call sets `X-User-Id: <uuid>` ([src/api/index.ts:52](../src/api/index.ts#L52)).
5. `requireAuth` ([server/index.js:540](../server/index.js#L540)) reads the header, fetches the user row, attaches it to `req.user`, calls `next()`.
6. `requireAdmin` ([server/index.js:2550](../server/index.js#L2550)) additionally checks `req.user.role === 'admin' || 'super_admin'`.
7. Logout endpoint exists at [server/index.js:590](../server/index.js#L590) but is a no-op — there's no server-side state to clear.

### Best practice

For a small-business multi-tenant web app, the standard shape is one of:

**Option A — Session cookie (recommended for this case)**
- Server creates a random session token (e.g. 32 bytes base64), stores `(token_hash, user_id, expires_at, created_at, last_seen_at, user_agent, ip)` in a `sessions` table.
- Sets it as `Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Max-Age=...`. `HttpOnly` means client JS can't read it (mitigates XSS exfiltration).
- Every request middleware looks the token up, checks expiry, optionally slides the window.
- Logout deletes the row.

**Option B — Signed JWT (lighter, no DB lookup per request)**
- Server signs `{user_id, exp}` with HMAC and an env-held secret. Client stores it (preferably also as an HttpOnly cookie, not localStorage).
- Cheaper but harder to revoke. Worth it for stateless multi-region, not for 10–15 users on one VM.

Either way:
- **No bearer in `localStorage`** — XSS reads it; service workers persist it across closes.
- **Rate-limit login** (e.g. `express-rate-limit`) — 5 attempts per IP per 15 min is industry norm. Currently nothing.
- **Lock CORS** to the actual front-end origin(s).
- **Rotate tokens on privilege escalation** (e.g. when admin status changes).

### Findings — auth

| # | Finding | Severity | File |
|---|---|---|---|
| A1 | `X-User-Id` is the raw user UUID with no signature/expiry. Anyone who reads `localStorage` (XSS, malicious browser extension, shared laptop) impersonates the user indefinitely. There is no logout mechanism on the server. | **High** | [src/api/index.ts:52](../src/api/index.ts#L52), [server/index.js:540](../server/index.js#L540) |
| A2 | No rate limiting on `POST /api/auth/login`. Brute-force is unbounded. | **High** | [server/index.js:560](../server/index.js#L560) |
| A3 | CORS allows any origin (`cors()` with no options). | **Medium** | [server/index.js:135](../server/index.js#L135) |
| A4 | `sessions` table exists but isn't authoritative for auth. Schema is in place; just unused for validation. | **Low (opportunity)** | [server/index.js:3569](../server/index.js#L3569) |
| A5 | `?userId=` query-param fallback path remains for one whitelisted route (PPTX template thumbnail) via `req._allowQueryUserId`. Defensible but worth documenting. | **Low** | [server/index.js:2918](../server/index.js#L2918) |
| A6 | Admin promotion is admin-only (DB or `PUT /api/admin/users/:id`). No self-service path — correct. | **OK** | [server/index.js:3012](../server/index.js#L3012) |

---

## 3. MCP Secret Handling

This is where the real risk lives, because every MCP server you connect (Slack, Notion, Linear, GitHub, custom internal APIs) hands the portal a long-lived credential. Right now those credentials are durable, plaintext, and trivially readable by any compromise of the server or the admin UI.

### Current lifecycle

```
admin enters env_vars in form ─▶ POST /api/admin/mcp-servers
                                    │
                                    ▼
                          plaintext JSON stored in
                          mcp_servers.env_vars column
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
              GET returns full env_vars   chat needs MCP tool
              to admin form (readable)         │
                                               ▼
                                    mcpManager.startServer({
                                      env: { ...process.env, ...envVars }
                                    })
                                               │
                                               ▼
                                       MCP child process
                                       (inherits portal's env too)
```

### Findings — MCP

| # | Finding | Severity | File |
|---|---|---|---|
| M1 | `env_vars` is a plaintext TEXT column. SQLite file at `./data/vetted_portal.db` (local) or `/data/vetted_portal.db` (VM) — anyone with file read access reads every connected service's API key. No encryption at rest. | **High** | [server/database.js:330-341](../server/database.js#L330-L341) |
| M2 | `GET /api/admin/mcp-servers` returns the full env_vars JSON to any admin. The admin UI parses and renders the values plaintext into editable form inputs. Screenshot, shoulder-surf, browser-cache, and "I'll just send this config to support" are all leak vectors. | **High** | [server/index.js:3368-3371](../server/index.js#L3368-L3371), [src/pages/AdminMcpPage.tsx:50-59](../src/pages/AdminMcpPage.tsx#L50-L59) |
| M3 | **`mcpManager.startServer` spawns the child with `env: { ...process.env, ...envVars }`** — meaning the MCP subprocess inherits `Opus_API_KEY`, GCP ADC env, `DATABASE_PATH`, `GCS_BUCKET`, every other portal secret. A buggy or malicious MCP server reads them with `os.environ`. This is the most dangerous finding. | **High** | [server/lib/mcp-manager.js:22-29](../server/lib/mcp-manager.js#L22-L29) |
| M4 | `PUT /api/chats/:id/mcp-servers` ([server/index.js:773-775](../server/index.js#L773-L775)) accepts the user's `serverIds` array and stores it verbatim — no validation that the IDs exist, are enabled, or that the user is allowed to use them. The downstream chat handler will read them at execution time, so this is bounded by the `enabled` filter, but you're storing whatever JSON the client sends. | **Medium** | [server/index.js:773-775](../server/index.js#L773-L775) |
| M5 | Tool list (`client.listTools()`) is not cached — fetched fresh on every chat message ([server/lib/mcp-manager.js:68-72](../server/lib/mcp-manager.js#L68-L72)). Functionally fine; bad for latency under load. | **Low (perf)** | [server/lib/mcp-manager.js:68-72](../server/lib/mcp-manager.js#L68-L72) |

### Best practice for MCP secrets

**Goal:** the human admin enters a credential once, the portal can use it forever, and at no point is it readable through the application again.

**Storage at rest** — three options ranked:

1. **Encrypt the `env_vars` JSON with AES-GCM** using a master key from an env var (`MCP_SECRET_KEY`, 32 bytes hex). Standard pattern in Node: `crypto.createCipheriv('aes-256-gcm', ...)`. ~30 lines, no new dep. Storage becomes `{iv, ciphertext, tag}`. A DB file leak alone is no longer enough — attacker needs `MCP_SECRET_KEY` too, which lives only in the VM `/data/.env`.
2. **External secrets manager** (GCP Secret Manager, since you're already on GCP). Each MCP server gets a secret ID; DB stores only the secret ID. Best practice but adds infra.
3. **Don't change storage; lock the trust boundary** (encrypt + treat the API as write-only). Acceptable interim.

**Admin API shape** — model on what you already do for `api_keys`:

- `POST /api/admin/mcp-servers` accepts env_vars in the request body, never returns them.
- `GET /api/admin/mcp-servers` returns metadata only: `id`, `name`, `command`, `args`, `enabled`, and a per-var preview (`{KEY: "sk-...XYZ"}` with middle redacted, like your `key_preview` column).
- `PUT /api/admin/mcp-servers/:id` accepts new env_vars only when explicitly re-sent; if a var is omitted, server keeps the existing value. Admin form should treat empty fields as "don't change" and never pre-populate from the server response.
- Add an explicit `POST /api/admin/mcp-servers/:id/rotate-secret` endpoint for the case "this credential leaked, replace it."

**Child process env** — change [server/lib/mcp-manager.js:22-29](../server/lib/mcp-manager.js#L22-L29) to:

```js
const child = spawn(command, args, {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV,
    ...envVars,  // per-server vars, decrypted at spawn time
  },
  // ...
});
```

Same pattern I used in [server/lib/spreadsheet.js](../server/lib/spreadsheet.js) `subprocessEnv()`. Allowlist what the child needs; the MCP server's tools are model-driven, so the child's env is part of the attack surface.

**Per-chat selection** — validate `serverIds` against the set of enabled servers on write (not just on read).

---

## 4. AI Provider & User-Owned Tokens

Adjacent to MCP but currently simpler.

### Current

- AI provider keys (`Opus_API_KEY`, Vertex via ADC) are environment-only, server-only, never echoed.
- Per-user tokens for external services don't exist yet — every chat uses the portal-owned AI key.
- MCP servers can hold per-tenant tokens, but the lifecycle is "admin pastes a token into the form," not OAuth.

### Best practice when you add user-OAuth services (Slack, Google, etc.)

- Use OAuth 2.0 authorization code flow. Server holds `client_id` + `client_secret`; user grants consent through the provider's site; provider returns a code to your backend; backend exchanges for `access_token` + `refresh_token`.
- Store the refresh token encrypted per user (`user_oauth_tokens` table). Same encryption story as MCP env_vars.
- Refresh on demand server-side; the access token never goes to the browser.
- When wiring an OAuth-backed service to MCP, the credential the MCP subprocess uses is fetched from your DB at spawn time, not pasted into a form.

You're not there yet — keep this in mind when wiring Slack/Google/etc., and the AES-GCM column-encryption pattern from §3 is reusable verbatim.

---

## 5. Token & MCP Handoff Pattern

A concrete shape for "how do tokens move" once §2 and §3 are fixed:

```
┌───────────────┐         (1) email/password
│   Browser     │ ─────────────────────────────────▶ POST /api/auth/login
│ (React/Vite)  │                                          │
└───────┬───────┘                                          │
        │                                                  │ (2) Set-Cookie: sid=...; HttpOnly
        │  ◀──────────────────────────────────────────────┘
        │
        │  (3) API call (cookie travels automatically)
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Express backend (single process, single VM)                     │
│                                                                  │
│  requireAuth → sessions table lookup → req.user                  │
│       │                                                          │
│       ▼                                                          │
│  chat handler — assembles prompt, picks model                    │
│       │                                                          │
│       ├─▶ Anthropic / Vertex (portal-owned keys, env)            │
│       │                                                          │
│       └─▶ MCP tool call:                                         │
│            │                                                     │
│            ▼                                                     │
│         mcp-manager:                                             │
│           1. SELECT server WHERE id = ? AND enabled = 1          │
│           2. decrypt env_vars (AES-GCM, key from env)            │
│           3. spawn child with explicit allowlist env + decrypted │
│              vars (no parent env leak)                           │
│           4. call tool, return text                              │
│           5. reap after 10 min idle (already correct)            │
└──────────────────────────────────────────────────────────────────┘
```

Two rules to internalize:

- **The browser never holds a third-party credential.** Not Anthropic, not Slack, not the MCP server's secret. Only its own session cookie.
- **The MCP subprocess gets only what it needs.** Allowlist its env; never `...process.env`.

---

## 6. Deployment & Ops Hardening

Adjacent to the trust model.

| Area | Current | Recommended |
|---|---|---|
| Deploy mechanism | Manual `git pull` + pm2 restart over SSH, separate `/data/.env` maintained by hand | Dockerize the backend; one `docker-compose.yml`; CI builds image on tag, VM pulls. `MCP_SECRET_KEY`, `Opus_API_KEY` live in the env file mounted into the container. |
| Backups | Manual / unknown | Nightly `sqlite3 .backup` to GCS, 7-day retention. |
| TLS | Presumably handled at the GCP load balancer or via Caddy/nginx — confirm. | Force HTTPS; HSTS header; serve `Set-Cookie ... Secure`. |
| Logs | Backend logs to stdout (PM2), in-memory ring buffer of last 100 errors at [server/index.js](../server/index.js) | Ship to GCP Logging or similar; rotate; redact `X-User-Id` and any header that might leak. |
| Secrets in repo | `.env` is gitignored (confirm) | Add a pre-commit hook scanning for secrets (`gitleaks`). |

---

## 7. Prioritized Action List

Ordered by ratio of risk reduction to effort. Each item names a single concrete change.

### P0 — Ship before more users

1. **Stop merging `process.env` into MCP children.** Allowlist only `PATH`/`HOME`/`NODE_ENV` (plus the decrypted per-server vars). Single function change in [server/lib/mcp-manager.js:22-29](../server/lib/mcp-manager.js#L22-L29). Pattern already exists in [server/lib/spreadsheet.js](../server/lib/spreadsheet.js).
2. **Encrypt `mcp_servers.env_vars` at rest.** AES-GCM with `MCP_SECRET_KEY` (32-byte hex) from env. Decrypt on read in the manager only; admin GET returns previews, not plaintext. Same pattern as `api_keys.key_preview`.
3. **Rate-limit `POST /api/auth/login`.** `express-rate-limit`, 5 attempts per IP per 15 min. ~5 lines.

### P1 — Within a sprint

4. **Replace the `X-User-Id` header with an HttpOnly session cookie.** Use the existing `sessions` table; populate it on login, validate in `requireAuth`, delete on logout. Switch the client to drop the header and rely on `credentials: 'include'`.
5. **Lock CORS** to the actual frontend origin(s).
6. **Stop returning plaintext `env_vars` from `GET /api/admin/mcp-servers`.** Return previews only; require the admin to explicitly re-enter a value to change it.
7. **Validate `serverIds`** on the per-chat MCP write endpoint against the enabled set.

### P2 — Nice-to-have

8. Cache `client.listTools()` per MCP server for a short TTL (e.g. 60s) to cut chat latency.
9. Dockerize the backend; one-command deploy.
10. Nightly DB backup to GCS.
11. Move TLS into the deploy contract (HSTS, Secure cookies).

---

## 8. Out of Scope (Flagged for Awareness, Not for This Doc)

- **`pandas_query` sidecar security** — the AST whitelist + restricted env mitigates a lot but pandas itself can read arbitrary files via `pd.read_csv("/etc/passwd")`. Acceptable for a single-tenant dev tool. For multi-tenant, the subprocess should run as an unprivileged user or in a container, not just `cwd: /tmp`. Track separately if you ever expose this to untrusted models.
- **Lease bot / Firestore access control** — distinct from the SQLite ACL; uses ADC. Outside this review.
- **PPTX/Canvas mode** — UI features, not in the trust boundary.

---

*Document is for review only. Nothing has been changed in code as part of this audit.*
