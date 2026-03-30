# Clipboard Image Paste in Chat

**Date:** 2026-03-29
**Scope:** Regular chat + project chat

## Overview

Add the ability to paste images from the clipboard directly into the chat input. Pasted images are sent inline with the message as base64 data and forwarded to the AI model (Claude or Gemini) for vision analysis.

## Approach

Base64-only — no file saved to disk, no library records, no new endpoints. The image lives in the message payload and is passed directly to the model's vision API.

## Frontend Changes

### ChatInput.tsx

**Paste handler:**
- Add `onPaste` handler to the `<textarea>` element
- Check `clipboardData.items` for entries with `type.startsWith('image/')`
- Read each image blob via `FileReader.readAsDataURL()`
- Extract the base64 data and mimeType from the data URL
- Reject images > 5MB with a toast (`addToast`)
- Store in local state: `pastedImages: Array<{ base64: string, mimeType: string }>`

**Preview strip:**
- Render above the textarea (in the same area as the existing demo file chip)
- Show a small thumbnail (48x48, object-cover, rounded) for each pasted image
- Each thumbnail has an X button to remove it from the array
- Clear `pastedImages` after send

**Send integration:**
- In `handleSendMessage`, include `images: pastedImages` in the payload passed to `api.chats.streamMessage()`
- Allow sending images with no text — auto-inject the prompt: "What's in this image?"
- Clear `pastedImages` state after successful send
- Include image thumbnails in the optimistic user message for immediate display

**Applies to both regular chat and project chat** since `ChatInput` is shared via the `projectId` prop — no separate implementation needed.

### ChatView.tsx

**Render images in user messages:**
- When a message has an `images` field (parsed from the stored JSON), render `<img>` tags
- Display above the text content in the user message bubble
- Use `max-w-xs rounded-lg` styling, clickable to view full-size (optional: lightbox or open in new tab)
- Images are base64 data URLs: `data:{mimeType};base64,{data}`

## Backend Changes

### server/index.js — POST /api/chats/:id/messages

**Accept images:**
- Destructure `images` from `req.body` alongside `content` and `attachments`
- `images` is an array of `{ base64: string, mimeType: string }`

**Store images:**
- Save on the user message row — store as JSON in a new `images` TEXT column on the `messages` table
- Add the column in `database.js` schema initialization

**Pass to AI models:**
- **Claude (claude-direct.js):** Add image blocks to the user message content array:
  ```js
  { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } }
  ```
- **Gemini (gemini.js):** Add inline data parts to the user turn:
  ```js
  { inlineData: { mimeType, data: base64 } }
  ```

**Return images in message responses:**
- When fetching chat messages (GET /api/chats/:id), parse and include the `images` field so ChatView can render them

### server/database.js

- Add `images TEXT` column to the `messages` table schema

## Data Flow

```
User pastes image
  → onPaste extracts blob → FileReader → base64 + mimeType
  → stored in local pastedImages state
  → thumbnail preview shown above textarea

User hits Enter
  → streamMessage({ content, model, images: [...], attachments: [...] })
  → Backend saves user message with images JSON
  → Backend builds model-specific image blocks
  → Claude: { type: "image", source: { type: "base64", ... } }
  → Gemini: { inlineData: { mimeType, data } }
  → Model responds with vision-aware answer
  → Response saved and streamed back

Chat loaded later
  → GET /api/chats/:id returns messages with images field
  → ChatView renders <img> tags in user bubbles
```

## Constraints

- **5MB per image** client-side limit (toast on rejection)
- **Supported formats:** image/png, image/jpeg, image/gif, image/webp (what clipboard typically provides)
- No drag-and-drop (clipboard paste only for this iteration)
- No image editing/cropping — paste as-is
- Base64 stored in SQLite — acceptable for a demo app; would need object storage at scale

## Files Modified

1. `src/components/chat/ChatInput.tsx` — paste handler, preview strip, send integration
2. `src/components/chat/ChatView.tsx` — render images in user message bubbles
3. `server/index.js` — accept images in POST endpoint, pass to model, return in GET
4. `server/lib/claude-direct.js` — add image blocks to Claude API call
5. `server/lib/gemini.js` — add inlineData parts to Gemini API call
6. `server/database.js` — add images column to messages table
