/**
 * AES-256-GCM encryption for MCP server env_vars at rest.
 *
 * Storage format (JSON string): { v:1, iv:<hex>, ct:<hex>, tag:<hex> }
 *  - v: format version, lets future migrations change shape
 *  - iv: 12-byte random nonce per encryption (96 bits, GCM standard)
 *  - ct: AES-256-GCM ciphertext of UTF-8 JSON of the env_vars object
 *  - tag: 16-byte authentication tag
 *
 * Key: MCP_SECRET_KEY env var, 64 hex chars (32 bytes / 256 bits).
 * Loss or rotation of the key invalidates every encrypted row.
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let _key = null;

export function getMcpSecretKey() {
  if (_key) return _key;
  const raw = process.env.MCP_SECRET_KEY;
  if (!raw) {
    const suggested = crypto.randomBytes(KEY_BYTES).toString('hex');
    throw new Error(
      `MCP_SECRET_KEY is required for encrypting MCP server credentials at rest.\n` +
      `Add this line to your .env (back it up — losing it invalidates all stored MCP env_vars):\n\n` +
      `  MCP_SECRET_KEY=${suggested}\n`
    );
  }
  const buf = Buffer.from(raw.trim(), 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`MCP_SECRET_KEY must be ${KEY_BYTES * 2} hex chars (${KEY_BYTES} bytes); got ${buf.length} bytes.`);
  }
  _key = buf;
  return _key;
}

export function isEncryptedBlob(stored) {
  if (typeof stored !== 'string' || stored.length === 0) return false;
  let parsed;
  try { parsed = JSON.parse(stored); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return parsed.v === 1 && typeof parsed.iv === 'string' && typeof parsed.ct === 'string' && typeof parsed.tag === 'string';
}

export function encryptEnvVars(envObj) {
  const plaintext = JSON.stringify(envObj ?? {});
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getMcpSecretKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') });
}

export function decryptEnvVars(stored) {
  if (!stored) return {};
  if (!isEncryptedBlob(stored)) {
    // Legacy plaintext fallback — used by the one-shot migration only.
    try { return JSON.parse(stored); } catch { return {}; }
  }
  const { iv, ct, tag } = JSON.parse(stored);
  const decipher = crypto.createDecipheriv(ALGO, getMcpSecretKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
  return JSON.parse(pt);
}

// "sk-a...XYZ9" for ≥8-char values; "••••" otherwise. Never leaks the middle.
export function previewValue(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.length === 0) return '';
  if (s.length < 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function previewEnvVarsObject(envObj) {
  const out = {};
  for (const [k, v] of Object.entries(envObj || {})) out[k] = previewValue(v);
  return out;
}

/**
 * Merge an incoming env_vars set from the admin form against the existing
 * decrypted set. Semantics:
 *  - keys present in `incoming` with a non-empty string value -> set/replace
 *  - keys present in `incoming` with empty string -> keep existing value
 *    (the form pre-populates these as blanks so the admin doesn't see
 *    plaintext credentials but can leave them untouched)
 *  - keys present in `existing` but absent from `incoming` -> remove
 *  - keys present in `incoming` but absent from `existing` with empty value
 *    -> ignored (an empty new key is not a credential)
 */
export function mergeEnvVars(existing, incoming) {
  const exist = existing || {};
  const inc = incoming || {};
  const out = {};
  for (const [k, v] of Object.entries(inc)) {
    if (typeof v === 'string' && v.length === 0) {
      if (Object.prototype.hasOwnProperty.call(exist, k)) out[k] = exist[k];
      // else: dropped (empty value for a brand-new key)
    } else if (v != null) {
      out[k] = String(v);
    }
  }
  return out;
}

/** Parse the env_vars field as it arrives from a request body. */
export function parseIncomingEnvVars(raw) {
  if (raw == null) return null;  // signals "no change"
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    if (raw.length === 0) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}
