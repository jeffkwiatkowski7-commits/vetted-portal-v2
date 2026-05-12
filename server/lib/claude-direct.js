/**
 * Claude via direct Anthropic API — uses @anthropic-ai/sdk with Opus_API_KEY.
 * For use when the user selects Claude Opus 4.6 from the model picker.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, getDatabase } from "../database.js";
import { hasTavily, tavilySearch } from "./tavily.js";

const MAX_TOKENS = 8192;
const MAX_TOOL_ITERATIONS = 10;

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.Opus_API_KEY;
    if (!apiKey) throw new Error("Opus_API_KEY not set in .env");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * General document Q&A / project chat via Claude direct API.
 * Supports MCP tools via the mcpToolMap + mcpManager passed from the caller.
 */
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null, modelOverride = null, { claudeTools = [], mcpToolMap = {}, mcpManager = null, builtinToolMap = {}, images = [], signal = null } = {}) {
  let textDocs = docs.filter((d) => d.text !== undefined);
  let pdfDocs = docs.filter((d) => d.base64 !== undefined && d.mimeType === "application/pdf");

  // Claude API has a 100-page PDF limit.
  // When multiple PDFs exist, only send query-relevant ones as native documents;
  // use Gemini Flash to summarize the rest (Gemini has no page limit on PDFs).
  if (pdfDocs.length > 1) {
    try {
      // Check filename relevance to the user's query
      const stopWords = new Set(["the","and","for","are","but","not","you","all","can","her","was","one","our","out","about","give","tell","what","with","from","this","that","have","been","some","details","detail","info","information","please","show","list","me","lease","leases","suite","suites","document","documents","file","files","pdf","compare","summary","summarize","review","analyze","analysis"]);
      const keywords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
      const isRelevant = (name) => {
        const lower = name.toLowerCase();
        return keywords.some(kw => lower.includes(kw));
      };

      let relevant = pdfDocs.filter(d => isRelevant(d.name));
      // If all or none match, the keywords are too generic — skip filtering
      if (relevant.length === pdfDocs.length) relevant = [];
      const other = relevant.length > 0 ? pdfDocs.filter(d => !isRelevant(d.name)) : [];

      if (relevant.length > 0 && other.length > 0) {
        // Send relevant PDFs as native documents, have Gemini summarize the rest
        if (onStep) onStep(`${relevant.length} of ${pdfDocs.length} PDFs match query — summarizing ${other.length} others via Gemini`);
        console.log(`[claude-direct] Relevant PDFs: ${relevant.map(d => d.name).join(", ")}`);
        pdfDocs = relevant;

        // Use Gemini Flash to summarize non-relevant PDFs in parallel
        const { summarizePdfs } = await import("./gemini.js");
        const summaries = await summarizePdfs(other, onStep);
        textDocs.push(...summaries);
      } else if (pdfDocs.length > 0) {
        // No filename match — count pages to check if we need fallback
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
      console.error("[claude-direct] PDF filtering failed, falling back to pdf-parse text extraction:", err.message);
      // Fallback: extract text with pdf-parse
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
      } catch { /* give up, let it fail at API level */ }
    }
  }

  const docContext = textDocs.length > 0
    ? textDocs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
    : "";

  const defaultPrompt = buildDefaultSystemPrompt();
  const basePrompt = systemPromptOverride ?? defaultPrompt;
  const system = docContext
    ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
    : basePrompt;

  const messages = [];
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

  messages.push({ role: "user", content: firstContent });

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

  const client = getClient();
  const modelId = modelOverride || "claude-opus-4-20250514";

  // Build tools list: Tavily web_search + MCP tools
  const allTools = [...claudeTools];
  if (hasTavily()) {
    allTools.unshift({
      name: "web_search",
      description: "Search the web for current information. Use for market data, recent events, or anything requiring live information.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] },
    });
  }

  const params = {
    model: modelId,
    max_tokens: MAX_TOKENS,
    system,
    messages: [...messages],
  };
  if (allTools.length > 0) {
    params.tools = allTools;
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Tool-calling loop
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (signal?.aborted) throw new Error('aborted');
    let response;
    try {
      response = await client.messages.create(params, signal ? { signal } : undefined);
    } catch (err) {
      // On schema errors, dump the tool the API is complaining about so we
      // can see exactly what the offending MCP server is sending.
      const msg = err?.message || '';
      const m = msg.match(/tools\.(\d+)\.custom\.input_schema/);
      if (m && Array.isArray(params.tools)) {
        const idx = Number(m[1]);
        const bad = params.tools[idx];
        console.error(`[claude-direct] Anthropic rejected tool index ${idx}:`, JSON.stringify(bad, null, 2));
      }
      throw err;
    }

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');

    // No tool calls or model is done — return text
    if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
      const text = (response.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if ((totalInputTokens || totalOutputTokens) && userId) {
        logUsage(getDatabase(), {
          userId, source: 'chat', prompt: userMessage, model: modelId,
          inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
        });
      }

      return { text: text || 'No response generated.' };
    }

    // Execute tool calls (Tavily web_search + MCP tools)
    params.messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      if (block.name === 'web_search') {
        const query = block.input?.query || '';
        console.log('[claude-direct] web search:', query);
        if (onStep) onStep(`Web search: "${query}"`);
        const result = await tavilySearch(query);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result || 'No results found.' });
        continue;
      }
      // Built-in export tools (export_to_word / export_to_excel)
      if (builtinToolMap[block.name]) {
        try {
          const result = await builtinToolMap[block.name](block.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (err) {
          if (onStep) onStep(`${block.name} error: ${err.message}`);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}` });
        }
        continue;
      }
      const mapping = mcpToolMap[block.name];
      if (!mapping) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Error: Unknown tool' });
        continue;
      }
      if (onStep) onStep(`Calling ${mapping.serverName}: ${mapping.originalName}...`);
      try {
        const result = await mcpManager.callTool(mapping.serverConfig, mapping.originalName, block.input || {});
        if (onStep) onStep(`${mapping.originalName} returned (${result.length} chars)`);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      } catch (err) {
        if (onStep) onStep(`${mapping.originalName} error: ${err.message}`);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}` });
      }
    }

    params.messages.push({ role: 'user', content: toolResults });
  }

  // Exhausted iterations — do a final call without tools
  delete params.tools;
  if (signal?.aborted) throw new Error('aborted');
  const finalResponse = await client.messages.create(params, signal ? { signal } : undefined);
  totalInputTokens += finalResponse.usage?.input_tokens || 0;
  totalOutputTokens += finalResponse.usage?.output_tokens || 0;

  if ((totalInputTokens || totalOutputTokens) && userId) {
    logUsage(getDatabase(), {
      userId, source: 'chat', prompt: userMessage, model: modelId,
      inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
    });
  }

  const text = (finalResponse.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  return { text: text || 'No response generated.' };
}

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
