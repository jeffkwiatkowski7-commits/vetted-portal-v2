import fs from 'fs';
import path from 'path';
import os from 'os';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Must be called BEFORE importing `server/index.js`.
// Sets DATABASE_PATH + NODE_ENV so the module-level init uses a throwaway file
// and `app.listen` is skipped.
export function isolateTestDatabase() {
  process.env.NODE_ENV = 'test';
  process.env.DEMO_MODE = 'false';
  process.env.SEED_DEMO_DATA = 'false';
  const tmpFile = path.join(os.tmpdir(), `vetted-test-${uuidv4()}.db`);
  process.env.DATABASE_PATH = tmpFile;
  // Also redirect uploads to a temp dir so tests don't pollute ./data/uploads
  const tmpUploads = path.join(os.tmpdir(), `vetted-test-uploads-${uuidv4()}`);
  fs.mkdirSync(tmpUploads, { recursive: true });
  process.env.UPLOAD_DIR = tmpUploads;
  return { dbFile: tmpFile, uploadsDir: tmpUploads };
}

// Insert two regular users (A, B) and one admin. Returns their IDs.
// Call AFTER the server module has been imported (so the schema exists).
export async function seedTestUsers(dbRun) {
  const now = new Date().toISOString();
  const hash = await bcrypt.hash('test', 10);
  const a = uuidv4();
  const b = uuidv4();
  const admin = uuidv4();
  for (const [id, email, name, role] of [
    [a, 'a@test.local', 'User A', 'user'],
    [b, 'b@test.local', 'User B', 'user'],
    [admin, 'admin@test.local', 'Admin', 'admin'],
  ]) {
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, email, name, role, hash, now, now]
    );
  }
  return { a, b, admin };
}

// Cleanup helper for afterAll hooks
export function cleanupTestPaths({ dbFile, uploadsDir }) {
  try { fs.unlinkSync(dbFile); } catch {}
  try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch {}
}
