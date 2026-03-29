# Model Selector Design — Vetted Portal v2

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add Gemini 3.1 and Claude Opus 4.6 as selectable AI models across all chat surfaces in the portal. Gemini 3.1 is the default everywhere. File indexing always uses Gemini 3.1 regardless of selection.

## Scope

Three chat surfaces are affected:
- Main portal chat (general, no project)
- Project chat (same `ChatInput` component)
- Lease Chat page (`LeaseChatPage.tsx`)

Out of scope: file indexing/OCR/extraction (always Gemini 3.1), blob storage migration (separate feature).

## Model Behavior Rules

| Action | Model |
|---|---|
| File upload, OCR, data extraction (ingestion) | Gemini 3.1 — hardcoded, not affected by dropdown |
| Library file indexing | Gemini 3.1 — hardcoded |
| Chat (general, project, lease) | User-selected — default Gemini 3.1 |

If `model` is absent or unrecognized in a request, backend falls back to Gemini 3.1.

## Models

| Display name | `value` sent to API | Vertex AI model ID |
|---|---|---|
| Gemini 3.1 (default) | `gemini` | `gemini-3.1-pro-preview` |
| Claude Opus 4.6 | `claude` | `claude-opus-4-6` |

Both models are accessed via Vertex AI using Application Default Credentials (`jeffk@vettedbot.com`). No API key files.

## UI — Model Selector

### `src/components/chat/ChatInput.tsx`

The existing `MODELS` array is updated to include a `value` field (used for API calls) alongside `name` (display) and `icon`:

```ts
const MODELS = [
  { name: 'Gemini 3.1', value: 'gemini', icon: <GeminiIcon /> },
  { name: 'Claude Opus 4.6', value: 'claude', icon: <ClaudeIcon /> },
];
```

- `selectedModel.value` is sent as the `model` field in **all** API requests that currently send `selectedModel.name` — this includes both `api.chats.create()` (line 102) and `api.chats.streamMessage()` (line 129)
- localStorage key stays `selectedModel`; both read and write must use `value`:
  - Write: `localStorage.setItem('selectedModel', model.value)`
  - Read: `MODELS.find((m) => m.value === saved) ?? MODELS[0]`
- Default: `MODELS[0]` (Gemini 3.1)
- The existing model dropdown UI is reused; only the options change
- Remove the `Gemini 3 Flash` entry and the `flash` prop on `GeminiIcon` (dead code once replaced)

### `src/pages/LeaseChatPage.tsx`

Add the same model selector dropdown to the chat input area (left of the send button). LeaseChatPage has its own local state — no shared component with ChatInput. Reads/writes the same `selectedModel` localStorage key so selection is consistent across pages.

### Response bubble model label

The model label ("Gemini 3.1" or "Opus 4.6") displayed under each assistant response bubble is derived from the `model` value returned in the API response (already stored as `model_used` in the DB and returned in chat message responses). No schema changes needed — `model_used` is already in the API response. Map `'gemini'` → `'Gemini 3.1'` and `'claude'` → `'Opus 4.6'` for display.

### File upload progress bars

All file upload surfaces (main chat attachment, library upload, lease bot PDF upload) must show a real upload progress bar during the upload phase. Use `XMLHttpRequest` with `progress` events (or `fetch` with a `ReadableStream` body) to report byte-level progress. The progress bar appears as soon as the upload starts and resolves to 100% before the indexing/ingestion phase begins. The indexing phase (OCR, extraction, SSE log stream) uses the existing step/log display — no progress bar needed there.

### Model thinking feedback

While any model is generating a response, give the user maximum real-time feedback:
- **Step list** (already implemented via SSE `step` events): every meaningful processing stage emits a step — loading files, building prompt, calling model, web search queries executed. For Claude, emit a step for each Tavily search invocation (e.g. `Web search: "market rents Chicago 2025"`).
- **Animated thinking indicator**: show a pulsing spinner or animated dots in the assistant bubble while the model is generating (before the first token/response arrives).
- **Step visibility**: the step list in the chat bubble is always expanded by default while the response is in-flight; it collapses to a summary once the response is complete.
- **Web search steps**: when Claude or Gemini performs a web search, emit a `step` event with the query text so the user sees it in real time (Gemini already does this; Claude's agentic loop must emit steps between tool-use iterations).
- **Lease bot ingestion log**: the existing SSE log stream on `LeaseChatPage` already streams progress lines — no changes needed there.

## Backend Architecture

### New file: `server/lib/claude.js`

Vertex AI client for Claude Opus 4.6. Uses `google-auth-library` for ADC tokens — this package is already available as a transitive dependency of `@google/genai` (no `package.json` addition needed, but verify with `node -e "require('google-auth-library')"`).

Vertex AI endpoint for Claude (confirmed working via curl):
```
POST https://aiplatform.googleapis.com/v1/projects/{GCP_PROJECT}/locations/global/publishers/anthropic/models/claude-opus-4-6:rawPredict
```

Location is `global` (not a region) — this is correct for Anthropic publisher endpoints on this project.

Request format:
```json
{
  "anthropic_version": "vertex-2023-10-16",
  "max_tokens": 8192,
  "system": "...",
  "messages": [...]
}
```

**Exports (identical signatures to Gemini equivalents):**
- `chatWithDocuments(docs, userMessage, chatHistory, systemPromptOverride)` → `{ text, searchQueries }`
- `chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch, persona)` → `{ text, searchQueries }`
- `chatCrossPortfolio(leaseSummaries, userMessage, chatHistory, useSearch, persona)` → `{ text, searchQueries }`

**Web search (Tavily):**
- `chatWithDocuments` (main/project chat): always attempts to enable search, matching Gemini's always-on grounding. If `TAVILY_API_KEY` is absent, Claude is called without the search tool — acceptable degraded mode, no error thrown.
- `chatWithLeases` / `chatCrossPortfolio` (lease bot): search enabled only when `useSearch=true` is passed. Falls back gracefully (no search tool) if `TAVILY_API_KEY` is absent.
- Implemented as an agentic tool-use loop: Claude requests search → execute Tavily → return result → Claude continues

**PDF documents:**
- Text docs embedded in system prompt
- PDF docs sent as `type: "document"` content blocks (Claude Opus 4.6 supports native PDF reading)

### `server/lease-routes.js` changes

`POST /api/leases/chat` reads `model` from request body and routes accordingly:

```js
const useClaude = body.model === 'claude';
const chatFn = useClaude ? claudeChatWithLeases : geminiChatWithLeases;
const crossFn = useClaude ? claudeChatCrossPortfolio : geminiChatCrossPortfolio;
```

Step label in SSE updates to reflect selected model: `'Calling Claude'` or `'Calling Gemini'`.

### `server/index.js` changes

Main/project chat handler reads `model` from request body and calls Claude or Gemini `chatWithDocuments` accordingly. Step label updates to reflect selected model. Error handling updated to cover both Claude HTTP errors (status codes in message) and Gemini errors (existing pattern).

### Config changes

**`server/lib/config.js`:**
```js
modelId: process.env.MODEL_ID || 'gemini-3.1-pro-preview',   // updated default
claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-6',  // new
```

**`.env` additions:**
```
MODEL_ID=gemini-3.1-pro-preview
CLAUDE_MODEL=claude-opus-4-6
TAVILY_API_KEY=<your-key>
```

## Files Modified

| File | Change |
|---|---|
| `server/lib/claude.js` | **New** — Claude Opus 4.6 Vertex AI client with Tavily search |
| `server/lib/config.js` | Update default `modelId` to `gemini-3.1-pro-preview`; add `claudeModel` |
| `server/index.js` | Route main/project chat to Claude or Gemini based on `model` param; update step labels and error handling |
| `server/lease-routes.js` | Route lease chat to Claude or Gemini based on `model` param; update step labels |
| `src/components/chat/ChatInput.tsx` | Add `value` field to `MODELS` array; add Claude option; send `selectedModel.value` instead of `selectedModel.name` |
| `src/pages/LeaseChatPage.tsx` | Add model selector dropdown; read/write `selectedModel` localStorage key |
| `src/api/index.ts` | Pass `model` in chat API calls; update file upload calls to use XHR with progress events |
| `src/components/chat/ChatInput.tsx` | Add upload progress bar for file attachments |
| `src/pages/LeaseChatPage.tsx` | Add upload progress bar for PDF uploads |
| `src/components/chat/ChatView.tsx` | Animated thinking indicator; step list expanded by default during generation |
| `.env` | Update `MODEL_ID`; add `CLAUDE_MODEL` and `TAVILY_API_KEY` |

## Out of Scope

- Blob/Cloud Storage migration for file uploads (separate feature)
- Per-project model default (future enhancement)
- Model selector on admin or settings pages
