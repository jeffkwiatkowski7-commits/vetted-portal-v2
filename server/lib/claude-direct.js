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
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null, onStep = null, modelOverride = null, { claudeTools = [], mcpToolMap = {}, mcpManager = null, images = [] } = {}) {
  const textDocs = docs.filter((d) => d.text !== undefined);
  const pdfDocs = docs.filter((d) => d.base64 !== undefined);

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

  // Attach PDFs as document blocks
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
    const response = await client.messages.create(params);

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
  const finalResponse = await client.messages.create(params);
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
