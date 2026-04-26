import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/vetted_portal.db');

let SQL = null;
let dbInstance = null;

// Initialize sql.js and create/load database
export async function initializeDatabase() {
  if (SQL === null) {
    SQL = await initSqlJs();
  }

  let db;

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create all tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      job_title TEXT,
      department TEXT,
      role TEXT DEFAULT 'user',
      avatar_path TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      system_prompt TEXT,
      is_shared INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_used TEXT,
      token_count INTEGER,
      reasoning TEXT,
      attachments TEXT,
      images TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_model TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.7,
      tool_sets TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      permission TEXT DEFAULT 'viewer',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS library_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      project_id TEXT,
      uploaded_at TEXT NOT NULL,
      index_status TEXT DEFAULT NULL,
      library_visible INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      category TEXT,
      system_prompt TEXT,
      model TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      tool_sets TEXT,
      visibility TEXT DEFAULT 'all',
      status TEXT DEFAULT 'active',
      usage_count INTEGER DEFAULT 0,
      route TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS app_categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_sets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      tools TEXT NOT NULL,
      api_config TEXT,
      status TEXT DEFAULT 'active',
      usage_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_prompts (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      prompt_text TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      model_name TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      icon_color TEXT,
      is_default INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      max_tokens INTEGER DEFAULT 4096,
      rate_limit INTEGER DEFAULT 60,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_preview TEXT NOT NULL,
      permissions TEXT NOT NULL,
      expires_at TEXT,
      status TEXT DEFAULT 'active',
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      default_model TEXT,
      default_temperature REAL DEFAULT 0.7,
      show_reasoning INTEGER DEFAULT 0,
      auto_scroll INTEGER DEFAULT 1,
      compact_view INTEGER DEFAULT 0,
      code_theme TEXT DEFAULT 'light',
      notify_shared_chat INTEGER DEFAULT 1,
      notify_project_updates INTEGER DEFAULT 1,
      notify_system INTEGER DEFAULT 1,
      notify_weekly_summary INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chat_shares (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      shared_with TEXT NOT NULL,
      permission TEXT DEFAULT 'view',
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id),
      FOREIGN KEY (shared_by) REFERENCES users(id),
      FOREIGN KEY (shared_with) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
    CREATE INDEX IF NOT EXISTS idx_library_files_user_id ON library_files(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

    CREATE TABLE IF NOT EXISTS usage_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_log_user_id ON usage_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_log_source ON usage_log(source);
    CREATE INDEX IF NOT EXISTS idx_usage_log_model ON usage_log(model);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_files (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      library_file_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      FOREIGN KEY (library_file_id) REFERENCES library_files(id),
      UNIQUE(skill_id, library_file_id)
    );

    CREATE TABLE IF NOT EXISTS project_skills (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      UNIQUE(project_id, skill_id)
    );

    CREATE INDEX IF NOT EXISTS idx_skill_files_skill_id ON skill_files(skill_id);
    CREATE INDEX IF NOT EXISTS idx_project_skills_project_id ON project_skills(project_id);

    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      route TEXT,
      stack TEXT,
      user_agent TEXT,
      count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_error_log_last_seen ON error_log(last_seen);

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      command TEXT NOT NULL,
      args TEXT,
      env_vars TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Scheduled tasks: Claude-desktop-style recurring or on-demand prompts.
    -- The runner endpoint is invoked by Cloud Scheduler / Cloud Tasks (or manually).
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      prompt TEXT NOT NULL,
      model TEXT,
      system_prompt TEXT,
      project_id TEXT,
      mcp_servers TEXT,                -- JSON array of mcp_server ids
      schedule_type TEXT NOT NULL,     -- 'cron' | 'interval' | 'once' | 'manual'
      cron_expression TEXT,            -- e.g. '0 9 * * MON'
      timezone TEXT DEFAULT 'UTC',
      enabled INTEGER NOT NULL DEFAULT 1,
      delivery TEXT,                   -- JSON: { type: 'notification' | 'chat' | 'email', target?: '...' }
      cloud_scheduler_job TEXT,        -- name of the GCP Cloud Scheduler job, if synced
      last_run_at TEXT,
      next_run_at TEXT,
      last_status TEXT,                -- 'success' | 'error' | null
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at) WHERE enabled = 1;

    -- One row per execution. Lets the user see history + debug failures.
    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,             -- 'running' | 'success' | 'error'
      result_text TEXT,
      error_message TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER,
      trigger TEXT,                     -- 'scheduler' | 'manual' | 'tool'
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON scheduled_task_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_started_at ON scheduled_task_runs(started_at);
  `);

  // Add index_status column to existing databases (ignore if already exists)
  try {
    db.run(`ALTER TABLE library_files ADD COLUMN index_status TEXT DEFAULT NULL`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add mcp_servers column to chats and projects
  try { db.run(`ALTER TABLE chats ADD COLUMN mcp_servers TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
  try { db.run(`ALTER TABLE projects ADD COLUMN mcp_servers TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }

  // Add images column to messages for clipboard image paste
  try { db.run(`ALTER TABLE messages ADD COLUMN images TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }

  // Add library_visible flag for chat-export files (hidden until "Add to Library")
  try { db.run(`ALTER TABLE library_files ADD COLUMN library_visible INTEGER DEFAULT 1`); } catch (e) { /* already exists */ }

  // Migrate MCP servers: remove broken packages, fix Sequential Thinking package name
  try {
    db.run(`DELETE FROM mcp_servers WHERE id IN ('mcp-brave-search', 'mcp-fetch', 'mcp-puppeteer')`);
    db.run(`UPDATE mcp_servers SET args = '${JSON.stringify(['-y', '@modelcontextprotocol/server-sequential-thinking']).replace(/'/g, "''")}' WHERE id = 'mcp-sequential-thinking'`);
    saveDatabase(db);
  } catch (e) { /* table may not exist yet */ }

  // Seed default MCP servers
  const existingMcp = dbGet(db, 'SELECT id FROM mcp_servers LIMIT 1', []);
  if (!existingMcp) {
    const now = new Date().toISOString();
    const mcpServers = [
      {
        id: 'mcp-memory',
        name: 'Memory',
        description: 'Persistent knowledge graph that remembers information across conversations. The AI can store and recall entities (clients, properties, lease terms), relationships between them, and specific observations. Useful for building up institutional knowledge over time — the AI remembers what you\'ve told it about a client\'s preferences, a property\'s history, or a deal\'s key terms without re-uploading documents.',
        icon: 'brain',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-memory']),
        env_vars: JSON.stringify({}),
        enabled: 1,
      },
      {
        id: 'mcp-sequential-thinking',
        name: 'Sequential Thinking',
        description: 'Structured reasoning for complex analysis. Gives the AI a step-by-step thinking scratchpad for problems that require careful multi-stage reasoning — lease comparisons across multiple properties, financial modeling, portfolio-level analysis, or any question where the AI needs to break down the problem, consider multiple factors, and build toward a conclusion methodically.',
        icon: 'lightbulb',
        command: 'npx',
        args: JSON.stringify(['-y', '@modelcontextprotocol/server-sequential-thinking']),
        env_vars: JSON.stringify({}),
        enabled: 1,
      },
    ];
    for (const s of mcpServers) {
      dbRun(db, `INSERT INTO mcp_servers (id, name, description, icon, command, args, env_vars, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.name, s.description, s.icon, s.command, s.args, s.env_vars, s.enabled, now, now]);
    }
  }

  dbInstance = db;
  return db;
}

// Get current database instance
export function getDatabase() {
  return dbInstance;
}

const COST_RATES = [
  { prefix: 'gemini-3-flash', input: 0.075, output: 0.30 },
  { prefix: 'gemini-2.0-flash', input: 0.075, output: 0.30 },
  { prefix: 'gemini-1.5-flash', input: 0.075, output: 0.30 },
  { prefix: 'gemini-1.5-pro',   input: 1.25,  output: 5.00 },
  { prefix: 'gpt-4o',           input: 2.50,  output: 10.00 },
  { prefix: 'claude-sonnet',    input: 3.00,  output: 15.00 },
];
const DEFAULT_RATE = { input: 1.00, output: 4.00 };

function computeCost(model, inputTokens, outputTokens) {
  const rate = COST_RATES.find(r => (model || '').startsWith(r.prefix)) || DEFAULT_RATE;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

export function logUsage(db, { userId, source, prompt, model, inputTokens, outputTokens }) {
  if (!db) return;
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);
  const estimatedCost = computeCost(model, inputTokens || 0, outputTokens || 0);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dbRun(db, `
    INSERT INTO usage_log (id, user_id, source, prompt, model, input_tokens, output_tokens, total_tokens, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, userId || null, source, prompt || null, model || null,
      inputTokens || 0, outputTokens || 0, totalTokens,
      Math.round(estimatedCost * 100000) / 100000,
      new Date().toISOString()]);
}

// Save database to file
function saveDatabase(db) {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper function to convert sql.js result to array of objects
function rowsToObjects(columns, values) {
  return values.map(row => {
    const obj = {};
    columns.forEach((col, index) => {
      obj[col] = row[index];
    });
    return obj;
  });
}

// Execute a query and return all rows as objects
export function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();

  return results;
}

// Execute a query and return first row as object
export function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);

  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();

  return result;
}

// Execute a statement (INSERT, UPDATE, DELETE)
export function dbRun(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();

  // Auto-save to file after mutations
  saveDatabase(db);
}

// Execute multiple statements
export function dbRunMultiple(db, statements) {
  for (const { sql, params } of statements) {
    dbRun(db, sql, params);
  }
}
