import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

import { initializeDatabase, getDatabase, dbGet, dbAll, dbRun, logUsage } from './database.js';
import { getMockResponse } from './mock-responses.js';
import { seedDatabase } from './seed.js';
import leaseRoutes from './lease-routes.js';
import { chatWithDocuments as geminiChatWithDocuments, generate as geminiGenerate, extractGroundedResponse } from './lib/gemini.js';
import { chatWithDocuments as claudeDirectChatWithDocuments } from './lib/claude-direct.js';
import bcrypt from 'bcryptjs';
import mammoth from 'mammoth';
import { indexFile, queryProject, deleteFileChunks, deleteProjectChunks, formatRetrievedContext, extractCitations, isSupportedType, extractText } from './lib/rag.js';
import { deleteFile as gcsDeleteFile, deleteProjectFiles as gcsDeleteProjectFiles, downloadFile as gcsDownload } from './lib/gcs.js';
import { chunkText, embedTexts } from './lib/embeddings.js';
import mcpManager from './lib/mcp-manager.js';
import { hasTavily, tavilySearch } from './lib/tavily.js';
import { parsePptxTemplate } from './lib/pptx-parser.js';
import { buildDocx, buildXlsx } from './lib/exports.js';

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

// Resolve a library_file's file_path to an absolute disk path.
// file_path is stored as "/uploads/<filename>" but files live in uploadsDir.
function resolveFilePath(filePathValue) {
  const filename = path.basename(filePathValue);
  return path.join(uploadsDir, filename);
}

// Tool declarations for AI-driven chat exports. Both Claude and Gemini
// see these alongside any MCP tools the user has selected.
const BUILTIN_EXPORT_TOOLS = [
  {
    name: 'export_to_word',
    description: 'Generate a downloadable Microsoft Word (.docx) file from structured content. ONLY call this tool when the user explicitly asks for a downloadable file using language like "export to Word", "save as Word", "download as a doc", "make a Word document", "give me a .docx", or similar. DO NOT call this tool just because the user asks to "format", "structure", "show", "list", "summarize", or "write up" something — those requests should produce a normal markdown response, not a file. When in doubt, do NOT call this tool; just respond with formatted markdown.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title shown at the top of the file.' },
        filename: { type: 'string', description: 'Suggested filename without extension.' },
        sections: {
          type: 'array',
          description: 'Ordered sections of the document.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'Optional section heading.' },
              paragraphs: { type: 'array', items: { type: 'string' }, description: 'Body paragraphs.' },
              bullets: { type: 'array', items: { type: 'string' }, description: 'Bullet list items.' },
              table: {
                type: 'object',
                properties: {
                  headers: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      required: ['title', 'sections'],
    },
  },
  {
    name: 'export_to_excel',
    description: 'Generate a downloadable Microsoft Excel (.xlsx) file from tabular data. ONLY call this tool when the user explicitly asks for a downloadable file using language like "export to Excel", "save as Excel", "download as a spreadsheet", "give me a .xlsx", "save as csv", or similar. DO NOT call this tool when the user asks to "show as a grid", "put in a grid", "format as a table", "make a table", "tabulate", "list", or "compare" — those requests should produce a markdown table in the response, not a file. When the content is prose with no clear rows and columns, do NOT call this tool. When in doubt, respond with a markdown table instead.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Suggested filename without extension.' },
        sheets: {
          type: 'array',
          description: 'One or more worksheets, each with headers and rows.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Worksheet tab name.' },
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            required: ['headers', 'rows'],
          },
        },
      },
      required: ['filename', 'sheets'],
    },
  },
];

// Save a generated export Buffer to disk and insert a hidden library_files row.
// Returns { id, filename, mimeType }.
function persistExportFile({ db, buffer, mimeType, baseFilename, extension, userId }) {
  const id = uuidv4();
  const safeBase = (baseFilename || 'export').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '-') || 'export';
  const displayName = `${safeBase}.${extension}`;
  const diskFilename = `export-${id}.${extension}`;
  const diskPath = path.join(uploadsDir, diskFilename);
  fs.writeFileSync(diskPath, buffer);

  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO library_files (
      id, user_id, filename, original_name, file_path, file_type, file_size,
      mime_type, project_id, uploaded_at, library_visible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    id, userId, diskFilename, displayName, `/uploads/${diskFilename}`,
    extension, buffer.length, mimeType, null, now,
  ]);

  return { id, filename: displayName, mimeType };
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
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

const maxFileSize = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50) * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: maxFileSize } });
const memoryUpload = multer({ storage: multer.memoryStorage() });

app.post('/api/chat/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { originalname, mimetype, path: filePath } = req.file;
  let textContent = null;
  let base64Content = null;

  const isPdf = mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf');

  const isDocx = mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalname.toLowerCase().endsWith('.docx');

  if (isPdf) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      textContent = parsed.text || null;
    } catch {
      const buffer = fs.readFileSync(filePath);
      base64Content = buffer.toString('base64');
    }
  } else if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      textContent = result.value || null;
    } catch {
      return res.status(422).json({ error: 'Could not read DOCX file' });
    }
  } else {
    try {
      textContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      return res.status(422).json({ error: 'Could not read file as text' });
    }
  }

  res.json({ name: originalname, mimeType: mimetype, textContent, base64Content });
});

async function runMigrations(db) {
  const cols = dbAll(db, "PRAGMA table_info('users')");
  const hasPwHash = cols.some(c => c.name === 'password_hash');
  if (!hasPwHash) {
    dbRun(db, 'ALTER TABLE users ADD COLUMN password_hash TEXT');
    console.log('Migration: added password_hash column');
  }

  // Ensure jeffk@vettedbot.com exists with a password hash
  const jeffk = dbGet(db, "SELECT id, password_hash FROM users WHERE email = 'jeffk@vettedbot.com'");
  if (!jeffk) {
    const hash = await bcrypt.hash('Vetted@3:16', 10);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(db, "INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at) VALUES (?, 'jeffk@vettedbot.com', 'Jeff Kwiatkowski', 'admin', 'active', ?, ?, ?)", [newId, hash, now, now]);
    console.log('Migration: created jeffk@vettedbot.com user with password');
  } else if (!jeffk.password_hash) {
    const hash = await bcrypt.hash('Vetted@3:16', 10);
    dbRun(db, "UPDATE users SET password_hash = ? WHERE email = 'jeffk@vettedbot.com'", [hash]);
    console.log('Migration: set jeffk password');
  }

  // Disable old Vertex-based Claude models (GCP doesn't support Claude); direct-API models re-enabled below
  dbRun(db, "UPDATE model_configs SET is_enabled = 0 WHERE provider = 'Anthropic'");

  // Ensure Gemini 3.1 model exists in model_configs (check by id or display_name)
  const g31Model = dbGet(db, "SELECT id FROM model_configs WHERE id = 'gemini-3-1-pro' OR display_name = 'Gemini 3.1'");
  if (!g31Model) {
    const now = new Date().toISOString();
    dbRun(db, `INSERT INTO model_configs (id, model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit, created_at, updated_at)
      VALUES ('gemini-3-1-pro', 'Gemini 3.1', 'Google', 'Gemini 3.1', '#8B5CF6', 1, 1, 8192, 60, ?, ?)`, [now, now]);
    console.log('Migration: added Gemini 3.1 model');
  }

  // Ensure only Gemini 3.1 is the default model (fix duplicate defaults)
  const defaultCount = dbGet(db, "SELECT COUNT(*) as cnt FROM model_configs WHERE is_default = 1");
  if (defaultCount && defaultCount.cnt > 1) {
    const now = new Date().toISOString();
    dbRun(db, "UPDATE model_configs SET is_default = 0, updated_at = ? WHERE is_default = 1", [now]);
    dbRun(db, "UPDATE model_configs SET is_default = 1, updated_at = ? WHERE id = 'gemini-3-1-pro' OR display_name = 'Gemini 3.1'", [now]);
    console.log('Migration: fixed duplicate default models — set Gemini 3.1 as sole default');
  }

  // Ensure Gemini 2.5 Flash model exists in model_configs
  const flashModel = dbGet(db, "SELECT id FROM model_configs WHERE id = 'gemini-2-5-flash'");
  if (!flashModel) {
    const now = new Date().toISOString();
    dbRun(db, `INSERT INTO model_configs (id, model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit, created_at, updated_at)
      VALUES ('gemini-2-5-flash', 'Gemini 2.5 Flash', 'Google', 'Gemini 2.5 Flash', '#10B981', 0, 1, 8192, 120, ?, ?)`, [now, now]);
    console.log('Migration: added Gemini 2.5 Flash model');
  }

  // Ensure Claude Opus 4.6 model exists in model_configs
  const opusModel = dbGet(db, "SELECT id FROM model_configs WHERE id = 'claude-opus-4-6'");
  if (!opusModel) {
    const now = new Date().toISOString();
    dbRun(db, `INSERT INTO model_configs (id, model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit, created_at, updated_at)
      VALUES ('claude-opus-4-6', 'claude-opus-4-20250514', 'Anthropic', 'Claude Opus 4.6', '#F97316', 0, 1, 8192, 60, ?, ?)`, [now, now]);
    console.log('Migration: added Claude Opus 4.6 model');
  } else {
    // Re-enable if it was disabled by the Anthropic blanket disable above
    dbRun(db, "UPDATE model_configs SET is_enabled = 1 WHERE id = 'claude-opus-4-6'");
  }

  // Ensure jefffox@vettedconsultant.com exists
  const jfox = dbGet(db, "SELECT id FROM users WHERE email = 'jefffox@vettedconsultant.com'");
  if (!jfox) {
    const hash = await bcrypt.hash('SalesRock$24', 10);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(db, "INSERT INTO users (id, email, display_name, job_title, department, role, status, password_hash, created_at, updated_at) VALUES (?, 'jefffox@vettedconsultant.com', 'Jeff Fox', 'Sales', 'Sales', 'user', 'active', ?, ?, ?)", [newId, hash, now, now]);
    console.log('Migration: created jefffox@vettedconsultant.com');
  }

  // Ensure wross@prepfunds.net exists
  const wross = dbGet(db, "SELECT id FROM users WHERE email = 'wross@prepfunds.net'");
  if (!wross) {
    const hash = await bcrypt.hash('PrepOwner!77', 10);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(db, "INSERT INTO users (id, email, display_name, job_title, role, status, password_hash, created_at, updated_at) VALUES (?, 'wross@prepfunds.net', 'Bill Ross', 'Owner', 'user', 'active', ?, ?, ?)", [newId, hash, now, now]);
    console.log('Migration: created wross@prepfunds.net');
  }
}

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
  await runMigrations(db);
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

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [email]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'User account is not active' });
  }

  if (!user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Update last login
  dbRun(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);

  // Return same shape as before — strip password_hash, keep everything else
  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser });
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
// MODEL ROUTES (public — used by chat and project UIs)
// ============================================================================

app.get('/api/models', requireAuth, (req, res) => {
  const models = dbAll(db, 'SELECT * FROM model_configs WHERE is_enabled = 1 ORDER BY is_default DESC, display_name ASC');
  res.json({ models });
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
    model || 'gemini',
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
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  const chat = isAdmin
    ? dbGet(db, 'SELECT * FROM chats WHERE id = ?', [req.params.id])
    : dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const messages = dbAll(db, 'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [req.params.id]);

  // Collect every attachment id referenced by any message and hydrate in one pass.
  const allAttachmentIds = new Set();
  const parsedAttachments = messages.map(m => {
    if (!m.attachments) return null;
    try {
      const ids = JSON.parse(m.attachments);
      if (Array.isArray(ids)) {
        ids.forEach(id => allAttachmentIds.add(id));
        return ids;
      }
    } catch { /* ignore malformed */ }
    return null;
  });

  let attachmentMap = {};
  if (allAttachmentIds.size > 0) {
    const idList = [...allAttachmentIds];
    const rows = dbAll(db,
      `SELECT id, original_name, mime_type, library_visible FROM library_files WHERE id IN (${idList.map(() => '?').join(',')})`,
      idList,
    );
    attachmentMap = Object.fromEntries(rows.map(r => [r.id, {
      id: r.id,
      filename: r.original_name,
      mime_type: r.mime_type,
      library_visible: r.library_visible === 1,
    }]));
  }

  const messagesWithParsedReasoning = messages.map((m, i) => ({
    ...m,
    reasoning: m.reasoning ? JSON.parse(m.reasoning) : null,
    attachments: parsedAttachments[i]
      ? parsedAttachments[i].map(id => attachmentMap[id]).filter(Boolean)
      : null,
    images: m.images ? JSON.parse(m.images) : null,
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

// -- Chat MCP server selection -------------------------------------------
app.put('/api/chats/:id/mcp-servers', requireAuth, (req, res) => {
  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ?', [req.params.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (chat.user_id !== req.user.id) return res.status(403).json({ error: 'Not your chat' });
  const { serverIds } = req.body;
  dbRun(db, 'UPDATE chats SET mcp_servers = ? WHERE id = ?', [JSON.stringify(serverIds || []), req.params.id]);
  res.json({ success: true });
});

app.post('/api/chats/:id/messages', requireAuth, async (req, res) => {
  const { content, attachments, images } = req.body;
  console.log('[chat] images received:', images ? `${images.length} image(s), first mimeType: ${images[0]?.mimeType}` : 'none');

  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  // Use SSE to stream steps as they happen
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Tell nginx to disable buffering for SSE
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Send a heartbeat comment every 15s to keep the SSE connection alive through proxies
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => clearInterval(heartbeat));

  const now = new Date().toISOString();

  // Save user message
  const userMessageId = uuidv4();
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userMessageId,
    req.params.id,
    'user',
    content,
    chat.model,
    Math.ceil(content.split(/\s+/).length * 1.3),
    null,
    attachments ? JSON.stringify(attachments) : null,
    images && images.length > 0 ? JSON.stringify(images) : null,
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
    const filePath = resolveFilePath(file.file_path);
    if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
      try {
        const buffer = fs.readFileSync(filePath);
        return { name: file.original_name, mimeType: 'application/pdf', base64: buffer.toString('base64') };
      } catch {
        return { name: file.original_name, text: `[Could not read ${file.original_name}]` };
      }
    } else if (file.file_type === 'docx' || file.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        return { name: file.original_name, text: result.value };
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

  // Accumulator for built-in export tools — populated inside the AI tool loop,
  // read again when persisting the assistant message in the second try block.
  const exportFileIds = [];

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

    // Inject active skills for this project
    if (project) {
      const activeSkills = dbAll(db, `
        SELECT s.id, s.name, s.instructions
        FROM skills s
        JOIN project_skills ps ON ps.skill_id = s.id
        WHERE ps.project_id = ? AND ps.enabled = 1
      `, [project.id]);
      if (activeSkills.length > 0) {
        step(`Loading ${activeSkills.length} skill${activeSkills.length !== 1 ? 's' : ''}: ${activeSkills.map(s => s.name).join(', ')}`);
        for (const skill of activeSkills) {
          let skillBlock = `<skill name="${skill.name}">\n${skill.instructions}`;
          const skillFiles = dbAll(db, `
            SELECT lf.* FROM library_files lf
            JOIN skill_files sf ON sf.library_file_id = lf.id
            WHERE sf.skill_id = ?
          `, [skill.id]);
          for (const file of skillFiles) {
            const isDocx = file.file_type === 'docx' || file.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const isText = !file.mime_type.startsWith('image/') && file.mime_type !== 'application/pdf';
            if (isDocx) {
              try {
                const filePath = resolveFilePath(file.file_path);
                const result = await mammoth.extractRawText({ path: filePath });
                let content = result.value;
                const TOKEN_LIMIT = 4000 * 4;
                if (content.length > TOKEN_LIMIT) {
                  content = content.slice(0, TOKEN_LIMIT) + '\n\n[Content truncated — file exceeds 4000 token limit]';
                }
                skillBlock += `\n\n<file name="${file.original_name}">\n${content}\n</file>`;
              } catch {
                skillBlock += `\n\n<file name="${file.original_name}">\n[Could not read file]\n</file>`;
              }
            } else if (isText) {
              try {
                const filePath = resolveFilePath(file.file_path);
                let content = fs.readFileSync(filePath, 'utf8');
                const TOKEN_LIMIT = 4000 * 4;
                if (content.length > TOKEN_LIMIT) {
                  content = content.slice(0, TOKEN_LIMIT) + '\n\n[Content truncated — file exceeds 4000 token limit]';
                }
                skillBlock += `\n\n<file name="${file.original_name}">\n${content}\n</file>`;
              } catch {
                skillBlock += `\n\n<file name="${file.original_name}">\n[Could not read file]\n</file>`;
              }
            } else {
              skillBlock += `\n\n<file name="${file.original_name}">[Non-text file — content not injected]</file>`;
            }
          }
          skillBlock += '\n</skill>';
          parts.push(skillBlock);
        }
      }
    }

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

    if (retrievedContext) {
      parts.push('\n\nThe following context was retrieved from project files. Use it to answer the user\'s question. When using information from these sources, cite them by filename and page number.\n');
      parts.push(retrievedContext);
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
    const modelId = req.body.modelId || null;

    // -- MCP tool declarations -----------------------------------------------
    let mcpToolDeclarations = [];
    let mcpToolMap = {}; // prefixedName -> { serverId, serverName, originalName, serverConfig }

    let activeMcpIds = [];
    const parseMcpIds = (raw) => {
      if (!raw) return [];
      try {
        let parsed = JSON.parse(raw);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed); // handle double-encoded
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    };
    if (chat.project_id) {
      const proj = dbGet(db, 'SELECT mcp_servers FROM projects WHERE id = ?', [chat.project_id]);
      activeMcpIds = parseMcpIds(proj?.mcp_servers);
    } else {
      activeMcpIds = parseMcpIds(chat.mcp_servers);
    }

    if (activeMcpIds.length > 0) {
      const mcpServers = dbAll(db,
        `SELECT * FROM mcp_servers WHERE id IN (${activeMcpIds.map(() => '?').join(',')}) AND enabled = 1`,
        activeMcpIds
      );

      for (const server of mcpServers) {
        try {
          step(`Starting ${server.name}...`);
          const tools = await mcpManager.getTools(server);
          for (const tool of tools) {
            const prefixedName = `${server.id}__${tool.name}`;
            mcpToolMap[prefixedName] = {
              serverId: server.id,
              serverName: server.name,
              originalName: tool.name,
              serverConfig: server,
            };
            const declaration = {
              name: prefixedName,
              description: tool.description || '',
            };
            if (tool.inputSchema && tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0) {
              declaration.parameters = {
                type: tool.inputSchema.type || 'object',
                properties: tool.inputSchema.properties || {},
              };
              if (tool.inputSchema.required) {
                declaration.parameters.required = tool.inputSchema.required;
              }
            }
            mcpToolDeclarations.push(declaration);
          }
          step(`Loaded ${tools.length} tool${tools.length !== 1 ? 's' : ''} from ${server.name}`);
        } catch (err) {
          step(`Failed to start ${server.name}: ${err.message}`);
          console.error(`[mcp] Failed to start ${server.name}:`, err);
        }
      }
    }

    // Built-in export tools (Word/Excel) — visible to both Claude and Gemini.
    // Handlers close over the chat context so they can persist files for this user/chat.
    const builtinToolMap = {
      export_to_word: async (args) => {
        if (!args || !Array.isArray(args.sections) || args.sections.length === 0) {
          return 'Error: export_to_word requires a non-empty `sections` array. Build the document content from the conversation and retry.';
        }
        const { buffer, mimeType } = await buildDocx(args);
        const file = persistExportFile({
          db, buffer, mimeType, extension: 'docx',
          baseFilename: args.filename || args.title || 'document',
          userId: req.user.id,
        });
        exportFileIds.push(file.id);
        step(`Generated ${file.filename}`);
        return `Generated Word document "${file.filename}". The file is now attached to your reply and the user can download it.`;
      },
      export_to_excel: async (args) => {
        if (!args || !Array.isArray(args.sheets) || args.sheets.length === 0) {
          return 'Error: export_to_excel requires a non-empty `sheets` array.';
        }
        const hasRows = args.sheets.some(s => Array.isArray(s.rows) && s.rows.length > 0);
        if (!hasRows) {
          return 'Error: export_to_excel requires at least one sheet with rows. The content does not appear tabular — ask the user whether to use Word instead, or restructure the data first.';
        }
        const { buffer, mimeType } = await buildXlsx(args);
        const file = persistExportFile({
          db, buffer, mimeType, extension: 'xlsx',
          baseFilename: args.filename || 'spreadsheet',
          userId: req.user.id,
        });
        exportFileIds.push(file.id);
        step(`Generated ${file.filename}`);
        return `Generated Excel file "${file.filename}". The file is now attached to your reply and the user can download it.`;
      },
    };
    const builtinToolDeclarations = [...BUILTIN_EXPORT_TOOLS];

    // Inject Tavily web_search and built-in exports alongside any MCP tool declarations
    const allFunctionDeclarations = [...mcpToolDeclarations, ...builtinToolDeclarations];
    if (hasTavily()) {
      allFunctionDeclarations.push({
        name: "web_search",
        description: "Search the web for current information. Use for market data, recent events, or anything requiring live information.",
        parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "The search query" } }, required: ["query"] },
      });
    }

    const geminiTools = allFunctionDeclarations.length > 0
      ? [{ functionDeclarations: allFunctionDeclarations }]
      : [];

    // Determine provider from modelId (model_name in DB)
    const isClaudeModel = modelId && (modelId.startsWith('claude-') || modelId.includes('claude'));

    let aiText = '';
    let result;

    if (isClaudeModel) {
      // Convert MCP + built-in tool declarations to Claude tool format
      const claudeTools = [...mcpToolDeclarations, ...builtinToolDeclarations].map(decl => {
        const tool = { name: decl.name, description: decl.description || '' };
        if (decl.parameters) {
          tool.input_schema = {
            type: decl.parameters.type || 'object',
            properties: decl.parameters.properties || {},
          };
          if (decl.parameters.required) tool.input_schema.required = decl.parameters.required;
        } else {
          tool.input_schema = { type: 'object', properties: {} };
        }
        return tool;
      });

      step('Calling Claude');
      result = await claudeDirectChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, { claudeTools, mcpToolMap, mcpManager, builtinToolMap, images });
    } else {
      step('Calling Gemini');
      result = await geminiChatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId, geminiTools, images);
    }

    if (result.text) {
      aiText = result.text;
    } else if (result.functionCalls) {
      // MCP tool-calling loop
      let loopContents = result._contents;
      let modelParts = result._modelParts;
      const MAX_ITERATIONS = 10;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        loopContents.push({ role: 'model', parts: modelParts });

        const fnCalls = modelParts.filter(p => p.functionCall);
        const fnResponseParts = await Promise.all(fnCalls.map(async (part) => {
          const prefixedName = part.functionCall.name;
          // Handle Tavily web_search calls
          if (prefixedName === 'web_search') {
            const query = part.functionCall.args?.query || '';
            step(`Searching the web: "${query}"`);
            try {
              const searchResult = await tavilySearch(query);
              step(`Web search returned results`);
              return { functionResponse: { name: prefixedName, response: { result: searchResult || 'No results found.' } } };
            } catch (err) {
              step(`Web search error: ${err.message}`);
              return { functionResponse: { name: prefixedName, response: { result: `Error: ${err.message}` } } };
            }
          }

          // Built-in export tools
          if (builtinToolMap[prefixedName]) {
            try {
              const toolResult = await builtinToolMap[prefixedName](part.functionCall.args || {});
              return { functionResponse: { name: prefixedName, response: { result: toolResult } } };
            } catch (err) {
              step(`${prefixedName} error: ${err.message}`);
              return { functionResponse: { name: prefixedName, response: { result: `Error: ${err.message}` } } };
            }
          }

          const mapping = mcpToolMap[prefixedName];
          if (!mapping) {
            return { functionResponse: { name: prefixedName, response: { result: 'Error: Unknown tool' } } };
          }
          step(`Calling ${mapping.serverName}: ${mapping.originalName}...`);
          try {
            const toolResult = await mcpManager.callTool(mapping.serverConfig, mapping.originalName, part.functionCall.args || {});
            step(`${mapping.originalName} returned (${toolResult.length} chars)`);
            return { functionResponse: { name: prefixedName, response: { result: toolResult } } };
          } catch (err) {
            step(`${mapping.originalName} error: ${err.message}`);
            return { functionResponse: { name: prefixedName, response: { result: `Error: ${err.message}` } } };
          }
        }));

        loopContents.push({ role: 'user', parts: fnResponseParts });

        const nextResult = await geminiGenerate(loopContents, {}, geminiTools, modelId);
        const candidate = nextResult.candidates?.[0];
        const nextParts = candidate?.content?.parts ?? [];

        const nextFnCalls = nextParts.filter(p => p.functionCall);
        if (nextFnCalls.length === 0) {
          aiText = extractGroundedResponse(nextResult).text;
          break;
        }

        modelParts = nextParts;
      }

      if (!aiText) {
        const fallback = await geminiGenerate(loopContents, {}, [], modelId);
        aiText = extractGroundedResponse(fallback).text;
      }
    }

    aiContent = aiText;
    step('Response received');
  } catch (err) {
    console.error('[chat] AI error:', err.message, err.stack);
    const msg = err.message || '';
    if (msg.includes('invalid_grant') || msg.includes('invalid_rapt') || msg.includes('reauth') || msg.includes('Unable to authenticate') || msg.includes('401') || msg.includes('403')) {
      aiContent = `The AI service could not authenticate. Check that the VM service account has the **Vertex AI User** role and the Vertex AI API is enabled on project \`${process.env.GCP_PROJECT || 'bill-leases'}\`.\n\nError: \`${msg.slice(0, 200)}\``;
    } else if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('429')) {
      aiContent = `The AI service is temporarily rate-limited. Please wait a moment and try again.\n\nError: \`${msg.slice(0, 300)}\``;
    } else if (msg.includes('not found') || msg.includes('404')) {
      const failedModel = msg.match(/models\/([^\s]+)/)?.[1] || process.env.MODEL_ID || 'unknown';
      aiContent = `The AI model \`${failedModel}\` is not available in project \`${process.env.GCP_PROJECT || 'bill-leases'}\` (location: \`${process.env.GCP_LOCATION || 'global'}\`).\n\nError: \`${msg.slice(0, 200)}\``;
    } else {
      aiContent = `Sorry, I was unable to generate a response. Please try again.\n\nError: \`${msg.slice(0, 200)}\``;
    }
  }

  // Save AI message first, then send done event with chat ID for frontend to fetch
  const aiMessageId = uuidv4();

  // Save to DB after response is ended
  try {
    dbRun(db, `
      INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      aiMessageId,
      req.params.id,
      'assistant',
      aiContent,
      chat.model,
      Math.ceil(aiContent.split(/\s+/).length * 1.3),
      aiReasoning ? JSON.stringify(aiReasoning) : null,
      exportFileIds && exportFileIds.length > 0 ? JSON.stringify(exportFileIds) : null,
      null,
      now
    ]);

    const isErrorResponse = aiContent.startsWith('The AI service') ||
      aiContent.startsWith('Sorry, I was unable') ||
      aiContent.startsWith('The AI model');
    if (!isErrorResponse) {
      const tokenCount = Math.ceil(aiContent.split(/\s+/).length * 1.3);
      logUsage(getDatabase(), {
        userId: req.user?.id || null,
        source: 'chat',
        prompt: content,
        model: chat.model,
        inputTokens: 0,
        outputTokens: tokenCount,
      });
    }

    dbRun(db, 'UPDATE chats SET updated_at = ? WHERE id = ?', [now, req.params.id]);
  } catch (err) {
    console.error('[chat] DB error after AI response:', err.message);
  }

  clearInterval(heartbeat);
  // Send minimal done — frontend fetches full messages via API
  res.write(`data: {"type":"done","chatId":"${req.params.id}"}\n\n`);
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
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  const projects = isAdmin
    ? dbAll(db, `SELECT p.*, u.display_name as owner_name FROM projects p LEFT JOIN users u ON p.owner_id = u.id ORDER BY p.updated_at DESC`)
    : dbAll(db, `
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
    default_model || 'gemini',
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
      tool_sets: project.tool_sets ? JSON.parse(project.tool_sets) : [],
      mcp_servers: project.mcp_servers ? JSON.parse(project.mcp_servers) : []
    },
    members
  });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, description, default_model, system_prompt, temperature, tool_sets, mcp_servers } = req.body;

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  // Allow owner, admin, or project member to update
  const isOwner = project.owner_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const isMember = dbGet(db, 'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!isOwner && !isAdmin && !isMember) {
    return res.status(403).json({ error: 'Not authorized to update this project' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE projects
    SET name = ?, description = ?, default_model = ?, system_prompt = ?, temperature = ?, tool_sets = ?, mcp_servers = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : project.name,
    description !== undefined ? description : project.description,
    default_model !== undefined ? default_model : project.default_model,
    system_prompt !== undefined ? system_prompt : project.system_prompt,
    temperature !== undefined ? temperature : project.temperature,
    tool_sets !== undefined ? JSON.stringify(tool_sets) : project.tool_sets,
    mcp_servers !== undefined ? JSON.stringify(mcp_servers) : project.mcp_servers,
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
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  let files;
  if (isAdmin) {
    files = project_id
      ? dbAll(db, 'SELECT lf.*, u.display_name as owner_name FROM library_files lf LEFT JOIN users u ON lf.user_id = u.id WHERE lf.project_id = ? AND lf.library_visible = 1 ORDER BY lf.uploaded_at DESC', [project_id])
      : dbAll(db, 'SELECT lf.*, u.display_name as owner_name FROM library_files lf LEFT JOIN users u ON lf.user_id = u.id WHERE lf.library_visible = 1 ORDER BY lf.uploaded_at DESC');
  } else {
    files = project_id
      ? dbAll(db, 'SELECT * FROM library_files WHERE user_id = ? AND project_id = ? AND library_visible = 1 ORDER BY uploaded_at DESC', [req.user.id, project_id])
      : dbAll(db, 'SELECT * FROM library_files WHERE user_id = ? AND library_visible = 1 ORDER BY uploaded_at DESC', [req.user.id]);
  }

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

// PPTX Template Extractor — parse .pptx and save design tokens to library
app.post('/api/apps/pptx-parse', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }
    if (!req.file.originalname.toLowerCase().endsWith('.pptx')) {
      return res.status(400).json({ success: false, error: 'File must be a .pptx PowerPoint file' });
    }

    const buffer = fs.readFileSync(req.file.path);
    const result = await parsePptxTemplate(buffer, req.file.originalname);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Write design tokens JSON to disk
    const fileId = uuidv4();
    const jsonContent = JSON.stringify(result.tokens, null, 2);
    const jsonBuffer = Buffer.from(jsonContent, 'utf8');
    const filename = `${fileId}-design-tokens.json`;
    const uploadDir = process.env.UPLOAD_DIR || './data/uploads';
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, jsonContent);

    // Insert library_files row
    const now = new Date().toISOString();
    const originalName = req.file.originalname.replace(/\.pptx$/i, '') + '-design-tokens.json';
    dbRun(db, `
      INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [fileId, req.user.id, filename, originalName, `/uploads/${filename}`, 'json', jsonBuffer.byteLength, 'application/json', now]);

    res.json({
      success: true,
      file_id: fileId,
      summary: {
        colorCount: Object.keys(result.tokens.colors || {}).length,
        fonts: result.tokens.fonts || {},
        layoutCount: (result.tokens.layouts || []).length,
        mediaCount: (result.tokens.media || []).length,
      },
      colors: result.tokens.colors || {},
      skippedMedia: result.skippedMedia || [],
    });
  } catch (err) {
    console.error('PPTX parse error:', err);
    res.status(500).json({ success: false, error: 'Failed to parse PowerPoint file' });
  } finally {
    // Clean up the uploaded .pptx temp file
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  }
});

app.get('/api/library/:id/download', requireAuth, (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = resolveFilePath(file.file_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.original_name);
});

// Promote a hidden chat-export file into the user's main Library.
app.post('/api/library/:id/promote', requireAuth, (req, res) => {
  const file = dbGet(db, 'SELECT id, library_visible FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  dbRun(db, 'UPDATE library_files SET library_visible = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.put('/api/library/:id', requireAuth, async (req, res) => {
  const { original_name, project_id } = req.body;

  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // If project_id is changing and file was indexed, clean up old chunks
  if (project_id !== undefined && file.project_id && file.index_status) {
    try {
      await deleteFileChunks(file.id);
      await gcsDeleteFile(file.project_id, file.id, file.original_name);
    } catch (err) {
      console.error('Error cleaning up old index:', err);
    }
  }

  // If assigning to a new project, mark for indexing
  if (project_id && project_id !== file.project_id) {
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['pending', file.id]);
  }

  dbRun(db, 'UPDATE library_files SET original_name = ?, project_id = ? WHERE id = ?', [
    original_name || file.original_name,
    project_id !== undefined ? project_id : file.project_id,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [req.params.id]);
  res.json({ file: updated });
});

app.delete('/api/library/:id', requireAuth, async (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Clean up RAG chunks and GCS blob if file was indexed
  if (file.project_id && file.index_status) {
    try {
      await deleteFileChunks(file.id);
      await gcsDeleteFile(file.project_id, file.id, file.original_name);
    } catch (err) {
      console.error('Error cleaning up indexed file:', err);
    }
  }

  const filePath = resolveFilePath(file.file_path);
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
    WHERE user_id = ? AND library_visible = 1
  `, [req.user.id]);

  res.json({ stats });
});

// ============================================================================
// SKILLS ROUTES
// ============================================================================

// List all skills (with file count)
app.get('/api/skills', requireAuth, (req, res) => {
  const skills = dbAll(db, `
    SELECT s.*, COUNT(sf.id) as file_count
    FROM skills s
    LEFT JOIN skill_files sf ON sf.skill_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `);
  res.json({ skills });
});

// Create a skill
app.post('/api/skills', requireAuth, (req, res) => {
  const { name, description, instructions } = req.body;
  if (!name?.trim() || !instructions?.trim()) {
    return res.status(400).json({ error: 'Name and instructions are required' });
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO skills (id, name, description, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, name.trim(), description?.trim() || null, instructions.trim(), now, now]);
  const skill = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [id]);
  res.status(201).json({ skill });
});

// Get a single skill with attached files
app.get('/api/skills/:id', requireAuth, (req, res) => {
  const skill = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [req.params.id]);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const files = dbAll(db, `
    SELECT lf.* FROM library_files lf
    JOIN skill_files sf ON sf.library_file_id = lf.id
    WHERE sf.skill_id = ?
  `, [req.params.id]);
  res.json({ skill: { ...skill, files } });
});

// Update a skill
app.put('/api/skills/:id', requireAuth, (req, res) => {
  const skill = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [req.params.id]);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const { name, description, instructions } = req.body;
  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE skills SET name = ?, description = ?, instructions = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name.trim() : skill.name,
    description !== undefined ? (description?.trim() || null) : skill.description,
    instructions !== undefined ? instructions.trim() : skill.instructions,
    now,
    req.params.id,
  ]);
  const updated = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [req.params.id]);
  res.json({ skill: updated });
});

// Delete a skill (cascade)
app.delete('/api/skills/:id', requireAuth, (req, res) => {
  const skill = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [req.params.id]);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  dbRun(db, 'DELETE FROM skill_files WHERE skill_id = ?', [req.params.id]);
  dbRun(db, 'DELETE FROM project_skills WHERE skill_id = ?', [req.params.id]);
  dbRun(db, 'DELETE FROM skills WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Attach a library file to a skill
app.post('/api/skills/:id/files', requireAuth, (req, res) => {
  const skill = dbGet(db, 'SELECT * FROM skills WHERE id = ?', [req.params.id]);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const { library_file_id } = req.body;
  if (!library_file_id) return res.status(400).json({ error: 'library_file_id is required' });
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ?', [library_file_id]);
  if (!file) return res.status(404).json({ error: 'Library file not found' });
  const existing = dbGet(db, 'SELECT * FROM skill_files WHERE skill_id = ? AND library_file_id = ?', [req.params.id, library_file_id]);
  if (existing) return res.status(409).json({ error: 'File already attached' });
  const id = uuidv4();
  dbRun(db, `
    INSERT INTO skill_files (id, skill_id, library_file_id, created_at)
    VALUES (?, ?, ?, ?)
  `, [id, req.params.id, library_file_id, new Date().toISOString()]);
  res.status(201).json({ success: true });
});

// Detach a library file from a skill
app.delete('/api/skills/:id/files/:fileId', requireAuth, (req, res) => {
  dbRun(db, 'DELETE FROM skill_files WHERE skill_id = ? AND library_file_id = ?', [req.params.id, req.params.fileId]);
  res.json({ success: true });
});

// List all skills with enabled state for a project
app.get('/api/projects/:id/skills', requireAuth, (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const skills = dbAll(db, `
    SELECT s.id as skill_id, s.name as skill_name, s.description as skill_description,
           COALESCE(ps.enabled, 0) as enabled
    FROM skills s
    LEFT JOIN project_skills ps ON ps.skill_id = s.id AND ps.project_id = ?
    ORDER BY s.name
  `, [req.params.id]);
  res.json({ skills });
});

// Bulk update project skills
app.put('/api/projects/:id/skills', requireAuth, (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { skills } = req.body;
  if (!Array.isArray(skills)) return res.status(400).json({ error: 'skills array is required' });
  for (const { skill_id, enabled } of skills) {
    const existing = dbGet(db, 'SELECT * FROM project_skills WHERE project_id = ? AND skill_id = ?', [req.params.id, skill_id]);
    if (existing) {
      dbRun(db, 'UPDATE project_skills SET enabled = ? WHERE project_id = ? AND skill_id = ?', [enabled ? 1 : 0, req.params.id, skill_id]);
    } else {
      const id = uuidv4();
      dbRun(db, `
        INSERT INTO project_skills (id, project_id, skill_id, enabled, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [id, req.params.id, skill_id, enabled ? 1 : 0, new Date().toISOString()]);
    }
  }
  res.json({ success: true });
});

// ============================================================================
// PROJECT FILE UPLOAD + RAG INDEXING
// ============================================================================

app.post('/api/projects/:id/files/upload', requireAuth, memoryUpload.single('file'), async (req, res) => {
  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  if (!isSupportedType(file.mimetype)) {
    return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}. Supported: PDF, DOCX, TXT, MD` });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const step = (msg) => sendEvent({ type: 'step', message: msg, ts: new Date().toISOString() });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => clearInterval(heartbeat));

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    dbRun(db, `INSERT INTO library_files (id, user_id, filename, original_name, file_path, file_type, file_size, mime_type, project_id, uploaded_at, index_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileId, req.user.id, file.originalname, file.originalname, `gcs://projects/${project.id}/${fileId}-${file.originalname}`,
       path.extname(file.originalname).slice(1), file.size, file.mimetype, project.id, now, 'indexing']);

    const result = await indexFile(project.id, fileId, file.originalname, file.buffer, file.mimetype, step);

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

  clearInterval(heartbeat);
  res.end();
});

app.post('/api/projects/:id/files/:fileId/reindex', requireAuth, async (req, res) => {
  const file = dbGet(db, 'SELECT * FROM library_files WHERE id = ? AND project_id = ?', [req.params.fileId, req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const step = (msg) => sendEvent({ type: 'step', message: msg, ts: new Date().toISOString() });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => clearInterval(heartbeat));

  try {
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['indexing', file.id]);

    step('Removing old index...');
    await deleteFileChunks(file.id);

    step('Downloading file from storage...');
    const buffer = await gcsDownload(req.params.id, file.id, file.original_name);

    // Re-run full indexFile (will re-upload to same GCS path, idempotent)
    const result = await indexFile(req.params.id, file.id, file.original_name, buffer, file.mime_type, step);

    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['ready', file.id]);
    sendEvent({ type: 'done', file: { id: file.id, index_status: 'ready', chunks: result.chunks } });
  } catch (err) {
    console.error('Re-index error:', err);
    dbRun(db, 'UPDATE library_files SET index_status = ? WHERE id = ?', ['error', file.id]);
    sendEvent({ type: 'error', message: err.message || 'Re-indexing failed' });
  }
  clearInterval(heartbeat);
  res.end();
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

app.delete('/api/admin/chats', requireAuth, requireAdmin, (req, res) => {
  dbRun(db, 'DELETE FROM messages');
  dbRun(db, 'DELETE FROM chats');
  res.json({ success: true });
});

app.delete('/api/admin/users/:id/chats', requireAuth, requireAdmin, (req, res) => {
  const targetUser = dbGet(db, 'SELECT id, display_name FROM users WHERE id = ?', [req.params.id]);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  const userChats = dbAll(db, 'SELECT id FROM chats WHERE user_id = ?', [req.params.id]);
  const chatIds = userChats.map(c => c.id);
  if (chatIds.length > 0) {
    dbRun(db, `DELETE FROM messages WHERE chat_id IN (${chatIds.map(() => '?').join(',')})`, chatIds);
    dbRun(db, 'DELETE FROM chats WHERE user_id = ?', [req.params.id]);
  }
  res.json({ success: true, deleted: chatIds.length });
});

app.get('/api/admin/chat-history', requireAuth, requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (req.query.user_id) { conditions.push('c.user_id = ?'); params.push(req.query.user_id); }
  if (req.query.q) { conditions.push('c.title LIKE ?'); params.push(`%${req.query.q}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = dbGet(db, `SELECT COUNT(*) as total FROM chats c ${where}`, params);
  const rows = dbAll(db, `
    SELECT c.id, c.title, c.user_id, c.project_id, c.model, c.created_at, c.updated_at,
           u.display_name, u.email,
           p.name as project_name,
           (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as message_count
    FROM chats c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN projects p ON c.project_id = p.id
    ${where}
    ORDER BY c.updated_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
  res.json({ rows, total: countRow?.total || 0, page, limit });
});

app.delete('/api/admin/chat-history/:id', requireAuth, requireAdmin, (req, res) => {
  const chat = dbGet(db, 'SELECT id FROM chats WHERE id = ?', [req.params.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  dbRun(db, 'DELETE FROM messages WHERE chat_id = ?', [req.params.id]);
  dbRun(db, 'DELETE FROM chats WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

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
  const mcpCount = dbGet(db, 'SELECT COUNT(*) as count FROM mcp_servers', []);

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
      mcp_servers: mcpCount?.count || 0,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = dbAll(db, 'SELECT * FROM users ORDER BY created_at DESC');
  const users = rows.map(({ password_hash, ...u }) => ({ ...u, has_password: !!password_hash }));
  res.json({ users });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, display_name, job_title, department, role = 'user', password, status = 'active' } = req.body;
  if (!email || !display_name) return res.status(400).json({ error: 'Email and name required' });
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const now = new Date().toISOString();
  const id = uuidv4();
  const password_hash = password ? await bcrypt.hash(password, 10) : null;
  try {
    dbRun(db, `
      INSERT INTO users (id, email, display_name, job_title, department, role, status, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, email, display_name, job_title || null, department || null, role, status, password_hash, now, now]);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
  const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [id]);
  const { password_hash: _, ...safeUser } = user;
  res.status(201).json({ user: { ...safeUser, has_password: !!user.password_hash } });
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (body.role !== undefined && !['user', 'admin'].includes(body.role)) return res.status(400).json({ error: 'Invalid role' });
  if (body.status !== undefined && !['active', 'inactive', 'suspended'].includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
  const allowed = ['email', 'display_name', 'job_title', 'department', 'role', 'status'];
  const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const setClauses = fields.map(f => `${f} = ?`).join(', ');
  const values = [...fields.map(f => body[f]), new Date().toISOString(), id];
  try {
    dbRun(db, `UPDATE users SET ${setClauses}, updated_at = ? WHERE id = ?`, values);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
  const updated = dbGet(db, 'SELECT * FROM users WHERE id = ?', [id]);
  const { password_hash, ...safeUser } = updated;
  res.json({ user: { ...safeUser, has_password: !!password_hash } });
});

app.put('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password is required' });
  }
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(password, 10);
  dbRun(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, new Date().toISOString(), id]);
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const adminCount = dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role IN ('admin','super_admin') AND status = 'active' AND id != ?", [id]);
  if (adminCount.count === 0) return res.status(400).json({ error: 'Cannot delete the last admin' });
  dbRun(db, 'DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
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

app.post('/api/admin/models', requireAuth, requireAdmin, (req, res) => {
  const { model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit } = req.body;
  if (!model_name || !display_name) return res.status(400).json({ error: 'model_name and display_name required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `INSERT INTO model_configs (id, model_name, provider, display_name, icon_color, is_default, is_enabled, max_tokens, rate_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, model_name, provider || 'Google', display_name, icon_color || '#888', is_default ? 1 : 0, is_enabled !== false ? 1 : 0, max_tokens || 4096, rate_limit || 60, now, now]);
  const model = dbGet(db, 'SELECT * FROM model_configs WHERE id = ?', [id]);
  res.status(201).json({ model });
});

app.put('/api/admin/models/:id', requireAuth, requireAdmin, (req, res) => {
  const { is_enabled, is_default, max_tokens, rate_limit, display_name, model_name, provider, icon_color } = req.body;

  const model = dbGet(db, 'SELECT * FROM model_configs WHERE id = ?', [req.params.id]);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const now = new Date().toISOString();

  // If setting this model as default, unset all others first
  if (is_default) {
    dbRun(db, 'UPDATE model_configs SET is_default = 0, updated_at = ? WHERE is_default = 1', [now]);
  }

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

app.delete('/api/admin/models/:id', requireAuth, requireAdmin, (req, res) => {
  const model = dbGet(db, 'SELECT * FROM model_configs WHERE id = ?', [req.params.id]);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  dbRun(db, 'DELETE FROM model_configs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
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

app.get('/api/admin/usage/models', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = dbAll(db, 'SELECT DISTINCT model FROM usage_log WHERE model IS NOT NULL ORDER BY model');
  res.json(rows.map(r => r.model));
});

app.get('/api/admin/usage/summary', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

  const row = dbGet(db, `
    SELECT
      COUNT(*) as total_prompts,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost,
      COUNT(DISTINCT user_id) as active_users
    FROM usage_log
    WHERE created_at >= ? AND created_at <= ?
  `, [monthStart, monthEnd]);

  res.json({
    total_prompts: row?.total_prompts || 0,
    total_tokens: row?.total_tokens || 0,
    estimated_cost: row?.estimated_cost || 0,
    active_users: row?.active_users || 0,
  });
});

app.get('/api/admin/usage', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.user_id) { conditions.push('ul.user_id = ?'); params.push(req.query.user_id); }
  if (req.query.source) { conditions.push('ul.source = ?'); params.push(req.query.source); }
  if (req.query.model) { conditions.push('ul.model = ?'); params.push(req.query.model); }
  if (req.query.from) { conditions.push('ul.created_at >= ?'); params.push(req.query.from + 'T00:00:00.000Z'); }
  if (req.query.to) { conditions.push('ul.created_at <= ?'); params.push(req.query.to + 'T23:59:59.999Z'); }
  if (req.query.q) { conditions.push('ul.prompt LIKE ?'); params.push(`%${req.query.q}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = dbGet(db, `SELECT COUNT(*) as total FROM usage_log ul ${where}`, params);
  const total = countRow?.total || 0;

  const rows = dbAll(db, `
    SELECT ul.*, u.display_name, u.department
    FROM usage_log ul
    LEFT JOIN users u ON ul.user_id = u.id
    ${where}
    ORDER BY ul.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({ rows, total, page, limit });
});

// -- Admin MCP Servers ---------------------------------------------------
app.get('/api/admin/mcp-servers', requireAuth, requireAdmin, (req, res) => {
  const servers = dbAll(db, 'SELECT * FROM mcp_servers ORDER BY name', []);
  res.json({ servers });
});

app.post('/api/admin/mcp-servers', requireAuth, requireAdmin, (req, res) => {
  const { name, description, icon, command, args, env_vars, enabled } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'Name and command are required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `INSERT INTO mcp_servers (id, name, description, icon, command, args, env_vars, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, icon || null, command,
     args || '[]', env_vars || '{}',
     enabled !== undefined ? (enabled ? 1 : 0) : 1, now, now]);
  const server = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [id]);
  res.status(201).json({ server });
});

app.put('/api/admin/mcp-servers/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'MCP server not found' });
  const { name, description, icon, command, args, env_vars, enabled } = req.body;
  const now = new Date().toISOString();
  dbRun(db, `UPDATE mcp_servers SET
    name = ?, description = ?, icon = ?, command = ?, args = ?, env_vars = ?, enabled = ?, updated_at = ?
    WHERE id = ?`,
    [
      name !== undefined ? name : existing.name,
      description !== undefined ? description : existing.description,
      icon !== undefined ? icon : existing.icon,
      command !== undefined ? command : existing.command,
      args !== undefined ? args : existing.args,
      env_vars !== undefined ? env_vars : existing.env_vars,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      now, req.params.id,
    ]);
  await mcpManager.stopServer(req.params.id);
  const server = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  res.json({ server });
});

app.delete('/api/admin/mcp-servers/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = dbGet(db, 'SELECT * FROM mcp_servers WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'MCP server not found' });
  await mcpManager.stopServer(req.params.id);
  dbRun(db, 'DELETE FROM mcp_servers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// -- User MCP Servers (enabled only, env_vars stripped) ------------------
app.get('/api/mcp-servers', requireAuth, (req, res) => {
  const servers = dbAll(db,
    'SELECT id, name, description, icon, enabled, created_at FROM mcp_servers WHERE enabled = 1 ORDER BY name', []);
  res.json({ servers });
});

// ============================================================================
// SETTINGS ROUTES
// ============================================================================

app.get('/api/settings/profile', requireAuth, (req, res) => {
  const { password_hash, ...safeProfile } = req.user;
  res.json({ profile: safeProfile });
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
  const { password_hash, ...safeProfile } = updated;
  res.json({ profile: safeProfile });
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
    `, [prefId, req.user.id, 'gemini', 0.7, 0, 1, 0, 'light', 1, 1, 1, 0]);

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
    `, [prefId, req.user.id, 'gemini', 0.7, 0, 1, 0, 'light', 1, 1, 1, 0]);

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
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await mcpManager.stopAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await mcpManager.stopAll();
  process.exit(0);
});

export default app;
