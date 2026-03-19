import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

import { initializeDatabase, getDatabase, dbGet, dbAll, dbRun } from './database.js';
import { getMockResponse } from './mock-responses.js';
import { seedDatabase } from './seed.js';
import leaseRoutes from './lease-routes.js';
import { chatWithDocuments } from './lib/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// In-memory error ring buffer
const errorLog = [];
const ERROR_LOG_MAX = 100;
let errorCounter = 0;

function pushError(entry) {
  errorLog.unshift({ id: ++errorCounter, ...entry });
  if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
}

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Initialize database on startup
let db;
try {
  // Initialize database
  db = await initializeDatabase();

  // Check if database needs seeding
  const userCount = dbGet(db, 'SELECT COUNT(*) as count FROM users');
  if (!userCount || userCount.count === 0) {
    await seedDatabase();
    db = getDatabase();
    console.log('Database initialized and seeded');
  } else {
    console.log('Database already seeded, skipping seed process');
  }
} catch (error) {
  console.error('Database initialization error:', error);
  process.exit(1);
}

// Helper function to get current user (demo - from header)
function getCurrentUserId(req) {
  return req.headers['x-user-id'] || req.query.userId;
}

function getCurrentUser(req) {
  const userId = getCurrentUserId(req);
  if (!userId) {
    return null;
  }
  return dbGet(db, 'SELECT * FROM users WHERE id = ?', [userId]);
}

// Middleware to check authentication
const _lastLoginUpdate = new Map(); // userId → timestamp, throttle to 1/hour
function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  // Refresh last_login_at at most once per hour per user
  const now = Date.now();
  const last = _lastLoginUpdate.get(user.id) || 0;
  if (now - last > 3_600_000) {
    _lastLoginUpdate.set(user.id, now);
    dbRun(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
  }
  next();
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [email]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'User account is not active' });
  }

  // Update last login
  dbRun(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      avatar_path: user.avatar_path
    }
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      display_name: req.user.display_name,
      job_title: req.user.job_title,
      department: req.user.department,
      role: req.user.role,
      avatar_path: req.user.avatar_path,
      status: req.user.status
    }
  });
});

// ============================================================================
// CHAT ROUTES
// ============================================================================

app.get('/api/chats', requireAuth, (req, res) => {
  const chats = dbAll(db, `
    SELECT
      c.id, c.user_id, c.project_id, c.title, c.model, c.temperature,
      c.system_prompt, c.is_shared, c.created_at, c.updated_at,
      COUNT(m.id) as message_count
    FROM chats c
    LEFT JOIN messages m ON c.id = m.chat_id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `, [req.user.id]);

  res.json({ chats });
});

app.post('/api/chats', requireAuth, (req, res) => {
  const { title, model, project_id, system_prompt, temperature } = req.body;

  const chatId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO chats (id, user_id, project_id, title, model, temperature, system_prompt, is_shared, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    chatId,
    req.user.id,
    project_id || null,
    title || 'New Chat',
    model || 'claude-opus',
    temperature || 0.7,
    system_prompt || null,
    0,
    now,
    now
  ]);

  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ?', [chatId]);
  res.status(201).json({ chat });
});

app.get('/api/chats/:id', requireAuth, (req, res) => {
  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const messages = dbAll(db, 'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [req.params.id]);

  // Parse reasoning if it exists
  const messagesWithParsedReasoning = messages.map(m => ({
    ...m,
    reasoning: m.reasoning ? JSON.parse(m.reasoning) : null,
    attachments: m.attachments ? JSON.parse(m.attachments) : null
  }));

  res.json({ chat, messages: messagesWithParsedReasoning });
});

app.put('/api/chats/:id', requireAuth, (req, res) => {
  const { title, model, temperature, system_prompt } = req.body;

  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE chats
    SET title = ?, model = ?, temperature = ?, system_prompt = ?, updated_at = ?
    WHERE id = ?
  `, [
    title !== undefined ? title : chat.title,
    model !== undefined ? model : chat.model,
    temperature !== undefined ? temperature : chat.temperature,
    system_prompt !== undefined ? system_prompt : chat.system_prompt,
    now,
    req.params.id
  ]);

  const updatedChat = dbGet(db, 'SELECT * FROM chats WHERE id = ?', [req.params.id]);
  res.json({ chat: updatedChat });
});

app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  dbRun(db, 'DELETE FROM messages WHERE chat_id = ?', [req.params.id]);
  dbRun(db, 'DELETE FROM chats WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.post('/api/chats/:id/messages', requireAuth, async (req, res) => {
  const { content, attachments } = req.body;

  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  // Use SSE to stream steps as they happen
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const now = new Date().toISOString();

  // Save user message
  const userMessageId = uuidv4();
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userMessageId,
    req.params.id,
    'user',
    content,
    chat.model,
    Math.ceil(content.split(/\s+/).length * 1.3),
    null,
    attachments ? JSON.stringify(attachments) : null,
    now
  ]);

  let aiContent;
  let aiReasoning = null;
  const steps = [];
  const step = (msg) => {
    const ts = new Date().toISOString();
    steps.push({ message: msg, ts });
    sendEvent({ type: 'step', message: msg, ts });
  };

  // Load project context if this chat belongs to a project
  const project = chat.project_id
    ? dbGet(db, 'SELECT * FROM projects WHERE id = ?', [chat.project_id])
    : null;

  // Helper: read a library file from disk.
  // PDFs → { name, mimeType, base64 } for native Gemini vision.
  // Other files → { name, text }.
  async function readLibraryFile(file) {
    const filePath = path.join(__dirname, '..', file.file_path);
    if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
      try {
        const buffer = fs.readFileSync(filePath);
        return { name: file.original_name, mimeType: 'application/pdf', base64: buffer.toString('base64') };
      } catch {
        return { name: file.original_name, text: `[Could not read ${file.original_name}]` };
      }
    } else {
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        return { name: file.original_name, text };
      } catch {
        return { name: file.original_name, text: `[Could not read ${file.original_name}]` };
      }
    }
  }

  try {
    const docs = [];

    // 1. Load project files
    if (project) {
      step(`Loading project: ${project.name}`);
      const projectFiles = dbAll(db, 'SELECT * FROM library_files WHERE project_id = ?', [project.id]);
      if (projectFiles.length > 0) {
        step(`Reading ${projectFiles.length} project file${projectFiles.length !== 1 ? 's' : ''}`);
        for (const file of projectFiles) docs.push(await readLibraryFile(file));
      }
    }

    // 2. Load per-message attachments (deduplicate against project files)
    if (attachments && attachments.length > 0) {
      step(`Reading ${attachments.length} attached file${attachments.length !== 1 ? 's' : ''}`);
      const projectFileIds = project
        ? new Set(dbAll(db, 'SELECT id FROM library_files WHERE project_id = ?', [project.id]).map(f => f.id))
        : new Set();
      for (const fileId of attachments) {
        if (projectFileIds.has(fileId)) continue;
        const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [fileId]);
        if (!file) continue;
        docs.push(await readLibraryFile(file));
      }
    }

    // 3. Build system prompt: project overrides global when present; global is fallback only
    const globalPrompt = dbGet(db, `SELECT prompt_text FROM system_prompts WHERE scope = 'global' AND status = 'active' LIMIT 1`);
    const hasProjectPrompt = !!project?.system_prompt?.trim();
    const basePrompt = hasProjectPrompt ? null : (globalPrompt?.prompt_text?.trim() || null);

    if (basePrompt) step('Applying global system prompt');

    const now2 = new Date();
    const contextHeader = [
      `**User:** ${req.user.display_name || req.user.email}`,
      `**Date:** ${now2.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      `**Time:** ${now2.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`,
    ].join('  \n');

    const parts = [];
    if (basePrompt) parts.push(basePrompt);

    // Project system prompt replaces global when present
    if (hasProjectPrompt) {
      step('Applying project system prompt');
      parts.push(project.system_prompt.trim());
    }

    // Tool sets
    if (project) {
      const rawToolSets = project.tool_sets;
      let toolSetIds = [];
      try {
        const parsed = Array.isArray(rawToolSets) ? rawToolSets : JSON.parse(rawToolSets || '[]');
        toolSetIds = Array.isArray(parsed) ? parsed : [];
      } catch { toolSetIds = []; }
      if (toolSetIds.length > 0) {
        const toolSets = dbAll(db,
          `SELECT name, description, tools FROM tool_sets WHERE id IN (${toolSetIds.map(() => '?').join(',')})`,
          toolSetIds
        );
        if (toolSets.length > 0) {
          step(`Loading ${toolSets.length} tool set${toolSets.length !== 1 ? 's' : ''}: ${toolSets.map(t => t.name).join(', ')}`);
          const toolBlock = toolSets.map(ts => {
            const tools = ts.tools ? JSON.parse(ts.tools) : [];
            return `**${ts.name}**: ${ts.description || ''}\nTools: ${tools.join(', ')}`;
          }).join('\n\n');
          parts.push(`## Available Tools\n\n${toolBlock}`);
        }
      }
    }

    // Always append context (user + date/time) at the end so model always sees it
    parts.push(`## Session Context\n\n${contextHeader}`);

    const systemPromptOverride = parts.join('\n\n');

    // 4. Load chat history
    const history = dbAll(db, `
      SELECT role, content FROM messages
      WHERE chat_id = ? AND id != ?
      ORDER BY created_at ASC
    `, [req.params.id, userMessageId]).map(m => ({ role: m.role, content: m.content }));

    if (history.length > 0) step(`Loaded ${history.length} previous message${history.length !== 1 ? 's' : ''}`);
    if (docs.length > 0) step(`Building prompt with ${docs.length} document${docs.length !== 1 ? 's' : ''}`);
    step('Calling Gemini');

    const result = await chatWithDocuments(docs, content, history, systemPromptOverride);
    aiContent = result.text;

    console.log('[chat] aiContent length:', aiContent.length);
    console.log('[chat] aiContent preview (first 500):', aiContent.slice(0, 500));
    console.log('[chat] aiContent tail (last 200):', aiContent.slice(-200));

    if (result.searchQueries?.length > 0) {
      result.searchQueries.forEach(q => step(`Web search: "${q}"`));
    }
    step('Response received');
  } catch (err) {
    console.error('[chat] Gemini error:', err.message);
    const msg = err.message || '';
    if (msg.includes('invalid_grant') || msg.includes('invalid_rapt') || msg.includes('reauth') || msg.includes('Unable to authenticate')) {
      aiContent = 'The AI service credentials have expired. Please ask your administrator to run `gcloud auth application-default login` on the server and restart the backend.';
    } else if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('429')) {
      aiContent = 'The AI service is temporarily rate-limited. Please wait a moment and try again.';
    } else if (msg.includes('not found') || msg.includes('404')) {
      aiContent = 'The AI model is not available in this environment. Please contact your administrator.';
    } else {
      aiContent = 'Sorry, I was unable to generate a response. Please try again.';
    }
  }

  // Save AI message
  const aiMessageId = uuidv4();
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    aiMessageId,
    req.params.id,
    'assistant',
    aiContent,
    chat.model,
    Math.ceil(aiContent.split(/\s+/).length * 1.3),
    aiReasoning ? JSON.stringify(aiReasoning) : null,
    null,
    now
  ]);

  // Update chat updated_at
  dbRun(db, 'UPDATE chats SET updated_at = ? WHERE id = ?', [now, req.params.id]);

  sendEvent({
    type: 'done',
    messages: [
      { id: userMessageId, role: 'user', content, model_used: chat.model, created_at: now },
      { id: aiMessageId, role: 'assistant', content: aiContent, model_used: chat.model, reasoning: aiReasoning, steps: steps.map(s => s.message), created_at: now }
    ],
    timing: {
      processing_time_ms: 1200 + Math.random() * 800,
      tokens_generated: Math.ceil(aiContent.split(/\s+/).length * 1.3),
      response_time_ms: 2400 + Math.random() * 1200
    }
  });
  res.end();
});

app.post('/api/chats/:id/share', requireAuth, (req, res) => {
  const { shared_with, permission } = req.body;

  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const shareId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO chat_shares (id, chat_id, shared_by, shared_with, permission, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [shareId, req.params.id, req.user.id, shared_with, permission || 'view', now]);

  res.status(201).json({
    share: {
      id: shareId,
      chat_id: req.params.id,
      shared_by: req.user.id,
      shared_with,
      permission: permission || 'view',
      created_at: now
    }
  });
});

app.get('/api/chats/shared/with-me', requireAuth, (req, res) => {
  const sharedChats = dbAll(db, `
    SELECT
      c.*,
      cs.shared_by,
      cs.permission,
      u.display_name as shared_by_name
    FROM chat_shares cs
    JOIN chats c ON cs.chat_id = c.id
    JOIN users u ON cs.shared_by = u.id
    WHERE cs.shared_with = ?
    ORDER BY cs.created_at DESC
  `, [req.user.id]);

  res.json({ chats: sharedChats });
});

// ============================================================================
// PROJECT ROUTES
// ============================================================================

app.get('/api/projects', requireAuth, (req, res) => {
  const projects = dbAll(db, `
    SELECT DISTINCT p.* FROM projects p
    WHERE p.owner_id = ? OR p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
    )
    ORDER BY p.updated_at DESC
  `, [req.user.id, req.user.id]);

  const result = projects.map(p => ({
    ...p,
    tool_sets: p.tool_sets ? JSON.parse(p.tool_sets) : []
  }));

  res.json({ projects: result });
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, description, default_model, system_prompt, temperature, tool_sets } = req.body;

  const projectId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO projects (id, owner_id, name, description, default_model, system_prompt, temperature, tool_sets, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    projectId,
    req.user.id,
    name,
    description || null,
    default_model || 'claude-opus',
    system_prompt || null,
    temperature || 0.7,
    tool_sets ? JSON.stringify(tool_sets) : JSON.stringify([]),
    'active',
    now,
    now
  ]);

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  res.status(201).json({ project });
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const members = dbAll(db, 'SELECT * FROM project_members WHERE project_id = ?', [req.params.id]);

  res.json({
    project: {
      ...project,
      tool_sets: project.tool_sets ? JSON.parse(project.tool_sets) : []
    },
    members
  });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, description, default_model, system_prompt, temperature, tool_sets } = req.body;

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found or not authorized' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE projects
    SET name = ?, description = ?, default_model = ?, system_prompt = ?, temperature = ?, tool_sets = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : project.name,
    description !== undefined ? description : project.description,
    default_model !== undefined ? default_model : project.default_model,
    system_prompt !== undefined ? system_prompt : project.system_prompt,
    temperature !== undefined ? temperature : project.temperature,
    tool_sets !== undefined ? JSON.stringify(tool_sets) : project.tool_sets,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  res.json({ project: updated });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);

  if (!project) {
    return res.status(404).json({ error: 'Project not found or not authorized' });
  }

  dbRun(db, 'DELETE FROM project_members WHERE project_id = ?', [req.params.id]);
  dbRun(db, 'DELETE FROM projects WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.post('/api/projects/:id/members', requireAuth, (req, res) => {
  const { user_id, permission } = req.body;

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found or not authorized' });
  }

  const memberId = uuidv4();
  const now = new Date().toISOString();

  try {
    dbRun(db, `
      INSERT INTO project_members (id, project_id, user_id, permission, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [memberId, req.params.id, user_id, permission || 'viewer', now]);

    res.status(201).json({
      member: {
        id: memberId,
        project_id: req.params.id,
        user_id,
        permission: permission || 'viewer',
        created_at: now
      }
    });
  } catch (error) {
    res.status(400).json({ error: 'Member already exists or invalid user' });
  }
});

app.delete('/api/projects/:id/members/:userId', requireAuth, (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);

  if (!project) {
    return res.status(404).json({ error: 'Project not found or not authorized' });
  }

  dbRun(db, 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);

  res.json({ success: true });
});

// ============================================================================
// LIBRARY ROUTES
// ============================================================================

app.get('/api/library', requireAuth, (req, res) => {
  const { project_id } = req.query;
  const files = project_id
    ? dbAll(db, 'SELECT * FROM library_files WHERE user_id = ? AND project_id = ? ORDER BY uploaded_at DESC', [req.user.id, project_id])
    : dbAll(db, 'SELECT * FROM library_files WHERE user_id = ? ORDER BY uploaded_at DESC', [req.user.id]);

  res.json({ files });
});

app.post('/api/library/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { project_id } = req.body;
  const fileId = uuidv4();
  const now = new Date().toISOString();
  const stats = fs.statSync(req.file.path);

  dbRun(db, `
    INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, project_id, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    fileId,
    req.user.id,
    req.file.filename,
    req.file.originalname,
    `/uploads/${req.file.filename}`,
    req.file.originalname.split('.').pop(),
    stats.size,
    req.file.mimetype,
    project_id || null,
    now
  ]);

  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [fileId]);
  res.status(201).json({ file });
});

app.get('/api/library/:id/download', requireAuth, (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(__dirname, '..', file.file_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.original_name);
});

app.put('/api/library/:id', requireAuth, (req, res) => {
  const { original_name, project_id } = req.body;

  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  dbRun(db, 'UPDATE library_files SET original_name = ?, project_id = ? WHERE id = ?', [
    original_name || file.original_name,
    project_id !== undefined ? project_id : file.project_id,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [req.params.id]);
  res.json({ file: updated });
});

app.delete('/api/library/:id', requireAuth, (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(__dirname, '..', file.file_path);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  dbRun(db, 'DELETE FROM library_files WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.get('/api/library/stats', requireAuth, (req, res) => {
  const stats = dbGet(db, `
    SELECT
      COUNT(*) as total_files,
      SUM(file_size) as total_size,
      COUNT(DISTINCT file_type) as file_types
    FROM library_files
    WHERE user_id = ?
  `, [req.user.id]);

  res.json({ stats });
});

// ============================================================================
// APPS ROUTES
// ============================================================================

app.get('/api/apps', (req, res) => {
  const apps = dbAll(db, 'SELECT * FROM apps WHERE status = ? ORDER BY usage_count DESC', ['active']);

  const result = apps.map(app => ({
    ...app,
    tool_sets: app.tool_sets ? JSON.parse(app.tool_sets) : []
  }));

  res.json({ apps: result });
});

app.post('/api/apps', requireAuth, (req, res) => {
  const { name, description, icon, category, system_prompt, model, temperature, tool_sets } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can create apps' });
  }

  const appId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO apps (id, name, description, icon, category, system_prompt, model, temperature, tool_sets, visibility, status, usage_count, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    appId,
    name,
    description || null,
    icon || null,
    category,
    system_prompt,
    model,
    temperature || 0.7,
    tool_sets ? JSON.stringify(tool_sets) : JSON.stringify([]),
    'all',
    'active',
    0,
    req.user.id,
    now,
    now
  ]);

  const app = dbGet(db, 'SELECT * FROM apps WHERE id = ?', [appId]);
  res.status(201).json({ app });
});

app.put('/api/apps/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can update apps' });
  }

  const { name, description, icon, category, system_prompt, model, temperature, tool_sets } = req.body;

  const app = dbGet(db, 'SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) {
    return res.status(404).json({ error: 'App not found' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE apps
    SET name = ?, description = ?, icon = ?, category = ?, system_prompt = ?, model = ?, temperature = ?, tool_sets = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : app.name,
    description !== undefined ? description : app.description,
    icon !== undefined ? icon : app.icon,
    category !== undefined ? category : app.category,
    system_prompt !== undefined ? system_prompt : app.system_prompt,
    model !== undefined ? model : app.model,
    temperature !== undefined ? temperature : app.temperature,
    tool_sets !== undefined ? JSON.stringify(tool_sets) : app.tool_sets,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM apps WHERE id = ?', [req.params.id]);
  res.json({ app: updated });
});

app.delete('/api/apps/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can delete apps' });
  }

  const app = dbGet(db, 'SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) {
    return res.status(404).json({ error: 'App not found' });
  }

  dbRun(db, 'DELETE FROM apps WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.get('/api/apps/categories', (req, res) => {
  const categories = dbAll(db, 'SELECT * FROM app_categories ORDER BY name ASC');

  res.json({ categories });
});

// ============================================================================
// ADMIN ROUTES
// ============================================================================

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const userCount = dbGet(db, 'SELECT COUNT(*) as count FROM users WHERE status = ?', ['active']);
  const chatCount = dbGet(db, 'SELECT COUNT(*) as count FROM chats');
  const projectCount = dbGet(db, 'SELECT COUNT(*) as count FROM projects');
  const messageCount = dbGet(db, 'SELECT COUNT(*) as count FROM messages');
  const toolSetCount = dbGet(db, 'SELECT COUNT(*) as count FROM tool_sets');
  const modelCount = dbGet(db, 'SELECT COUNT(*) as count FROM model_configs');
  const promptCount = dbGet(db, 'SELECT COUNT(*) as count FROM system_prompts');
  const today = new Date().toISOString().split('T')[0];
  const activeTodayCount = dbGet(db, "SELECT COUNT(*) as count FROM users WHERE last_login_at >= ?", [today]);
  const libraryFileCount = dbGet(db, 'SELECT COUNT(*) as count FROM library_files');

  res.json({
    stats: {
      total_users: userCount.count,
      active_users: userCount.count,
      active_today: activeTodayCount.count,
      total_chats: chatCount.count,
      total_projects: projectCount.count,
      total_messages: messageCount.count,
      tool_sets: toolSetCount.count,
      models: modelCount.count,
      system_prompts: promptCount.count,
      total_library_files: libraryFileCount.count,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = dbAll(db, 'SELECT id, email, display_name, job_title, department, role, status, created_at, last_login_at FROM users ORDER BY created_at DESC');

  res.json({ users });
});

app.put('/api/admin/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body;

  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  dbRun(db, 'UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);

  const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.json({ user });
});

app.put('/api/admin/users/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;

  if (!['active', 'inactive', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  dbRun(db, 'UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);

  const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.json({ user });
});

app.get('/api/admin/tool-sets', requireAuth, requireAdmin, (req, res) => {
  const toolSets = dbAll(db, 'SELECT * FROM tool_sets ORDER BY created_at DESC');

  const result = toolSets.map(ts => ({
    ...ts,
    tools: ts.tools ? JSON.parse(ts.tools) : [],
    api_config: ts.api_config ? JSON.parse(ts.api_config) : {}
  }));

  res.json({ tool_sets: result });
});

app.post('/api/admin/tool-sets', requireAuth, requireAdmin, (req, res) => {
  const { name, description, tools, api_config } = req.body;

  const toolSetId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO tool_sets (id, name, description, tools, api_config, status, usage_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    toolSetId,
    name,
    description || null,
    JSON.stringify(tools || []),
    api_config ? JSON.stringify(api_config) : null,
    'active',
    0,
    now,
    now
  ]);

  const toolSet = dbGet(db, 'SELECT * FROM tool_sets WHERE id = ?', [toolSetId]);
  res.status(201).json({ tool_set: toolSet });
});

app.put('/api/admin/tool-sets/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, description, tools, api_config } = req.body;

  const toolSet = dbGet(db, 'SELECT * FROM tool_sets WHERE id = ?', [req.params.id]);
  if (!toolSet) {
    return res.status(404).json({ error: 'Tool set not found' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE tool_sets
    SET name = ?, description = ?, tools = ?, api_config = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : toolSet.name,
    description !== undefined ? description : toolSet.description,
    tools !== undefined ? JSON.stringify(tools) : toolSet.tools,
    api_config !== undefined ? JSON.stringify(api_config) : toolSet.api_config,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM tool_sets WHERE id = ?', [req.params.id]);
  res.json({ tool_set: updated });
});

app.delete('/api/admin/tool-sets/:id', requireAuth, requireAdmin, (req, res) => {
  const toolSet = dbGet(db, 'SELECT * FROM tool_sets WHERE id = ?', [req.params.id]);

  if (!toolSet) {
    return res.status(404).json({ error: 'Tool set not found' });
  }

  dbRun(db, 'DELETE FROM tool_sets WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.get('/api/admin/models', requireAuth, requireAdmin, (req, res) => {
  const models = dbAll(db, 'SELECT * FROM model_configs ORDER BY display_name ASC');

  res.json({ models });
});

app.put('/api/admin/models/:id', requireAuth, requireAdmin, (req, res) => {
  const { is_enabled, is_default, max_tokens, rate_limit, display_name, model_name, provider, icon_color } = req.body;

  const model = dbGet(db, 'SELECT * FROM model_configs WHERE id = ?', [req.params.id]);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE model_configs
    SET is_enabled = ?, is_default = ?, max_tokens = ?, rate_limit = ?, display_name = ?, model_name = ?, provider = ?, icon_color = ?, updated_at = ?
    WHERE id = ?
  `, [
    is_enabled !== undefined ? is_enabled : model.is_enabled,
    is_default !== undefined ? is_default : model.is_default,
    max_tokens !== undefined ? max_tokens : model.max_tokens,
    rate_limit !== undefined ? rate_limit : model.rate_limit,
    display_name !== undefined ? display_name : model.display_name,
    model_name !== undefined ? model_name : model.model_name,
    provider !== undefined ? provider : model.provider,
    icon_color !== undefined ? icon_color : model.icon_color,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM model_configs WHERE id = ?', [req.params.id]);
  res.json({ model: updated });
});

app.get('/api/admin/system-prompts', requireAuth, requireAdmin, (req, res) => {
  const prompts = dbAll(db, 'SELECT * FROM system_prompts ORDER BY created_at DESC');

  res.json({ prompts });
});

app.post('/api/admin/system-prompts', requireAuth, requireAdmin, (req, res) => {
  const { name, prompt_text, scope } = req.body;

  const promptId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO system_prompts (id, name, prompt_text, scope, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [promptId, name, prompt_text, scope, 'active', now, now]);

  const prompt = dbGet(db, 'SELECT * FROM system_prompts WHERE id = ?', [promptId]);
  res.status(201).json({ prompt });
});

app.put('/api/admin/system-prompts/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, prompt_text, scope } = req.body;

  const prompt = dbGet(db, 'SELECT * FROM system_prompts WHERE id = ?', [req.params.id]);
  if (!prompt) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE system_prompts
    SET name = ?, prompt_text = ?, scope = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : prompt.name,
    prompt_text !== undefined ? prompt_text : prompt.prompt_text,
    scope !== undefined ? scope : prompt.scope,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM system_prompts WHERE id = ?', [req.params.id]);
  res.json({ prompt: updated });
});

app.delete('/api/admin/system-prompts/:id', requireAuth, requireAdmin, (req, res) => {
  const prompt = dbGet(db, 'SELECT * FROM system_prompts WHERE id = ?', [req.params.id]);
  if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
  if (prompt.scope === 'global') return res.status(400).json({ error: 'Cannot delete the global default prompt' });
  dbRun(db, 'DELETE FROM system_prompts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
  res.json({ errors: errorLog });
});

app.post('/api/admin/client-errors', requireAuth, (req, res) => {
  const { message, stack, url, userAgent } = req.body;
  pushError({
    timestamp: new Date().toISOString(),
    source: 'client',
    level: 'error',
    message: message || 'Unknown client error',
    stack,
    route: url,
    userAgent,
  });
  res.json({ ok: true });
});

// ============================================================================
// SETTINGS ROUTES
// ============================================================================

app.get('/api/settings/profile', requireAuth, (req, res) => {
  res.json({ profile: req.user });
});

app.put('/api/settings/profile', requireAuth, (req, res) => {
  const { display_name, job_title, department, avatar_path } = req.body;

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE users
    SET display_name = ?, job_title = ?, department = ?, avatar_path = ?, updated_at = ?
    WHERE id = ?
  `, [
    display_name !== undefined ? display_name : req.user.display_name,
    job_title !== undefined ? job_title : req.user.job_title,
    department !== undefined ? department : req.user.department,
    avatar_path !== undefined ? avatar_path : req.user.avatar_path,
    now,
    req.user.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ profile: updated });
});

app.get('/api/settings/preferences', requireAuth, (req, res) => {
  const prefs = dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);

  if (!prefs) {
    // Create default preferences
    const prefId = uuidv4();
    const now = new Date().toISOString();
    dbRun(db, `
      INSERT INTO user_preferences (id, user_id, default_model, default_temperature, show_reasoning, auto_scroll, compact_view, code_theme, notify_shared_chat, notify_project_updates, notify_system, notify_weekly_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [prefId, req.user.id, 'claude-opus', 0.7, 0, 1, 0, 'light', 1, 1, 1, 0]);

    const newPrefs = dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    return res.json({ preferences: newPrefs });
  }

  res.json({ preferences: prefs });
});

app.put('/api/settings/preferences', requireAuth, (req, res) => {
  const { default_model, default_temperature, show_reasoning, auto_scroll, compact_view, code_theme, notify_shared_chat, notify_project_updates, notify_system, notify_weekly_summary } = req.body;

  let prefs = dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);

  if (!prefs) {
    // Create default preferences first
    const prefId = uuidv4();
    dbRun(db, `
      INSERT INTO user_preferences (id, user_id, default_model, default_temperature, show_reasoning, auto_scroll, compact_view, code_theme, notify_shared_chat, notify_project_updates, notify_system, notify_weekly_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [prefId, req.user.id, 'claude-opus', 0.7, 0, 1, 0, 'light', 1, 1, 1, 0]);

    prefs = dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
  }

  dbRun(db, `
    UPDATE user_preferences
    SET default_model = ?, default_temperature = ?, show_reasoning = ?, auto_scroll = ?, compact_view = ?, code_theme = ?, notify_shared_chat = ?, notify_project_updates = ?, notify_system = ?, notify_weekly_summary = ?
    WHERE user_id = ?
  `, [
    default_model !== undefined ? default_model : prefs.default_model,
    default_temperature !== undefined ? default_temperature : prefs.default_temperature,
    show_reasoning !== undefined ? show_reasoning : prefs.show_reasoning,
    auto_scroll !== undefined ? auto_scroll : prefs.auto_scroll,
    compact_view !== undefined ? compact_view : prefs.compact_view,
    code_theme !== undefined ? code_theme : prefs.code_theme,
    notify_shared_chat !== undefined ? notify_shared_chat : prefs.notify_shared_chat,
    notify_project_updates !== undefined ? notify_project_updates : prefs.notify_project_updates,
    notify_system !== undefined ? notify_system : prefs.notify_system,
    notify_weekly_summary !== undefined ? notify_weekly_summary : prefs.notify_weekly_summary,
    req.user.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
  res.json({ preferences: updated });
});

app.get('/api/settings/api-keys', requireAuth, (req, res) => {
  const keys = dbAll(db, 'SELECT id, name, key_preview, permissions, expires_at, status, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);

  res.json({ api_keys: keys });
});

app.post('/api/settings/api-keys', requireAuth, (req, res) => {
  const { name, permissions, expires_at } = req.body;

  const keyId = uuidv4();
  const rawKey = uuidv4() + '-' + uuidv4();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPreview = rawKey.substring(0, 8) + '...';
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO api_keys (id, user_id, name, key_hash, key_preview, permissions, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    keyId,
    req.user.id,
    name,
    keyHash,
    keyPreview,
    JSON.stringify(permissions || []),
    expires_at || null,
    'active',
    now
  ]);

  res.status(201).json({
    api_key: {
      id: keyId,
      name,
      key: rawKey,
      key_preview: keyPreview,
      permissions: permissions || [],
      expires_at: expires_at || null,
      created_at: now
    }
  });
});

app.delete('/api/settings/api-keys/:id', requireAuth, (req, res) => {
  const key = dbGet(db, 'SELECT * FROM api_keys WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!key) {
    return res.status(404).json({ error: 'API key not found' });
  }

  dbRun(db, 'DELETE FROM api_keys WHERE id = ?', [req.params.id]);

  res.json({ success: true });
});

app.get('/api/settings/sessions', requireAuth, (req, res) => {
  const sessions = dbAll(db, 'SELECT id, token, expires_at, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);

  res.json({ sessions });
});

// ============================================================================
// LEASE ROUTES (Firestore + Gemini integration from cbre_leases)
// ============================================================================

app.use('/api', leaseRoutes);

// ============================================================================
// SEARCH ROUTES
// ============================================================================

app.get('/api/search', requireAuth, (req, res) => {
  const query = req.query.q || '';

  if (query.length < 2) {
    return res.json({ results: [] });
  }

  const searchTerm = `%${query}%`;

  const chatResults = dbAll(db, 'SELECT id, title, user_id FROM chats WHERE user_id = ? AND (title LIKE ? OR id LIKE ?) LIMIT 5', [req.user.id, searchTerm, searchTerm]);

  const projectResults = dbAll(db, `
    SELECT p.id, p.name, p.owner_id
    FROM projects p
    WHERE (p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?))
    AND (p.name LIKE ? OR p.description LIKE ?)
    LIMIT 5
  `, [req.user.id, req.user.id, searchTerm, searchTerm]);

  const fileResults = dbAll(db, 'SELECT id, original_name, user_id FROM library_files WHERE user_id = ? AND original_name LIKE ? LIMIT 5', [req.user.id, searchTerm]);

  const appResults = dbAll(db, 'SELECT id, name, category FROM apps WHERE status = ? AND (name LIKE ? OR description LIKE ?) LIMIT 5', ['active', searchTerm, searchTerm]);

  res.json({
    results: {
      chats: chatResults.map(c => ({ type: 'chat', ...c })),
      projects: projectResults.map(p => ({ type: 'project', ...p })),
      files: fileResults.map(f => ({ type: 'file', ...f })),
      apps: appResults.map(a => ({ type: 'app', ...a }))
    }
  });
});

// ============================================================================
// NOTIFICATIONS ROUTES
// ============================================================================

app.get('/api/notifications', requireAuth, (req, res) => {
  const notifications = dbAll(db, 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);

  res.json({ notifications });
});

app.put('/api/notifications/:id/read', requireAuth, (req, res) => {
  const notification = dbGet(db, 'SELECT * FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  dbRun(db, 'UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);

  const updated = dbGet(db, 'SELECT * FROM notifications WHERE id = ?', [req.params.id]);
  res.json({ notification: updated });
});

app.put('/api/notifications/read-all', requireAuth, (req, res) => {
  dbRun(db, 'UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);

  res.json({ success: true });
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

if (NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: err.message || 'Internal server error',
    stack: err.stack,
    route: req.path,
  });
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

process.on('uncaughtException', (err) => {
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: err.message,
    stack: err.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: String(reason),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${NODE_ENV} mode)`);
  console.log(`API available at http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

export default app;
