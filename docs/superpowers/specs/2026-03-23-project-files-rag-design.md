# Project Files with RAG Search — Design Spec

**Date:** 2026-03-23
**Status:** Draft

## Overview

Add file upload and RAG-powered search to projects. Files uploaded (or assigned from the library) to a project are stored in Google Cloud Storage, chunked, embedded via Vertex AI, and indexed in Firestore with native vector search. Project chat queries retrieve relevant chunks and inject them as context for the LLM, with source citations shown in the response.

## Goals

- Upload files directly from the project detail page or assign existing library files
- Store original blobs in GCS for durability and deployment-readiness
- Chunk and embed all project files for semantic search via Firestore vector search
- Retrieve relevant context during project chat and cite sources in responses
- Stream ingestion progress via SSE (same pattern as lease ingestion)

## Non-Goals

- Full-text keyword search (vector search covers semantic retrieval)
- Real-time collaborative editing of files
- File versioning (re-upload replaces the file)
- Global cross-project search

## Architecture

### GCP Services

| Service | Purpose | Auth |
|---------|---------|------|
| Google Cloud Storage | Original file blob storage | ADC (jeffk@vettedbot.com) |
| Firestore | Text chunks + vector embeddings with native vector search | ADC (existing) |
| Vertex AI Embeddings | `text-embedding-005` for chunk and query embeddings | ADC (existing) |

### Data Flow

```
Upload/Assign → GCS (blob) → Text Extraction → Chunking → Vertex AI Embedding → Firestore (chunks + vectors)

Chat Query → Vertex AI Embedding → Firestore Vector Search (scoped to project) → Top-K Chunks → LLM Context → Response + Sources
```

### Storage Layout

**GCS Bucket:** `vetted-portal-files` (configurable via `GCS_BUCKET` env var)

```
projects/{projectId}/{fileId}-{originalName}
```

**Firestore Collection:** `project_file_chunks`

```
project_file_chunks/{chunkId}
  ├── projectId: string
  ├── fileId: string          (matches library_files.id in SQLite)
  ├── filename: string        (original filename for display)
  ├── chunkIndex: number      (ordering within file)
  ├── text: string            (~500 tokens per chunk)
  ├── embedding: vector       (768 dimensions, text-embedding-005)
  ├── pageNumber: number|null (for PDFs)
  └── createdAt: timestamp
```

**Firestore Indexes:**
- Composite index: `projectId` (equality) + `embedding` (vector, cosine distance, 768 dimensions) — scopes all searches to a single project
- Must be created manually via Firebase CLI or console before first use

**SQLite `library_files`:** Unchanged. Continues to track file metadata and project assignment. A new `index_status` column is added (`pending`, `indexing`, `ready`, `error`) to track ingestion state.

## Ingestion Pipeline

Triggered when a file is uploaded to a project or an existing library file is assigned to a project.

### Steps

1. **Upload to GCS** — Store original blob at `projects/{projectId}/{fileId}-{originalName}`
2. **Text extraction** (supported types: PDF, DOCX, TXT, MD — unsupported types are rejected with a 400 error at upload time):
   - PDF: `pdf-parse` for text extraction (fallback: Gemini OCR for scanned PDFs)
   - DOCX: `mammoth` for text extraction
   - TXT/MD: Read as UTF-8
3. **Chunking** — Split extracted text into ~2000 character chunks (~500 tokens) with ~200 character overlap. Track page boundaries for PDFs.
4. **Embedding** — Call Vertex AI `text-embedding-005` in batches (up to 250 texts per request). Use task type `RETRIEVAL_DOCUMENT` for file chunks and `RETRIEVAL_QUERY` for chat queries.
5. **Store in Firestore** — Write chunk documents with text, embedding vector, and source metadata
6. **Update SQLite** — Set `index_status = 'ready'` on the `library_files` record

### SSE Progress Events

Same event format as lease ingestion:

```javascript
event: step
data: {"message": "Uploading to cloud storage...", "ts": "..."}

event: step
data: {"message": "Extracting text from document...", "ts": "..."}

event: step
data: {"message": "Chunking text (12 chunks)...", "ts": "..."}

event: step
data: {"message": "Generating embeddings...", "ts": "..."}

event: step
data: {"message": "Indexing complete", "ts": "..."}

event: done
data: {"fileId": "...", "chunks": 12, "status": "ready"}
```

### Error Handling

- If any step fails, set `index_status = 'error'` on the library_files record
- GCS upload failure: no chunks written, file marked as error
- Partial embedding failure: retry batch once, then mark error
- User can re-trigger indexing from the UI

## Chat Retrieval

### Flow

1. User sends message in project chat
2. Backend embeds the query using `text-embedding-005`
3. Firestore vector search: find top-10 nearest chunks where `projectId == currentProject`
4. Format retrieved chunks as context block injected before the user message
5. LLM generates response using retrieved context
6. Parse response for source references and attach citation metadata

### Context Injection Format

```
<retrieved_context>
<source file="lease-agreement.pdf" page="3" chunk="2">
  The tenant shall pay monthly rent of $5,000 due on the first of each month...
</source>
<source file="project-brief.docx" chunk="1">
  The project aims to consolidate three office locations into a single campus...
</source>
</retrieved_context>
```

### Source Citations

The LLM is instructed (via system prompt addition) to cite sources when using retrieved context. Citations are rendered in the UI after the response:

```
Sources:
• lease-agreement.pdf (p. 3)
• project-brief.docx (p. 1)
```

## New Backend Modules

### `server/lib/gcs.js`

GCS client helpers using `@google-cloud/storage`:

- `uploadFile(projectId, fileId, filename, buffer)` — Upload blob to bucket
- `deleteFile(projectId, fileId, filename)` — Delete blob
- `deleteProjectFiles(projectId)` — Delete all blobs for a project
- `getSignedUrl(projectId, fileId, filename)` — Generate download URL

### `server/lib/embeddings.js`

Vertex AI embedding + chunking:

- `chunkText(text, options)` — Split text into chunks with overlap. Returns `[{text, chunkIndex, pageNumber}]`
- `embedTexts(texts)` — Batch embed via Vertex AI `text-embedding-005`. Returns float arrays.
- `embedQuery(query)` — Embed a single query string.

### `server/lib/rag.js`

Retrieval orchestration:

- `indexFile(projectId, fileId, filename, buffer, mimeType, onProgress)` — Full pipeline: extract → chunk → embed → store. Calls `onProgress` for SSE events.
- `queryProject(projectId, query, topK)` — Embed query → Firestore vector search → return chunks with metadata.
- `deleteFileChunks(fileId)` — Remove all chunks for a file from Firestore.
- `deleteProjectChunks(projectId)` — Remove all chunks for a project.

### Endpoint Changes

**New endpoint:** `POST /api/projects/:id/files/upload`
- Multer in-memory storage (blob goes to GCS, not disk)
- SSE response streaming ingestion progress
- Creates `library_files` record with `project_id` and `index_status`

**Modified endpoint:** `POST /api/chats/:id/messages`
- If chat belongs to a project, call `rag.queryProject()` before LLM call
- Inject retrieved chunks into context
- Include source metadata in the `done` SSE event

**Modified endpoint:** `PUT /api/library/:id`
- When `project_id` changes: delete old chunks, re-index under new project
- When `project_id` set to null: delete chunks and GCS blob

**Modified endpoint:** `DELETE /api/library/:id`
- Also delete chunks from Firestore and blob from GCS

## Frontend Changes

### ProjectDetailPage

- **Files section** — List of project files showing: filename, size, type, index status (indexing spinner / ready checkmark / error icon with retry)
- **Upload button** — Direct upload with SSE progress display (step indicators matching lease ingestion UX)
- **Assign from library** — Existing flow, triggers indexing when file is assigned

### Chat Response

- **Sources block** — After AI message content, render a collapsible "Sources" section
- Each source shows: filename, page number (if PDF), and chunk preview on hover/click
- Styled to match the existing chat bubble design

### Chat Input

- No changes needed — existing attachment flow remains for per-message files
- Project-level files are always available via RAG (no manual attachment needed)

## Environment Variables

New additions to `.env`:

```
GCS_BUCKET=vetted-portal-files
```

Existing variables used (no changes):

```
GCP_PROJECT=bill-leases
GCP_LOCATION=us-central1
```

## NPM Dependencies

New packages:

- `@google-cloud/storage` — GCS client
- `@google-cloud/aiplatform` — Vertex AI embeddings (may already be available via existing Vertex AI setup)

## File Lifecycle

| Action | GCS | Firestore | SQLite |
|--------|-----|-----------|--------|
| Upload to project | Create blob | Create chunks + vectors | Create library_files record |
| Assign library file to project | Create blob | Create chunks + vectors | Update project_id |
| Remove from project | Delete blob | Delete chunks | Set project_id = null |
| Delete file | Delete blob | Delete chunks | Delete record |
| Re-assign to different project | Delete old + create new blob | Delete old + create new chunks | Update project_id |

## Testing

No test runner is configured. Manual testing:

1. Upload a small TXT file to a project — verify GCS blob, Firestore chunks, and embedding vectors
2. Upload a multi-page PDF — verify page numbers tracked in chunks
3. Chat in project — verify relevant chunks are retrieved and sources cited
4. Remove file from project — verify cleanup in GCS and Firestore
5. Assign library file to project — verify indexing triggers
6. Error case: upload unsupported file type — verify graceful error
