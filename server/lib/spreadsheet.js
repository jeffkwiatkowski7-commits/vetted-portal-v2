/**
 * Spawn a Python pandas sidecar to extract a spreadsheet into prompt text,
 * or to run a constrained pandas query against an attached spreadsheet.
 * Uses `uv run` with PEP 723 inline script metadata so deps resolve on first
 * call without a global pip install. Set UV_BIN to override.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "spreadsheet_extract.py");
const UV_BIN = process.env.UV_BIN || "uv";
const TIMEOUT_MS = Number(process.env.SPREADSHEET_EXTRACT_TIMEOUT_MS || 30_000);

// Minimal env for the subprocess — keeps uv functional without leaking the
// portal's secrets (.env vars) into the model-driven query sandbox.
function subprocessEnv() {
  const e = {};
  for (const k of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "XDG_CACHE_HOME"]) {
    if (process.env[k]) e[k] = process.env[k];
  }
  return e;
}

function runSidecar({ args, stdin = null }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(UV_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: subprocessEnv(),
      cwd: "/tmp",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, TIMEOUT_MS);

    proc.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    proc.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`uv spawn failed (${UV_BIN}): ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`pandas sidecar timed out after ${TIMEOUT_MS}ms`));
      if (code !== 0) return reject(new Error(`pandas sidecar exited ${code}: ${stderr.trim() || "no stderr"}`));
      resolve(stdout);
    });
    proc.stdin.on("error", () => { /* swallow EPIPE if child dies early */ });
    if (stdin != null) proc.stdin.end(stdin);
    else proc.stdin.end();
  });
}

export async function extractSpreadsheetText({ buffer, mimeType, filename }) {
  return runSidecar({
    args: [
      "run", "--quiet", "--python-preference", "only-system",
      "--script", SCRIPT_PATH,
      "extract", "--mime", mimeType, "--filename", filename || "(input)",
    ],
    stdin: buffer,
  });
}

export async function runSpreadsheetQuery({ filePath, mimeType, sheet = null, code }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("pandas_query requires a non-empty `code` string");
  }
  const args = [
    "run", "--quiet", "--python-preference", "only-system",
    "--script", SCRIPT_PATH,
    "query", "--file", filePath, "--mime", mimeType,
  ];
  if (sheet) args.push("--sheet", sheet);
  return runSidecar({ args, stdin: code });
}
