import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('system-prompt branded canvas block', () => {
  let db, dbRun, dbGet, ids, applyBrandedCanvasBlock;

  beforeAll(async () => {
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    applyBrandedCanvasBlock = server.applyBrandedCanvasBlock;
    ids = await seedTestUsers(dbRun);

    // Seed a v2 template owned by user A.
    const tplId = uuidv4();
    const manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'Branded Tpl', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, manifest, now, now]
    );

    // Project owned by A with template attached.
    const projAttached = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Attached', 'active', ?, ?, ?)`,
      [projAttached, ids.a, tplId, now, now]
    );

    // Project owned by A with no template.
    const projUnattached = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Unattached', 'active', NULL, ?, ?)`,
      [projUnattached, ids.a, now, now]
    );

    // Cross-user trap: project owned by A, but stamped with user B's template id.
    // The chat-time SELECT filters by owner_id, so this should NOT pick up the brand block.
    const projCrossUser = uuidv4();
    const bTplId = uuidv4();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Tpl', 'ic_memo', '/fake/b.pptx', NULL, ?, 'active', ?, ?)`,
      [bTplId, ids.b, manifest, now, now]
    );
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'CrossUser', 'active', ?, ?, ?)`,
      [projCrossUser, ids.a, bTplId, now, now]
    );

    Object.assign(ids, { tplId, projAttached, projUnattached, projCrossUser });
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 3: appends brand block when project has a template', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projAttached]);
    const parts = [];
    applyBrandedCanvasBlock(db, project, parts);
    const joined = parts.join('\n');
    expect(joined).toContain('canvas-deck');
    expect(joined).toContain('Branded Tpl');
  });

  it('test 3: skips brand block when project has no template', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projUnattached]);
    const parts = [];
    applyBrandedCanvasBlock(db, project, parts);
    expect(parts).toHaveLength(0);
  });

  it('test 4: skips brand block when template owner != project owner (defense in depth)', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projCrossUser]);
    const parts = [];
    expect(() => applyBrandedCanvasBlock(db, project, parts)).not.toThrow();
    expect(parts).toHaveLength(0);
  });

  it('S3: chat-time template SELECT contains owner-scoped WHERE clause (static check)', () => {
    const src = fs.readFileSync('server/index.js', 'utf8');
    // The SELECT must filter on both id and user_id. Allow flexible whitespace,
    // case-sensitive keywords, and require the same statement contains both.
    const re = /SELECT[^;]+FROM\s+pptx_templates\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i;
    expect(re.test(src)).toBe(true);
  });
});
