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

export function isSupportedType(mimeType) {
  return SUPPORTED_TYPES.has(mimeType);
}

export async function extractText(buffer, mimeType, filename) {
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

async function storeChunks(projectId, fileId, filename, chunks, embeddings) {
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
}

export async function indexFile(projectId, fileId, filename, buffer, mimeType, onProgress) {
  const progress = onProgress || (() => {});

  progress("Uploading to cloud storage...");
  await gcsUpload(projectId, fileId, filename, buffer, mimeType);

  progress("Extracting text from document...");
  const text = await extractText(buffer, mimeType, filename);
  if (!text || text.trim().length === 0) {
    throw new Error("No text content could be extracted from file");
  }

  const chunks = chunkText(text);
  progress(`Chunking text (${chunks.length} chunks)...`);

  progress("Generating embeddings...");
  const embeddings = await embedTexts(chunks.map(c => c.text));

  progress("Storing in vector index...");
  await storeChunks(projectId, fileId, filename, chunks, embeddings);

  progress("Indexing complete");
  return { chunks: chunks.length };
}

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

export async function deleteFileChunks(fileId) {
  const col = chunksCollection();
  const snapshot = await col.where("fileId", "==", fileId).get();
  if (snapshot.empty) return;
  await batchDelete(snapshot.docs);
}

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

export function formatRetrievedContext(chunks) {
  if (!chunks || chunks.length === 0) return "";
  const sources = chunks.map(c => {
    const pageAttr = c.pageNumber ? ` page="${c.pageNumber}"` : "";
    return `<source file="${c.filename}"${pageAttr} chunk="${c.chunkIndex}">\n${c.text}\n</source>`;
  });
  return `<retrieved_context>\n${sources.join("\n")}\n</retrieved_context>`;
}

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
