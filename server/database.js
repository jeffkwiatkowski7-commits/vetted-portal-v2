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
      last_login_at TEXT
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
  `);

  dbInstance = db;
  return db;
}

// Get current database instance
export function getDatabase() {
  return dbInstance;
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
