import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';
import { v4 as uuidv4 } from 'uuid';

const paths = isolateTestDatabase();

describe('ensureWrossIcMemoTemplate', () => {
  let dbRun, dbGet, ensureWrossIcMemoTemplate, db, fs, path;

  beforeAll(async () => {
    fs = await import('fs');
    path = await import('path');
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ensureWrossIcMemoTemplate = server.ensureWrossIcMemoTemplate;

    // Make sure wross exists in this fresh test DB
    const w = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    if (!w) {
      dbRun(
        `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
         VALUES (?, 'wross@prepfunds.net', 'Bill Ross', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
        [uuidv4()]
      );
    }
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S2: running migration twice produces exactly one ic_memo template for wross', async () => {
    const wrossUser = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    dbRun('DELETE FROM pptx_templates WHERE user_id = ?', [wrossUser.id]);
    const wrossDir = path.join(paths.uploadsDir, 'templates', wrossUser.id);
    if (fs.existsSync(wrossDir)) fs.rmSync(wrossDir, { recursive: true, force: true });

    await ensureWrossIcMemoTemplate(db);
    await ensureWrossIcMemoTemplate(db);

    const rows = dbGet(
      'SELECT COUNT(*) as c FROM pptx_templates WHERE user_id = ? AND template_type = ?',
      [wrossUser.id, 'ic_memo']
    );
    expect(rows.c).toBe(1);

    const dirContents = fs.readdirSync(wrossDir).filter(f => f.endsWith('.pptx'));
    expect(dirContents).toHaveLength(1);
  });

  it('migration: skips quietly when wross user does not exist', async () => {
    const wrossUser = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    if (wrossUser) {
      dbRun('DELETE FROM pptx_templates WHERE user_id = ?', [wrossUser.id]);
      dbRun("DELETE FROM users WHERE email = 'wross@prepfunds.net'", []);
    }
    await expect(ensureWrossIcMemoTemplate(db)).resolves.not.toThrow();
  });
});
