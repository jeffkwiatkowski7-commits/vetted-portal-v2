# MCP Integration Design

**Date:** 2026-03-29
**Status:** Approved

## Overview

Add Model Context Protocol (MCP) support to the Vetted Portal, making MCP the universal tool interface for all AI integrations. Admins manage a catalog of MCP servers. Users enable servers per project or per standalone chat via a "+" button in ChatInput. The AI (Gemini) uses native function calling to invoke MCP tools during conversations, with results woven inline into responses. Replaces the existing Tavily integration.

## Goals

- All AI tool integrations go through MCP — no more one-off integrations in `gemini.js`
- Admins add/remove/configure MCP servers from the admin panel with no code changes or restarts
- Users toggle MCP servers on/off per project (project-level) or per standalone chat
- Tool usage is visible in the existing steps panel; results appear inline in the AI's markdown response
- Ship with 5 pre-seeded MCP servers: Brave Search, Fetch, Memory, Puppeteer, Sequential Thinking

## Architecture

### Approach: Native Tool-Calling Loop

Gemini supports function calling. MCP tool schemas are converted to Gemini `functionDeclarations`. When Gemini returns a `functionCall`, the backend routes it to the appropriate MCP server via the MCP SDK, gets the result, sends it back to Gemini as a `functionResponse`, and loops until Gemini produces a final text response. This extends the existing Tavily function-calling pattern in `gemini.js` and replaces it with a generic loop.

```
User sends message
    → Backend loads active MCP servers for chat/project
    → Converts MCP tool schemas to Gemini functionDeclarations
    → Calls Gemini with message + history + tools
    → Loop:
        ├─ Gemini returns functionCall → route to MCP server → send result back → continue
        ├─ Gemini returns text → done
        └─ Max 10 iterations (safety cap)
    → Save response, send SSE done event
```

## Database

### New Table: `mcp_servers`

Admin-managed catalog of available MCP servers.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Display name (e.g., "Brave Search") |
| description | TEXT | Detailed description shown to users |
| icon | TEXT | Icon identifier: "search", "globe", "brain", "terminal", "link", "lightbulb" |
| command | TEXT NOT NULL | Executable (e.g., "npx", "node") |
| args | TEXT | JSON array of arguments |
| env_vars | TEXT | JSON object of environment variables |
| enabled | INTEGER DEFAULT 1 | 1 = available to users, 0 = disabled by admin |
| created_at | TEXT NOT NULL | ISO timestamp |
| updated_at | TEXT NOT NULL | ISO timestamp |

### Modified Tables

**`chats`** — add `mcp_servers` column:

| Column | Type | Description |
|--------|------|-------------|
| mcp_servers | TEXT DEFAULT NULL | JSON array of mcp_server IDs for standalone chats |

**`projects`** — add `mcp_servers` column:

| Column | Type | Description |
|--------|------|-------------|
| mcp_servers | TEXT DEFAULT NULL | JSON array of mcp_server IDs for project-level MCP. Separate from existing `tool_sets` column which stores tool set names for skills. |

### Dropped Table

**`chat_mcp_servers`** — not needed. Standalone chats use `chats.mcp_servers`. Project chats inherit from `projects.mcp_servers`.

## Backend

### MCP Process Manager (`server/lib/mcp-manager.js`)

Singleton that manages MCP server child processes.

**Methods:**

- **`startServer(serverConfig)`** — Spawns an MCP server as a child process using `command` + `args` from DB config. Passes `env_vars` as environment variables. Connects via stdio using the `@modelcontextprotocol/sdk` client. Caches the connection by server ID.

- **`stopServer(serverId)`** — Kills the child process, removes from cache.

- **`getTools(serverId)`** — Calls `listTools()` on the MCP connection. Returns array of tool definitions (name, description, inputSchema). Starts the server lazily if not already running.

- **`callTool(serverId, toolName, args)`** — Calls `callTool()` on the MCP connection. Returns the tool result content.

- **`stopAll()`** — Cleanup on server shutdown. Called from process exit handler.

**Lifecycle:**

- Servers start lazily on first tool request.
- Emit SSE step `"Starting [server name]..."` on first cold start so users see why there's a delay (npx downloads the package on first run).
- Idle servers are reaped after 10 minutes of no calls.
- If a server process dies, it is restarted on the next `getTools()` or `callTool()` request.

**Error handling:**

- If `callTool()` fails or times out (30-second timeout per tool call), return the error as a `functionResponse` with content `"Error: [message]"`. This lets Gemini gracefully inform the user (e.g., "I wasn't able to search the web right now") rather than crashing the entire response.
- If `startServer()` fails (bad command, missing package), emit an SSE step `"Failed to start [server name]: [error]"` and exclude that server's tools from the current request. Gemini proceeds with remaining tools or generates a text response without tools.

### Admin API Endpoints

All require admin role.

- `GET /api/admin/mcp-servers` — List all MCP servers (enabled and disabled).
- `POST /api/admin/mcp-servers` — Create a new MCP server. Body: `{ name, description, icon, command, args, env_vars, enabled }`.
- `PUT /api/admin/mcp-servers/:id` — Update an MCP server. Body: partial fields.
- `DELETE /api/admin/mcp-servers/:id` — Delete an MCP server. Stops the process if running.

### User API Endpoints

- `GET /api/mcp-servers` — List all enabled MCP servers (for user-facing selector and integrations page).

### Chat MCP Endpoints

- `PUT /api/chats/:id/mcp-servers` — Set active MCP servers for a standalone chat. Body: `{ serverIds: ["id1", "id2"] }`. Saves to `chats.mcp_servers`.

### Project MCP (existing endpoint)

- `PUT /api/projects/:id` — already supports partial updates. Store MCP server IDs in `mcp_servers` column.

### Chat Message Endpoint Changes (`POST /api/chats/:id/messages`)

Replace the existing Tavily function-calling logic with a generic MCP tool-calling loop:

1. Determine active MCP servers:
   - If chat has a project → read `projects.mcp_servers`
   - If standalone chat → read `chats.mcp_servers`
2. For each active server, call `mcpManager.getTools(serverId)` to get tool definitions.
3. Convert MCP tool schemas (JSON Schema) to Gemini `functionDeclarations` format. Prefix each tool name with the server ID (e.g., `srv123__brave_web_search`) to prevent collisions when multiple servers expose tools with the same name. Map prefixed names back to server ID + original tool name for routing.
4. Pass function declarations to the Gemini API call alongside the message, history, and system prompt.
5. **Tool-calling loop:**
   - If Gemini returns one or more `functionCall` parts:
     - For each `functionCall` in the response (Gemini may return multiple in parallel):
       - Look up which MCP server owns that function name.
       - Emit SSE step: `"Calling [server name]: [tool name]..."`.
       - Call `mcpManager.callTool(serverId, toolName, args)`.
       - Emit SSE step with result summary.
     - Execute parallel `functionCall`s concurrently via `Promise.all` for better latency.
     - Send all results back to Gemini as `functionResponse` parts in a single request.
     - Continue loop.
   - If Gemini returns a text part: break loop, use as final response.
   - Cap at 10 iterations to prevent runaway loops (each iteration = one Gemini API round-trip, so worst case is 11 API calls per user message).
6. Save the AI's final text response to the database as before.

### Tavily Removal

- Remove Tavily-specific function calling code from `gemini.js`.
- Remove `TAVILY_API_KEY` from `.env`.
- Brave Search MCP replaces this functionality.

## Frontend

### ChatInput — "+" Button & MCP Selector

**Location:** Next to the existing paperclip (attachment) button in `ChatInput.tsx`.

**"+" Button:**
- Renders next to the paperclip icon.
- When at least one MCP server is active, shows a subtle gold dot indicator.
- Clicking opens the MCP Selector Popover.

**MCP Selector Popover:**
- Small floating panel anchored to the "+" button.
- Lists all enabled MCP servers (from `GET /api/mcp-servers`).
- Each row: icon, server name, short description, toggle switch.
- Toggling calls `PUT /api/chats/:id/mcp-servers` for standalone chats.
- For project chats, toggles are disabled with a note: "Configured in project settings."

### Project Settings — MCP Section

**Location:** New section in the project settings page, below existing settings.

**Layout:**
- Section header: "MCP Tools"
- List of all enabled MCP servers with toggle switches.
- Toggling updates `projects.mcp_servers` via `PUT /api/projects/:id`.
- All chats in the project inherit these selections.

### Integrations Page (`/integrations`)

**Sidebar:** New item "Integrations" below Apps, above Settings. Icon: puzzle piece or plug.

**Page Layout:**
- Header: "Integrations"
- Subheader: "AI tools available in your projects and chats"
- Clean list of cards, one per enabled MCP server.

**Each card shows:**
- Icon (left)
- Name (bold)
- Detailed description (paragraph)
- Status badge: "Available" (green)

**No toggles or configuration** — this is read-only. Users configure MCP servers in project settings or via the "+" button in standalone chats. Each card shows a "Used in: Project A, Project B" line listing which of the user's projects have that server enabled (from `projects.mcp_servers`).

### Steps Panel

No changes needed. Tool calls emit SSE step events that already render in the existing collapsible steps panel. Examples:

- "Calling Brave Search: brave_web_search..."
- "Found 4 web results"
- "Calling Fetch: fetch_url..."
- "Content retrieved (2.4 KB)"
- "Calling Memory: create_entities..."
- "Saved 3 entities to knowledge graph"

## Pre-seeded MCP Servers

Seeded on first run in `server/database.js` (same pattern as existing demo data seeding).

### 1. Brave Search

- **Name:** Brave Search
- **Description:** Search the web in real-time during conversations. The AI can look up current market data, property comparables, industry news, company information, and regulatory updates. Results are woven into the AI's response with source attribution. Powered by Brave's independent search index — covers web, news, and local business listings.
- **Icon:** search
- **Command:** npx
- **Args:** `["-y", "@anthropic-ai/mcp-server-brave-search"]`
- **Env vars:** `{ "BRAVE_API_KEY": "" }` (admin must add key)
- **Enabled:** 1

### 2. Fetch

- **Name:** Fetch
- **Description:** Retrieve and read content from any URL. Paste a link to a property listing, news article, report, or any web page into the conversation and the AI will pull the content, convert it to readable text, and analyze it. Supports HTML pages, JSON APIs, and plain text. Large pages are automatically chunked for processing.
- **Icon:** globe
- **Command:** npx
- **Args:** `["-y", "@anthropic-ai/mcp-server-fetch"]`
- **Env vars:** `{}`
- **Enabled:** 1

### 3. Memory

- **Name:** Memory
- **Description:** Persistent knowledge graph that remembers information across conversations. The AI can store and recall entities (clients, properties, lease terms), relationships between them, and specific observations. Useful for building up institutional knowledge over time — the AI remembers what you've told it about a client's preferences, a property's history, or a deal's key terms without re-uploading documents.
- **Icon:** brain
- **Command:** npx
- **Args:** `["-y", "@modelcontextprotocol/server-memory"]`
- **Env vars:** `{}`
- **Enabled:** 1

### 4. Puppeteer

- **Name:** Puppeteer
- **Description:** Automated browser for interacting with web pages. The AI can navigate to websites, fill out forms, take screenshots, and extract structured data from pages that require JavaScript to load. Useful for pulling data from property listing sites, capturing visual snapshots of dashboards, or scraping tabular data that isn't available via a simple URL fetch.
- **Icon:** terminal
- **Command:** npx
- **Args:** `["-y", "@anthropic-ai/mcp-server-puppeteer"]`
- **Env vars:** `{}`
- **Enabled:** 1

### 5. Sequential Thinking

- **Name:** Sequential Thinking
- **Description:** Structured reasoning for complex analysis. Gives the AI a step-by-step thinking scratchpad for problems that require careful multi-stage reasoning — lease comparisons across multiple properties, financial modeling, portfolio-level analysis, or any question where the AI needs to break down the problem, consider multiple factors, and build toward a conclusion methodically.
- **Icon:** lightbulb
- **Command:** npx
- **Args:** `["-y", "@anthropic-ai/mcp-server-sequential-thinking"]`
- **Env vars:** `{}`
- **Enabled:** 1

## Admin Panel UI

### MCP Servers Section

New section in the admin panel alongside existing Users, Models, etc.

**List View:**
- Table columns: Name, Description (truncated), Status (enabled/disabled toggle), Projects using it (count)
- Action buttons: Edit, Delete
- "Add MCP Server" button at top

**Add/Edit Form (modal or inline):**
- Name — text input
- Description — textarea
- Icon — dropdown (search, globe, brain, terminal, link, lightbulb)
- Command — text input
- Arguments — text input (JSON array)
- Environment Variables — key/value pair editor with add/remove rows. Values are masked after save (shown as "••••••"). On edit, the admin GET endpoint returns actual values (admin-only endpoint, not exposed to regular users). The frontend pre-fills fields with real values so admins can see and modify them. No sentinel-value logic needed.
- Enabled — toggle

## NPM Dependencies

- `@modelcontextprotocol/sdk` — MCP client SDK for connecting to MCP servers over stdio

## Security Notes

- **Env var storage:** Stored as plaintext in SQLite. Acceptable for single-tenant demo deployment. Production would need encryption at rest.
- **Env var display:** Values masked in admin UI after save (shown as "••••••"). Full values only sent to MCP server processes, never to the frontend.
- **MCP server isolation:** Each MCP server runs as a separate child process with only its configured env vars. No access to the main app's environment.

## Files Modified

- `server/database.js` — new `mcp_servers` table, `mcp_servers` column on `chats`, seed data
- `server/index.js` — admin MCP endpoints, user MCP endpoints, chat MCP endpoints, replace Tavily loop with generic MCP tool loop
- `server/lib/mcp-manager.js` — new file, MCP process manager singleton
- `server/lib/gemini.js` — remove Tavily-specific code, accept generic function declarations
- `src/components/chat/ChatInput.tsx` — "+" button and MCP selector popover
- `src/pages/MainChatPage.tsx` — wire MCP state to ChatInput
- `src/pages/IntegrationsPage.tsx` — new page, read-only MCP server list
- `src/pages/AdminPage.tsx` — MCP servers management section
- `src/pages/ProjectSettingsPage.tsx` (or equivalent) — MCP toggle section
- `src/api/index.ts` — new API methods for MCP endpoints
- `src/App.tsx` — add `/integrations` route
- `src/store/index.ts` — sidebar entry for Integrations
- `src/types/index.ts` — `McpServer` interface
- `.env` — remove `TAVILY_API_KEY`
- `package.json` — add `@modelcontextprotocol/sdk`
