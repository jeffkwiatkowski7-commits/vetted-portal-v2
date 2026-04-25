# PPTX Template Extractor + Canvas Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload PowerPoint templates to extract design tokens, then generate branded HTML pages via Canvas Mode skill with live preview in chat.

**Architecture:** Backend PPTX parser extracts theme XML into a design tokens JSON saved to the library. A new "Canvas Mode" skill instructs the LLM to emit `canvas-html` code fences, which a new CanvasBlock component renders as a live sandboxed iframe preview inline in chat.

**Tech Stack:** jszip + fast-xml-parser (backend parsing), DOMPurify (iframe sanitization), existing React/Tailwind frontend

**Spec:** `docs/superpowers/specs/2026-03-30-pptx-canvas-mode-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/lib/pptx-parser.js` | Create | Unzip .pptx, parse theme XML, return design tokens JSON |
| `src/components/chat/CanvasBlock.tsx` | Create | Sandboxed iframe preview + code toggle + action buttons |
| `src/pages/PptxAppPage.tsx` | Create | Upload UI with drag-drop, progress, success/error states |
| `package.json` | Modify | Add `jszip`, `fast-xml-parser` |
| `server/index.js` | Modify | Add `POST /api/apps/pptx-parse` endpoint |
| `server/seed.js` | Modify | Add PPTX Extractor app + Canvas Mode skill |
| `src/types/index.ts` | Modify | Add `route?` field to `App` interface |
| `src/pages/AppsPage.tsx` | Modify | Route-aware app click handler |
| `src/App.tsx` | Modify | Add `/apps/pptx-parser` route |
| `src/pages/MainChatPage.tsx` | Modify | Detect `canvas-html` code fence → render CanvasBlock |
| `src/components/chat/ChatView.tsx` | Modify | Same `canvas-html` detection |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jszip and fast-xml-parser**

```bash
npm install jszip fast-xml-parser
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('jszip'); require('fast-xml-parser'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add jszip and fast-xml-parser for PPTX parsing"
```

---

### Task 2: PPTX Parser

**Files:**
- Create: `server/lib/pptx-parser.js`

- [ ] **Step 1: Create the parser module**

```js
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

const MAX_MEDIA_SIZE = 500 * 1024; // 500KB
const MAX_MEDIA_COUNT = 10;

/**
 * Extract a hex color string from a PowerPoint color element.
 * Handles <a:srgbClr val="RRGGBB"/> and <a:sysClr lastClr="RRGGBB"/>.
 */
function extractColor(el) {
  if (!el) return null;
  // Direct sRGB
  if (el.srgbClr) {
    let hex = el.srgbClr['@_val'] || (typeof el.srgbClr === 'string' ? el.srgbClr : null);
    if (hex) return applyLumModifiers(hex, el.srgbClr);
    return null;
  }
  // System color with fallback
  if (el.sysClr) {
    let hex = el.sysClr['@_lastClr'] || el.sysClr['@_val'];
    if (hex) return applyLumModifiers(hex, el.sysClr);
    return null;
  }
  return null;
}

/**
 * Apply lumMod/lumOff tint/shade modifiers to a hex color.
 */
function applyLumModifiers(hex, node) {
  if (!node || typeof node !== 'object') return `#${hex}`;
  const lumMod = node.lumMod?.['@_val'] || node.lumMod;
  const lumOff = node.lumOff?.['@_val'] || node.lumOff;
  if (!lumMod && !lumOff) return `#${hex}`;

  // Parse hex to HSL, apply mod/off, convert back
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  if (lumMod) l = l * (parseInt(lumMod, 10) / 100000);
  if (lumOff) l = l + (parseInt(lumOff, 10) / 100000);
  l = Math.max(0, Math.min(1, l));

  // HSL to RGB
  let r2, g2, b2;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/**
 * Extract theme colors from a:clrScheme element.
 */
function extractColors(clrScheme) {
  if (!clrScheme) return {};
  const colorNames = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const outputNames = ['dark1', 'light1', 'dark2', 'light2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hyperlink', 'followedHyperlink'];
  const colors = {};
  colorNames.forEach((name, i) => {
    const color = extractColor(clrScheme[name]);
    if (color) colors[outputNames[i]] = color;
  });
  return colors;
}

/**
 * Extract heading and body fonts from theme font scheme.
 */
function extractFonts(fontScheme) {
  if (!fontScheme) return {};
  const fonts = {};
  const major = fontScheme.majorFont;
  const minor = fontScheme.minorFont;
  if (major?.latin?.['@_typeface']) fonts.heading = major.latin['@_typeface'];
  if (minor?.latin?.['@_typeface']) fonts.body = minor.latin['@_typeface'];
  return fonts;
}

/**
 * Extract background from slide master.
 */
function extractBackground(slideMasterXml) {
  if (!slideMasterXml) return [];
  const bg = slideMasterXml.sldMaster?.cSld?.bg?.bgPr;
  if (!bg) return [];

  // Solid fill
  if (bg.solidFill) {
    const color = extractColor(bg.solidFill);
    if (color) return [{ type: 'solid', color }];
  }

  // Gradient fill
  if (bg.gradFill) {
    const gsLst = bg.gradFill.gsLst?.gs;
    if (gsLst) {
      const stops = (Array.isArray(gsLst) ? gsLst : [gsLst]).map(gs => ({
        color: extractColor(gs) || '#000000',
        position: parseInt(gs['@_pos'] || '0', 10) / 1000,
      }));
      return [{ type: 'gradient', stops }];
    }
  }

  return [];
}

/**
 * Extract layout names and placeholders from slide layout XML files.
 */
function extractLayout(layoutXml) {
  if (!layoutXml?.sldLayout) return null;
  const layout = layoutXml.sldLayout;
  const name = layout.cSld?.['@_name'] || layout['@_type'] || 'Unknown';
  const spTree = layout.cSld?.spTree?.sp;
  const shapes = Array.isArray(spTree) ? spTree : spTree ? [spTree] : [];
  const placeholders = shapes
    .map(sp => sp.nvSpPr?.nvPr?.ph?.['@_type'])
    .filter(Boolean);
  return { name, placeholders };
}

/**
 * Main entry point. Parses a .pptx file buffer and returns design tokens.
 * @param {Buffer} fileBuffer - The raw .pptx file bytes
 * @param {string} [fallbackName] - Filename to use if presentation.xml has no name
 * @returns {Promise<{tokens?: object, error?: string, skippedMedia?: string[]}>}
 */
export async function parsePptxTemplate(fileBuffer, fallbackName = 'Untitled') {
  let zip;
  try {
    zip = await JSZip.loadAsync(fileBuffer);
  } catch {
    return { error: 'File is not a valid PowerPoint file' };
  }

  // --- Theme ---
  const themeFile = zip.file('ppt/theme/theme1.xml');
  if (!themeFile) {
    return { error: 'No theme found in this PowerPoint file' };
  }
  const themeXml = parser.parse(await themeFile.async('text'));
  const themeElements = themeXml.theme?.themeElements;
  const colors = extractColors(themeElements?.clrScheme);
  const fonts = extractFonts(themeElements?.fontScheme);

  // --- Presentation name ---
  let name = fallbackName.replace(/\.pptx$/i, '');
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml = parser.parse(await presFile.async('text'));
    const presName = presXml.presentation?.['@_name'];
    if (presName) name = presName;
  }

  // --- Backgrounds ---
  let backgrounds = [];
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml');
  if (masterFile) {
    const masterXml = parser.parse(await masterFile.async('text'));
    backgrounds = extractBackground(masterXml);
  }

  // --- Layouts ---
  const layouts = [];
  const layoutFiles = zip.file(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
  for (const lf of layoutFiles) {
    const layoutXml = parser.parse(await lf.async('text'));
    const layout = extractLayout(layoutXml);
    if (layout) layouts.push(layout);
  }

  // --- Media ---
  const media = [];
  const skippedMedia = [];
  const mediaFiles = zip.file(/^ppt\/media\//);
  for (const mf of mediaFiles) {
    if (media.length >= MAX_MEDIA_COUNT) {
      skippedMedia.push(`${mf.name} (max ${MAX_MEDIA_COUNT} media limit reached)`);
      continue;
    }
    const ext = '.' + mf.name.split('.').pop().toLowerCase();
    const mimeType = MIME_MAP[ext];
    if (!mimeType) {
      skippedMedia.push(`${mf.name} (unsupported format)`);
      continue;
    }
    const data = await mf.async('uint8array');
    if (data.byteLength > MAX_MEDIA_SIZE) {
      skippedMedia.push(`${mf.name} (${Math.round(data.byteLength / 1024)}KB exceeds 500KB limit)`);
      continue;
    }
    media.push({
      filename: mf.name.split('/').pop(),
      data: Buffer.from(data).toString('base64'),
      type: mimeType,
    });
  }

  const tokens = { name, colors, fonts };
  if (backgrounds.length > 0) tokens.backgrounds = backgrounds;
  if (layouts.length > 0) tokens.layouts = layouts;
  if (media.length > 0) tokens.media = media;

  return { tokens, skippedMedia };
}
```

- [ ] **Step 2: Smoke-test with a quick node script**

```bash
node -e "import('./server/lib/pptx-parser.js').then(m => console.log(typeof m.parsePptxTemplate))"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add server/lib/pptx-parser.js
git commit -m "feat: add PPTX template parser — extracts design tokens from PowerPoint themes"
```

---

### Task 3: API Endpoint

**Files:**
- Modify: `server/index.js` — add endpoint after the existing library file upload block (~line 1180)

- [ ] **Step 1: Add the import at the top of server/index.js**

Find the existing imports near the top of the file and add:

```js
import { parsePptxTemplate } from './lib/pptx-parser.js';
```

- [ ] **Step 2: Add the POST /api/apps/pptx-parse endpoint**

Add this after the existing `POST /api/library/upload` endpoint block (search for `console.log('✓ Created ${apps.length} apps')` or the library upload handler — place it near the other library/file endpoints):

```js
// PPTX Template Extractor — parse .pptx and save design tokens to library
app.post('/api/apps/pptx-parse', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }
    if (!req.file.originalname.toLowerCase().endsWith('.pptx')) {
      return res.status(400).json({ success: false, error: 'File must be a .pptx PowerPoint file' });
    }

    const buffer = fs.readFileSync(req.file.path);
    const result = await parsePptxTemplate(buffer, req.file.originalname);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Write design tokens JSON to disk
    const fileId = uuidv4();
    const jsonContent = JSON.stringify(result.tokens, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, 'utf8');
    const filename = `${fileId}-design-tokens.json`;
    const uploadDir = process.env.UPLOAD_DIR || './data/uploads';
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, jsonContent);

    // Insert library_files row
    const now = new Date().toISOString();
    const originalName = req.file.originalname.replace(/\.pptx$/i, '') + '-design-tokens.json';
    dbRun(db, `
      INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [fileId, req.user.id, filename, originalName, `/uploads/${filename}`, 'json', jsonBuffer.byteLength, 'application/json', now]);

    // Clean up the uploaded .pptx temp file
    try { fs.unlinkSync(req.file.path); } catch {}

    res.json({
      success: true,
      file_id: fileId,
      summary: {
        colorCount: Object.keys(result.tokens.colors || {}).length,
        fonts: result.tokens.fonts || {},
        layoutCount: (result.tokens.layouts || []).length,
        mediaCount: (result.tokens.media || []).length,
      },
      skippedMedia: result.skippedMedia || [],
    });
  } catch (err) {
    console.error('PPTX parse error:', err);
    res.status(500).json({ success: false, error: 'Failed to parse PowerPoint file' });
  }
});
```

- [ ] **Step 3: Restart dev server and test with curl**

```bash
npm run dev:backend
```

Then verify the endpoint exists (should return 401 without auth, confirming the route is registered):

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/apps/pptx-parse
```

Expected: `401`

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat: add POST /api/apps/pptx-parse endpoint — parses PPTX and saves design tokens to library"
```

---

### Task 4: Seed Data — App + Skill

**Files:**
- Modify: `server/seed.js` — add PPTX Extractor app to the `apps` array and add Canvas Mode skill after skills seeding (or create skills seeding if none exists)

- [ ] **Step 1: Add the PPTX Extractor app to the apps array in seed.js**

Find the `apps` array (around line 210-284) and add this entry after the last app object (before the closing `]`):

```js
    {
      id: uuidv4(),
      name: 'PowerPoint Template Extractor',
      description: 'Extract design tokens from PowerPoint templates — colors, fonts, backgrounds, and layouts — saved as JSON to your Library for use with Canvas Mode',
      icon: '📊',
      category: 'data',
      system_prompt: systemPrompts[0].id,
      model: 'gemini-3',
      temperature: 0.5,
      tool_sets: JSON.stringify([]),
      visibility: 'all',
      status: 'active',
      usage_count: 0,
      created_by: users[0].id,
      created_at: now,
      updated_at: now
    }
```

- [ ] **Step 2: Add Canvas Mode skill seeding**

After the apps seeding block (after `console.log('✓ Created ${apps.length} apps');`), add:

```js
  // Seed Canvas Mode skill
  const canvasSkillId = uuidv4();
  dbRun(db, `
    INSERT INTO skills (id, name, description, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    canvasSkillId,
    'Canvas Mode',
    'Renders AI-generated HTML/CSS as live visual previews in chat',
    `You are in Canvas Mode. When the user requests visual content — pages, reports, dashboards, cards, layouts, or any visual output — generate complete, self-contained HTML with embedded CSS.

Rules:
1. Wrap ALL visual HTML output in a \`\`\`canvas-html code fence (not \`\`\`html)
2. Include all styles in a <style> block — no external stylesheets except Google Fonts via @import
3. Make the output responsive and presentable as a standalone page
4. If design tokens are attached (colors, fonts, backgrounds), use them for all styling decisions
5. When the user asks for revisions, output the complete updated HTML — never a partial diff
6. Keep the HTML clean and well-structured — it may be exported and used directly

The \`\`\`canvas-html fence signals the UI to render your output as a live preview instead of a code block. The user can toggle between the preview and the raw code.`,
    now,
    now
  ]);
  console.log('✓ Created Canvas Mode skill');
```

- [ ] **Step 3: Commit**

```bash
git add server/seed.js
git commit -m "feat: seed PPTX Extractor app and Canvas Mode skill"
```

---

### Task 5: App Type + Route-Aware Click Handler

**Files:**
- Modify: `src/types/index.ts` (~line 96-112)
- Modify: `src/pages/AppsPage.tsx` (~line 40-56)

- [ ] **Step 1: Add `route` field to the App interface**

In `src/types/index.ts`, find the `App` interface and add `route?` after `status`:

```ts
export interface App {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  system_prompt: string;
  model: string;
  temperature: number;
  tool_sets?: string;
  visibility: string;
  status: string;
  route?: string;
  usage_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update the app click handler in AppsPage.tsx**

In `src/pages/AppsPage.tsx`, replace the `handleAppClick` function (lines 40-56) with:

```tsx
  const handleAppClick = async (app: App) => {
    // If app has a dedicated route, navigate there instead of creating a chat
    if (app.route) {
      navigate(app.route);
      return;
    }
    try {
      const newChat = await api.chats.create({
        title: `${app.name} - ${new Date().toLocaleDateString()}`,
        model: app.model,
        temperature: app.temperature,
        system_prompt: app.system_prompt,
      });
      setActiveChat(newChat);
      navigate(`/chat/${newChat.id}`);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to start chat',
      });
    }
  };
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/pages/AppsPage.tsx
git commit -m "feat: support route field on App type for dedicated app pages"
```

---

### Task 6: PPTX App Page

**Files:**
- Create: `src/pages/PptxAppPage.tsx`
- Modify: `src/App.tsx` (~line 123, add route)

- [ ] **Step 1: Create PptxAppPage.tsx**

```tsx
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';

type PageState = 'upload' | 'processing' | 'success' | 'error';

interface Summary {
  colorCount: number;
  fonts: { heading?: string; body?: string };
  layoutCount: number;
  mediaCount: number;
}

interface ParseResult {
  file_id: string;
  summary: Summary;
  skippedMedia: string[];
  colors?: Record<string, string>;
}

const STEPS = [
  'Uploading file...',
  'Extracting theme...',
  'Processing media...',
  'Building design tokens...',
];

export default function PptxAppPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  const [state, setState] = useState<PageState>('upload');
  const [fileName, setFileName] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      addToast({ type: 'error', title: 'Please upload a .pptx file' });
      return;
    }

    setFileName(file.name);
    setState('processing');
    setCurrentStep(0);

    // Simulate step progression while the upload/parse happens
    const stepTimer = setInterval(() => {
      setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    }, 800);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/apps/pptx-parse', {
        method: 'POST',
        headers: { 'X-User-Id': user?.id || '' },
        body: formData,
      });

      clearInterval(stepTimer);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setState('error');
        setErrorMsg(data.error || 'Failed to parse PowerPoint file');
        return;
      }

      setCurrentStep(STEPS.length);
      setResult(data);
      setState('success');
    } catch {
      clearInterval(stepTimer);
      setState('error');
      setErrorMsg('Network error — could not reach the server');
    }
  }, [user, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = () => {
    setState('upload');
    setFileName('');
    setCurrentStep(0);
    setResult(null);
    setErrorMsg('');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Back button */}
        <button
          onClick={() => navigate('/apps')}
          className="flex items-center gap-1.5 text-sm text-vetted-text-secondary hover:text-vetted-primary mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Apps
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-serif text-vetted-primary">PowerPoint Template Extractor</h1>
          <p className="text-vetted-text-secondary mt-1">Upload a PowerPoint template to extract its design system</p>
        </div>

        {/* Upload State */}
        {state === 'upload' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragOver
                ? 'border-vetted-accent bg-vetted-accent/5'
                : 'border-vetted-border hover:border-vetted-accent/50'
            }`}
          >
            <Upload size={48} className="mx-auto text-vetted-text-muted mb-4 opacity-50" />
            <p className="text-vetted-text-secondary mb-4">
              Drag and drop a <span className="font-medium text-vetted-primary">.pptx</span> file here
            </p>
            <label className="btn-primary inline-flex items-center gap-2 cursor-pointer">
              Choose File
              <input
                type="file"
                accept=".pptx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Processing State */}
        {state === 'processing' && (
          <div className="card p-8">
            <p className="font-medium text-vetted-primary mb-6">{fileName}</p>
            <div className="space-y-3">
              {STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  {i < currentStep ? (
                    <CheckCircle size={18} className="text-green-500 shrink-0" />
                  ) : i === currentStep ? (
                    <Loader2 size={18} className="text-vetted-accent shrink-0 animate-spin" />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border border-vetted-border shrink-0" />
                  )}
                  <span className={i <= currentStep ? 'text-vetted-primary' : 'text-vetted-text-muted'}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success State */}
        {state === 'success' && result && (
          <div className="space-y-6">
            <div className="card p-6 border-green-200 bg-green-50/30">
              <div className="flex items-center gap-3 mb-1">
                <CheckCircle size={24} className="text-green-500" />
                <p className="font-medium text-vetted-primary">Design tokens saved to your Library</p>
              </div>
            </div>

            {/* Summary Card */}
            <div className="card p-6 space-y-5">
              {/* Colors */}
              {result.summary.colorCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Colors</h3>
                  <div className="flex flex-wrap gap-2">
                    {result.colors && Object.entries(result.colors).map(([name, hex]) => (
                      <div key={name} className="flex items-center gap-1.5" title={`${name}: ${hex}`}>
                        <div
                          className="w-7 h-7 rounded-full border border-vetted-border shadow-sm"
                          style={{ backgroundColor: hex }}
                        />
                      </div>
                    ))}
                    {!result.colors && (
                      <span className="text-sm text-vetted-text-muted">{result.summary.colorCount} colors extracted</span>
                    )}
                  </div>
                </div>
              )}

              {/* Fonts */}
              {(result.summary.fonts.heading || result.summary.fonts.body) && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Fonts</h3>
                  <div className="space-y-1 text-sm">
                    {result.summary.fonts.heading && (
                      <p><span className="text-vetted-text-muted">Heading:</span> <span className="font-medium">{result.summary.fonts.heading}</span></p>
                    )}
                    {result.summary.fonts.body && (
                      <p><span className="text-vetted-text-muted">Body:</span> <span className="font-medium">{result.summary.fonts.body}</span></p>
                    )}
                  </div>
                </div>
              )}

              {/* Layouts */}
              {result.summary.layoutCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Layouts</h3>
                  <p className="text-sm">{result.summary.layoutCount} layouts extracted</p>
                </div>
              )}

              {/* Media */}
              {result.summary.mediaCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Media</h3>
                  <p className="text-sm">{result.summary.mediaCount} images extracted</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={reset} className="btn-secondary">
                Upload Another
              </button>
              <button onClick={() => navigate('/library')} className="btn-primary">
                View in Library
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {state === 'error' && (
          <div className="card p-6 border-red-200 bg-red-50/30">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle size={24} className="text-red-500" />
              <p className="font-medium text-red-700">{errorMsg}</p>
            </div>
            <button onClick={reset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route in App.tsx**

In `src/App.tsx`, add the import at the top with the other page imports:

```tsx
import PptxAppPage from './pages/PptxAppPage';
```

Then add the route inside the `<Routes>` block, after the `/apps` route (line 123):

```tsx
            <Route path="/apps/pptx-parser" element={<PptxAppPage />} />
```

- [ ] **Step 3: Verify the page loads**

Start the dev server (`npm run dev`) and navigate to `http://localhost:5173/apps/pptx-parser`. Should see the upload page with drag-and-drop zone.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PptxAppPage.tsx src/App.tsx
git commit -m "feat: add PPTX Template Extractor app page with upload, progress, and success states"
```

---

### Task 7: CanvasBlock Component

**Files:**
- Create: `src/components/chat/CanvasBlock.tsx`

- [ ] **Step 1: Create the CanvasBlock component**

```tsx
import React, { useState, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Eye, Code, Copy, Download, ExternalLink, Check } from 'lucide-react';

interface CanvasBlockProps {
  html: string;
}

export default function CanvasBlock({ html }: CanvasBlockProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'link'],
    ADD_ATTR: ['target', 'rel'],
  }), [html]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'canvas-output.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNewTab = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden border border-[#2a2a2a]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2a2a2a]">
        {/* Tab Toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              tab === 'preview'
                ? 'bg-[#C4A962]/20 text-[#C4A962]'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Eye size={13} />
            Preview
          </button>
          <button
            onClick={() => setTab('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              tab === 'code'
                ? 'bg-[#C4A962]/20 text-[#C4A962]'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Code size={13} />
            Code
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Copy HTML"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Download HTML"
          >
            <Download size={13} />
          </button>
          <button
            onClick={handleNewTab}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === 'preview' ? (
        <div className="relative">
          <iframe
            ref={iframeRef}
            srcDoc={sanitizedHtml}
            sandbox="allow-same-origin"
            className="w-full bg-white border-0"
            style={{ height: expanded ? '80vh' : '400px' }}
            title="Canvas preview"
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] bg-black/60 text-white/60 hover:text-white/80 transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      ) : (
        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed max-h-[500px]">
          <code className="text-green-300 font-mono">{html}</code>
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/CanvasBlock.tsx
git commit -m "feat: add CanvasBlock component — sandboxed iframe preview with code toggle"
```

---

### Task 8: Wire Canvas-HTML into Chat Renderers

**Files:**
- Modify: `src/pages/MainChatPage.tsx` (~lines 254-275)
- Modify: `src/components/chat/ChatView.tsx` (~lines 81-93)

- [ ] **Step 1: Add CanvasBlock import to MainChatPage.tsx**

At the top of `src/pages/MainChatPage.tsx`, add with the other imports:

```tsx
import CanvasBlock from '../components/chat/CanvasBlock';
```

- [ ] **Step 2: Add canvas-html detection in MainChatPage.tsx code handler**

In `src/pages/MainChatPage.tsx`, find the `code` handler (line 254). Replace the entire `code` handler:

```tsx
                code: ({ className, children }) => {
                  if (className === 'language-canvas-html') {
                    return <CanvasBlock html={String(children)} />;
                  }
                  const isBlock = className?.includes('language-');
                  if (isBlock) {
                    return (
                      <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden">
                        {className && (
                          <div className="px-4 py-1.5 bg-[#2a2a2a] text-[10px] text-white/40 uppercase tracking-wider font-mono">
                            {className.replace('language-', '')}
                          </div>
                        )}
                        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed">
                          <code className="text-green-300 font-mono">{children}</code>
                        </pre>
                      </div>
                    );
                  }
                  return (
                    <code className="px-1.5 py-0.5 bg-vetted-surface rounded text-[13px] font-mono text-vetted-accent">
                      {children}
                    </code>
                  );
                },
```

- [ ] **Step 3: Add CanvasBlock import to ChatView.tsx**

At the top of `src/components/chat/ChatView.tsx`, add:

```tsx
import CanvasBlock from './CanvasBlock';
```

- [ ] **Step 4: Add canvas-html detection in ChatView.tsx code handler**

In `src/components/chat/ChatView.tsx`, find the `code` handler (line 81). Replace it:

```tsx
          code: ({ children, className }) => {
            if (className === 'language-canvas-html') {
              return <CanvasBlock html={String(children)} />;
            }
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code className={`${className ?? ''} text-[13px] font-mono`}>{children}</code>
              );
            }
            return (
              <code className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                {children}
              </code>
            );
          },
```

- [ ] **Step 5: Verify canvas-html renders**

In the browser, send a chat message that would trigger canvas-html output (or temporarily hardcode a test message containing a ` ```canvas-html ` code fence). Confirm the CanvasBlock renders with preview/code tabs and action buttons.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MainChatPage.tsx src/components/chat/ChatView.tsx
git commit -m "feat: wire canvas-html code fence detection into both chat renderers"
```

---

### Task 9: Return Colors in API Response + Connect to PptxAppPage

**Files:**
- Modify: `server/index.js` — update the pptx-parse response to include colors
- Modify: `src/pages/PptxAppPage.tsx` — no changes needed, already handles `result.colors`

The current API response includes `summary.colorCount` but not the actual color values. The PptxAppPage already checks for `result.colors` to render swatches. Update the API to include them.

- [ ] **Step 1: Add colors to the API response**

In `server/index.js`, in the `POST /api/apps/pptx-parse` handler, update the response to include the color values. Find the `res.json({` block and add `colors`:

```js
    res.json({
      success: true,
      file_id: fileId,
      summary: {
        colorCount: Object.keys(result.tokens.colors || {}).length,
        fonts: result.tokens.fonts || {},
        layoutCount: (result.tokens.layouts || []).length,
        mediaCount: (result.tokens.media || []).length,
      },
      colors: result.tokens.colors || {},
      skippedMedia: result.skippedMedia || [],
    });
```

- [ ] **Step 2: Commit**

```bash
git add server/index.js
git commit -m "feat: include extracted colors in PPTX parse API response for swatch display"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Delete the database to re-seed with new app + skill**

```bash
rm -f data/vetted_portal.db
npm run dev:backend
```

Verify seed output includes:
- `✓ Created X apps` (should be one more than before)
- `✓ Created Canvas Mode skill`

- [ ] **Step 2: Test the full PPTX upload flow**

1. Navigate to `http://localhost:5173/apps`
2. Find "PowerPoint Template Extractor" card and click it
3. Should navigate to `/apps/pptx-parser`
4. Upload a `.pptx` file
5. Verify progress steps animate, then success state shows with color swatches, fonts, and counts
6. Click "View in Library" and confirm the design tokens JSON appears

- [ ] **Step 3: Test Canvas Mode skill**

1. Create a new project, attach the Canvas Mode skill
2. Optionally attach the design tokens JSON file
3. Chat: "Create a simple landing page"
4. Verify the response uses ` ```canvas-html ` fences
5. Verify the CanvasBlock renders with preview iframe, code tab, copy/download/new-tab buttons

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```
