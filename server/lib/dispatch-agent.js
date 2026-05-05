import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbRun, getDatabase } from '../database.js';
import { chatWithDocuments as claudeChatWithDocuments } from './claude-direct.js';
import { chatWithDocuments as geminiChatWithDocuments } from './gemini.js';
import { queryProject, formatRetrievedContext } from './rag.js';
import mcpManager from './mcp-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

const RUN_TIMEOUT_MS = parseInt(process.env.AGENT_RUN_TIMEOUT_MS || '300000', 10); // 5 min

function resolveFilePath(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(process.cwd(), relPath);
}

async function readLibraryFile(file) {
  const filePath = resolveFilePath(file.file_path);
  if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
    try {
      const buffer = fs.readFileSync(filePath);
      return { name: file.original_name, mimeType: 'application/pdf', base64: buffer.toString('base64') };
    } catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  } else if (file.file_type === 'docx') {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return { name: file.original_name, text: result.value };
    } catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  } else {
    try { return { name: file.original_name, text: fs.readFileSync(filePath, 'utf8') }; }
    catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  }
}

/**
 * Run one sub-agent dispatch.
 *   project: row from projects table (caller validates membership in active team)
 *   prompt: string from the orchestrator
 *   onEvent: optional callback for typed events ({type, ...payload})
 *   userId: caller's user id (for usage logging)
 *   signal: AbortSignal — propagates orchestrator stop
 *
 * Returns { run_id, final_message, duration_ms, tokens, events, error?, status }
 */
export async function runDispatch({ project, prompt, onEvent = null, userId = null, signal = null }) {
  const db = getDatabase();
  const run_id = uuidv4();
  const events = [];
  const startedAt = Date.now();
  const emit = (type, payload = {}) => {
    const event = { type, ts: new Date().toISOString(), ...payload };
    events.push(event);
    if (onEvent) try { onEvent(event); } catch (e) { /* swallow */ }
  };

  const summarize = (s, n = 200) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

  emit('started', { run_id, project_id: project.id, project_name: project.name, prompt_summary: summarize(prompt) });

  try {
    const preamble = `You are a sub-agent named "${project.name}" dispatched by an orchestrator. Use your tools and knowledge to handle the prompt below. Return ONE final assistant message — no recursion, no further dispatch. Be thorough and direct.`;
    const systemPromptOverride = `${preamble}\n\n${(project.system_prompt || '').trim()}`.trim();

    const projectFiles = dbAll(db, 'SELECT * FROM library_files WHERE project_id = ?', [project.id]);
    const docs = [];
    for (const f of projectFiles) docs.push(await readLibraryFile(f));

    let retrievedContext = '';
    try {
      const chunks = await queryProject(project.id, prompt);
      if (chunks && chunks.length > 0) retrievedContext = formatRetrievedContext(chunks);
    } catch { /* RAG is best-effort */ }
    const finalSystem = retrievedContext
      ? `${systemPromptOverride}\n\n## Retrieved Context\n${retrievedContext}`
      : systemPromptOverride;

    let mcpToolDeclarations = [];
    let mcpToolMap = {};
    let activeMcpIds = [];
    try {
      const parsed = JSON.parse(project.mcp_servers || '[]');
      activeMcpIds = Array.isArray(parsed) ? parsed : [];
    } catch { activeMcpIds = []; }
    if (activeMcpIds.length > 0) {
      const mcpServers = dbAll(db,
        `SELECT * FROM mcp_servers WHERE id IN (${activeMcpIds.map(() => '?').join(',')}) AND enabled = 1`,
        activeMcpIds,
      );
      for (const server of mcpServers) {
        try {
          const tools = await mcpManager.getTools(server);
          for (const tool of tools) {
            const prefixedName = `${server.id}__${tool.name}`;
            mcpToolMap[prefixedName] = { serverId: server.id, serverName: server.name, originalName: tool.name, serverConfig: server };
            const declaration = { name: prefixedName, description: tool.description || '' };
            if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
              declaration.parameters = {
                type: tool.inputSchema.type || 'object',
                properties: tool.inputSchema.properties || {},
              };
              if (tool.inputSchema.required) declaration.parameters.required = tool.inputSchema.required;
            }
            mcpToolDeclarations.push(declaration);
          }
        } catch (err) {
          emit('tool_call', { tool: server.name, args_summary: `failed to start: ${err.message}` });
        }
      }
    }

    const onStep = (msg) => emit('thinking', { delta: msg + '\n' });

    const timeout = setTimeout(() => {
      try { signal?.dispatchEvent?.(new Event('abort')); } catch { /* signal may be a basic AbortController.signal */ }
    }, RUN_TIMEOUT_MS);

    let result;
    try {
      const isClaudeModel = project.default_model && (project.default_model.startsWith('claude-') || project.default_model.includes('claude'));
      if (isClaudeModel) {
        const claudeTools = mcpToolDeclarations.map(decl => ({
          name: decl.name,
          description: decl.description || '',
          input_schema: {
            type: 'object',
            properties: decl.parameters?.properties || {},
            ...(decl.parameters?.required ? { required: decl.parameters.required } : {}),
          },
        }));
        result = await claudeChatWithDocuments(
          docs, prompt, [], finalSystem, userId, onStep, project.default_model,
          { claudeTools, mcpToolMap, mcpManager, builtinToolMap: {}, images: [], signal },
        );
      } else {
        const geminiTools = mcpToolDeclarations.length > 0
          ? [{ functionDeclarations: mcpToolDeclarations }]
          : [];
        result = await geminiChatWithDocuments(
          docs, prompt, [], finalSystem, userId, onStep, project.default_model, geminiTools, [], signal,
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    const final_message = (result?.text || '').trim();
    emit('text', { delta: final_message });
    const duration_ms = Date.now() - startedAt;
    const tokens = { input: result?.usage?.input_tokens || 0, output: result?.usage?.output_tokens || 0 };
    emit('finished', { final_message, duration_ms, tokens });

    return { run_id, project_id: project.id, project_name: project.name, prompt, final_message, events, duration_ms, tokens, error: null, status: 'done' };
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || err?.message === 'aborted' || signal?.aborted;
    const duration_ms = Date.now() - startedAt;
    const errMsg = isAbort ? 'cancelled' : (err?.message || 'unknown error');
    emit('finished', { final_message: '', duration_ms, tokens: { input: 0, output: 0 }, error: errMsg });
    return {
      run_id, project_id: project.id, project_name: project.name, prompt,
      final_message: '', events, duration_ms, tokens: { input: 0, output: 0 },
      error: errMsg, status: isAbort ? 'cancelled' : 'error',
    };
  }
}

/**
 * Persist a completed run as a `messages` row with kind="agent_run".
 */
export function persistAgentRun(db, chatId, run) {
  const msgId = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at, kind)
    VALUES (?, ?, 'assistant', ?, ?, ?, NULL, NULL, NULL, ?, 'agent_run')
  `, [
    msgId, chatId, JSON.stringify(run),
    null,
    (run.tokens?.input || 0) + (run.tokens?.output || 0),
    now,
  ]);
  return msgId;
}
