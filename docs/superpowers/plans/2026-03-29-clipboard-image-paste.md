# Clipboard Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to paste images from clipboard into chat, preview them, send them inline with messages, and have the AI model (Claude or Gemini) analyze them via vision.

**Architecture:** Base64-only approach — images are read from clipboard, stored as base64 in the messages table, and passed directly to model vision APIs. No file uploads, no new endpoints, no library records.

**Tech Stack:** React (paste API, FileReader), Express (JSON body), SQLite (TEXT column), Anthropic SDK (image blocks), Google GenAI SDK (inlineData parts)

---

### Task 1: Add `images` column to messages table

**Files:**
- Modify: `server/database.js:69-80` (messages CREATE TABLE)
- Modify: `server/database.js:324-333` (ALTER TABLE migration section)

- [ ] **Step 1: Add column to CREATE TABLE schema**

In `server/database.js`, add `images TEXT` to the messages table definition (after the `attachments` column, before `created_at`):

```sql
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_used TEXT,
      token_count INTEGER,
      reasoning TEXT,
      attachments TEXT,
      images TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
```

- [ ] **Step 2: Add ALTER TABLE migration for existing databases**

After the existing `ALTER TABLE` block at line ~333 (after the `mcp_servers` migrations), add:

```js
  // Add images column to messages for clipboard image paste
  try { db.run(`ALTER TABLE messages ADD COLUMN images TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
```

- [ ] **Step 3: Verify by starting the server**

Run: `npm run dev:backend`
Expected: Server starts without errors. The database has the new column.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat: add images column to messages table for clipboard paste"
```

---

### Task 2: Accept and store images in POST /api/chats/:id/messages

**Files:**
- Modify: `server/index.js:444-482` (POST endpoint — destructure images, save to user message)
- Modify: `server/index.js:857-875` (save AI message — keep images null for assistant)

- [ ] **Step 1: Destructure `images` from request body**

At `server/index.js:445`, change:

```js
  const { content, attachments } = req.body;
```

to:

```js
  const { content, attachments, images } = req.body;
```

- [ ] **Step 2: Store images JSON on the user message INSERT**

At `server/index.js:469-482`, change the INSERT to include the `images` column. Replace:

```js
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userMessageId,
    req.params.id,
    'user',
    content,
    chat.model,
    Math.ceil(content.split(/\s+/).length * 1.3),
    null,
    attachments ? JSON.stringify(attachments) : null,
    now
  ]);
```

with:

```js
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userMessageId,
    req.params.id,
    'user',
    content,
    chat.model,
    Math.ceil(content.split(/\s+/).length * 1.3),
    null,
    attachments ? JSON.stringify(attachments) : null,
    images && images.length > 0 ? JSON.stringify(images) : null,
    now
  ]);
```

- [ ] **Step 3: Update the AI message INSERT to include the images column**

At `server/index.js:862-875`, change the AI message INSERT to include `images` (always null for assistant messages). Replace:

```js
    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      aiMessageId,
      req.params.id,
      'assistant',
      aiContent,
      chat.model,
      Math.ceil(aiContent.split(/\s+/).length * 1.3),
      aiReasoning ? JSON.stringify(aiReasoning) : null,
      null,
      now
    ]);
```

with:

```js
    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      aiMessageId,
      req.params.id,
      'assistant',
      aiContent,
      chat.model,
      Math.ceil(aiContent.split(/\s+/).length * 1.3),
      aiReasoning ? JSON.stringify(aiReasoning) : null,
      null,
      null,
      now
    ]);
```

- [ ] **Step 4: Parse images in GET /api/chats/:id response**

At `server/index.js:386-390`, update the message mapping to also parse `images`. Replace:

```js
  const messagesWithParsedReasoning = messages.map(m => ({
    ...m,
    reasoning: m.reasoning ? JSON.parse(m.reasoning) : null,
    attachments: m.attachments ? JSON.parse(m.attachments) : null
  }));
```

with:

```js
  const messagesWithParsedReasoning = messages.map(m => ({
    ...m,
    reasoning: m.reasoning ? JSON.parse(m.reasoning) : null,
    attachments: m.attachments ? JSON.parse(m.attachments) : null,
    images: m.images ? JSON.parse(m.images) : null,
  }));
```

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: accept and store images in chat message endpoints"
```

---

### Task 3: Pass images to Claude vision API

**Files:**
- Modify: `server/index.js:767-784` (where Claude is called — pass images through)
- Modify: `server/lib/claude-direct.js:26-73` (chatWithDocuments — add image blocks to user content)

- [ ] **Step 1: Pass images to Claude's chatWithDocuments call**

At `server/index.js:784`, change:

```js
      result = await claudeDirectChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, { claudeTools, mcpToolMap, mcpManager });
```

to:

```js
      result = await claudeDirectChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, { claudeTools, mcpToolMap, mcpManager, images });
```

- [ ] **Step 2: Add image blocks in claude-direct.js chatWithDocuments**

In `server/lib/claude-direct.js`, update the function signature at line 26 to destructure `images`:

```js
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null, modelOverride = null, { claudeTools = [], mcpToolMap = {}, mcpManager = null, images = [] } = {}) {
```

Then, after the PDF document blocks are added to `firstContent` (after the `for (const pdf of pdfDocs)` loop at line ~59), add image blocks for pasted images:

```js
  // Add pasted clipboard images as image blocks
  if (images && images.length > 0) {
    for (const img of images) {
      firstContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType,
          data: img.base64,
        },
      });
    }
  }
```

Insert this block after line 59 (after the PDF loop closing brace) and before `messages.push({ role: "user", content: firstContent });` on line 61.

- [ ] **Step 3: Verify by starting the server**

Run: `npm run dev:backend`
Expected: No import or syntax errors.

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/lib/claude-direct.js
git commit -m "feat: pass pasted images to Claude vision API"
```

---

### Task 4: Pass images to Gemini vision API

**Files:**
- Modify: `server/index.js:785-788` (where Gemini is called — pass images through)
- Modify: `server/lib/gemini.js:465-488` (chatWithDocuments — add inlineData parts)

- [ ] **Step 1: Pass images to Gemini's chatWithDocuments call**

At `server/index.js:787`, change:

```js
      result = await geminiChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, geminiTools);
```

to:

```js
      result = await geminiChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, geminiTools, images);
```

- [ ] **Step 2: Update gemini.js chatWithDocuments to accept and use images**

In `server/lib/gemini.js`, update the function signature at line 465:

```js
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null, modelOverride = null, tools = [], images = []) {
```

Then, after the PDF inlineData parts are added to `firstUserParts` (after the `for (const pdf of pdfDocs)` loop at line ~484), add pasted image parts:

```js
  // Add pasted clipboard images as inline data
  if (images && images.length > 0) {
    for (const img of images) {
      firstUserParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }
```

Insert this block after line 484 (after the PDF loop closing brace) and before the `const contents = [` on line 486.

- [ ] **Step 3: Verify by starting the server**

Run: `npm run dev:backend`
Expected: No import or syntax errors.

- [ ] **Step 4: Commit**

```bash
git add server/index.js server/lib/gemini.js
git commit -m "feat: pass pasted images to Gemini vision API"
```

---

### Task 5: Add paste handler and preview strip to ChatInput

**Files:**
- Modify: `src/components/chat/ChatInput.tsx` (paste handler, image state, preview UI, send integration)

- [ ] **Step 1: Add image state and paste handler**

In `ChatInput.tsx`, add state for pasted images after the existing state declarations (after line 66):

```tsx
const [pastedImages, setPastedImages] = useState<Array<{ base64: string; mimeType: string }>>([]);
```

Add a paste handler function before the `handleSendMessage` function (before line 154):

```tsx
const handlePaste = (e: React.ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.type.startsWith('image/')) continue;

    e.preventDefault();
    const blob = item.getAsFile();
    if (!blob) continue;

    // Reject images > 5MB
    if (blob.size > 5 * 1024 * 1024) {
      addToast({ type: 'error', title: 'Image too large', detail: 'Maximum image size is 5MB' });
      continue;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
      setPastedImages((prev) => [...prev, { base64, mimeType }]);
    };
    reader.readAsDataURL(blob);
  }
};
```

- [ ] **Step 2: Wire onPaste to textarea and update send button disabled state**

On the `<textarea>` element (line 303), add the `onPaste` handler:

```tsx
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              spellCheck={true}
```

Update the send button disabled condition (line 453) to also enable when images are pasted. Change:

```tsx
                  disabled={loading || (!message.trim() && !demoActive)}
```

to:

```tsx
                  disabled={loading || (!message.trim() && pastedImages.length === 0 && !demoActive)}
```

Also update the send button styling condition (line 457). Change:

```tsx
                        : message.trim() && !loading
```

to:

```tsx
                        : (message.trim() || pastedImages.length > 0) && !loading
```

- [ ] **Step 3: Add image preview strip above the textarea**

Inside the main input container div (after line 301, the opening `<div className="relative border...">` and before the `<textarea>`), add the preview strip:

```tsx
            {/* Pasted image previews */}
            {pastedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-2.5">
                {pastedImages.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={`Pasted image ${idx + 1}`}
                      className="w-12 h-12 object-cover rounded-lg border border-vetted-border"
                    />
                    <button
                      onClick={() => setPastedImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-vetted-primary text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
```

- [ ] **Step 4: Integrate images into handleSendMessage**

In `handleSendMessage`, update the early return to allow image-only sends. Change (line 165):

```tsx
    if (!content.trim()) return;
```

to:

```tsx
    // Allow sending images with no text
    if (!content.trim() && pastedImages.length === 0) return;
    if (!content.trim() && pastedImages.length > 0) {
      content = "What's in this image?";
    }
```

In the `streamMessage` call (line 201-205), include images in the payload. Change:

```tsx
      const sendResult = await api.chats.streamMessage(
        chatId!,
        { content, model: modelValue, modelId: selectedModel?.modelId, temperature, attachments: files.map((f) => f.id) },
        hidden ? () => {} : (step) => addLiveStep(step),
      );
```

to:

```tsx
      const sendResult = await api.chats.streamMessage(
        chatId!,
        { content, model: modelValue, modelId: selectedModel?.modelId, temperature, attachments: files.map((f) => f.id), images: pastedImages.length > 0 ? pastedImages : undefined },
        hidden ? () => {} : (step) => addLiveStep(step),
      );
```

After the `if (!hidden) setMessage('');` line (line 187), add image clearing:

```tsx
      if (!hidden) setMessage('');
      if (!hidden) setPastedImages([]);
```

Also include images in the optimistic user message for immediate rendering. Update the optimistic message (line 194):

```tsx
            { id: `optimistic-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString(), images: pastedImages.length > 0 ? pastedImages : null },
```

- [ ] **Step 5: Clear images alongside chatAttachedFiles**

In the `setChatAttachedFiles` calls and file clearing, ensure `pastedImages` is also cleared. This is already handled by the `setPastedImages([])` added in Step 4.

- [ ] **Step 6: Verify the frontend compiles**

Run: `npm run dev:frontend`
Expected: No TypeScript errors. The paste handler, preview strip, and send integration are in place.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat: add clipboard image paste with preview strip in ChatInput"
```

---

### Task 6: Render images in ChatView user messages

**Files:**
- Modify: `src/components/chat/ChatView.tsx:357-370` (user message bubble)

- [ ] **Step 1: Add image rendering in user message bubble**

In `ChatView.tsx`, update the user message rendering block (lines 361-369). Replace:

```tsx
              <div className="flex flex-col items-end gap-1">
                <div className="max-w-[75%] bg-vetted-surface text-vetted-primary rounded-2xl px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
                {msg.created_at && (
                  <span className="text-[10px] text-vetted-text-muted pr-1">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
```

with:

```tsx
              <div className="flex flex-col items-end gap-1">
                <div className="max-w-[75%] bg-vetted-surface text-vetted-primary rounded-2xl px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((img: { base64: string; mimeType: string }, imgIdx: number) => (
                        <img
                          key={imgIdx}
                          src={`data:${img.mimeType};base64,${img.base64}`}
                          alt={`Attached image ${imgIdx + 1}`}
                          className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(`data:${img.mimeType};base64,${img.base64}`, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                  {msg.content}
                </div>
                {msg.created_at && (
                  <span className="text-[10px] text-vetted-text-muted pr-1">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `npm run dev:frontend`
Expected: No TypeScript errors. Images render in user message bubbles.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatView.tsx
git commit -m "feat: render pasted images in ChatView user message bubbles"
```

---

### Task 7: Manual end-to-end test

**Files:** None (testing only)

- [ ] **Step 1: Start the full dev server**

Run: `npm run dev`

- [ ] **Step 2: Test the paste-preview-remove flow**

1. Log in as `admin@vetted.com`
2. Open a new chat
3. Copy an image to clipboard (screenshot or right-click copy on any image)
4. Click into the chat textarea and press Ctrl+V / Cmd+V
5. Verify: a 48x48 thumbnail appears above the textarea
6. Hover over the thumbnail — verify the X button appears
7. Click X — verify the thumbnail is removed
8. Paste the image again — verify the thumbnail reappears

- [ ] **Step 3: Test sending image with text**

1. Paste an image into the textarea
2. Type "Describe this image" in the textarea
3. Press Enter
4. Verify: the user message bubble shows the image above the text
5. Verify: the AI responds with a vision-aware description (requires a working model connection)

- [ ] **Step 4: Test sending image with no text**

1. Paste an image into the textarea (leave text empty)
2. Press Enter (or click Send)
3. Verify: the message is sent with auto-injected prompt "What's in this image?"
4. Verify: the user message bubble shows the image and the auto-injected text

- [ ] **Step 5: Test image persistence on reload**

1. After sending a message with an image, reload the page
2. Navigate back to the same chat
3. Verify: the user message still shows the pasted image (loaded from DB)

- [ ] **Step 6: Test 5MB limit**

1. Find or create an image larger than 5MB
2. Paste it into the textarea
3. Verify: a red error toast appears saying "Image too large — Maximum image size is 5MB"
4. Verify: no thumbnail is added

- [ ] **Step 7: Test project chat**

1. Navigate to a project page
2. Paste an image in the project chat input
3. Send with text
4. Verify: same behavior as regular chat (shared ChatInput component)
