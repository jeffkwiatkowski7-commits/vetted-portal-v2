/**
 * Vertex AI Gemini client — uses @google/genai SDK with v1beta for Gemini 3.
 *
 * Functions:
 * 1. ocrPdf()              — OCR scanned PDFs using Gemini vision
 * 2. extractLeaseData()    — structured data extraction from lease text
 * 3. chatWithLeases()      — per-project Q&A using full context window
 * 4. chatCrossPortfolio()  — cross-portfolio Q&A using summaries
 * 5. chatWithDocuments()   — general document Q&A
 */
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

// Singleton client
let _client = null;

function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({
      vertexai: true,
      project: config.gcpProject,
      location: config.gcpLocation,
      httpOptions: { apiVersion: config.apiVersion },
    });
  }
  return _client;
}

async function generate(contents, genConfig = {}, tools = []) {
  const client = getClient();
  const req = {
    model: config.modelId,
    contents,
    config: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      ...genConfig,
    },
  };
  if (tools.length) req.config.tools = tools;
  return client.models.generateContent(req);
}

// ── Response extraction ──────────────────────────────────────────────

function extractGroundedResponse(result) {
  const candidate = result.candidates?.[0];
  const meta = candidate?.groundingMetadata;
  const searchQueries = meta?.webSearchQueries ?? [];
  const chunks = meta?.groundingChunks ?? [];

  const rawText = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  console.log("[gemini] finishReason:", candidate?.finishReason);
  console.log("[gemini] searchQueries:", searchQueries);

  let text = rawText || result.text || "No response generated.";

  const sourceLines = chunks
    .filter((c) => c.web?.uri && c.web?.title)
    .slice(0, 5)
    .map((c) => `- [${c.web.title}](${c.web.uri})`)
    .join("\n");

  if (sourceLines) text += `\n\n---\n**Sources:**\n${sourceLines}`;

  return { text, searchQueries };
}

// ── OCR ─────────────────────────────────────────────────────────────

const OCR_PROMPT = `You are a document OCR specialist. Transcribe ALL visible text from this scanned PDF lease document.
Return the complete text content, preserving the structure and order of the document.
Include all text: headings, paragraphs, clauses, signatures, dates, addresses, amounts, etc.
If there are handwritten annotations, transcribe those too and mark them as [handwritten: ...].`;

export async function ocrPdf(pdfBase64) {
  const result = await generate(
    [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
          { text: OCR_PROMPT },
        ],
      },
    ],
    { temperature: 0.1, maxOutputTokens: 8192 },
  );

  return (
    result.candidates?.[0]?.content?.parts?.[0]?.text ||
    result.text ||
    ""
  );
}

// ── Structured extraction ───────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a commercial real estate lease analyst. Extract structured data from the following lease document text.
Return ONLY valid JSON matching this exact schema:

{
  "tenantName": "string or null",
  "landlordName": "string or null",
  "propertyAddress": "string or null — full street address of the property",
  "suiteNumber": "string or null — suite/unit number",
  "leaseStartDate": "YYYY-MM-DD or null — if only month/year given, use 1st of month",
  "leaseEndDate": "YYYY-MM-DD or null",
  "monthlyRent": "number or null — if only annual rent, divide by 12",
  "rentEscalationTerms": "string or null — concise summary of rent increase schedule",
  "renewalOptions": "string or null — concise summary of renewal terms",
  "permittedUse": "string or null",
  "squareFootage": "number or null",
  "securityDeposit": "number or null",
  "terminationClauses": "string or null — concise summary",
  "specialProvisions": "string or null — concise summary of notable terms"
}

Rules:
- Dates MUST be ISO format (YYYY-MM-DD)
- Monthly rent should be a number with no currency symbols
- If a field cannot be determined, use null
- For text fields, provide concise but complete summaries

LEASE DOCUMENT TEXT:
`;

export async function extractLeaseData(fullText, sourceFile) {
  const truncated = fullText.slice(0, 100_000);

  const result = await generate(
    [{ role: "user", parts: [{ text: EXTRACTION_PROMPT + truncated }] }],
    { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: "application/json" },
  );

  let rawJson =
    result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    result.text?.trim() ||
    "{}";

  // Clean up markdown code fences if present
  if (rawJson.startsWith("```")) rawJson = rawJson.split("\n").slice(1).join("\n");
  if (rawJson.endsWith("```")) rawJson = rawJson.slice(0, rawJson.lastIndexOf("```"));

  const data = JSON.parse(rawJson);
  const parsed = Array.isArray(data) ? data[0] : data;

  return {
    sourceFile,
    fullText,
    tenantName: parsed.tenantName || null,
    landlordName: parsed.landlordName || null,
    propertyAddress: parsed.propertyAddress || null,
    suiteNumber: parsed.suiteNumber || null,
    leaseStartDate: parsed.leaseStartDate || null,
    leaseEndDate: parsed.leaseEndDate || null,
    monthlyRent: parsed.monthlyRent || null,
    rentEscalationTerms: parsed.rentEscalationTerms || null,
    renewalOptions: parsed.renewalOptions || null,
    permittedUse: parsed.permittedUse || null,
    squareFootage: parsed.squareFootage || null,
    securityDeposit: parsed.securityDeposit || null,
    terminationClauses: parsed.terminationClauses || null,
    specialProvisions: parsed.specialProvisions || null,
  };
}

// ── System prompt ────────────────────────────────────────────────────

function getChatSystemPrompt(useSearch, persona) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const personaSection = persona?.trim() ? `## Your Role\n\n${persona.trim()}\n\n` : "";

  return `${personaSection}You are a confidential lease assistant for a commercial real estate portfolio manager.
You answer questions about lease documents. All lease data is confidential and must not be shared outside this system.

Today's date is ${today}. Use this when answering questions about lease expirations, upcoming renewals, or time-sensitive terms.

## Core Rules

**Data source discipline:**
- Answer ONLY from the provided lease data. Do NOT invoke web search for questions that can be answered from the leases (e.g. tenant concentration, NOI projections, expiration schedules, renewal priorities, clause analysis).
${useSearch ? `- Web search is enabled for this query because it requires external market data. Prefer authoritative CRE sources: CoStar, LoopNet, CBRE Research, JLL Research, Cushman & Wakefield, NAR. Cite each source inline as [Source Name](URL) with publication date if available.` : `- Web search is DISABLED for this query. Answer entirely from the provided lease data.`}

**Never refuse financial projection questions:**
- When asked about NOI, income projections, or cash flow, ALWAYS produce an analysis using the available lease data.
- Never say you cannot answer because data is incomplete. Build the best estimate from available data and clearly label every assumption.
- Label assumptions inline as **[Assumption: ...]** so the user knows what is estimated vs. known.
- Always show two scenarios: **Base Case** (all leases renew at escalated rates) and **Risk Case** (expiring leases roll off with no replacement).
- Present projections as a Year 1–5 table.

**General guidelines:**
- When referencing a specific fact from a lease, cite it inline immediately after the claim as **(Tenant Name, Suite X)**.
- When comparing leases, highlight key differences clearly
- If a question is ambiguous, ask a brief clarifying question before answering
- All data is confidential — remind the user if they ask about exporting or sharing

Formatting rules — FOLLOW EXACTLY:
- Use **bold** for emphasis and key values
- Use bullet lists and numbered lists to organize information
- Use headers (## or ###) to organize longer responses
- When presenting data about multiple leases, ALWAYS use a markdown table

CRITICAL table formatting rules — FOLLOW EXACTLY:
- EVERY table row MUST be on its own line with a newline character at the end
- The separator row MUST have EXACTLY the same number of columns as the header row
- There MUST be a blank line before the first | row and after the last | row
- Keep tables to 6 columns max. Split into multiple tables if needed
- For long text values, summarize in 10 words or fewer in the table cell
- NEVER put multiple | rows on the same line`;
}

// ── Per-project Q&A ──────────────────────────────────────────────────

export async function chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch = false, persona) {
  const leaseContext = leaseTexts
    .map((l, i) => `\n--- LEASE ${i + 1}: ${l.tenantName} (Suite ${l.suiteNumber}) ---\n${l.text}\n`)
    .join("\n");

  const systemContext = `${getChatSystemPrompt(useSearch, persona)}\n\nYou have access to ${leaseTexts.length} lease(s) for this property:\n${leaseContext}`;

  const contents = [
    {
      role: "user",
      parts: [{ text: `[SYSTEM CONTEXT — not from user]\n${systemContext}\n\n[USER QUESTION]\n${chatHistory.length === 0 ? userMessage : chatHistory[0].content}` }],
    },
  ];

  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
  }

  if (chatHistory.length > 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  const tools = useSearch ? [{ googleSearch: {} }] : [];
  const result = await generate(contents, {}, tools);

  for (const q of result.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []) {
    console.log("[gemini] web search:", q);
  }

  return extractGroundedResponse(result);
}

// ── Default system prompt ────────────────────────────────────────────

export function buildDefaultSystemPrompt() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return `You are a knowledgeable, precise, and helpful AI assistant powered by Gemini.

Today's date is ${today}.

## Core Behavior

- Answer questions directly and accurately
- Use Google Search when questions require current information, recent events, live data, or anything likely beyond your training knowledge — search proactively, don't wait to be asked
- When using grounded sources, cite them inline as [Source](URL)
- If you're uncertain about something, say so clearly rather than speculating
- Never refuse a reasonable request — if you can't do exactly what's asked, do the closest useful thing and explain

## Reasoning

- For complex questions, think step by step before answering
- Show your work when doing calculations or multi-step analysis
- Label any assumptions you make as **[Assumption: ...]**

## Formatting — follow exactly

- Use **bold** for key terms and important values
- Use bullet lists and numbered lists to organize information
- Use ## and ### headers to structure longer responses
- Use markdown tables when comparing multiple items or presenting structured data
- Use code blocks (\`\`\`) for code, commands, JSON, or technical output
- Keep responses focused — lead with the answer, then provide supporting detail`;
}

// ── General document Q&A / project chat ─────────────────────────────

export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null) {
  const docContext = docs.length > 0
    ? docs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
    : "";

  const basePrompt = systemPromptOverride ?? buildDefaultSystemPrompt();
  const systemPrompt = docContext
    ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
    : basePrompt;

  const contents = [
    {
      role: "user",
      parts: [{ text: `[SYSTEM CONTEXT]\n${systemPrompt}\n\n[USER MESSAGE]\n${chatHistory.length === 0 ? userMessage : chatHistory[0].content}` }],
    },
  ];

  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
  }

  if (chatHistory.length > 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  // Always enable Google Grounding — model decides when to search
  const result = await generate(contents, {}, [{ googleSearch: {} }]);

  for (const q of result.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []) {
    console.log("[gemini] web search:", q);
  }

  return extractGroundedResponse(result);
}

// ── Cross-portfolio Q&A ──────────────────────────────────────────────

export async function chatCrossPortfolio(leaseSummaries, userMessage, chatHistory = [], useSearch = false, persona) {
  const summaryContext = leaseSummaries
    .map((l, i) =>
      `Lease ${i + 1}: ${l.tenantName} | Suite ${l.suiteNumber} | ${l.propertyAddress} | ` +
      `${l.leaseStartDate || "?"} to ${l.leaseEndDate || "?"} | ` +
      `$${l.monthlyRent?.toLocaleString() || "?"}/mo | ${l.squareFootage || "?"}sqft | ` +
      `Renewal: ${l.renewalOptions || "N/A"} | Notes: ${l.specialProvisions || "N/A"}`,
    )
    .join("\n");

  const systemContext = `${getChatSystemPrompt(useSearch, persona)}

You have summary data for ${leaseSummaries.length} leases across the entire portfolio:

${summaryContext}

Answer questions using this portfolio data. If you need the full lease text to answer accurately, say so.`;

  const contents = [
    {
      role: "user",
      parts: [{ text: `[SYSTEM CONTEXT — not from user]\n${systemContext}\n\n[USER QUESTION]\n${chatHistory.length === 0 ? userMessage : chatHistory[0].content}` }],
    },
  ];

  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
  }

  if (chatHistory.length > 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  const tools = useSearch ? [{ googleSearch: {} }] : [];
  const result = await generate(contents, {}, tools);
  return extractGroundedResponse(result);
}
