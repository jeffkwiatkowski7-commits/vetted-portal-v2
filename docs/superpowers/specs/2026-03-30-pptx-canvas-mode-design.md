# PPTX Template Extractor App + Canvas Mode Skill

**Date:** 2026-03-30
**Status:** Draft

## Overview

Two features that work together to let users generate branded HTML pages from PowerPoint templates:

1. **PPTX Template Extractor** — an App that uploads a `.pptx` file, extracts design tokens (colors, fonts, backgrounds, layouts, media), and saves the result as a JSON file in the Library
2. **Canvas Mode** — a Skill that instructs the LLM to output self-contained HTML/CSS inside `canvas-html` code fences, and a chat UI component that renders the HTML live in a sandboxed iframe

## User Flow

1. User opens the PPTX Template Extractor app from `/apps`
2. User uploads a `.pptx` template file
3. App shows progress: "Uploading..." → "Extracting theme..." → "Processing media..." → "Building design tokens..."
4. On success: green confirmation — "Design tokens saved to your Library"
5. Summary card shows extracted color swatches, font names, and layout count
6. User creates/opens a project, attaches the design tokens JSON to the Canvas Mode skill
7. User chats: "Create a quarterly report page" — LLM receives design tokens via skill injection and outputs `canvas-html`
8. Chat UI renders the HTML live inline with Preview/Code toggle and action buttons (Copy, Download, New Tab)
9. User iterates conversationally until satisfied

---

## Part 1: PPTX Parser

### File: `server/lib/pptx-parser.js`

**Dependencies:** `jszip`, `fast-xml-parser`

**Exported function:** `parsePptxTemplate(fileBuffer)` → returns design tokens object

### Design Tokens JSON Schema

```json
{
  "name": "string — extracted from presentation.xml or fallback to filename",
  "colors": {
    "dark1": "#hex",
    "light1": "#hex",
    "dark2": "#hex",
    "light2": "#hex",
    "accent1": "#hex",
    "accent2": "#hex",
    "accent3": "#hex",
    "accent4": "#hex",
    "accent5": "#hex",
    "accent6": "#hex",
    "hyperlink": "#hex",
    "followedHyperlink": "#hex"
  },
  "fonts": {
    "heading": "Font Family Name",
    "body": "Font Family Name"
  },
  "backgrounds": [
    {
      "type": "solid | gradient | image",
      "color": "#hex (for solid)",
      "stops": [{"color": "#hex", "position": 0}],
      "filename": "string (for image)",
      "data": "base64 string (for image)"
    }
  ],
  "media": [
    {
      "filename": "logo.png",
      "data": "base64 encoded",
      "type": "image/png"
    }
  ],
  "layouts": [
    {
      "name": "Title Slide",
      "placeholders": ["title", "subtitle"]
    }
  ]
}
```

### Extraction Logic

1. **Unzip** the `.pptx` buffer using `jszip`
2. **Parse `ppt/theme/theme1.xml`** — extract the `<a:clrScheme>` element for the 12 named colors; extract `<a:majorFont>` and `<a:minorFont>` for heading/body fonts
3. **Parse `ppt/slideMasters/slideMaster1.xml`** — extract background fill (solid color, gradient stops, or image reference)
4. **Parse `ppt/slideLayouts/*.xml`** — extract layout names and placeholder types from each layout file
5. **Read `ppt/media/*`** — collect images (PNG, JPG, SVG) as base64-encoded strings with MIME types. **Limits:** skip any single file > 500KB, cap at 10 media items total to keep the JSON manageable
6. **Parse `ppt/presentation.xml`** — extract presentation name if available, otherwise use the uploaded filename

### Color Conversion

PowerPoint theme colors use several formats that need conversion to hex:
- `<a:srgbClr val="1A1A1A"/>` → `#1A1A1A` (direct hex)
- `<a:sysClr val="windowText" lastClr="000000"/>` → `#000000` (system color with fallback)
- Colors may have child elements like `<a:lumMod>` and `<a:lumOff>` for tint/shade — apply these as percentage adjustments

### Error Handling

- Invalid ZIP / not a `.pptx` → return error: "File is not a valid PowerPoint file"
- Missing `theme1.xml` → return error: "No theme found in this PowerPoint file"
- Missing optional elements (media, backgrounds, layouts) → omit from output, don't fail
- Unsupported media formats (EMF, WMF) → skip with a note in the response
- Media file > 500KB → skip (likely a stock photo, not a logo/icon)
- More than 10 media files → keep only the first 10, note the rest were skipped

---

## Part 2: PPTX Template Extractor App

### Route: `/apps/pptx-parser`

### Page: `src/pages/PptxAppPage.tsx`

### UI States

**1. Upload state (default)**
- Page header: "PowerPoint Template Extractor" with subtitle "Upload a PowerPoint template to extract its design system"
- Drag-and-drop zone with dashed border, accepts `.pptx` files only
- "Choose File" button as alternative to drag-and-drop
- File type validation on select — reject non-`.pptx` with toast error

**2. Processing state**
- File name displayed at top
- Progress steps shown sequentially, each with a spinner → checkmark transition:
  - "Uploading file..."
  - "Extracting theme..."
  - "Processing media..."
  - "Building design tokens..."
- Steps appear immediately on upload (not waiting for SSE), matching existing app patterns

**3. Success state**
- Green checkmark icon
- "Design tokens saved to your Library" confirmation message
- Summary card showing:
  - **Colors:** row of circular swatches for each extracted color
  - **Fonts:** heading and body font names displayed in their respective fonts
  - **Layouts:** count of extracted layouts (e.g., "6 layouts extracted")
  - **Media:** count of extracted media files (e.g., "3 images extracted")
- "Upload Another" button to reset to upload state
- "View in Library" link

**4. Error state**
- Red alert with error message from parser
- "Try Again" button to reset

### App Registration

Add to `server/seed.js` seeded apps:
- **Name:** "PowerPoint Template Extractor"
- **Category:** "data"
- **Description:** "Extract design tokens from PowerPoint templates — colors, fonts, backgrounds, and layouts — saved as JSON to your Library for use with Canvas Mode"
- **Icon:** "presentation"
- **Status:** "active"

Modify `AppsPage.tsx` app click handler: if the app has a `route` field, navigate to that route instead of creating a chat session. The PPTX app would have `route: "/apps/pptx-parser"`.

### API Endpoint: `POST /api/apps/pptx-parse`

- **Auth:** `requireAuth` middleware
- **Input:** multipart form upload (reuse existing Multer config), single `.pptx` file
- **Process:**
  1. Read uploaded file buffer
  2. Call `parsePptxTemplate(buffer)`
  3. Write the design tokens JSON to disk at `{UPLOAD_DIR}/{uuid}-design-tokens.json`
  4. Insert a `library_files` row matching the existing schema:
     - `id`: generated UUID
     - `user_id`: current user ID
     - `filename`: `{uuid}-design-tokens.json`
     - `original_name`: `{original-pptx-name}-design-tokens.json`
     - `file_path`: full path to the written JSON file
     - `file_type`: `json`
     - `file_size`: byte length of the written JSON
     - `mime_type`: `application/json`
     - `uploaded_at`: current ISO timestamp
  5. Return `{ success: true, file_id, summary: { colorCount, fonts, layoutCount, mediaCount } }`
- **Error:** Return `{ success: false, error: "message" }` with 400 status

---

## Part 3: Canvas Mode Skill

### Skill Definition

Pre-seeded in `server/seed.js`:

- **Name:** "Canvas Mode"
- **Description:** "Renders AI-generated HTML/CSS as live visual previews in chat"
- **Instructions:**

```
You are in Canvas Mode. When the user requests visual content — pages, reports, dashboards, cards, layouts, or any visual output — generate complete, self-contained HTML with embedded CSS.

Rules:
1. Wrap ALL visual HTML output in a ```canvas-html code fence (not ```html)
2. Include all styles in a <style> block — no external stylesheets except Google Fonts via @import
3. Make the output responsive and presentable as a standalone page
4. If design tokens are attached (colors, fonts, backgrounds), use them for all styling decisions
5. When the user asks for revisions, output the complete updated HTML — never a partial diff
6. Keep the HTML clean and well-structured — it may be exported and used directly

The ```canvas-html fence signals the UI to render your output as a live preview instead of a code block. The user can toggle between the preview and the raw code.
```

### Chat UI: `CanvasBlock` Component

**File:** `src/components/chat/CanvasBlock.tsx`

**Trigger:** In the existing markdown renderer's `code` handler (MainChatPage.tsx), detect `className === 'language-canvas-html'`. When matched, render `<CanvasBlock>` instead of the standard code block.

**Component structure:**

```
┌─────────────────────────────────────────────────┐
│ [Preview] [Code]              [Copy] [DL] [Tab] │ ← header bar
├─────────────────────────────────────────────────┤
│                                                 │
│          Rendered HTML (iframe)                  │ ← preview (default)
│          or syntax-highlighted code              │ ← code view
│                                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Preview tab (default):**
- Sandboxed iframe using `srcdoc` attribute
- `sandbox="allow-same-origin"` — no scripts, no forms, no popups
- HTML sanitized with DOMPurify before rendering
- Height: 400px default, with a drag handle or expand button to resize
- White background inside iframe (page content renders on white)

**Code tab:**
- Existing syntax-highlighted code block rendering (highlight.js)
- Same styling as current code blocks

**Action buttons:**
- **Copy** — copies raw HTML to clipboard, shows "Copied!" feedback
- **Download** — triggers browser download as `canvas-output.html`
- **New Tab** — opens the HTML in a new browser tab via `URL.createObjectURL(new Blob([html]))`

**Styling:**
- Matches existing code block styling: `rounded-xl`, `bg-[#1a1a1a]`, border `#2a2a2a`
- Tab toggle uses accent gold (`#C4A962`) for active state
- Action buttons: subtle border, hover highlights with accent color
- Consistent with the mockup at `http://localhost:8766/canvas-mockup.html`

### Integration with Existing Code

The only file that changes in the existing chat rendering is the `code` handler in `MainChatPage.tsx` (and `ChatView.tsx` if used):

```tsx
code: ({ className, children }) => {
  if (className === 'language-canvas-html') {
    return <CanvasBlock html={String(children)} />;
  }
  // ... existing code block rendering unchanged
}
```

No changes to the backend chat/streaming logic. No changes to system prompt construction — the Canvas Mode skill injects its instructions through the existing skill injection system.

---

## Dependencies

**New npm packages:**
- `jszip` — unzip `.pptx` files (backend)
- `fast-xml-parser` — parse theme/layout XML (backend)

**Existing packages used:**
- `multer` — file upload handling
- `dompurify` — HTML sanitization for iframe content
- `highlight.js` — syntax highlighting for code view
- `react-markdown` — markdown rendering (code block handler)

---

## Files to Create

| File | Purpose |
|------|---------|
| `server/lib/pptx-parser.js` | PPTX unzip + XML parsing → design tokens JSON |
| `src/pages/PptxAppPage.tsx` | PPTX Template Extractor app page |
| `src/components/chat/CanvasBlock.tsx` | Inline HTML preview component for chat |

## Files to Modify

| File | Change |
|------|--------|
| `server/index.js` | Add `POST /api/apps/pptx-parse` endpoint |
| `server/seed.js` | Add PPTX Extractor app + Canvas Mode skill to seed data |
| `src/App.tsx` | Add route `/apps/pptx-parser` → `PptxAppPage` |
| `src/pages/AppsPage.tsx` | Handle `route` field on app cards (navigate to route instead of creating chat) |
| `src/pages/MainChatPage.tsx` | Add `canvas-html` detection in code block handler → render `CanvasBlock` |
| `src/components/chat/ChatView.tsx` | Same `canvas-html` detection if this renderer is used |
| `package.json` | Add `jszip`, `fast-xml-parser` dependencies |
