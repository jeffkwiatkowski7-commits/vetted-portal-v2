/**
 * Claude via Vertex AI — uses @anthropic-ai/vertex-sdk.
 * Uses ADC for auth (same account as Gemini).
 *
 * Exports (identical signatures to gemini.js equivalents):
 *   chatWithDocuments(docs, userMessage, chatHistory, systemPromptOverride)
 *   chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch, persona)
 *   chatCrossPortfolio(leaseSummaries, userMessage, chatHistory, useSearch, persona)
 */
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { config } from "./config.js";
import { hasTavily, tavilySearch } from "./tavily.js";

const MAX_TOKENS = 8192;
const MAX_SEARCH_ITERATIONS = 5;

// Singleton client
let _client = null;
function getClient() {
  if (!_client) {
    _client = new AnthropicVertex({
      region: "global",
      projectId: config.gcpProject,
    });
  }
  return _client;
}

// ── Agentic tool-use loop ─────────────────────────────────────────────

const TOOLS_DEF = hasTavily()
  ? [
      {
        name: "web_search",
        description:
          "Search the web for current information. Use for market data, recent events, or anything requiring live information.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    ]
  : undefined;

/**
 * Run Claude with optional tool-use loop.
 * Returns { text, searchQueries }.
 */
async function runWithTools(system, messages, useSearch, onStep = null) {
  const searchQueries = [];
  const client = getClient();

  const params = {
    model: config.claudeModel,
    max_tokens: MAX_TOKENS,
    system,
    messages: [...messages],
  };
  if (useSearch && TOOLS_DEF) {
    params.tools = TOOLS_DEF;
  }

  for (let i = 0; i < MAX_SEARCH_ITERATIONS; i++) {
    const response = await client.messages.create(params);

    // Check for tool_use blocks
    const toolUseBlocks = (response.content || []).filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
      // Final text response
      const text = (response.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { text: text || "No response generated.", searchQueries };
    }

    // Execute tool calls and append results
    params.messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      if (block.name === "web_search") {
        const query = block.input?.query || "";
        searchQueries.push(query);
        console.log("[claude] web search:", query);
        if (onStep) onStep(`Web search: "${query}"`);
        const result = await tavilySearch(query);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result || "No results found.",
        });
      }
    }
    params.messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Claude exceeded max search iterations");
}

// ── System prompts ────────────────────────────────────────────────────

function buildDefaultSystemPrompt() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  return `You are a knowledgeable, precise, and helpful AI assistant powered by Claude.

Today's date is ${today}.

## Core Behavior

- Answer questions directly and accurately
- Use the web_search tool when questions require current information, recent events, live data, or anything likely beyond your training knowledge — search proactively, don't wait to be asked
- When using search results, cite sources inline as [Source Name](URL)
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

function buildLeaseChatSystemPrompt(useSearch, persona) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const personaSection = persona?.trim() ? `## Your Role\n\n${persona.trim()}\n\n` : "";

  return `${personaSection}You are a confidential lease assistant for a commercial real estate portfolio manager.
You answer questions about lease documents. All lease data is confidential and must not be shared outside this system.

Today's date is ${today}. Use this when answering questions about lease expirations, upcoming renewals, or time-sensitive terms.

## Core Rules

**Data source discipline:**
- Answer ONLY from the provided lease data. Do NOT use web search for questions that can be answered from the leases.
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

Formatting rules — FOLLOW EXACTLY:
- Use **bold** for emphasis and key values
- Use bullet lists and numbered lists to organize information
- Use headers (## or ###) to organize longer responses
- When presenting data about multiple leases, ALWAYS use a markdown table

CRITICAL table formatting rules:
- EVERY table row MUST be on its own line
- The separator row MUST have EXACTLY the same number of columns as the header row
- There MUST be a blank line before the first | row and after the last | row
- Keep tables to 6 columns max
- NEVER put multiple | rows on the same line`;
}

// ── Exported functions ────────────────────────────────────────────────

/**
 * General document Q&A / project chat.
 * Mirrors gemini.js chatWithDocuments signature.
 */
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null) {
  let textDocs = docs.filter((d) => d.text !== undefined);
  let pdfDocs = docs.filter((d) => d.base64 !== undefined);

  // Claude API has a 100-page PDF limit.
  // When multiple PDFs exist, only send query-relevant ones as native documents;
  // use Gemini Flash to summarize the rest (Gemini has no page limit on PDFs).
  if (pdfDocs.length > 1) {
    try {
      const stopWords = new Set(["the","and","for","are","but","not","you","all","can","her","was","one","our","out","about","give","tell","what","with","from","this","that","have","been","some","details","detail","info","information","please","show","list","me"]);
      const keywords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
      const isRelevant = (name) => {
        const lower = name.toLowerCase();
        return keywords.some(kw => lower.includes(kw));
      };

      const relevant = pdfDocs.filter(d => isRelevant(d.name));
      const other = pdfDocs.filter(d => !isRelevant(d.name));

      if (relevant.length > 0 && other.length > 0) {
        if (onStep) onStep(`${relevant.length} of ${pdfDocs.length} PDFs match query — summarizing ${other.length} others via Gemini`);
        console.log(`[claude] Relevant PDFs: ${relevant.map(d => d.name).join(", ")}`);
        pdfDocs = relevant;
        const { summarizePdfs } = await import("./gemini.js");
        const summaries = await summarizePdfs(other, onStep);
        textDocs.push(...summaries);
      } else if (pdfDocs.length > 0) {
        const pdfParse = (await import("pdf-parse")).default;
        let totalPages = 0;
        for (const pdf of pdfDocs) {
          try {
            const buffer = Buffer.from(pdf.base64, "base64");
            const parsed = await pdfParse(buffer);
            totalPages += parsed.numpages || 0;
          } catch { /* skip */ }
        }
        if (totalPages > 100) {
          if (onStep) onStep(`PDF pages (${totalPages}) exceed limit — summarizing all via Gemini`);
          const { summarizePdfs } = await import("./gemini.js");
          const summaries = await summarizePdfs(pdfDocs, onStep);
          textDocs.push(...summaries);
          pdfDocs = [];
        }
      }
    } catch (err) {
      console.error("[claude] PDF filtering failed, falling back to pdf-parse:", err.message);
      try {
        const pdfParse = (await import("pdf-parse")).default;
        for (const pdf of pdfDocs) {
          try {
            const buffer = Buffer.from(pdf.base64, "base64");
            const parsed = await pdfParse(buffer);
            textDocs.push({ name: pdf.name, text: parsed.text || `[Could not extract text from ${pdf.name}]` });
          } catch {
            textDocs.push({ name: pdf.name, text: `[Could not extract text from ${pdf.name}]` });
          }
        }
        pdfDocs = [];
      } catch { /* give up */ }
    }
  }

  const docContext = textDocs.length > 0
    ? textDocs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
    : "";

  const basePrompt = systemPromptOverride ?? buildDefaultSystemPrompt();
  const system = docContext
    ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
    : basePrompt;

  // Build messages — first user turn includes chat history seed or current message
  const messages = [];

  // Build first user content (may include PDF document blocks)
  const firstContent = [];

  if (chatHistory.length === 0) {
    firstContent.push({ type: "text", text: userMessage });
  } else {
    firstContent.push({ type: "text", text: chatHistory[0].content });
  }

  // Attach PDFs as document blocks (only if under page limit)
  for (const pdf of pdfDocs) {
    firstContent.push({
      type: "document",
      source: {
        type: "base64",
        media_type: pdf.mimeType,
        data: pdf.base64,
      },
    });
  }

  messages.push({ role: "user", content: firstContent });

  // Append remaining history
  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  if (chatHistory.length > 0) {
    messages.push({ role: "user", content: userMessage });
  }

  return runWithTools(system, messages, true, onStep);
}

/**
 * Per-project lease Q&A.
 * Mirrors gemini.js chatWithLeases signature.
 */
export async function chatWithLeases(leaseTexts, userMessage, chatHistory = [], useSearch = false, persona) {
  const leaseContext = leaseTexts
    .map((l, i) => `\n--- LEASE ${i + 1}: ${l.tenantName} (Suite ${l.suiteNumber}) ---\n${l.text}\n`)
    .join("\n");

  const system = `${buildLeaseChatSystemPrompt(useSearch, persona)}\n\nYou have access to ${leaseTexts.length} lease(s) for this property:\n${leaseContext}`;

  const messages = [];

  if (chatHistory.length === 0) {
    messages.push({ role: "user", content: userMessage });
  } else {
    messages.push({ role: "user", content: chatHistory[0].content });
    for (let i = 1; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }
    messages.push({ role: "user", content: userMessage });
  }

  return runWithTools(system, messages, useSearch);
}

/**
 * Cross-portfolio Q&A.
 * Mirrors gemini.js chatCrossPortfolio signature.
 */
export async function chatCrossPortfolio(leaseSummaries, userMessage, chatHistory = [], useSearch = false, persona) {
  const summaryContext = leaseSummaries
    .map((l, i) =>
      `Lease ${i + 1}: ${l.tenantName} | Suite ${l.suiteNumber} | ${l.propertyAddress} | ` +
      `${l.leaseStartDate || "?"} to ${l.leaseEndDate || "?"} | ` +
      `$${l.monthlyRent?.toLocaleString() || "?"}/mo | ${l.squareFootage || "?"}sqft | ` +
      `Renewal: ${l.renewalOptions || "N/A"} | Notes: ${l.specialProvisions || "N/A"}`
    )
    .join("\n");

  const system = `${buildLeaseChatSystemPrompt(useSearch, persona)}

You have summary data for ${leaseSummaries.length} leases across the entire portfolio:

${summaryContext}

Answer questions using this portfolio data. If you need the full lease text to answer accurately, say so.`;

  const messages = [];

  if (chatHistory.length === 0) {
    messages.push({ role: "user", content: userMessage });
  } else {
    messages.push({ role: "user", content: chatHistory[0].content });
    for (let i = 1; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }
    messages.push({ role: "user", content: userMessage });
  }

  return runWithTools(system, messages, useSearch);
}
