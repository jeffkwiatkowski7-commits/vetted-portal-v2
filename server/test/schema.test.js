import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('pptx_templates schema', () => {
  let dbAll;
  beforeAll(async () => {
    await import('../index.js');
    const dbMod = await import('../database.js');
    dbAll = (sql, params) => dbMod.dbAll(dbMod.getDatabase(), sql, params);
  });
  afterAll(() => cleanupTestPaths(paths));

  it('has the pptx_templates table with expected columns', () => {
    const cols = dbAll('PRAGMA table_info(pptx_templates)', []);
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual([
      'created_at', 'id', 'manifest_json', 'name', 'source_pptx_path',
      'status', 'template_type', 'thumbnail_path', 'updated_at', 'user_id',
    ]);
  });

  it('has the three indexes', () => {
    const idxs = dbAll(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pptx_templates'",
      []
    );
    const names = idxs.map(i => i.name).sort();
    expect(names).toContain('idx_pptx_templates_user_id');
    expect(names).toContain('idx_pptx_templates_user_type');
    expect(names).toContain('idx_pptx_templates_user_status');
  });
});
