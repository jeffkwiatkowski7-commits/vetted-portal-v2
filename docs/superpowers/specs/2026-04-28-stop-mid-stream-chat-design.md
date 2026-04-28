# Stop Mid-Stream Chat — Design

**Date:** 2026-04-28
**Status:** Approved, ready for implementation plan
**Surfaces in scope:** Main chat (`MainChatPage`) and project chat (`ChatInput` component used by `ProjectDetailPage`). LeaseChatPage is explicitly out of scope.

## Problem

While Claude/Gemini is generating a response, the user has no way to stop it. The Send button shows a non-clickable spinner; the input is disabled. If the response is going to be long, slow, or wrong, the user has to wait it out and Anthropic still bills the full output tokens.

## Solution overview

End-to-end abort propagation:

```
[Stop button] → [streamMessage AbortController] → [SSE socket close]
                                                          ↓
                                             server: req.on('close')
                                                          ↓
                                             AbortController.signal fed to AI SDK
                                                          ↓
                                             SDK cancels in-flight HTTP request
                                                          ↓
                                             partial text saved with marker
```

While streaming, the gold paper-airplane Send button swaps to a **red Square stop icon**. Clicking it aborts the SSE; the server sees the socket close and aborts the in-flight Anthropic/Gemini call; the assistant message is saved with `*[Response stopped by user]*` appended.

## Frontend changes

### `src/api/index.ts` — `streamMessage`

Accept an optional `externalSignal: AbortSignal` parameter. Wire it into the existing internal `AbortController` (which currently only handles the 180s timeout):

```ts
streamMessage(id, data, onStep, externalSignal?: AbortSignal)
```

When `externalSignal` fires, call `controller.abort('user-stopped')`. Distinguish stop from timeout by reading `controller.signal.reason` — on user-stopped, resolve with `{ type: 'stopped' }` instead of rejecting.

### `src/pages/MainChatPage.tsx`

- Add `abortRef = useRef<AbortController | null>(null)`.
- Before `streamMessage`, set `abortRef.current = new AbortController()` and pass `abortRef.current.signal`.
- Clear `abortRef.current = null` in the `finally` block.
- Add `handleStop = () => abortRef.current?.abort('user-stopped')`.
- Replace the non-clickable `Loader2` at line 778 with a `Square` icon (lucide-react). Make the button clickable while `chatting`. Wire `onClick={chatting ? handleStop : handleSend}`.
- Re-enable the textarea container (currently `pointer-events-none` while chatting at line 631) so the stop button is interactive. Keep the textarea itself `disabled` so the user can't type a new message while stopping.

### `src/components/chat/ChatInput.tsx`

`ChatInput` already tracks a `loading` state at line 64 (set true around the `streamMessage` call, false in `finally`). Mirror the MainChatPage pattern:

- Add `abortRef = useRef<AbortController | null>(null)`.
- Pass `abortRef.current.signal` into `streamMessage` at line 234.
- Add `handleStop` that calls `abortRef.current?.abort('user-stopped')`.
- At the button's existing `disabled` check (line 509), change to `disabled={(!message.trim() && pastedImages.length === 0 && !demoActive) && !loading}` so the button stays clickable while `loading` (it becomes the stop button).
- At the `<Send size={16} />` at line 519, swap to `loading ? <Square ... /> : <Send size={16} />` and override the `onClick`/styling for the loading branch.

### Visual

When `chatting`:
- Background: `bg-red-600 hover:bg-red-700`
- Icon: `<Square size={16} className="text-white fill-white" />`
- Tooltip: "Stop generating"

When idle: existing gold accent + `Send` icon.

## Backend changes

### `server/index.js` — chat SSE handler (around line 1074)

Add a per-request `AbortController` and wire it to socket close:

```js
const aiAbort = new AbortController();
req.on('close', () => {
  aiAbort.abort('client-disconnected');
  clearInterval(heartbeat);
});
```

Pass `aiAbort.signal` into `claudeDirectChatWithDocuments` / `geminiChatWithDocuments` via the existing options bag.

In the catch block (line ~1156), branch before the existing keyword matchers:

```js
const isUserAbort = err?.name === 'AbortError' || aiAbort.signal.aborted;
if (isUserAbort) {
  aiContent = (partialText || '').trim() + (partialText ? '\n\n' : '') + '*[Response stopped by user]*';
} else {
  // existing 401/403/429/quota/404 keyword logic
}
```

The existing `INSERT INTO messages` block already runs after the catch, so the marker message is persisted normally. The `done` SSE event won't reach the client (socket is closed) — that's fine.

### `server/lib/claude-direct.js`

Accept `signal` in the options bag (alongside `claudeTools`, `mcpToolMap`, etc.). Thread into every `client.messages.create({ ...params, signal })` call:
- The main loop call at line 185
- The final no-tools call at line 267

Add a fast-fail check at the top of each tool-loop iteration:

```js
if (signal?.aborted) throw new Error('aborted');
```

This ensures we don't kick off another `messages.create` after a tool call returns if the user has already clicked stop.

### `server/lib/gemini.js`

Accept `signal` parameter on `chatWithDocuments` and `generate`. Pass through to the Vertex SDK's request options where supported.

## Edge cases

| Case | Behavior |
|------|----------|
| Stop clicked before any SSE event arrives | Controller is already in `abortRef`; abort fires; partial text empty; saved message is just the marker. |
| Stop clicked after `done` event | `chatting` already `false`; button is Send again; no-op. |
| Stop clicked during MCP tool execution | Current tool call runs to completion (typically <5s); the loop's top-of-iteration `signal.aborted` check throws before the next `messages.create`. |
| Network blip vs user stop | Both fire `req.on('close')`; both produce the same `*[Response stopped by user]*` marker. Acceptable; the marker reflects "no full response was received" either way. |
| Race: DB INSERT vs abort | INSERT is synchronous SQLite; completes before any abort handler runs. ✓ |

## Token billing note

The non-streaming `messages.create` call returns a single complete response. When aborted, the SDK closes the underlying HTTP request — Anthropic stops generating further tokens at the point of disconnect. **Partial text is not returned to the SDK caller** for non-streaming requests, so `partialText` will almost always be empty. We still get the billing benefit (truncated generation) but the saved assistant message is just the marker. If we ever switch to streaming, we can capture and save the partial deltas.

## Testing (manual — no test runner in repo)

1. Send a long-prompt message → confirm Send icon swaps to red Square within ~50ms.
2. Click Stop within 1s → confirm:
   - UI returns to idle (red Square reverts to gold Send).
   - Chat history shows assistant message containing `*[Response stopped by user]*`.
   - Server console logs show abort (`AbortError` or `client-disconnected`).
3. Send a normal message that completes before any stop → full response saved, no marker, no regressions.
4. Repeat in project chat (`/projects/:id`) — same behavior.
5. Confirm `/lease-chat` is untouched (no stop button, existing behavior preserved).

## Files touched

- `src/api/index.ts` — add optional `externalSignal` to `streamMessage`
- `src/pages/MainChatPage.tsx` — `abortRef`, `handleStop`, red Square swap
- `src/components/chat/ChatInput.tsx` — same pattern, red Square swap at line 519
- `server/index.js` — per-request `AbortController`, `req.on('close')` wire-up, user-abort branch in catch
- `server/lib/claude-direct.js` — accept `signal`, thread into `messages.create` (both call sites), top-of-loop abort check
- `server/lib/gemini.js` — accept `signal`, thread into Vertex SDK
- `src/components/Sidebar.tsx` (or wherever the version constant lives) — bump v1.13.0 → v1.13.1

## Out of scope

- LeaseChatPage SSE stop (separate `readSSE()` parser, separate code path).
- Streaming Anthropic responses (would let us save partial text on stop). Future improvement.
- Resume / regenerate after stop. Out of scope; user can re-send manually.
