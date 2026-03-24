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
 */
export function chunkText(text) {
  const CHUNK_SIZE = 2000;
  const OVERLAP = 200;
  const chunks = [];

  const pages = text.split('\f');
  const hasPages = pages.length > 1;

  let fullText = text;
  let pageMap = null;

  if (hasPages) {
    pageMap = [];
    let offset = 0;
    for (let i = 0; i < pages.length; i++) {
      pageMap.push({ start: offset, end: offset + pages[i].length, page: i + 1 });
      offset += pages[i].length + 1;
    }
    fullText = text.replace(/\f/g, ' ');
  }

  let start = 0;
  let chunkIndex = 0;

  while (start < fullText.length) {
    let end = Math.min(start + CHUNK_SIZE, fullText.length);

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
    if (end >= fullText.length) break;
  }

  return chunks;
}

/**
 * Embed an array of texts using Vertex AI text-embedding-005.
 * Uses RETRIEVAL_DOCUMENT task type for file chunks.
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
