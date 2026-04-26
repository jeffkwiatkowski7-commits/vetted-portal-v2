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

  it('test 2: detail endpoint returns 404 (not 403) on cross-user access', async () => {
    const res = await request(app).get(`/api/pptx-templates/${ids.bTplId}`).set('X-User-Id', ids.a);
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('B Template');
    expect(body).not.toContain(ids.bTplId);
  });

  it('test 2b: detail endpoint returns own template fully', async () => {
    const res = await request(app).get(`/api/pptx-templates/${ids.aTplId}`).set('X-User-Id', ids.a);
    expect(res.status).toBe(200);
    const tpl = res.body.template || res.body;
    expect(tpl.id).toBe(ids.aTplId);
    expect(tpl.name).toBe('A Template');
    expect(tpl.manifest).toEqual({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'Test' }] });
  });

  it('upload: writes file under user dir, parses manifest, returns row', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Uploaded Template')
      .field('template_type', 'ic_memo')
      .attach('file', samplePath);

    expect(res.status).toBe(201);
    const tpl = res.body.template || res.body;
    expect(tpl.id).toBeTruthy();
    expect(tpl.name).toBe('Uploaded Template');
    expect(tpl.template_type).toBe('ic_memo');
    expect(tpl.slide_count).toBeGreaterThan(0);

    const fs = await import('fs');
    const expectedPath = path.join(paths.uploadsDir, 'templates', ids.a, `${tpl.id}.pptx`);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const row = dbGet('SELECT user_id, name, status FROM pptx_templates WHERE id = ?', [tpl.id]);
    expect(row.user_id).toBe(ids.a);
    expect(row.status).toBe('active');

    ids.aUploadedId = tpl.id;
  });

  it('upload: rejects non-pptx mime', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const notPptx = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Manifest.json');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Should Fail')
      .field('template_type', 'ic_memo')
      .attach('file', notPptx);

    expect(res.status).toBe(400);
  });

  it('upload: rejects invalid template_type', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Bad Type')
      .field('template_type', 'not_a_real_type')
      .attach('file', samplePath);

    expect(res.status).toBe(400);
  });

  it('test 6: list and detail SQL strings filter by user_id in WHERE clause', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const indexJs = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

    const listHandlerMatch = indexJs.match(/app\.get\('\/api\/pptx-templates',[\s\S]*?\}\);/);
    const detailHandlerMatch = indexJs.match(/app\.get\('\/api\/pptx-templates\/:id',[\s\S]*?\}\);/);
    expect(listHandlerMatch, 'list handler must exist').toBeTruthy();
    expect(detailHandlerMatch, 'detail handler must exist').toBeTruthy();
    expect(listHandlerMatch[0]).toMatch(/WHERE user_id = \?/);
    expect(detailHandlerMatch[0]).toMatch(/WHERE id = \? AND user_id = \?/);
  });
});
