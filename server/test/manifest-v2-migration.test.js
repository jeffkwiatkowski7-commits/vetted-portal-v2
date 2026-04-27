import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PPTX = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

describe('manifest v1→v2 migration (general parallel pass)', () => {
  let db, dbRun, dbGet, dbAll, upgradeManifestsToV2;

  beforeAll(async () => {
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    dbAll = (sql, params) => dbMod.dbAll(db, sql, params);
    upgradeManifestsToV2 = server.upgradeManifestsToV2;

    // Seed user.
    const uid = uuidv4();
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, 'm@test.local', 'M', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
      [uid]
    );

    const v1Manifest = JSON.stringify({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'X' }] });
    const now = new Date().toISOString();

    // Row A: valid path, should upgrade.
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-valid', ?, 'Valid', 'ic_memo', ?, NULL, ?, 'active', ?, ?)`,
      [uid, SAMPLE_PPTX, v1Manifest, now, now]
    );

    // Row B: missing path on disk, should be left at v1 without throwing.
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-missing', ?, 'Missing', 'ic_memo', '/nonexistent/file.pptx', NULL, ?, 'active', ?, ?)`,
      [uid, v1Manifest, now, now]
    );

    // Row C: already v2, should be untouched.
    const v2Manifest = JSON.stringify({
      version: 2,
      slide_count: 1,
      slides: [{ index: 1, title: 'Y' }],
      design_tokens: {
        colors: { primary: '#000', accent: '#fff', background: '#aaa' },
        fonts: { heading: 'A', body: 'B' },
      },
    });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-v2', ?, 'V2', 'ic_memo', ?, NULL, ?, 'active', ?, ?)`,
      [uid, SAMPLE_PPTX, v2Manifest, now, now]
    );
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S2: upgrades v1 rows with valid paths and skips broken ones', async () => {
    await upgradeManifestsToV2(db);

    const valid = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-valid']).manifest_json);
    expect(valid.version).toBe(2);
    expect(valid.design_tokens).toBeDefined();

    const missing = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-missing']).manifest_json);
    expect(missing.version).toBe(1);

    const v2 = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-v2']).manifest_json);
    expect(v2.version).toBe(2);
    expect(v2.design_tokens.colors.primary).toBe('#000'); // unchanged
  });

  it('is idempotent on a second run', async () => {
    await upgradeManifestsToV2(db);
    await upgradeManifestsToV2(db);
    const valid = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-valid']).manifest_json);
    expect(valid.version).toBe(2);
  });
});
