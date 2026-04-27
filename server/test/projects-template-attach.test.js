import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('project template attach + cascading detach', () => {
  let app, db, dbRun, dbGet, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ids = await seedTestUsers(dbRun);

    const now = new Date().toISOString();
    const v2Manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    const aTplId = uuidv4();
    const bTplId = uuidv4();
    const archivedTplId = uuidv4();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Tpl', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [aTplId, ids.a, v2Manifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Tpl', 'ic_memo', '/fake/b.pptx', NULL, ?, 'active', ?, ?)`,
      [bTplId, ids.b, v2Manifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Archived', 'ic_memo', '/fake/a-arc.pptx', NULL, ?, 'archived', ?, ?)`,
      [archivedTplId, ids.a, v2Manifest, now, now]
    );
    Object.assign(ids, { aTplId, bTplId, archivedTplId });
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 5: PUT /api/projects/:id rejects cross-user template with 400', async () => {
    // Create a project owned by A.
    const create = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'A Project', description: 'x' });
    expect(create.status).toBe(201);
    const projId = create.body.project.id;

    // Try to attach user B's template via PUT.
    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.bTplId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found|not owned/i);

    // Project's column unchanged.
    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });

  it('test 5: PUT accepts owner template and persists it', async () => {
    const create = await request(app).post('/api/projects').set('X-User-Id', ids.a).send({ name: 'B Project' });
    const projId = create.body.project.id;

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.aTplId });
    expect(res.status).toBe(200);

    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBe(ids.aTplId);
  });

  it('test 5: PUT rejects archived templates with 400', async () => {
    const create = await request(app).post('/api/projects').set('X-User-Id', ids.a).send({ name: 'Archived Project' });
    const projId = create.body.project.id;

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.archivedTplId });
    expect(res.status).toBe(400);
  });

  it('test 5: PUT with null pptx_template_id detaches', async () => {
    // Pre-attach via SQL to skip the API path.
    const projId = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Detach Me', 'active', ?, ?, ?)`,
      [projId, ids.a, ids.aTplId, now, now]
    );

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: null });
    expect(res.status).toBe(200);

    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });

  it('test 5: POST accepts pptx_template_id with ownership validation', async () => {
    const ok = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'POST OK', pptx_template_id: ids.aTplId });
    expect(ok.status).toBe(201);
    expect(ok.body.project.pptx_template_id).toBe(ids.aTplId);

    const bad = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'POST Bad', pptx_template_id: ids.bTplId });
    expect(bad.status).toBe(400);
  });

  it('test 6: DELETE /api/pptx-templates/:id nulls dependent project columns', async () => {
    // Create a fresh template + project, attach, then delete the template.
    const tplId = uuidv4();
    const now = new Date().toISOString();
    const v2Manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'Doomed', 'ic_memo', '/fake/doomed.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, v2Manifest, now, now]
    );
    const projId = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Cascade Project', 'active', ?, ?, ?)`,
      [projId, ids.a, tplId, now, now]
    );

    const res = await request(app)
      .delete(`/api/pptx-templates/${tplId}`)
      .set('X-User-Id', ids.a);
    expect(res.status).toBe(204);

    // Template gone.
    const tpl = dbGet('SELECT * FROM pptx_templates WHERE id = ?', [tplId]);
    expect(tpl).toBeNull();

    // Project's column nulled.
    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });
});
