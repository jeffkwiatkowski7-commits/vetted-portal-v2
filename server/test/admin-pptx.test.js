import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('admin pptx-templates endpoint', () => {
  let app, dbRun, dbGet, dbAll, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    const db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    dbAll = (sql, params) => dbMod.dbAll(db, sql, params);
    ids = await seedTestUsers(dbRun);

    const tplId = uuidv4();
    const now = new Date().toISOString();
    const minimalManifest = JSON.stringify({ version: 1, slide_count: 2, slides: [{ index: 1, title: 'X' }, { index: 2, title: 'Y' }] });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Template', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, minimalManifest, now, now]
    );
    ids.aTplId = tplId;
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S3a: non-admin gets 403', async () => {
    const res = await request(app)
      .get(`/api/admin/pptx-templates?user_id=${ids.a}`)
      .set('X-User-Id', ids.b);
    expect(res.status).toBe(403);
  });

  it('S3b: admin gets target user templates AND one audit row is written', async () => {
    const before = dbGet("SELECT COUNT(*) as c FROM audit_log WHERE action = 'pptx_templates.admin_view'", []);

    const res = await request(app)
      .get(`/api/admin/pptx-templates?user_id=${ids.a}`)
      .set('X-User-Id', ids.admin);
    expect(res.status).toBe(200);
    const templates = res.body.templates || res.body;
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('A Template');

    const after = dbGet("SELECT COUNT(*) as c FROM audit_log WHERE action = 'pptx_templates.admin_view'", []);
    expect(after.c).toBe(before.c + 1);

    const row = dbGet(
      "SELECT * FROM audit_log WHERE action = 'pptx_templates.admin_view' ORDER BY created_at DESC LIMIT 1",
      []
    );
    expect(row.user_id).toBe(ids.admin);
    expect(row.resource_type).toBe('pptx_template');
    expect(row.resource_id).toBe(ids.a);
    expect(row.id).toBeTruthy();
  });

  it('S3c: 400 when user_id query param is missing', async () => {
    const res = await request(app)
      .get('/api/admin/pptx-templates')
      .set('X-User-Id', ids.admin);
    expect(res.status).toBe(400);
  });
});
