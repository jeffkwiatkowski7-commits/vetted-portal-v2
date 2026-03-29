# Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini 3.1 and Claude Opus 4.6 as selectable AI models across all chat surfaces (main chat, project chat, lease bot), with file upload progress bars and maximum real-time thinking feedback.

**Architecture:** New `server/lib/claude.js` mirrors Gemini's interface using Vertex AI rawPredict + Tavily tool-use loop. Both `server/index.js` and `server/lease-routes.js` branch on `req.body.model === 'claude'`. Frontend `ChatInput` and `LeaseChatPage` expose a model dropdown that reads/writes the `selectedModel` localStorage key (storing the `value` field: `'gemini'` or `'claude'`). File uploads switch from `fetch` to `XMLHttpRequest` for byte-level progress reporting.

**Tech Stack:** Node.js/Express, google-auth-library (ADC), Vertex AI rawPredict (Claude), @google/genai SDK (Gemini), Tavily REST API, React/TypeScript, XMLHttpRequest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/lib/config.js` | Modify | Add `claudeModel`, update `modelId` default |
| `server/lib/claude.js` | Create | Claude Opus 4.6 via Vertex AI, Tavily search tool-use loop |
| `server/index.js` | Modify | Route chat to Claude or Gemini; update step label + error handling |
| `server/lease-routes.js` | Modify | Route lease chat to Claude or Gemini; update step labels |
| `src/api/index.ts` | Modify | XHR upload with `onProgress` callback |
| `src/components/chat/ChatInput.tsx` | Modify | MODELS array with `value`; Claude option; send `value` not `name`; upload progress bar |
| `src/components/chat/ChatView.tsx` | Modify | Map `model_used` value to display name |
| `src/pages/LeaseChatPage.tsx` | Modify | Model selector dropdown; pass `model` in chat request; upload progress bar |
| `src/components/sidebar/Sidebar.tsx` | Modify | Bump version number |
| `.env` | Modify | Add `MODEL_ID`, `CLAUDE_MODEL`, `TAVILY_API_KEY` |

---

## Task 1: Config + .env updates

**Files:**
- Modify: `server/lib/config.js`
- Modify: `.env`

- [ ] **Step 1: Update config.js**

  Find:
  ```js
  modelId: process.env.MODEL_ID || "gemini-2.0-flash-preview",
  ```

  Replace with:
  ```js
  modelId: process.env.MODEL_ID || "gemini-3.1-pro-preview",
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-6",
  ```

- [ ] **Step 2: Update .env**

  In `.env`, replace whatever `MODEL_ID=...` line currently exists and add the two new lines after it:

  ```
  MODEL_ID=gemini-3.1-pro-preview
  CLAUDE_MODEL=claude-opus-4-6
  TAVILY_API_KEY=<your-key-here>
  ```

  (The current `MODEL_ID` value may differ — just replace the whole line. Do NOT hardcode a specific old value to search for.)

- [ ] **Step 3: Commit**

  ```bash
  git add server/lib/config.js .env
  git commit -m "feat: add claudeModel config and update modelId default to gemini-3.1"
  ```

---

## Task 2: Create server/lib/claude.js

**Files:**
- Create: `server/lib/claude.js`

This file exports three functions with identical signatures to the Gemini equivalents: `chatWithDocuments`, `chatWithLeases`, `chatCrossPortfolio`. It uses `google-auth-library` (already available as a transitive dep of `@google/genai`) to get ADC tokens, then calls the Vertex AI rawPredict endpoint for Claude Opus 4.6.

Tavily search is implemented as an agentic tool-use loop: if Claude returns a `tool_use` block, execute the Tavily search and feed the result back, repeating until Claude returns a text response (max 5 iterations).

- [ ] **Step 1: Verify google-auth-library is available**

  ```bash
  node -e "require('google-auth-library'); console.log('OK')"
  ```

  Expected: `OK`. If not, run `npm install google-auth-library`.

- [ ] **Step 2: Create the file**

  ```js
  // server/lib/claude.js
  /**
   * Claude Opus 4.6 via Vertex AI rawPredict.
   * Uses google-auth-library for ADC tokens (same account as Gemini).
   *
   * Exports (identical signatures to gemini.js equivalents):
   *   chatWithDocuments(docs, userMessage, chatHistory, systemPromptOverride)
   *   chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch, persona)
   *   chatCrossPortfolio(leaseSummaries, userMessage, chatHistory, useSearch, persona)
   */
  import { GoogleAuth } from "google-auth-library";
  import { config } from "./config.js";

  const VERTEX_ENDPOINT = `https://aiplatform.googleapis.com/v1/projects/${config.gcpProject}/locations/global/publishers/anthropic/models/${config.claudeModel}:rawPredict`;
  const MAX_TOKENS = 8192;
  const MAX_SEARCH_ITERATIONS = 5;

  // ── Auth ──────────────────────────────────────────────────────────────

  let _auth = null;
  function getAuth() {
    if (!_auth) {
      _auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
    }
    return _auth;
  }

  async function getAccessToken() {
    const client = await getAuth().getClient();
    const token = await client.getAccessToken();
    return token.token;
  }

  // ── Raw API call ──────────────────────────────────────────────────────

  async function callClaude(system, messages) {
    const token = await getAccessToken();
    const body = {
      anthropic_version: "vertex-2023-10-16",
      max_tokens: MAX_TOKENS,
      system,
      messages,
    };
    const res = await fetch(VERTEX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ── Tavily search ─────────────────────────────────────────────────────

  async function tavilySearch(query) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return null;
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.results || [])
      .map((r) => `**${r.title}** (${r.url})\n${r.content}`)
      .join("\n\n");
    return results || null;
  }

  // ── Agentic tool-use loop ─────────────────────────────────────────────

  const TOOLS_DEF = process.env.TAVILY_API_KEY
    ? [
        {
          name: "web_search",
          description:
            "Search the web for current information. Use for market data, recent events, or anything requiring live information.",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query" },
            },
            required: ["query"],
          },
        },
      ]
    : undefined;

  /**
   * Run Claude with optional tool-use loop.
   * Returns { text, searchQueries }.
   */
  async function runWithTools(system, messages, useSearch) {
    const searchQueries = [];
    const body = {
      anthropic_version: "vertex-2023-10-16",
      max_tokens: MAX_TOKENS,
      system,
      messages: [...messages],
    };
    // Tools only added when useSearch=true AND TAVILY_API_KEY is set.
    // chatWithDocuments always passes useSearch=true (matching Gemini's always-on grounding).
    // chatWithLeases/chatCrossPortfolio pass useSearch from caller (off by default).
    if (useSearch && TOOLS_DEF) {
      body.tools = TOOLS_DEF;
    }

    for (let i = 0; i < MAX_SEARCH_ITERATIONS; i++) {
      const token = await getAccessToken();
      const res = await fetch(VERTEX_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Claude API error ${res.status}: ${text}`);
      }
      const data = await res.json();

      // Check for tool_use blocks
      const toolUseBlocks = (data.content || []).filter(
        (b) => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0 || data.stop_reason !== "tool_use") {
        // Final text response
        const text = (data.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        return { text: text || "No response generated.", searchQueries };
      }

      // Execute tool calls and append results
      body.messages.push({ role: "assistant", content: data.content });

      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (block.name === "web_search") {
          const query = block.input?.query || "";
          searchQueries.push(query);
          console.log("[claude] web search:", query);
          const result = await tavilySearch(query);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result || "No results found.",
          });
        }
      }
      body.messages.push({ role: "user", content: toolResults });
    }

    throw new Error("Claude exceeded max search iterations");
  }

  // ── System prompts ────────────────────────────────────────────────────

  function buildDefaultSystemPrompt() {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    return `You are a knowledgeable, precise, and helpful AI assistant powered by Claude.

  Today's date is ${today}.

  ## Core Behavior

  - Answer questions directly and accurately
  - Use the web_search tool when questions require current information, recent events, live data, or anything likely beyond your training knowledge — search proactively, don't wait to be asked
  - When using search results, cite sources inline as [Source Name](URL)
  - If you're uncertain about something, say so clearly rather than speculating
  - Never refuse a reasonable request — if you can't do exactly what's asked, do the closest useful thing and explain

  ## Reasoning

  - For complex questions, think step by step before answering
  - Show your work when doing calculations or multi-step analysis
  - Label any assumptions you make as **[Assumption: ...]**

  ## Formatting — follow exactly

  - Use **bold** for key terms and important values
  - Use bullet lists and numbered lists to organize information
  - Use ## and ### headers to structure longer responses
  - Use markdown tables when comparing multiple items or presenting structured data
  - Use code blocks (\`\`\`) for code, commands, JSON, or technical output
  - Keep responses focused — lead with the answer, then provide supporting detail`;
  }

  function buildLeaseChatSystemPrompt(useSearch, persona) {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const personaSection = persona?.trim() ? `## Your Role\n\n${persona.trim()}\n\n` : "";

    return `${personaSection}You are a confidential lease assistant for a commercial real estate portfolio manager.
  You answer questions about lease documents. All lease data is confidential and must not be shared outside this system.

  Today's date is ${today}. Use this when answering questions about lease expirations, upcoming renewals, or time-sensitive terms.

  ## Core Rules

  **Data source discipline:**
  - Answer ONLY from the provided lease data. Do NOT use web search for questions that can be answered from the leases.
  ${useSearch ? `- Web search is enabled for this query because it requires external market data. Prefer authoritative CRE sources: CoStar, LoopNet, CBRE Research, JLL Research, Cushman & Wakefield, NAR. Cite each source inline as [Source Name](URL) with publication date if available.` : `- Web search is DISABLED for this query. Answer entirely from the provided lease data.`}

  **Never refuse financial projection questions:**
  - When asked about NOI, income projections, or cash flow, ALWAYS produce an analysis using the available lease data.
  - Never say you cannot answer because data is incomplete. Build the best estimate from available data and clearly label every assumption.
  - Label assumptions inline as **[Assumption: ...]** so the user knows what is estimated vs. known.
  - Always show two scenarios: **Base Case** (all leases renew at escalated rates) and **Risk Case** (expiring leases roll off with no replacement).
  - Present projections as a Year 1–5 table.

  **General guidelines:**
  - When referencing a specific fact from a lease, cite it inline immediately after the claim as **(Tenant Name, Suite X)**.
  - When comparing leases, highlight key differences clearly
  - If a question is ambiguous, ask a brief clarifying question before answering

  Formatting rules — FOLLOW EXACTLY:
  - Use **bold** for emphasis and key values
  - Use bullet lists and numbered lists to organize information
  - Use headers (## or ###) to organize longer responses
  - When presenting data about multiple leases, ALWAYS use a markdown table

  CRITICAL table formatting rules:
  - EVERY table row MUST be on its own line
  - The separator row MUST have EXACTLY the same number of columns as the header row
  - There MUST be a blank line before the first | row and after the last | row
  - Keep tables to 6 columns max
  - NEVER put multiple | rows on the same line`;
  }

  // ── Exported functions ────────────────────────────────────────────────

  /**
   * General document Q&A / project chat.
   * Mirrors gemini.js chatWithDocuments signature.
   */
  export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null) {
    const textDocs = docs.filter((d) => d.text !== undefined);
    const pdfDocs = docs.filter((d) => d.base64 !== undefined);

    const docContext = textDocs.length > 0
      ? textDocs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
      : "";

    const basePrompt = systemPromptOverride ?? buildDefaultSystemPrompt();
    const system = docContext
      ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
      : basePrompt;

    // Build messages — first user turn includes chat history seed or current message
    const messages = [];

    // Build first user content (may include PDF document blocks)
    const firstContent = [];

    if (chatHistory.length === 0) {
      firstContent.push({ type: "text", text: userMessage });
    } else {
      firstContent.push({ type: "text", text: chatHistory[0].content });
    }

    // Attach PDFs as document blocks
    for (const pdf of pdfDocs) {
      firstContent.push({
        type: "document",
        source: {
          type: "base64",
          media_type: pdf.mimeType,
          data: pdf.base64,
        },
      });
    }

    messages.push({ role: "user", content: firstContent });

    // Append remaining history
    for (let i = 1; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    if (chatHistory.length > 0) {
      messages.push({ role: "user", content: userMessage });
    }

    return runWithTools(system, messages, true);
  }

  /**
   * Per-project lease Q&A.
   * Mirrors gemini.js chatWithLeases signature.
   */
  export async function chatWithLeases(leaseTexts, userMessage, chatHistory = [], useSearch = false, persona) {
    const leaseContext = leaseTexts
      .map((l, i) => `\n--- LEASE ${i + 1}: ${l.tenantName} (Suite ${l.suiteNumber}) ---\n${l.text}\n`)
      .join("\n");

    const system = `${buildLeaseChatSystemPrompt(useSearch, persona)}\n\nYou have access to ${leaseTexts.length} lease(s) for this property:\n${leaseContext}`;

    const messages = [];

    if (chatHistory.length === 0) {
      messages.push({ role: "user", content: userMessage });
    } else {
      messages.push({ role: "user", content: chatHistory[0].content });
      for (let i = 1; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
      messages.push({ role: "user", content: userMessage });
    }

    return runWithTools(system, messages, useSearch);
  }

  /**
   * Cross-portfolio Q&A.
   * Mirrors gemini.js chatCrossPortfolio signature.
   */
  export async function chatCrossPortfolio(leaseSummaries, userMessage, chatHistory = [], useSearch = false, persona) {
    const summaryContext = leaseSummaries
      .map((l, i) =>
        `Lease ${i + 1}: ${l.tenantName} | Suite ${l.suiteNumber} | ${l.propertyAddress} | ` +
        `${l.leaseStartDate || "?"} to ${l.leaseEndDate || "?"} | ` +
        `$${l.monthlyRent?.toLocaleString() || "?"}/mo | ${l.squareFootage || "?"}sqft | ` +
        `Renewal: ${l.renewalOptions || "N/A"} | Notes: ${l.specialProvisions || "N/A"}`
      )
      .join("\n");

    const system = `${buildLeaseChatSystemPrompt(useSearch, persona)}

  You have summary data for ${leaseSummaries.length} leases across the entire portfolio:

  ${summaryContext}

  Answer questions using this portfolio data. If you need the full lease text to answer accurately, say so.`;

    const messages = [];

    if (chatHistory.length === 0) {
      messages.push({ role: "user", content: userMessage });
    } else {
      messages.push({ role: "user", content: chatHistory[0].content });
      for (let i = 1; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
      messages.push({ role: "user", content: userMessage });
    }

    return runWithTools(system, messages, useSearch);
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/lib/claude.js
  git commit -m "feat: add Claude Opus 4.6 Vertex AI client with Tavily search"
  ```

---

## Task 3: Update server/index.js — model routing for main/project chat

**Files:**
- Modify: `server/index.js`

The chat handler currently calls `chatWithDocuments` from `gemini.js`. It needs to branch on `req.body.model` and call the Claude version when `model === 'claude'`. Update the import, step label, and error handling.

- [ ] **Step 1: Update the import at the top of server/index.js**

  Current line 14:
  ```js
  import { chatWithDocuments } from './lib/gemini.js';
  ```

  Replace with:
  ```js
  import { chatWithDocuments as geminiChatWithDocuments } from './lib/gemini.js';
  import { chatWithDocuments as claudeChatWithDocuments } from './lib/claude.js';
  ```

- [ ] **Step 2: Update the chat handler to route by model**

  Around line 430, find:
  ```js
  step('Calling Gemini');

  const result = await chatWithDocuments(docs, content, history, systemPromptOverride);
  ```

  Replace with:
  ```js
  const useClaude = req.body.model === 'claude';
  step(useClaude ? 'Calling Claude' : 'Calling Gemini');

  const chatWithDocuments = useClaude ? claudeChatWithDocuments : geminiChatWithDocuments;
  const result = await chatWithDocuments(docs, content, history, systemPromptOverride);
  ```

- [ ] **Step 3: Update error handling to cover Claude HTTP errors**

  Around line 439, find:
  ```js
  } catch (err) {
    console.error('[chat] Gemini error:', err.message);
    const msg = err.message || '';
    if (msg.includes('invalid_grant') || msg.includes('invalid_rapt') || msg.includes('reauth') || msg.includes('Unable to authenticate')) {
  ```

  Replace with:
  ```js
  } catch (err) {
    console.error('[chat] AI error:', err.message);
    const msg = err.message || '';
    if (msg.includes('invalid_grant') || msg.includes('invalid_rapt') || msg.includes('reauth') || msg.includes('Unable to authenticate')) {
  ```

  Also find the 404 error message near line 447:
  ```js
  } else if (msg.includes('not found') || msg.includes('404')) {
      aiContent = 'The AI model is not available in this environment. Please contact your administrator.';
  ```

  Replace with:
  ```js
  } else if (msg.includes('not found') || msg.includes('404') || msg.includes('Claude API error')) {
      aiContent = 'The AI model is not available in this environment. Please contact your administrator.';
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add server/index.js
  git commit -m "feat: route main/project chat to Claude or Gemini based on model param"
  ```

---

## Task 4: Update server/lease-routes.js — model routing for lease chat

**Files:**
- Modify: `server/lease-routes.js`

- [ ] **Step 1: Check current imports at the top of lease-routes.js**

  Run: `head -20 server/lease-routes.js`

  Look for the line that imports `chatWithLeases` and `chatCrossPortfolio` from gemini.js.

- [ ] **Step 2: Update imports**

  Find (keep `ocrPdf` and `extractLeaseData` — they're used for lease ingestion):
  ```js
  import { ocrPdf, extractLeaseData, chatWithLeases, chatCrossPortfolio } from "./lib/gemini.js";
  ```

  Replace with:
  ```js
  import { ocrPdf, extractLeaseData, chatWithLeases as geminiChatWithLeases, chatCrossPortfolio as geminiChatCrossPortfolio } from "./lib/gemini.js";
  import { chatWithLeases as claudeChatWithLeases, chatCrossPortfolio as claudeChatCrossPortfolio } from "./lib/claude.js";
  ```

- [ ] **Step 3: Update the chat route to read model and branch**

  In `router.post("/leases/chat", ...)` (around line 161), find:
  ```js
  const { message, projectId, propertyId, history = [] } = req.body;
  ```

  Replace with:
  ```js
  const { message, projectId, propertyId, history = [], model } = req.body;
  const useClaude = model === 'claude';
  const chatFn = useClaude ? claudeChatWithLeases : geminiChatWithLeases;
  const crossFn = useClaude ? claudeChatCrossPortfolio : geminiChatCrossPortfolio;
  ```

- [ ] **Step 4: Replace the two `chatWithLeases` and `chatCrossPortfolio` call sites**

  Find (around line 237):
  ```js
  emit("Calling Gemini...");
  const result = await chatWithLeases(leaseTexts, message, history, useSearch, persona);
  ```

  Replace with:
  ```js
  emit(useClaude ? "Calling Claude..." : "Calling Gemini...");
  const result = await chatFn(leaseTexts, message, history, useSearch, persona);
  ```

  Find (around line 282):
  ```js
  emit("Building cross-portfolio prompt...");
  emit("Calling Gemini...");
  const result = await chatCrossPortfolio(summaries, message, history, useSearch);
  ```

  Replace with:
  ```js
  emit("Building cross-portfolio prompt...");
  emit(useClaude ? "Calling Claude..." : "Calling Gemini...");
  const result = await crossFn(summaries, message, history, useSearch);
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add server/lease-routes.js
  git commit -m "feat: route lease chat to Claude or Gemini based on model param"
  ```

---

## Task 5: Update src/api/index.ts — XHR upload with progress

**Files:**
- Modify: `src/api/index.ts`

The `library.upload()` function currently uses `fetch`. Replace with XHR so we can report byte-level progress via a callback.

**Note:** `LibraryPickerModal.tsx` already uses raw XHR directly (bypasses `api.library.upload`) and already has a full progress bar — no changes needed there. This Task upgrades the `api.library.upload` helper so any other upload caller can also get progress reporting.

- [ ] **Step 1: Replace the upload function**

  Find (lines 91–103):
  ```ts
  upload: async (file: File, projectId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (projectId) formData.append('project_id', projectId);
    const userId = localStorage.getItem('userId') || '';
    const res = await fetch(`${BASE}/library/upload`, {
      method: 'POST',
      headers: { 'X-User-Id': userId },
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  ```

  Replace with:
  ```ts
  upload: (file: File, projectId?: string, onProgress?: (percent: number) => void): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      if (projectId) formData.append('project_id', projectId);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/library/upload`);
      xhr.setRequestHeader('X-User-Id', userId);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    }),
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/api/index.ts
  git commit -m "feat: use XHR for library upload to support progress reporting"
  ```

---

## Task 6: Update src/components/chat/ChatInput.tsx

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

Four changes:
1. Add Claude icon + update MODELS array with `value` field
2. Fix localStorage to use `value` not `name`
3. Send `selectedModel.value` in both API calls
4. Add upload progress bar state + UI

- [ ] **Step 1: Add ClaudeIcon component and update MODELS**

  Find the `GeminiIcon` function and the MODELS array (lines 11–24). Replace with:
  ```tsx
  function GeminiIcon() {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1L9.5 6.5L7 13L4.5 6.5Z" fill="#3B82F6" opacity="0.9"/>
        <path d="M1 7L6.5 4.5L13 7L6.5 9.5Z" fill="#3B82F6" opacity="0.6"/>
      </svg>
    );
  }

  function ClaudeIcon() {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="#D97706" strokeWidth="1.5" fill="none"/>
        <path d="M4.5 9.5L7 4.5L9.5 9.5" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 7.5h3" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  const MODELS = [
    { name: 'Gemini 3.1', value: 'gemini', icon: <GeminiIcon /> },
    { name: 'Claude Opus 4.6', value: 'claude', icon: <ClaudeIcon /> },
  ];
  ```

- [ ] **Step 2: Fix localStorage read in useState initializer**

  Find (line 43–45):
  ```ts
  const saved = localStorage.getItem('selectedModel');
  return MODELS.find((m) => m.name === saved) ?? MODELS[0];
  ```

  Replace with:
  ```ts
  const saved = localStorage.getItem('selectedModel');
  return MODELS.find((m) => m.value === saved) ?? MODELS[0];
  ```

- [ ] **Step 3: Fix localStorage write in the dropdown onClick**

  Find (line 299):
  ```ts
  localStorage.setItem('selectedModel', model.name);
  ```

  Replace with:
  ```ts
  localStorage.setItem('selectedModel', model.value);
  ```

- [ ] **Step 4: Fix dropdown comparison from name to value**

  Find (line 302–303, the `className` condition):
  ```ts
  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-vetted-surface flex items-center gap-2.5 transition-colors ${
    selectedModel.name === model.name ? 'bg-vetted-surface font-medium' : ''
  }`}
  ```

  Replace with:
  ```ts
  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-vetted-surface flex items-center gap-2.5 transition-colors ${
    selectedModel.value === model.value ? 'bg-vetted-surface font-medium' : ''
  }`}
  ```

  Also find the checkmark condition (line 308):
  ```ts
  {selectedModel.name === model.name && (
  ```

  Replace with:
  ```ts
  {selectedModel.value === model.value && (
  ```

- [ ] **Step 5: Send selectedModel.value in api.chats.create() (line ~101)**

  Find:
  ```ts
  model: selectedModel.name,
  ```
  (Inside the `api.chats.create()` call)

  Replace with:
  ```ts
  model: selectedModel.value,
  ```

- [ ] **Step 6: Send selectedModel.value in api.chats.streamMessage() (line ~129)**

  Find:
  ```ts
  { content, model: selectedModel.name, temperature, attachments: files.map((f) => f.id) },
  ```

  Replace with:
  ```ts
  { content, model: selectedModel.value, temperature, attachments: files.map((f) => f.id) },
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/chat/ChatInput.tsx
  git commit -m "feat: update model selector to use value field; add Claude Opus 4.6 option"
  ```

---

## Task 7: Update src/components/chat/ChatView.tsx — model label display

**Files:**
- Modify: `src/components/chat/ChatView.tsx`

**IMPORTANT — animated thinking indicator and step visibility are already fully implemented in the existing code. Do NOT add them again.**
- `ThinkingIndicator` (lines 240–279) already shows animated bouncing dots when `steps.length === 0`, and shows an expanded live step list with a pulsing accent dot on the latest step while generating. This satisfies the spec's "animated thinking indicator" and "steps expanded by default while in-flight" requirements.
- `StepsLog` (line 151) starts collapsed (`open=false`) on completed messages. This satisfies the spec's "collapses to a summary once complete" requirement.
No code changes needed for these behaviors.

The `AssistantMessage` component already renders `modelUsed` (line 229–233) as "Response provided by {modelUsed}". We need to map raw API values to display names.

- [ ] **Step 1: Add a model display name mapping**

  At the top of the file, after the imports, add:
  ```ts
  function modelDisplayName(value?: string): string | undefined {
    if (!value) return undefined;
    if (value === 'gemini') return 'Gemini 3.1';
    if (value === 'claude') return 'Opus 4.6';
    return value; // fallback: show raw value
  }
  ```

- [ ] **Step 2: Apply the mapping in AssistantMessage**

  Find (line 229–233):
  ```tsx
  {modelUsed && (
    <span className="ml-2 text-[11px] text-vetted-text-muted">
      Response provided by {modelUsed}
    </span>
  )}
  ```

  Replace with:
  ```tsx
  {modelDisplayName(modelUsed) && (
    <span className="ml-2 text-[11px] text-vetted-text-muted">
      {modelDisplayName(modelUsed)}
    </span>
  )}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/chat/ChatView.tsx
  git commit -m "feat: map model_used value to display name in assistant bubbles"
  ```

---

## Task 8: Update src/pages/LeaseChatPage.tsx — model selector + upload progress

**Files:**
- Modify: `src/pages/LeaseChatPage.tsx`

Two changes:
1. Add model selector dropdown to the chat input area
2. Pass `model` in the chat API call
3. Add upload progress bar for PDF uploads

- [ ] **Step 1: Add model selector state**

  At the top of `LeaseChatPage` (after `const [chatting, setChatting] = useState(false);`), add:
  ```ts
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'claude'>(() => {
    const saved = localStorage.getItem('selectedModel');
    return (saved === 'gemini' || saved === 'claude') ? saved : 'gemini';
  });
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  ```

- [ ] **Step 2: Pass model in handleSend**

  Find (around line 333):
  ```ts
  body: JSON.stringify({ message: text, history }),
  ```

  Replace with:
  ```ts
  body: JSON.stringify({ message: text, history, model: selectedModel }),
  ```

- [ ] **Step 3: Switch PDF upload to XHR for progress**

  Find `handleFile` (around line 281–313). Replace the `fetch` call with XHR:

  ```ts
  const handleFile = async (file: File) => {
    setIngesting(true);
    setIngestLogs([]);
    setIngestDone(false);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/leases/ingest');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploadProgress(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          // Parse as SSE stream via Response
          const blob = new Blob([xhr.response], { type: 'text/event-stream' });
          const streamRes = new Response(blob);
          readSSE(streamRes, (event, data: any) => {
            if (event === 'log') {
              setIngestLogs(prev => [...prev, data.message]);
            } else if (event === 'done') {
              setIngestDone(true);
              setLeases(prev => [...prev, {
                id: data.id,
                tenantName: data.tenantName,
                propertyAddress: data.propertyAddress,
                suiteNumber: data.suiteNumber,
                monthlyRent: data.monthlyRent,
                sourceFile: file.name,
              }]);
              setIngesting(false);
            } else if (event === 'error') {
              setIngestLogs(prev => [...prev, `ERROR: ${data.message}`]);
              setIngestDone(true);
              setIngesting(false);
            }
          }).then(resolve).catch(reject);
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => { setUploadProgress(null); reject(new Error('Upload failed')); };
      xhr.send(formData);
    });
  };
  ```

  **Note:** The above approach reads SSE from a completed XHR response. This works for progress during upload, but the SSE log stream is still read after upload completes. This is correct: the progress bar tracks the upload phase (bytes sent); the SSE log stream tracks the ingestion/OCR phase after upload.

  **Alternative (simpler):** If XHR + streaming SSE is complex to combine, use XHR just for upload progress and then re-use `fetch` for the streaming part. Split into two steps: (1) XHR upload to get progress → (2) fetch the SSE stream. But since `/api/leases/ingest` is a single endpoint that handles both, check if this is feasible. The simplest approach: use XHR's `onprogress` just to drive the progress bar, then let the `onload` callback parse the accumulated SSE body at once. Given the ingestion can take 30+ seconds, this means no streaming log during ingestion — just a progress bar during upload, then logs appear all at once at the end.

  **Recommended approach:** Keep `fetch` for the full SSE stream (as it is now), but add an artificial progress indication during upload phase. Since we can't get byte-level progress with `fetch`, show an indeterminate progress bar (pulsing) during upload, switching to the log stream once SSE events start arriving. This is simpler and avoids the XHR/SSE combination problem.

  **Final decision:** Use the indeterminate spinner approach for lease PDF upload since the endpoint is SSE from the start. Add `uploadProgress` state but drive it with a boolean `uploading` flag instead of a byte count:

  ```ts
  const handleFile = async (file: File) => {
    setIngesting(true);
    setIngestLogs([]);
    setIngestDone(false);
    setUploadProgress(0); // show progress bar immediately

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/leases/ingest', {
      method: 'POST',
      body: formData,
    });

    setUploadProgress(null); // upload sent, hide bar once SSE starts

    await readSSE(res, (event, data: any) => {
      // ... same as before
    });
  };
  ```

- [ ] **Step 4: Add upload progress bar UI**

  In the left panel, just above `{!ingesting && <UploadZone onFile={handleFile} />}`, add:

  ```tsx
  {uploadProgress !== null && (
    <div className="mb-2">
      <div className="h-1.5 w-full bg-vetted-border rounded-full overflow-hidden">
        <div className="h-full bg-vetted-accent animate-pulse w-full" />
      </div>
      <p className="text-[10px] text-vetted-text-muted mt-1">Uploading PDF…</p>
    </div>
  )}
  ```

- [ ] **Step 5: Add model selector to the chat input area**

  In the chat input row (around line 421, `<div className="flex gap-2 items-end">`), add the model selector button left of the send button:

  ```tsx
  <div className="border-t border-vetted-border p-4">
    <div className="flex gap-2 items-end">
      <textarea ... />
      {/* Model selector */}
      <div className="relative shrink-0">
        <select
          value={selectedModel}
          onChange={e => {
            const val = e.target.value as 'gemini' | 'claude';
            setSelectedModel(val);
            localStorage.setItem('selectedModel', val);
          }}
          className="h-9 rounded-xl border border-vetted-border px-2 text-xs text-vetted-text-secondary bg-white focus:outline-none cursor-pointer"
        >
          <option value="gemini">Gemini 3.1</option>
          <option value="claude">Opus 4.6</option>
        </select>
      </div>
      <button ... /> {/* send button */}
    </div>
  </div>
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/LeaseChatPage.tsx
  git commit -m "feat: add model selector and upload progress to LeaseChatPage"
  ```

---

## Task 9: Bump sidebar version + final commit

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Bump the version**

  Find (line 248):
  ```tsx
  <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.0.1</p>
  ```

  Replace with:
  ```tsx
  <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.1.0</p>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/components/sidebar/Sidebar.tsx
  git commit -m "chore: bump version to v1.1.0"
  ```

---

## Manual Verification

After all tasks are complete:

1. Start dev server: `npm run dev`
2. Open the app and send a chat message — confirm "Calling Gemini" step appears
3. Switch to Claude Opus 4.6 in the dropdown — send a message — confirm "Calling Claude" step appears
4. Upload a file to the library — confirm the progress bar appears and fills to 100%
5. Open lease chat — confirm model selector appears in the input area
6. Send a lease chat message with Claude selected — confirm "Calling Claude..." step in SSE
7. Reload page — confirm model selection persists (localStorage)
8. Check assistant bubble for model label ("Gemini 3.1" or "Opus 4.6")
