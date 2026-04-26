import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('pptx-templates user endpoints', () => {
  let app, dbRun, dbGet, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    const db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ids = await seedTestUsers(dbRun);

    // Insert one template owned by A and one owned by B directly via SQL —
    // we don't need real .pptx files for the access-control checks.
    const now = new Date().toISOString();
    const aTplId = uuidv4();
    const bTplId = uuidv4();
    const minimalManifest = JSON.stringify({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'Test' }] });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Template', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [aTplId, ids.a, minimalManifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Template', 'one_pager', '/fake/b.pptx', NULL, ?, 'active', ?, ?)`,
      [bTplId, ids.b, minimalManifest, now, now]
    );
    ids.aTplId = aTplId;
    ids.bTplId = bTplId;
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 1: list endpoint isolates per user', async () => {
    const aRes = await request(app).get('/api/pptx-templates').set('X-User-Id', ids.a);
    expect(aRes.status).toBe(200);
    const aTemplates = aRes.body.templates || aRes.body;
    expect(aTemplates).toHaveLength(1);
    expect(aTemplates[0].name).toBe('A Template');
    expect(aTemplates.find(t => t.name === 'B Template')).toBeUndefined();

    const bRes = await request(app).get('/api/pptx-templates').set('X-User-Id', ids.b);
    expect(bRes.status).toBe(200);
    const bTemplates = bRes.body.templates || bRes.body;
    expect(bTemplates).toHaveLength(1);
    expect(bTemplates[0].name).toBe('B Template');
    expect(bTemplates.find(t => t.name === 'A Template')).toBeUndefined();
  });

  it('test 4: empty-state path returns [] without leaking other users', async () => {
    const cId = uuidv4();
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, 'c@test.local', 'User C', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
      [cId]
    );
    const res = await request(app).get('/api/pptx-templates').set('X-User-Id', cId);
    expect(res.status).toBe(200);
    const templates = res.body.templates || res.body;
    expect(templates).toEqual([]);
  });
});
