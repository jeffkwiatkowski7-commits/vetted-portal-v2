# Project Files with RAG Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GCS file storage and Firestore-based RAG search so project files are semantically searchable from project chat, with source citations in responses.

**Architecture:** Files upload to GCS for blob storage. Text is extracted, chunked (~2000 chars), and embedded via Vertex AI `text-embedding-005`. Chunks + vectors stored in Firestore with native vector search scoped by project. Chat queries embed the question, retrieve top-10 chunks, inject as context, and cite sources in the response.

**Tech Stack:** Google Cloud Storage, Firestore (vector search), Vertex AI Embeddings, `@google-cloud/storage`, `@google/genai` (existing), Express/SSE, React/TypeScript

**Spec:** `docs/superpowers/specs/2026-03-23-project-files-rag-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/lib/gcs.js` | GCS upload/delete/signed-URL helpers |
| `server/lib/embeddings.js` | Text chunking + Vertex AI embedding calls |
| `server/lib/rag.js` | Orchestrates ingestion pipeline and retrieval queries |

### Modified Files
| File | Changes |
|------|---------|
| `server/lib/config.js` | Add `gcsBucket`, `firestoreChunksCollection`, `embeddingModel` config |
| `server/database.js` | Add `index_status` column to `library_files` |
| `server/index.js` | New upload endpoint, modify chat/library endpoints for RAG |
| `src/types/index.ts` | Add `index_status` to `LibraryFile`, add `SourceCitation` type |
| `src/api/index.ts` | Add project file upload API with SSE, add re-index API |
| `src/pages/ProjectDetailPage.tsx` | Files section with upload, status indicators, re-index |
| `src/components/chat/ChatMessage.tsx` or equivalent | Source citations rendering |
| `package.json` | Add `@google-cloud/storage` dependency |
| `.env` | Add `GCS_BUCKET` |

---

## Task 1: Install Dependencies and Config

**Files:**
- Modify: `package.json`
- Modify: `.env`
- Modify: `server/lib/config.js`

- [ ] **Step 1: Install @google-cloud/storage**

```bash
npm install @google-cloud/storage
```

- [ ] **Step 2: Add GCS_BUCKET to .env**

Add to `.env`:
```
GCS_BUCKET=vetted-portal-files
```

- [ ] **Step 3: Update config.js with new settings**

Add to `server/lib/config.js` in the config object:

```javascript
gcsBucket: process.env.GCS_BUCKET || "vetted-portal-files",
firestoreChunksCollection: process.env.FIRESTORE_CHUNKS_COLLECTION || "project_file_chunks",
embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-005",
```

- [ ] **Step 4: Verify config loads**

```bash
node -e "import('./server/lib/config.js').then(m => console.log(m.config))"
```

Expected: Config object includes `gcsBucket`, `firestoreChunksCollection`, `embeddingModel`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env server/lib/config.js
git commit -m "feat: add GCS storage dependency and RAG config"
```

---

## Task 2: Add index_status to library_files

**Files:**
- Modify: `server/database.js:108-121`
- Modify: `src/types/index.ts:73-84`

- [ ] **Step 1: Add index_status column to library_files schema**

In `server/database.js`, update the `CREATE TABLE library_files` statement. Add `index_status TEXT DEFAULT NULL` after the `uploaded_at` column (before the FOREIGN KEY lines). Also add an ALTER TABLE fallback after the CREATE TABLE for existing databases:

```javascript
db.run(`ALTER TABLE library_files ADD COLUMN index_status TEXT DEFAULT NULL`);
```

Wrap the ALTER in a try/catch (it will fail if column already exists, which is fine).

- [ ] **Step 2: Update LibraryFile TypeScript type**

In `src/types/index.ts`, add to the `LibraryFile` interface:

```typescript
index_status?: 'pending' | 'indexing' | 'ready' | 'error' | null;
```

- [ ] **Step 3: Verify by starting dev server**

```bash
npm run dev:backend
```

Expected: Server starts without errors. Check that `index_status` column exists by looking at startup logs.

- [ ] **Step 4: Commit**

```bash
git add server/database.js src/types/index.ts
git commit -m "feat: add index_status column to library_files"
```

---

## Task 3: GCS Storage Module

**Files:**
- Create: `server/lib/gcs.js`

- [ ] **Step 1: Create server/lib/gcs.js**

```javascript
import { Storage } from "@google-cloud/storage";
import { config } from "./config.js";

let _storage = null;

function getStorage() {
  if (!_storage) {
    _storage = new Storage({ projectId: config.gcpProject });
  }
  return _storage;
}

function getBucket() {
  return getStorage().bucket(config.gcsBucket);
}

/**
 * Upload a file buffer to GCS.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} filename - original filename
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<string>} GCS path
 */
export async function uploadFile(projectId, fileId, filename, buffer, mimeType) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const file = getBucket().file(gcsPath);
  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
  });
  return gcsPath;
}

/**
 * Delete a single file from GCS.
 */
export async function deleteFile(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  try {
    await getBucket().file(gcsPath).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

/**
 * Delete all files for a project from GCS.
 */
export async function deleteProjectFiles(projectId) {
  await getBucket().deleteFiles({ prefix: `projects/${projectId}/` });
}

/**
 * Generate a signed download URL (1 hour expiry).
 */
export async function getSignedUrl(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const [url] = await getBucket().file(gcsPath).getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}
```

- [ ] **Step 2: Smoke test GCS module**

```bash
node -e "
import('./server/lib/gcs.js').then(m => {
  console.log('GCS module loaded, exports:', Object.keys(m));
})
"
```

Expected: `['uploadFile', 'deleteFile', 'deleteProjectFiles', 'getSignedUrl']`

- [ ] **Step 3: Commit**

```bash
git add server/lib/gcs.js
git commit -m "feat: add GCS storage module"
```

---

## Task 4: Embeddings Module (Chunking + Vertex AI)

**Files:**
- Create: `server/lib/embeddings.js`

- [ ] **Step 1: Create server/lib/embeddings.js**

This module handles text chunking and Vertex AI embedding calls. Uses the existing `@google/genai` SDK (same as gemini.js) for embeddings.

```javascript
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

let _client = null;

function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({
      vertexai: true,
      project: config.gcpProject,
      location: config.gcpLocation,
    });
  }
  return _client;
}

/**
 * Chunk text into ~2000 character segments with ~200 char overlap.
 * Tracks page boundaries for PDFs (pages separated by \f).
 * @param {string} text
 * @returns {{text: string, chunkIndex: number, pageNumber: number|null}[]}
 */
export function chunkText(text) {
  const CHUNK_SIZE = 2000;
  const OVERLAP = 200;
  const chunks = [];

  // Split by form-feed to track page numbers (PDFs)
  const pages = text.split('\f');
  const hasPages = pages.length > 1;

  let fullText = text;
  let pageMap = null;

  if (hasPages) {
    // Build a map of character offset → page number
    pageMap = [];
    let offset = 0;
    for (let i = 0; i < pages.length; i++) {
      pageMap.push({ start: offset, end: offset + pages[i].length, page: i + 1 });
      offset += pages[i].length + 1; // +1 for the \f character
    }
    fullText = text.replace(/\f/g, ' ');
  }

  let start = 0;
  let chunkIndex = 0;

  while (start < fullText.length) {
    let end = Math.min(start + CHUNK_SIZE, fullText.length);

    // Try to break at a sentence or paragraph boundary
    if (end < fullText.length) {
      const slice = fullText.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('.\n'),
      );
      if (lastBreak > CHUNK_SIZE * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const chunkStr = fullText.slice(start, end).trim();
    if (chunkStr.length > 0) {
      let pageNumber = null;
      if (pageMap) {
        const entry = pageMap.find(p => start >= p.start && start < p.end);
        pageNumber = entry ? entry.page : null;
      }
      chunks.push({ text: chunkStr, chunkIndex, pageNumber });
      chunkIndex++;
    }

    start = end - OVERLAP;
    if (start < 0) start = 0;
    // Prevent infinite loop if we're not making progress
    if (end >= fullText.length) break;
  }

  return chunks;
}

/**
 * Embed an array of texts using Vertex AI text-embedding-005.
 * Uses RETRIEVAL_DOCUMENT task type for file chunks.
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function embedTexts(texts) {
  if (texts.length === 0) return [];
  const client = getClient();
  const BATCH_SIZE = 250;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await client.models.embedContent({
      model: config.embeddingModel,
      contents: batch.map(t => ({ parts: [{ text: t }] })),
      config: { taskType: "RETRIEVAL_DOCUMENT" },
    });
    for (const emb of result.embeddings) {
      allEmbeddings.push(emb.values);
    }
  }

  return allEmbeddings;
}

/**
 * Embed a single query using Vertex AI text-embedding-005.
 * Uses RETRIEVAL_QUERY task type.
 * @param {string} query
 * @returns {Promise<number[]>} Embedding vector
 */
export async function embedQuery(query) {
  const client = getClient();
  const result = await client.models.embedContent({
    model: config.embeddingModel,
    contents: [{ parts: [{ text: query }] }],
    config: { taskType: "RETRIEVAL_QUERY" },
  });
  return result.embeddings[0].values;
}
```

- [ ] **Step 2: Smoke test embeddings module**

```bash
node -e "
import('./server/lib/embeddings.js').then(m => {
  const chunks = m.chunkText('Hello world. This is a test document with enough text to verify chunking works properly.');
  console.log('Chunks:', chunks.length, chunks[0]);
  console.log('Exports:', Object.keys(m));
})
"
```

Expected: 1 chunk with `chunkIndex: 0`, `pageNumber: null`, text content present.

- [ ] **Step 3: Commit**

```bash
git add server/lib/embeddings.js
git commit -m "feat: add embeddings module with chunking and Vertex AI"
```

---

## Task 5: RAG Orchestration Module

**Files:**
- Create: `server/lib/rag.js`

- [ ] **Step 1: Create server/lib/rag.js**

This module orchestrates the full ingestion pipeline and retrieval. Uses Firestore (already a dependency via `@google-cloud/firestore`) for chunk storage and vector search.

```javascript
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { config } from "./config.js";
import { uploadFile as gcsUpload, deleteFile as gcsDelete } from "./gcs.js";
import { chunkText, embedTexts, embedQuery } from "./embeddings.js";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

let _firestore = null;

function getFirestore() {
  if (!_firestore) {
    _firestore = new Firestore({ projectId: config.gcpProject });
  }
  return _firestore;
}

function chunksCollection() {
  return getFirestore().collection(config.firestoreChunksCollection);
}

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

/**
 * Check if a MIME type is supported for indexing.
 */
export function isSupportedType(mimeType) {
  return SUPPORTED_TYPES.has(mimeType);
}

/**
 * Extract text from a file buffer based on MIME type.
 */
async function extractText(buffer, mimeType, filename) {
  switch (mimeType) {
    case "application/pdf": {
      const result = await pdfParse(buffer);
      return result.text;
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case "text/plain":
    case "text/markdown":
      return buffer.toString("utf-8");
    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

/**
 * Index a file: upload to GCS, extract text, chunk, embed, store in Firestore.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} filename - original filename
 * @param {Buffer} buffer - file contents
 * @param {string} mimeType
 * @param {(msg: string) => void} onProgress - callback for SSE progress events
 * @returns {Promise<{chunks: number}>}
 */
export async function indexFile(projectId, fileId, filename, buffer, mimeType, onProgress) {
  const progress = onProgress || (() => {});

  // 1. Upload to GCS
  progress("Uploading to cloud storage...");
  await gcsUpload(projectId, fileId, filename, buffer, mimeType);

  // 2. Extract text
  progress("Extracting text from document...");
  const text = await extractText(buffer, mimeType, filename);
  if (!text || text.trim().length === 0) {
    throw new Error("No text content could be extracted from file");
  }

  // 3. Chunk
  const chunks = chunkText(text);
  progress(`Chunking text (${chunks.length} chunks)...`);

  // 4. Embed
  progress("Generating embeddings...");
  const embeddings = await embedTexts(chunks.map(c => c.text));

  // 5. Store in Firestore (batch writes limited to 500 ops)
  progress("Storing in vector index...");
  const col = chunksCollection();
  const BATCH_LIMIT = 500;

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_LIMIT) {
    const batchEnd = Math.min(batchStart + BATCH_LIMIT, chunks.length);
    const batch = getFirestore().batch();
    for (let i = batchStart; i < batchEnd; i++) {
      const docRef = col.doc();
      batch.set(docRef, {
        projectId,
        fileId,
        filename,
        chunkIndex: chunks[i].chunkIndex,
        text: chunks[i].text,
        embedding: FieldValue.vector(embeddings[i]),
        pageNumber: chunks[i].pageNumber,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  progress("Indexing complete");
  return { chunks: chunks.length };
}

/**
 * Query project files using vector search.
 * @param {string} projectId
 * @param {string} query
 * @param {number} topK - number of chunks to retrieve (default 10)
 * @returns {Promise<{text: string, filename: string, pageNumber: number|null, chunkIndex: number, score: number}[]>}
 */
export async function queryProject(projectId, query, topK = 10) {
  const queryEmbedding = await embedQuery(query);
  const col = chunksCollection();

  const results = await col
    .where("projectId", "==", projectId)
    .findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: topK,
      distanceMeasure: "COSINE",
    })
    .get();

  return results.docs.map(doc => {
    const data = doc.data();
    return {
      text: data.text,
      filename: data.filename,
      pageNumber: data.pageNumber,
      chunkIndex: data.chunkIndex,
    };
  });
}

/**
 * Delete all chunks for a specific file (handles >500 docs).
 */
export async function deleteFileChunks(fileId) {
  const col = chunksCollection();
  const snapshot = await col.where("fileId", "==", fileId).get();
  if (snapshot.empty) return;
  await batchDelete(snapshot.docs);
}

/**
 * Delete all chunks for a project (handles >500 docs).
 */
export async function deleteProjectChunks(projectId) {
  const col = chunksCollection();
  const snapshot = await col.where("projectId", "==", projectId).get();
  if (snapshot.empty) return;
  await batchDelete(snapshot.docs);
}

async function batchDelete(docs) {
  const BATCH_LIMIT = 500;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = getFirestore().batch();
    docs.slice(i, i + BATCH_LIMIT).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

/**
 * Format retrieved chunks as XML context for LLM injection.
 */
export function formatRetrievedContext(chunks) {
  if (!chunks || chunks.length === 0) return "";
  const sources = chunks.map(c => {
    const pageAttr = c.pageNumber ? ` page="${c.pageNumber}"` : "";
    return `<source file="${c.filename}"${pageAttr} chunk="${c.chunkIndex}">\n${c.text}\n</source>`;
  });
  return `<retrieved_context>\n${sources.join("\n")}\n</retrieved_context>`;
}

/**
 * Extract unique source citations from retrieved chunks for UI display.
 */
export function extractCitations(chunks) {
  const seen = new Set();
  const citations = [];
  for (const c of chunks) {
    const key = `${c.filename}:${c.pageNumber || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ filename: c.filename, pageNumber: c.pageNumber });
    }
  }
  return citations;
}
```

- [ ] **Step 2: Smoke test RAG module**

```bash
node -e "
import('./server/lib/rag.js').then(m => {
  console.log('RAG module loaded, exports:', Object.keys(m));
  const ctx = m.formatRetrievedContext([
    { text: 'Hello world', filename: 'test.txt', pageNumber: null, chunkIndex: 0 }
  ]);
  console.log('Context format:', ctx);
})
"
```

Expected: Exports include `indexFile`, `queryProject`, `deleteFileChunks`, `deleteProjectChunks`, `formatRetrievedContext`, `extractCitations`, `isSupportedType`. Context format shows XML with `<retrieved_context>` wrapper.

- [ ] **Step 3: Commit**

```bash
git add server/lib/rag.js
git commit -m "feat: add RAG orchestration module"
```

---

## Task 6: Backend Endpoints — Project File Upload + Ingest

**Files:**
- Modify: `server/index.js` (near the project endpoints, around line 780+)

- [ ] **Step 1: Add imports at top of server/index.js**

After the existing imports (around line 1-20), add:

```javascript
import { indexFile, queryProject, deleteFileChunks, deleteProjectChunks, formatRetrievedContext, extractCitations, isSupportedType } from './lib/rag.js';
import { deleteFile as gcsDeleteFile, deleteProjectFiles as gcsDeleteProjectFiles } from './lib/gcs.js';
```

- [ ] **Step 2: Add in-memory multer instance for GCS uploads**

Near the existing multer config (around line 52-63), add:

```javascript
const memoryUpload = multer({ storage: multer.memoryStorage() });
```

- [ ] **Step 3: Add POST /api/projects/:id/files/upload endpoint**

Add this after the existing project endpoints (after the project skills endpoints). This uses SSE streaming like the lease ingestion:

```javascript
// Project file upload with RAG indexing (SSE)
app.post('/api/projects/:id/files/upload', requireAuth, memoryUpload.single('file'), async (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  if (!isSupportedType(file.mimetype)) {
    return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}. Supported: PDF, DOCX, TXT, MD` });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const step = (msg) => sendEvent({ type: 'step', message: msg, ts: new Date().toISOString() });

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    // Create library_files record
    dbRun(db, `INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, project_id, uploaded_at, index_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileId, req.user.id, file.originalname, file.originalname, `gcs://projects/${project.id}/${fileId}-${file.originalname}`,
       path.extname(file.originalname).slice(1), file.size, file.mimetype, project.id, now, 'indexing']);

    // Run ingestion pipeline
    const result = await indexFile(project.id, fileId, file.originalname, file.buffer, file.mimetype, step);

    // Update status to ready
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['ready', fileId]);

    sendEvent({
      type: 'done',
      file: {
        id: fileId,
        original_name: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype,
        index_status: 'ready',
        chunks: result.chunks,
      },
    });
  } catch (err) {
    console.error('File indexing error:', err);
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['error', fileId]);
    sendEvent({ type: 'error', message: err.message || 'Indexing failed' });
  }

  res.end();
});
```

- [ ] **Step 4: Add POST /api/projects/:id/files/:fileId/reindex endpoint**

For re-triggering indexing on error. Downloads the file from GCS and re-runs the pipeline:

```javascript
import { downloadFile as gcsDownload } from './lib/gcs.js';
```

Add this `downloadFile` export to `server/lib/gcs.js`:

```javascript
/**
 * Download a file buffer from GCS.
 */
export async function downloadFile(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const [buffer] = await getBucket().file(gcsPath).download();
  return buffer;
}
```

Then add the endpoint:

```javascript
// Re-index a project file (downloads from GCS and re-processes)
app.post('/api/projects/:id/files/:fileId/reindex', requireAuth, async (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND project_id = ?', [req.params.fileId, req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const step = (msg) => sendEvent({ type: 'step', message: msg, ts: new Date().toISOString() });

  try {
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['indexing', file.id]);

    // Delete old chunks
    step('Removing old index...');
    await deleteFileChunks(file.id);

    // Download from GCS
    step('Downloading file from storage...');
    const buffer = await gcsDownload(req.params.id, file.id, file.original_name);

    // Re-run ingestion (skip GCS upload since file is already there)
    const text = await extractText(buffer, file.mime_type, file.original_name);
    const chunks = chunkText(text);
    step(`Chunking text (${chunks.length} chunks)...`);

    step('Generating embeddings...');
    const embeddings = await embedTexts(chunks.map(c => c.text));

    step('Storing in vector index...');
    // ... store chunks in Firestore (same batched write as indexFile) ...

    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['ready', file.id]);
    sendEvent({ type: 'done', file: { id: file.id, index_status: 'ready', chunks: chunks.length } });
  } catch (err) {
    console.error('Re-index error:', err);
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['error', file.id]);
    sendEvent({ type: 'error', message: err.message || 'Re-indexing failed' });
  }
  res.end();
});
```

Note: To avoid duplicating the Firestore batch write logic, extract a helper `storeChunks(projectId, fileId, filename, chunks, embeddings)` from `indexFile` in `rag.js` and reuse it here. Also export `extractText` and re-export `chunkText`/`embedTexts` from rag.js for the reindex endpoint.

- [ ] **Step 5: Test the upload endpoint starts**

```bash
npm run dev:backend
```

Expected: Server starts without import errors.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat: add project file upload endpoint with SSE ingestion"
```

---

## Task 7: Modify Existing Endpoints for RAG

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Modify DELETE /api/library/:id to clean up GCS + Firestore**

Find the existing DELETE endpoint (around line 906-921). Replace the file deletion logic. After the `dbGet` that fetches the file, before `dbRun` delete, add GCS and Firestore cleanup:

```javascript
// Clean up RAG chunks and GCS blob if file was indexed
if (file.project_id && file.index_status) {
  try {
    await deleteFileChunks(file.id);
    await gcsDeleteFile(file.project_id, file.id, file.original_name);
  } catch (err) {
    console.error('Error cleaning up indexed file:', err);
  }
}
```

Also change the endpoint handler from sync `(req, res)` to `async (req, res)`.

- [ ] **Step 2: Modify PUT /api/library/:id to handle project reassignment**

Find the existing PUT endpoint (around line 888-904). When `project_id` changes, clean up old chunks and trigger re-indexing. Add before the UPDATE query:

```javascript
const existingFile = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [req.params.id]);
// ... existing ownership check ...

// If project_id is changing and file was indexed, clean up old chunks
if (project_id !== undefined && existingFile.project_id && existingFile.index_status) {
  try {
    await deleteFileChunks(existingFile.id);
    await gcsDeleteFile(existingFile.project_id, existingFile.id, existingFile.original_name);
  } catch (err) {
    console.error('Error cleaning up old index:', err);
  }
}

// If assigning to a new project, mark for indexing
if (project_id && project_id !== existingFile.project_id) {
  // Note: actual re-indexing would need the file buffer from disk
  // Update index_status to pending — indexing triggered separately
  dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['pending', existingFile.id]);
}
```

Also change the endpoint handler from sync to async.

- [ ] **Step 3: Modify POST /api/chats/:id/messages for RAG retrieval**

In the chat message handler (around line 380-425), after loading project files but before building the system prompt, add RAG retrieval. Find the section where `projectFiles` are loaded and add:

```javascript
// RAG retrieval for project files
let retrievedChunks = [];
let retrievedContext = '';
let citations = [];
if (project) {
  try {
    step('Searching project files...');
    retrievedChunks = await queryProject(project.id, content);
    if (retrievedChunks.length > 0) {
      retrievedContext = formatRetrievedContext(retrievedChunks);
      citations = extractCitations(retrievedChunks);
      step(`Found ${retrievedChunks.length} relevant passages from ${citations.length} file${citations.length !== 1 ? 's' : ''}`);
    }
  } catch (err) {
    console.error('RAG retrieval error:', err);
    // Non-fatal — continue without RAG context
  }
}
```

Then inject `retrievedContext` into the system prompt parts (after skills injection, before the AI call):

```javascript
if (retrievedContext) {
  parts.push('\n\nThe following context was retrieved from project files. Use it to answer the user\'s question. When using information from these sources, cite them by filename and page number.\n');
  parts.push(retrievedContext);
}
```

Include citations in the `done` SSE event — add `citations` field to the assistant message object:

```javascript
citations: citations.length > 0 ? citations : undefined,
```

- [ ] **Step 4: Verify server starts and chat still works**

```bash
npm run dev:backend
```

Expected: Server starts. Existing chat (non-project) still works without errors.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: integrate RAG retrieval into chat and cleanup into file endpoints"
```

---

## Task 8: Frontend Types and API Layer

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add SourceCitation type**

In `src/types/index.ts`, add:

```typescript
export interface SourceCitation {
  filename: string;
  pageNumber: number | null;
}
```

- [ ] **Step 2: Add citations to Message type**

Find the `Message` interface in `src/types/index.ts` and add:

```typescript
citations?: SourceCitation[];
```

- [ ] **Step 3: Add project file upload API**

In `src/api/index.ts`, add to the existing exports (or within an appropriate section):

```typescript
export const projectFiles = {
  upload: (
    projectId: string,
    file: File,
    onStep: (step: { message: string; ts: string }) => void,
  ): Promise<any> =>
    new Promise(async (resolve, reject) => {
      try {
        const userId = localStorage.getItem('userId') || '';
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${BASE}/projects/${projectId}/files/upload`, {
          method: 'POST',
          headers: { 'X-User-Id': userId },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }));
          return reject(new Error(err.error || `HTTP ${res.status}`));
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'step') onStep({ message: event.message, ts: event.ts });
            else if (event.type === 'done') resolve(event);
            else if (event.type === 'error') reject(new Error(event.message));
          }
        }
      } catch (err) {
        reject(err);
      }
    }),
};
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/api/index.ts
git commit -m "feat: add project file upload API and citation types"
```

---

## Task 9: ProjectDetailPage — Files Section with Upload

**Files:**
- Modify: `src/pages/ProjectDetailPage.tsx`

- [ ] **Step 1: Read current ProjectDetailPage to understand layout**

Review the current page structure, tabs, and how files are currently displayed. The file list and upload button will be added as a section within the project detail view.

- [ ] **Step 2: Add file upload state and handlers**

Add state for upload progress and file list. Import the `projectFiles` API. Add:

```typescript
const [uploadSteps, setUploadSteps] = useState<{message: string; ts: string}[]>([]);
const [isUploading, setIsUploading] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);

const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !project) return;

  setIsUploading(true);
  setUploadSteps([]);

  try {
    await projectFiles.upload(project.id, file, (step) => {
      setUploadSteps(prev => [...prev, step]);
    });
    // Reload files list
    const files = await api.library.list(project.id);
    setProjectFiles(files);
  } catch (err: any) {
    console.error('Upload failed:', err);
    // Show error toast
  } finally {
    setIsUploading(false);
    setUploadSteps([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};
```

- [ ] **Step 3: Add Files section UI**

Add a files section to the project detail view showing:
- File list with name, size, type, and index status badge
- Upload button triggering hidden file input
- Upload progress steps (when uploading)
- Status indicators: spinning for `indexing`, checkmark for `ready`, error icon with retry for `error`

Style using existing Tailwind patterns and the gold accent color (`#C4A962`).

```tsx
{/* Files Section */}
<div className="mb-6">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Project Files</h3>
    <label className="cursor-pointer px-3 py-1.5 bg-[#C4A962]/10 text-[#C4A962] text-sm rounded-lg hover:bg-[#C4A962]/20 transition-colors">
      Upload File
      <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} disabled={isUploading} />
    </label>
  </div>

  {isUploading && uploadSteps.length > 0 && (
    <div className="mb-3 p-3 bg-white/5 rounded-lg space-y-1">
      {uploadSteps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-white/50">
          <span className={i === uploadSteps.length - 1 ? 'text-[#C4A962]' : ''}>{s.message}</span>
        </div>
      ))}
    </div>
  )}

  {projectFiles.length === 0 ? (
    <p className="text-sm text-white/30">No files uploaded yet</p>
  ) : (
    <div className="space-y-2">
      {projectFiles.map(file => (
        <div key={file.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/80">{file.original_name}</span>
            <span className="text-xs text-white/30">{(file.file_size / 1024).toFixed(0)} KB</span>
          </div>
          <div>
            {file.index_status === 'ready' && <span className="text-green-400 text-xs">✓ Indexed</span>}
            {file.index_status === 'indexing' && <span className="text-[#C4A962] text-xs animate-pulse">Indexing...</span>}
            {file.index_status === 'error' && <span className="text-red-400 text-xs">Error</span>}
            {!file.index_status && <span className="text-white/30 text-xs">Not indexed</span>}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 4: Verify page renders**

```bash
npm run dev
```

Expected: ProjectDetailPage shows files section with upload button. Uploading a file shows SSE progress steps.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectDetailPage.tsx
git commit -m "feat: add files section with upload to project detail page"
```

---

## Task 10: Chat Source Citations UI

**Files:**
- Modify: The chat message rendering component (find the component that renders assistant messages — likely in `src/components/chat/` or inline in the chat page)

- [ ] **Step 1: Identify the chat message component**

Search for where assistant messages are rendered. Look for the component that displays `message.content` for `role === 'assistant'`.

- [ ] **Step 2: Add citations rendering**

After the message content, add a collapsible sources section when `message.citations` exists:

```tsx
{message.citations && message.citations.length > 0 && (
  <div className="mt-2 pt-2 border-t border-white/10">
    <div className="text-xs text-white/40 mb-1">Sources:</div>
    <div className="flex flex-wrap gap-1">
      {message.citations.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-xs text-white/50">
          {c.filename}{c.pageNumber ? ` (p. ${c.pageNumber})` : ''}
        </span>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Ensure citations are parsed from SSE done event**

In the chat message handler (wherever the `done` event is processed and messages are stored), ensure `citations` from the SSE response are included in the message object.

Check `src/api/index.ts` `streamMessage` — the `done` event already resolves with the full event object. Ensure the component reads `citations` from the stored message.

- [ ] **Step 4: Verify citations render**

```bash
npm run dev
```

Expected: When chatting in a project with indexed files, AI responses show source citations below the message.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ src/pages/
git commit -m "feat: render source citations in chat messages"
```

---

## Task 11: Firestore Vector Index Setup

**Files:**
- None (GCP console / CLI configuration)

- [ ] **Step 1: Create Firestore vector index**

The Firestore vector index must be created before vector search works. Run via gcloud CLI:

```bash
gcloud firestore indexes composite create \
  --project=bill-leases \
  --collection-group=project_file_chunks \
  --field-config=field-path=projectId,order=ASCENDING \
  --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}' \
  --database="(default)"
```

Note: Index creation takes a few minutes. Vector search queries will fail until the index is built.

- [ ] **Step 2: Create supporting indexes**

```bash
gcloud firestore indexes composite create \
  --project=bill-leases \
  --collection-group=project_file_chunks \
  --field-config=field-path=fileId,order=ASCENDING \
  --database="(default)"
```

- [ ] **Step 3: Verify index status**

```bash
gcloud firestore indexes composite list --project=bill-leases --database="(default)" | grep project_file_chunks
```

Expected: Indexes show status READY.

- [ ] **Step 4: Document in commit**

```bash
git commit --allow-empty -m "chore: Firestore vector index created for project_file_chunks"
```

---

## Task 12: End-to-End Manual Testing

- [ ] **Step 1: Upload a TXT file to a project**

1. Open a project in the browser
2. Click "Upload File" and select a `.txt` file
3. Verify SSE progress steps appear
4. Verify file shows "Indexed" status after completion
5. Check GCS bucket has the blob
6. Check Firestore has chunk documents

- [ ] **Step 2: Upload a multi-page PDF**

1. Upload a PDF with 3+ pages
2. Verify chunks have correct `pageNumber` values in Firestore
3. Verify file shows "Indexed" status

- [ ] **Step 3: Chat with project files**

1. Send a question related to the uploaded file content
2. Verify the response references the file content
3. Verify source citations appear below the message
4. Verify the "Searching project files..." step appears during processing

- [ ] **Step 4: Delete a file**

1. Remove a file from the project
2. Verify GCS blob is deleted
3. Verify Firestore chunks are deleted
4. Verify the file no longer appears in project files list

- [ ] **Step 5: Test error handling**

1. Try uploading an unsupported file type (e.g., `.png`)
2. Verify a 400 error is returned with a clear message

- [ ] **Step 6: Bump version and commit**

Update the version in the sidebar component.

```bash
git add -A
git commit -m "feat: project files with RAG search — complete"
```
