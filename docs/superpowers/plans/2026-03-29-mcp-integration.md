# MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-off Tavily integration with a generic MCP (Model Context Protocol) tool system — admins manage a catalog of MCP servers, users toggle them per project or per standalone chat, and the AI calls MCP tools via Gemini's native function calling.

**Architecture:** Backend spawns MCP servers as stdio child processes managed by a singleton `McpManager`. MCP tool schemas are converted to Gemini `functionDeclarations` and fed into a generic tool-calling loop that replaces the Tavily-specific code. Frontend adds a "+" button in ChatInput for standalone chat tool selection, MCP toggles in project settings, an Integrations browse page, and a rewritten admin MCP management page backed by the database instead of localStorage.

**Tech Stack:** Node.js/Express backend, `@modelcontextprotocol/sdk` for MCP client, `@google/genai` for Gemini, React/TypeScript/Tailwind frontend, SQLite via sql.js, Zustand state.

---

## File Structure

### New Files
- `server/lib/mcp-manager.js` — Singleton MCP process manager (start, stop, getTools, callTool)
- `src/pages/IntegrationsPage.tsx` — Read-only user-facing page listing available MCP servers

### Modified Files
- `server/database.js` — Add `mcp_servers` table, `mcp_servers` column on `chats` and `projects`, seed 5 MCP servers
- `server/index.js` — Admin CRUD endpoints, user list endpoint, chat MCP endpoint, replace Tavily loop in message handler
- `server/lib/gemini.js` — Accept external `tools` array and `onStep` callback, remove Tavily-specific code from `chatWithDocuments`
- `src/types/index.ts` — Add `McpServer` interface, add `mcp_servers` to `Chat` and `Project`
- `src/api/index.ts` — Add MCP API methods
- `src/pages/AdminMcpPage.tsx` — Rewrite to use database API instead of localStorage
- `src/components/projects/ProjectForm.tsx` — Fetch MCP servers from API instead of localStorage
- `src/components/chat/ChatInput.tsx` — Add "+" button and MCP selector popover
- `src/pages/MainChatPage.tsx` — Wire MCP state to ChatInput, persist to chat
- `src/App.tsx` — Add `/integrations` route
- `src/components/sidebar/Sidebar.tsx` — Add Integrations nav item, bump version
- `package.json` — Add `@modelcontextprotocol/sdk`

### Removed Files
- `server/lib/tavily.js` — Replaced by Brave Search MCP server

---

## Task 1: Install dependency and add types

**Files:**
- Modify: `package.json`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Install @modelcontextprotocol/sdk**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Add McpServer interface and update Chat/Project types**

In `src/types/index.ts`, add the `McpServer` interface and update `Chat` and `Project`:

```typescript
export interface McpServer {
  id: string;
  name: string;
  description: string;
  icon: string;
  command: string;
  args: string;      // JSON array
  env_vars: string;  // JSON object
  enabled: number;
  created_at: string;
  updated_at: string;
}
```

Add to the existing `Chat` interface:

```typescript
  mcp_servers?: string;  // JSON array of mcp_server IDs
```

Add to the existing `Project` interface:

```typescript
  mcp_servers?: string;  // JSON array of mcp_server IDs
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/types/index.ts
git commit -m "feat(mcp): install MCP SDK, add McpServer type and update Chat/Project interfaces"
```

---

## Task 2: Database schema — mcp_servers table, columns, and seed data

**Files:**
- Modify: `server/database.js`

- [ ] **Step 1: Add mcp_servers table in initializeDatabase**

Inside the `db.exec()` block in `initializeDatabase()`, after the existing table definitions, add:

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  command TEXT NOT NULL,
  args TEXT,
  env_vars TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Add mcp_servers column to chats and projects**

After the existing `ALTER TABLE` statements (around line 312), add:

```javascript
try { db.run(`ALTER TABLE chats ADD COLUMN mcp_servers TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
try { db.run(`ALTER TABLE projects ADD COLUMN mcp_servers TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
```

- [ ] **Step 3: Seed 5 MCP servers**

In the `runMigrations` function (or alongside existing seed logic), add seed data. Use `dbGet` to check existence first:

```javascript
const existingMcp = dbGet(db, 'SELECT id FROM mcp_servers LIMIT 1', []);
if (!existingMcp) {
  const now = new Date().toISOString();
  const mcpServers = [
    {
      id: 'mcp-brave-search',
      name: 'Brave Search',
      description: 'Search the web in real-time during conversations. The AI can look up current market data, property comparables, industry news, company information, and regulatory updates. Results are woven into the AI\'s response with source attribution. Powered by Brave\'s independent search index — covers web, news, and local business listings.',
      icon: 'search',
      command: 'npx',
      args: JSON.stringify(['-y', '@anthropic-ai/mcp-server-brave-search']),
      env_vars: JSON.stringify({ BRAVE_API_KEY: '' }),
      enabled: 1,
    },
    {
      id: 'mcp-fetch',
      name: 'Fetch',
      description: 'Retrieve and read content from any URL. Paste a link to a property listing, news article, report, or any web page into the conversation and the AI will pull the content, convert it to readable text, and analyze it. Supports HTML pages, JSON APIs, and plain text. Large pages are automatically chunked for processing.',
      icon: 'globe',
      command: 'npx',
      args: JSON.stringify(['-y', '@anthropic-ai/mcp-server-fetch']),
      env_vars: JSON.stringify({}),
      enabled: 1,
    },
    {
      id: 'mcp-memory',
      name: 'Memory',
      description: 'Persistent knowledge graph that remembers information across conversations. The AI can store and recall entities (clients, properties, lease terms), relationships between them, and specific observations. Useful for building up institutional knowledge over time — the AI remembers what you\'ve told it about a client\'s preferences, a property\'s history, or a deal\'s key terms without re-uploading documents.',
      icon: 'brain',
      command: 'npx',
      args: JSON.stringify(['-y', '@modelcontextprotocol/server-memory']),
      env_vars: JSON.stringify({}),
      enabled: 1,
    },
    {
      id: 'mcp-puppeteer',
      name: 'Puppeteer',
      description: 'Automated browser for interacting with web pages. The AI can navigate to websites, fill out forms, take screenshots, and extract structured data from pages that require JavaScript to load. Useful for pulling data from property listing sites, capturing visual snapshots of dashboards, or scraping tabular data that isn\'t available via a simple URL fetch.',
      icon: 'terminal',
      command: 'npx',
      args: JSON.stringify(['-y', '@anthropic-ai/mcp-server-puppeteer']),
      env_vars: JSON.stringify({}),
      enabled: 1,
    },
    {
      id: 'mcp-sequential-thinking',
      name: 'Sequential Thinking',
      description: 'Structured reasoning for complex analysis. Gives the AI a step-by-step thinking scratchpad for problems that require careful multi-stage reasoning — lease comparisons across multiple properties, financial modeling, portfolio-level analysis, or any question where the AI needs to break down the problem, consider multiple factors, and build toward a conclusion methodically.',
      icon: 'lightbulb',
      command: 'npx',
      args: JSON.stringify(['-y', '@anthropic-ai/mcp-server-sequential-thinking']),
      env_vars: JSON.stringify({}),
      enabled: 1,
    },
  ];
  for (const s of mcpServers) {
    dbRun(db, `INSERT INTO mcp_servers (id, name, description, icon, command, args, env_vars, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.name, s.description, s.icon, s.command, s.args, s.env_vars, s.enabled, now, now]);
  }
}
```

- [ ] **Step 4: Verify by starting the server**

```bash
npm run dev:backend
```

Expected: Server starts without errors, `mcp_servers` table created and seeded.

- [ ] **Step 5: Commit**

```bash
git add server/database.js
git commit -m "feat(mcp): add mcp_servers table, columns on chats/projects, seed 5 servers"
```

---

## Task 3: MCP Process Manager

**Files:**
- Create: `server/lib/mcp-manager.js`

- [ ] **Step 1: Create mcp-manager.js**

This singleton manages MCP server child processes via the `@modelcontextprotocol/sdk`. Key behaviors:
- Lazy start on first tool request
- 10-minute idle reaping
- 30-second timeout per tool call
- Auto-restart on dead process

```javascript
/**
 * MCP Process Manager — singleton that manages MCP server child processes.
 * Servers start lazily on first request, idle-reap after 10 minutes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CALL_TIMEOUT_MS = 30 * 1000;       // 30 seconds per tool call

class McpManager {
  constructor() {
    this._connections = new Map();
    this._reapInterval = setInterval(() => this._reapIdle(), 60_000);
  }

  async startServer(serverConfig) {
    if (this._connections.has(serverConfig.id)) {
      await this.stopServer(serverConfig.id);
    }

    const args = JSON.parse(serverConfig.args || '[]');
    const envVars = JSON.parse(serverConfig.env_vars || '{}');

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args,
      env: { ...process.env, ...envVars },
    });

    const client = new Client({
      name: 'vetted-portal',
      version: '1.0.0',
    });

    await client.connect(transport);

    this._connections.set(serverConfig.id, {
      client,
      transport,
      config: serverConfig,
      lastUsed: Date.now(),
    });

    return client;
  }

  async stopServer(serverId) {
    const conn = this._connections.get(serverId);
    if (!conn) return;
    try {
      await conn.client.close();
    } catch (e) {
      console.warn(`[mcp] error closing ${serverId}:`, e.message);
    }
    this._connections.delete(serverId);
  }

  async _getClient(serverConfig) {
    const conn = this._connections.get(serverConfig.id);
    if (conn) {
      conn.lastUsed = Date.now();
      return conn.client;
    }
    return this.startServer(serverConfig);
  }

  async getTools(serverConfig) {
    const client = await this._getClient(serverConfig);
    const result = await client.listTools();
    return result.tools || [];
  }

  async callTool(serverConfig, toolName, args) {
    const client = await this._getClient(serverConfig);
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: args }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool call timed out after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS)
      ),
    ]);

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return JSON.stringify(result.content || result);
  }

  async stopAll() {
    clearInterval(this._reapInterval);
    const ids = [...this._connections.keys()];
    await Promise.all(ids.map(id => this.stopServer(id)));
  }

  _reapIdle() {
    const now = Date.now();
    for (const [id, conn] of this._connections) {
      if (now - conn.lastUsed > IDLE_TIMEOUT_MS) {
        console.log(`[mcp] reaping idle server: ${conn.config.name}`);
        this.stopServer(id);
      }
    }
  }
}

const mcpManager = new McpManager();
export default mcpManager;
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/mcp-manager.js
git commit -m "feat(mcp): add MCP process manager singleton"
```

---

## Task 4: Backend API endpoints (admin + user + chat)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Import mcpManager at the top of server/index.js**

Near the existing imports (around line 10):

```javascript
import mcpManager from './lib/mcp-manager.js';
```

Add process cleanup handler near the end of the file (before `app.listen`):

```javascript
process.on('SIGTERM', async () => { await mcpManager.stopAll(); process.exit(0); });
process.on('SIGINT', async () => { await mcpManager.stopAll(); process.exit(0); });
```

- [ ] **Step 2: Add admin MCP CRUD endpoints**

Add these after the existing admin endpoints (after `requireAdmin` usage):

```javascript
// -- Admin MCP Servers ---------------------------------------------------
app.get('/api/admin/mcp-servers', requireAuth, requireAdmin, (req, res) => {
  const servers = dbAll(db, 'SELECT * FROM mcp_servers ORDER BY name', []);
  res.json({ servers });
});

app.post('/api/admin/mcp-servers', requireAuth, requireAdmin, (req, res) => {
  const { name, description, icon, command, args, env_vars, enabled } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'Name and command are required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `INSERT INTO mcp_servers (id, name, description, icon, command, args, env_vars, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, icon || null, command,
     args || '[]', env_vars || '{}',
     enabled !== undefined ? (enabled ? 1 : 0) : 1, now, now]);
  const server = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [id]);
  res.status(201).json({ server });
});

app.put('/api/admin/mcp-servers/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'MCP server not found' });
  const { name, description, icon, command, args, env_vars, enabled } = req.body;
  const now = new Date().toISOString();
  dbRun(db, `UPDATE mcp_servers SET
    name = ?, description = ?, icon = ?, command = ?, args = ?, env_vars = ?, enabled = ?, updated_at = ?
    WHERE id = ?`,
    [
      name !== undefined ? name : existing.name,
      description !== undefined ? description : existing.description,
      icon !== undefined ? icon : existing.icon,
      command !== undefined ? command : existing.command,
      args !== undefined ? args : existing.args,
      env_vars !== undefined ? env_vars : existing.env_vars,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      now, req.params.id,
    ]);
  // Restart the server process if running (config may have changed)
  await mcpManager.stopServer(req.params.id);
  const server = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  res.json({ server });
});

app.delete('/api/admin/mcp-servers/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'MCP server not found' });
  await mcpManager.stopServer(req.params.id);
  dbRun(db, 'DELETE FROM mcp_servers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});
```

- [ ] **Step 3: Add user-facing MCP endpoint**

```javascript
// -- User MCP Servers (enabled only, env_vars stripped) ------------------
app.get('/api/mcp-servers', requireAuth, (req, res) => {
  const servers = dbAll(db,
    'SELECT id, name, description, icon, enabled, created_at FROM mcp_servers WHERE enabled = 1 ORDER BY name', []);
  res.json({ servers });
});
```

- [ ] **Step 4: Add chat MCP servers endpoint**

```javascript
// -- Chat MCP server selection -------------------------------------------
app.put('/api/chats/:id/mcp-servers', requireAuth, (req, res) => {
  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ?', [req.params.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (chat.user_id !== req.user.id) return res.status(403).json({ error: 'Not your chat' });
  const { serverIds } = req.body;
  dbRun(db, 'UPDATE chats SET mcp_servers = ? WHERE id = ?',
    [JSON.stringify(serverIds || []), req.params.id]);
  res.json({ success: true });
});
```

- [ ] **Step 5: Update admin stats to include MCP server count**

Find the existing `GET /api/admin/stats` endpoint and add an mcp_servers count:

```javascript
const mcpCount = dbGet(db, 'SELECT COUNT(*) as count FROM mcp_servers', []);
// Add to response object: mcp_servers: mcpCount?.count || 0
```

- [ ] **Step 6: Verify endpoints**

```bash
npm run dev:backend
# In another terminal:
curl -H 'X-User-Id: <admin-user-id>' http://localhost:3000/api/admin/mcp-servers
```

Expected: Returns JSON with 5 seeded MCP servers.

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat(mcp): add admin CRUD, user list, and chat MCP server endpoints"
```

---

## Task 5: Replace Tavily with generic MCP tool-calling in gemini.js

**Files:**
- Modify: `server/lib/gemini.js`
- Delete: `server/lib/tavily.js`
- Modify: `.env` (remove TAVILY_API_KEY)

- [ ] **Step 1: Modify chatWithDocuments to accept external tools parameter**

Add `tools = []` as the 8th parameter to `chatWithDocuments` (line 461). The function signature becomes:

```javascript
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null, modelOverride = null, tools = []) {
```

Replace everything from the `// Use Tavily web search via function calling if available` comment (line 495) through the end of the function with:

```javascript
  // No tools — use continuation for long responses
  if (tools.length === 0) {
    const result = await generateWithContinuation(contents, {}, [], modelOverride);
    const usageMeta = result?.response?.usageMetadata;
    const inputTokens = result._totalInputTokens || usageMeta?.promptTokenCount || 0;
    const outputTokens = result._totalOutputTokens || usageMeta?.candidatesTokenCount || 0;
    if ((inputTokens || outputTokens) && userId) {
      logUsage(getDatabase(), { userId, source: 'chat', prompt: userMessage, model: resolveModelId(modelOverride) || config.modelId, inputTokens, outputTokens });
    }
    return extractGroundedResponse(result);
  }

  // With tools — single generate call, return raw parts for caller's tool loop
  const result = await generate(contents, {}, tools, modelOverride);
  const candidate = result.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const fnCalls = parts.filter((p) => p.functionCall);
  if (fnCalls.length === 0) {
    // Model chose not to use tools — just text
    const usageMeta = result?.usageMetadata || result?.response?.usageMetadata;
    if (usageMeta && userId) {
      logUsage(getDatabase(), { userId, source: 'chat', prompt: userMessage, model: resolveModelId(modelOverride) || config.modelId, inputTokens: usageMeta.promptTokenCount || 0, outputTokens: usageMeta.candidatesTokenCount || 0 });
    }
    return { text: extractGroundedResponse(result).text };
  }

  // Return function calls for the caller to handle in its tool loop
  return { text: null, functionCalls: fnCalls, _modelParts: parts, _contents: contents };
```

Also export `generate` and `extractGroundedResponse` so server/index.js can continue the conversation:

```javascript
export { generate, extractGroundedResponse };
```

- [ ] **Step 2: Remove Tavily imports from gemini.js**

Remove the import line at the top (line 14):

```javascript
// DELETE: import { tavilySearch, hasTavily } from "./tavily.js";
```

- [ ] **Step 3: Remove Tavily code from chatWithLeases**

In `chatWithLeases` (around line 343), replace the `if (useSearch && hasTavily())` block with simple generation:

```javascript
  // Web search not supported in lease chat (use MCP in main chat instead)
  const result = await generateWithContinuation(contents, {}, [], null);
  const usageMeta = result?.response?.usageMetadata;
  if (usageMeta) {
    logUsage(getDatabase(), {
      userId, source: 'lease', prompt: userMessage,
      model: config.modelId,
      inputTokens: usageMeta.promptTokenCount || 0,
      outputTokens: usageMeta.candidatesTokenCount || 0,
    });
  }
  return extractGroundedResponse(result);
```

- [ ] **Step 4: Remove Tavily code from chatCrossPortfolio**

Same pattern — replace the `if (useSearch && hasTavily())` block in `chatCrossPortfolio` (around line 590) with simple generation without tools.

- [ ] **Step 5: Delete tavily.js and remove TAVILY_API_KEY**

```bash
rm server/lib/tavily.js
```

Remove the `TAVILY_API_KEY=...` line from `.env`.

- [ ] **Step 6: Verify server starts**

```bash
npm run dev:backend
```

Expected: No import errors, server starts clean.

- [ ] **Step 7: Commit**

```bash
git add server/lib/gemini.js .env
git rm server/lib/tavily.js
git commit -m "feat(mcp): replace Tavily with generic tool interface in gemini.js"
```

---

## Task 6: MCP tool-calling loop in chat message handler

**Files:**
- Modify: `server/index.js` (the `POST /api/chats/:id/messages` handler)

This is the core integration — replacing the simple `geminiChatWithDocuments()` call with a loop that handles MCP tool calls.

- [ ] **Step 1: Add MCP tool resolution after context loading**

Inside the `POST /api/chats/:id/messages` handler, after the context loading pipeline (after tools/skills are loaded, around line 670), add MCP tool resolution. Import `generate` and `extractGroundedResponse` from gemini.js at the top of the file:

```javascript
import { generate as geminiGenerate, extractGroundedResponse } from './lib/gemini.js';
```

Then in the handler:

```javascript
// -- MCP tool declarations -----------------------------------------------
let mcpToolDeclarations = [];
let mcpToolMap = {}; // prefixedName -> { serverId, serverName, originalName, serverConfig }

// Determine active MCP servers
let activeMcpIds = [];
if (chat.project_id) {
  const proj = dbGet(db, 'SELECT mcp_servers FROM projects WHERE id = ?', [chat.project_id]);
  try { activeMcpIds = JSON.parse(proj?.mcp_servers || '[]'); } catch { activeMcpIds = []; }
} else {
  try { activeMcpIds = JSON.parse(chat.mcp_servers || '[]'); } catch { activeMcpIds = []; }
}

if (activeMcpIds.length > 0) {
  const mcpServers = dbAll(db,
    `SELECT * FROM mcp_servers WHERE id IN (${activeMcpIds.map(() => '?').join(',')}) AND enabled = 1`,
    activeMcpIds
  );

  for (const server of mcpServers) {
    try {
      step(`Starting ${server.name}...`);
      const tools = await mcpManager.getTools(server);
      for (const tool of tools) {
        const prefixedName = `${server.id}__${tool.name}`;
        mcpToolMap[prefixedName] = {
          serverId: server.id,
          serverName: server.name,
          originalName: tool.name,
          serverConfig: server,
        };
        const declaration = {
          name: prefixedName,
          description: tool.description || '',
        };
        if (tool.inputSchema && tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0) {
          declaration.parameters = {
            type: tool.inputSchema.type || 'object',
            properties: tool.inputSchema.properties || {},
          };
          if (tool.inputSchema.required) {
            declaration.parameters.required = tool.inputSchema.required;
          }
        }
        mcpToolDeclarations.push(declaration);
      }
      step(`Loaded ${tools.length} tool${tools.length !== 1 ? 's' : ''} from ${server.name}`);
    } catch (err) {
      step(`Failed to start ${server.name}: ${err.message}`);
      console.error(`[mcp] Failed to start ${server.name}:`, err);
    }
  }
}

const geminiTools = mcpToolDeclarations.length > 0
  ? [{ functionDeclarations: mcpToolDeclarations }]
  : [];
```

- [ ] **Step 2: Replace the existing Gemini call with a tool-calling loop**

Replace the existing call (around line 673):

```javascript
// OLD: const result = await geminiChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId);
```

With:

```javascript
let aiText = '';
const result = await geminiChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, geminiTools);

if (result.text) {
  // Model returned text directly (no tool calls or no tools)
  aiText = result.text;
} else if (result.functionCalls) {
  // Tool-calling loop
  let contents = result._contents;
  let modelParts = result._modelParts;
  const MAX_ITERATIONS = 10;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Add model's function call response to conversation
    contents.push({ role: 'model', parts: modelParts });

    // Execute all function calls concurrently
    const fnCalls = modelParts.filter(p => p.functionCall);
    const fnResponseParts = await Promise.all(fnCalls.map(async (part) => {
      const prefixedName = part.functionCall.name;
      const mapping = mcpToolMap[prefixedName];
      if (!mapping) {
        return { functionResponse: { name: prefixedName, response: { result: 'Error: Unknown tool' } } };
      }
      step(`Calling ${mapping.serverName}: ${mapping.originalName}...`);
      try {
        const toolResult = await mcpManager.callTool(mapping.serverConfig, mapping.originalName, part.functionCall.args || {});
        step(`${mapping.originalName} returned (${toolResult.length} chars)`);
        return { functionResponse: { name: prefixedName, response: { result: toolResult } } };
      } catch (err) {
        step(`${mapping.originalName} error: ${err.message}`);
        return { functionResponse: { name: prefixedName, response: { result: `Error: ${err.message}` } } };
      }
    }));

    contents.push({ role: 'user', parts: fnResponseParts });

    // Next Gemini call
    const nextResult = await geminiGenerate(contents, {}, geminiTools, modelId);
    const candidate = nextResult.candidates?.[0];
    const nextParts = candidate?.content?.parts ?? [];

    const nextFnCalls = nextParts.filter(p => p.functionCall);
    if (nextFnCalls.length === 0) {
      // Model returned text — done
      aiText = extractGroundedResponse(nextResult).text;
      break;
    }

    // More tool calls — continue loop
    modelParts = nextParts;
  }

  if (!aiText) {
    // Max iterations hit — try one more without tools
    const fallback = await geminiGenerate(contents, {}, [], modelId);
    aiText = extractGroundedResponse(fallback).text;
  }
}
```

- [ ] **Step 3: Update the response saving to use aiText**

Find where `result.text` is used to save the AI message to the database (around line 700+) and replace with `aiText`. The pattern is:

```javascript
// Replace result.text with aiText wherever the AI response text is saved/sent
```

- [ ] **Step 4: Verify end-to-end**

```bash
npm run dev
```

1. Create a standalone chat
2. Send a message (no MCP servers active) — should work as before
3. Enable an MCP server on a chat — tool-calling loop should engage

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(mcp): generic MCP tool-calling loop in chat message handler"
```

---

## Task 7: Frontend API methods

**Files:**
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add MCP API methods**

Add after the existing `projects` export:

```typescript
export const mcpServers = {
  // User-facing (enabled only, no env_vars)
  list: () => request('/mcp-servers').then(d => d.servers || []),

  // Admin CRUD (includes env_vars)
  adminList: () => request('/admin/mcp-servers').then(d => d.servers || []),
  adminCreate: (data: any) => request('/admin/mcp-servers', { method: 'POST', body: JSON.stringify(data) }).then(d => d.server),
  adminUpdate: (id: string, data: any) => request(`/admin/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.server),
  adminDelete: (id: string) => request(`/admin/mcp-servers/${id}`, { method: 'DELETE' }),

  // Chat-level MCP selection
  setChatServers: (chatId: string, serverIds: string[]) =>
    request(`/chats/${chatId}/mcp-servers`, { method: 'PUT', body: JSON.stringify({ serverIds }) }),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(mcp): add frontend API methods for MCP servers"
```

---

## Task 8: Rewrite AdminMcpPage to use database API

**Files:**
- Modify: `src/pages/AdminMcpPage.tsx`

- [ ] **Step 1: Rewrite AdminMcpPage**

Replace the entire file. Key changes:
- Fetch from `/api/admin/mcp-servers` instead of localStorage
- Add/edit form includes command, args, env_vars fields
- Env vars use key/value pair editor
- Icon dropdown
- Toggle calls PUT endpoint

```typescript
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check, Search, Globe, Brain, Terminal, Link, Lightbulb, Cpu } from 'lucide-react';
import { mcpServers as mcpApi } from '../api';
import type { McpServer } from '../types';

const ICON_OPTIONS = [
  { value: 'search', label: 'Search', Icon: Search },
  { value: 'globe', label: 'Globe', Icon: Globe },
  { value: 'brain', label: 'Brain', Icon: Brain },
  { value: 'terminal', label: 'Terminal', Icon: Terminal },
  { value: 'link', label: 'Link', Icon: Link },
  { value: 'lightbulb', label: 'Lightbulb', Icon: Lightbulb },
];

function getIcon(icon: string) {
  const match = ICON_OPTIONS.find(o => o.value === icon);
  return match ? match.Icon : Cpu;
}

interface EnvVar { key: string; value: string; }

const BLANK_FORM = {
  name: '', description: '', icon: 'search', command: '', args: '[]',
  envVars: [] as EnvVar[], enabled: true,
};

export default function AdminMcpPage() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

  const load = () => {
    mcpApi.adminList().then(setServers).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const openEdit = (server: McpServer) => {
    setEditingId(server.id);
    const envObj = JSON.parse(server.env_vars || '{}');
    setForm({
      name: server.name,
      description: server.description || '',
      icon: server.icon || 'search',
      command: server.command,
      args: server.args || '[]',
      envVars: Object.entries(envObj).map(([key, value]) => ({ key, value: value as string })),
      enabled: !!server.enabled,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    const envObj: Record<string, string> = {};
    for (const { key, value } of form.envVars) {
      if (key.trim()) envObj[key.trim()] = value;
    }
    const data = {
      name: form.name, description: form.description, icon: form.icon,
      command: form.command, args: form.args,
      env_vars: JSON.stringify(envObj), enabled: form.enabled,
    };
    if (editingId) {
      await mcpApi.adminUpdate(editingId, data);
    } else {
      await mcpApi.adminCreate(data);
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this MCP server?')) return;
    await mcpApi.adminDelete(id);
    load();
  };

  const handleToggle = async (server: McpServer) => {
    await mcpApi.adminUpdate(server.id, { enabled: !server.enabled });
    load();
  };

  const addEnvVar = () => setForm({ ...form, envVars: [...form.envVars, { key: '', value: '' }] });
  const removeEnvVar = (i: number) => setForm({ ...form, envVars: form.envVars.filter((_, idx) => idx !== i) });
  const updateEnvVar = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...form.envVars];
    updated[i] = { ...updated[i], [field]: val };
    setForm({ ...form, envVars: updated });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-1 hover:bg-vetted-surface rounded transition-colors">
          <ArrowLeft size={16} className="text-vetted-text-secondary" />
        </button>
        <h1 className="text-xl font-serif text-vetted-primary flex-1">MCP Servers</h1>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
          <Plus size={14} /> Add MCP Server
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <p className="text-sm text-vetted-text-secondary">
          Configure MCP (Model Context Protocol) servers that provide AI tools. Enabled servers are available to users in project settings and standalone chats.
        </p>

        {/* Add/Edit form */}
        {showForm && (
          <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
            <h3 className="text-sm font-medium text-vetted-primary">{editingId ? 'Edit' : 'Add'} MCP Server</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Brave Search" className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Icon</label>
                <select value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent">
                  {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What this MCP server does" rows={2}
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Command *</label>
                <input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })}
                  placeholder="npx" className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Arguments (JSON array)</label>
                <input value={form.args} onChange={e => setForm({ ...form, args: e.target.value })}
                  placeholder='["-y", "@anthropic-ai/mcp-server-brave-search"]'
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-vetted-text-secondary">Environment Variables</label>
                <button type="button" onClick={addEnvVar} className="text-xs text-vetted-accent hover:text-vetted-primary transition-colors">+ Add Variable</button>
              </div>
              {form.envVars.length === 0 && <p className="text-xs text-vetted-text-muted">No environment variables configured.</p>}
              {form.envVars.map((ev, i) => (
                <div key={i} className="flex gap-2 mt-1.5">
                  <input value={ev.key} onChange={e => updateEnvVar(i, 'key', e.target.value)} placeholder="KEY"
                    className="flex-1 px-2 py-1.5 text-xs border border-vetted-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
                  <input value={ev.value} onChange={e => updateEnvVar(i, 'value', e.target.value)} placeholder="value"
                    className="flex-1 px-2 py-1.5 text-xs border border-vetted-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
                  <button onClick={() => removeEnvVar(i)} className="p-1 hover:bg-red-50 rounded-lg"><Trash2 size={12} className="text-red-400" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-vetted-text-secondary">Enabled</label>
              <div onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${form.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"><X size={13} /> Cancel</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.command.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"><Check size={13} /> {editingId ? 'Update' : 'Add'}</button>
            </div>
          </div>
        )}

        {/* Server list */}
        {loading ? (
          <p className="text-sm text-vetted-text-muted">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-vetted-text-muted">No MCP servers configured.</p>
        ) : servers.map((server) => {
          const IconComp = getIcon(server.icon);
          return (
            <div key={server.id} className={`border rounded-xl bg-white p-4 ${server.enabled ? 'border-vetted-border' : 'border-vetted-border opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-2 rounded-lg ${server.enabled ? 'bg-vetted-accent/10' : 'bg-vetted-surface'}`}>
                  <IconComp size={16} className={server.enabled ? 'text-vetted-accent' : 'text-vetted-text-muted'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-vetted-primary">{server.name}</p>
                    <div className="flex items-center gap-2">
                      <div onClick={() => handleToggle(server)}
                        className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${server.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${server.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <button onClick={() => openEdit(server)} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors text-xs text-vetted-text-secondary">Edit</button>
                      <button onClick={() => handleDelete(server.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13} className="text-red-400" /></button>
                    </div>
                  </div>
                  {server.description && <p className="text-xs text-vetted-text-muted mt-0.5 line-clamp-2">{server.description}</p>}
                  <p className="text-xs text-vetted-text-muted mt-1 font-mono">{server.command} {JSON.parse(server.args || '[]').join(' ')}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify admin page**

```bash
npm run dev
```

Navigate to `/admin/tool-sets`. Should show 5 seeded MCP servers from the database. Toggle, edit, and add should work.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminMcpPage.tsx
git commit -m "feat(mcp): rewrite admin MCP page to use database API"
```

---

## Task 9: Update ProjectForm to fetch MCP servers from API

**Files:**
- Modify: `src/components/projects/ProjectForm.tsx`

- [ ] **Step 1: Replace localStorage MCP loading with API call**

Remove the `getAvailableMcps()` function (lines 6-20). Add a state variable and useEffect:

```typescript
const [availableMcps, setAvailableMcps] = useState<{ id: string; name: string; description: string; icon: string }[]>([]);

useEffect(() => {
  api.mcpServers.list().then(setAvailableMcps).catch(() => {});
}, []);
```

Remove the line `const availableMcps = getAvailableMcps();` (line 152).

The `mcpServers` import is available because `api` is already imported as `import * as api from '../../api';`.

- [ ] **Step 2: Update ProjectFormData to include mcp_servers**

```typescript
export interface ProjectFormData {
  name: string;
  description: string;
  system_prompt: string;
  tool_sets: string[];
  mcp_servers: string[];
  default_model: string;
  file_ids: string[];
}
```

- [ ] **Step 3: Update enabledMcps initial state to read from mcp_servers**

Replace the current initial state (line 124-127):

```typescript
const [enabledMcps, setEnabledMcps] = useState<string[]>(() => {
  try { return JSON.parse(initialData?.mcp_servers as unknown as string ?? '[]'); }
  catch { return Array.isArray(initialData?.mcp_servers) ? (initialData.mcp_servers as unknown as string[]) : []; }
});
```

- [ ] **Step 4: Update handleSubmit to send mcp_servers**

In `handleSubmit`, update the `onSave` call:

```typescript
const result = await onSave({
  name, description, system_prompt: systemPrompt,
  tool_sets: [],   // no longer used for MCP
  mcp_servers: enabledMcps,
  default_model: selectedModel,
  file_ids: selectedFileIds,
});
```

- [ ] **Step 5: Verify project settings**

Open a project, click Settings, verify MCP tools section shows servers from the database.

- [ ] **Step 6: Commit**

```bash
git add src/components/projects/ProjectForm.tsx
git commit -m "feat(mcp): ProjectForm fetches MCP servers from API instead of localStorage"
```

---

## Task 10: Wire project mcp_servers through save flow

**Files:**
- Modify: `src/pages/ProjectDetailPage.tsx`
- Modify: `src/pages/ProjectsPage.tsx`
- Modify: `server/index.js` (project update endpoint)

- [ ] **Step 1: Update ProjectDetailPage handleUpdateProject**

Update to send `mcp_servers` to the API:

```typescript
const handleUpdateProject = async (data: { name: string; description: string; system_prompt: string; tool_sets: string[]; mcp_servers: string[]; file_ids: string[] }) => {
  // ...
  await api.projects.update(id, {
    name: data.name,
    description: data.description,
    system_prompt: data.system_prompt,
    mcp_servers: JSON.stringify(data.mcp_servers),
  });
  // ...
};
```

Pass `mcp_servers` in initialData when rendering ProjectForm:

```typescript
<ProjectForm
  initialData={{
    ...project,
    mcp_servers: project.mcp_servers as unknown as string[],
  }}
  // ...
/>
```

- [ ] **Step 2: Update ProjectsPage create handler**

If ProjectsPage has a create handler, ensure it passes `mcp_servers`:

```typescript
await api.projects.create({
  name: data.name,
  description: data.description,
  system_prompt: data.system_prompt,
  mcp_servers: JSON.stringify(data.mcp_servers || []),
});
```

- [ ] **Step 3: Update PUT /api/projects/:id in server/index.js**

In the project update handler, add `mcp_servers` to the UPDATE fields:

```javascript
const mcp_servers = req.body.mcp_servers;
// Add to the SQL UPDATE and params:
// mcp_servers = ?,
// mcp_servers !== undefined ? mcp_servers : existing.mcp_servers,
```

- [ ] **Step 4: Verify end-to-end project MCP**

1. Open a project, edit settings, toggle MCP servers, save
2. Send a message in the project chat
3. The MCP tool-calling loop should engage if servers are enabled

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectDetailPage.tsx src/pages/ProjectsPage.tsx server/index.js
git commit -m "feat(mcp): wire project mcp_servers through save flow and API"
```

---

## Task 11: ChatInput "+" button and MCP selector popover

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`
- Modify: `src/pages/MainChatPage.tsx`

- [ ] **Step 1: Add MCP props to ChatInput**

Change the component signature:

```typescript
interface ChatInputProps {
  centered?: boolean;
  projectId?: string;
  mcpServerIds?: string[];
  onMcpServersChange?: (ids: string[]) => void;
  isProjectChat?: boolean;
}

export default function ChatInput({
  centered = false, projectId,
  mcpServerIds = [], onMcpServersChange, isProjectChat = false,
}: ChatInputProps) {
```

- [ ] **Step 2: Add MCP state and fetch available servers**

Inside ChatInput, add:

```typescript
const [mcpServers, setMcpServers] = useState<{ id: string; name: string; description: string; icon: string }[]>([]);
const [showMcpPicker, setShowMcpPicker] = useState(false);
const mcpButtonRef = useRef<HTMLButtonElement>(null);

useEffect(() => {
  api.mcpServers.list().then(setMcpServers).catch(() => {});
}, []);

const activeMcpCount = mcpServerIds.length;
```

Add the `mcpServers` import — `api` should already be imported. If not, add:

```typescript
import * as api from '../../api';
```

- [ ] **Step 3: Add the "+" button next to the paperclip**

After the paperclip `<button>` (around line 292), add:

```tsx
{/* MCP Tools button */}
<button
  ref={mcpButtonRef}
  onClick={() => setShowMcpPicker(!showMcpPicker)}
  className={`p-2 rounded-lg transition-colors relative ${
    showMcpPicker
      ? 'text-vetted-accent bg-vetted-accent/10'
      : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'
  }`}
  title="AI Tools"
>
  <Plus size={18} />
  {activeMcpCount > 0 && (
    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-vetted-accent rounded-full border-2 border-white" />
  )}
</button>
```

Import `Plus` from lucide-react if not already imported.

- [ ] **Step 4: Add the MCP selector popover**

After the "+" button, add the popover (rendered conditionally). Position it relative to the button container:

```tsx
{showMcpPicker && (
  <div className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-vetted-border rounded-xl shadow-lg z-50 overflow-hidden">
    <div className="px-4 py-3 border-b border-vetted-border">
      <p className="text-sm font-medium text-vetted-primary">AI Tools</p>
      {isProjectChat && (
        <p className="text-xs text-vetted-text-muted mt-0.5">Configured in project settings</p>
      )}
    </div>
    <div className="max-h-64 overflow-y-auto divide-y divide-vetted-border">
      {mcpServers.map((server) => {
        const active = mcpServerIds.includes(server.id);
        return (
          <div key={server.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-vetted-surface/50">
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-vetted-primary">{server.name}</p>
              <p className="text-xs text-vetted-text-muted truncate">{server.description}</p>
            </div>
            {isProjectChat ? (
              <span className={`text-xs px-1.5 py-0.5 rounded ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {active ? 'On' : 'Off'}
              </span>
            ) : (
              <div
                onClick={() => {
                  const newIds = active
                    ? mcpServerIds.filter(id => id !== server.id)
                    : [...mcpServerIds, server.id];
                  onMcpServersChange?.(newIds);
                }}
                className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors flex-shrink-0 ${active ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
)}
```

Add a click-outside effect to close the popover:

```typescript
useEffect(() => {
  if (!showMcpPicker) return;
  const handler = (e: MouseEvent) => {
    if (mcpButtonRef.current && !mcpButtonRef.current.contains(e.target as Node)) {
      setShowMcpPicker(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [showMcpPicker]);
```

- [ ] **Step 5: Wire MCP state in MainChatPage**

In `src/pages/MainChatPage.tsx`, add MCP state:

```typescript
const [chatMcpServerIds, setChatMcpServerIds] = useState<string[]>([]);
```

When a chat is loaded (in the chat loading effect, after setting messages), parse the mcp_servers field:

```typescript
try { setChatMcpServerIds(JSON.parse(chat.mcp_servers || '[]')); } catch { setChatMcpServerIds([]); }
```

Add the handler to persist MCP changes:

```typescript
const handleMcpServersChange = async (ids: string[]) => {
  setChatMcpServerIds(ids);
  if (chatId) {
    try {
      await api.mcpServers.setChatServers(chatId, ids);
    } catch (err) {
      console.error('Failed to save MCP servers:', err);
    }
  }
};
```

Pass to ChatInput wherever it's rendered:

```tsx
<ChatInput
  mcpServerIds={chatMcpServerIds}
  onMcpServersChange={handleMcpServersChange}
  isProjectChat={!!activeChat?.project_id}
/>
```

- [ ] **Step 6: Verify**

```bash
npm run dev
```

1. Go to main chat, click "+" button — should show MCP server list
2. Toggle servers on/off — should persist via API
3. In a project chat, toggles should be read-only

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ChatInput.tsx src/pages/MainChatPage.tsx
git commit -m "feat(mcp): add MCP tool selector in ChatInput with + button and popover"
```

---

## Task 12: Integrations page

**Files:**
- Create: `src/pages/IntegrationsPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Create IntegrationsPage**

```typescript
import React, { useState, useEffect } from 'react';
import { Search, Globe, Brain, Terminal, Link, Lightbulb, Cpu, Puzzle } from 'lucide-react';
import * as api from '../api';

const ICON_MAP: Record<string, React.ElementType> = {
  search: Search, globe: Globe, brain: Brain,
  terminal: Terminal, link: Link, lightbulb: Lightbulb,
};

export default function IntegrationsPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    api.mcpServers.list().then(setServers).catch(() => {});
    api.projects.list().then(setProjects).catch(() => {});
  }, []);

  // Build map: serverId -> project names using it
  const serverProjects: Record<string, string[]> = {};
  for (const p of projects) {
    let mcpIds: string[] = [];
    try { mcpIds = JSON.parse(p.mcp_servers || '[]'); } catch {}
    for (const id of mcpIds) {
      if (!serverProjects[id]) serverProjects[id] = [];
      serverProjects[id].push(p.name);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Puzzle size={20} className="text-vetted-accent" />
          <div>
            <h1 className="text-xl font-serif text-vetted-primary">Integrations</h1>
            <p className="text-sm text-vetted-text-secondary mt-0.5">AI tools available in your projects and chats</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-4">
          {servers.map((server) => {
            const IconComp = ICON_MAP[server.icon] || Cpu;
            const usedIn = serverProjects[server.id] || [];
            return (
              <div key={server.id} className="border border-vetted-border rounded-xl bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-lg bg-vetted-accent/10 flex-shrink-0">
                    <IconComp size={20} className="text-vetted-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-vetted-primary">{server.name}</h3>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Available</span>
                    </div>
                    <p className="text-sm text-vetted-text-secondary leading-relaxed">{server.description}</p>
                    {usedIn.length > 0 && (
                      <p className="text-xs text-vetted-text-muted mt-2">Used in: {usedIn.join(', ')}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

Import and add route:

```typescript
import IntegrationsPage from './pages/IntegrationsPage';
```

Add in the Routes block (after `/apps`):

```tsx
<Route path="/integrations" element={<IntegrationsPage />} />
```

- [ ] **Step 3: Add Integrations to sidebar**

In `src/components/sidebar/Sidebar.tsx`:

1. Add `Puzzle` to the lucide-react imports
2. Add the nav item in the navigation array (after Apps, before Admin):

```typescript
{ path: '/integrations', icon: Puzzle, label: 'Integrations' },
```

3. Bump the version number from `v1.6.1` to `v1.7.0`

- [ ] **Step 4: Verify**

```bash
npm run dev
```

1. Check sidebar shows "Integrations" link
2. Navigate to `/integrations`
3. Should show 5 available MCP servers with descriptions
4. If any projects have MCP servers enabled, "Used in:" should show

- [ ] **Step 5: Commit**

```bash
git add src/pages/IntegrationsPage.tsx src/App.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(mcp): add Integrations page, sidebar nav, bump to v1.7.0"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full end-to-end verification**

```bash
npm run dev
```

Test checklist:
1. Admin page (`/admin/tool-sets`): 5 MCP servers shown, can CRUD
2. Project settings: MCP servers fetched from API, toggles work
3. Standalone chat: "+" button shows MCP selector, toggles persist
4. Project chat: "+" button shows read-only MCP status
5. Integrations page (`/integrations`): Shows available servers with "Used in" projects
6. Sidebar: Shows "Integrations" link, version v1.7.0
7. Message with MCP servers enabled: Tool-calling loop engages, steps shown in UI
8. Message without MCP servers: Works as before (direct text response)

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors.
