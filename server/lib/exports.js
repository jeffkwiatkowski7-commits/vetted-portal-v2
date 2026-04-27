/**
 * Server-side .docx and .xlsx generation for AI-driven chat exports.
 *
 * buildDocx shells out to `pandoc` to convert markdown → docx. The AI passes
 * a single markdown string and pandoc handles tables, headings, lists, bold/
 * italic, blockquotes, code, etc. natively — no JSON-section schema to drift
 * out of sync with what the model actually wants to emit.
 *
 * Excel export still uses ExcelJS since that's already row/column structured.
 */
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PANDOC_BIN = process.env.PANDOC_BIN || 'pandoc';

export async function buildDocx({ title, markdown }) {
  const body = typeof markdown === 'string' ? markdown : '';
  const trimmed = body.trim();
  // Prepend the title as an H1 unless the markdown already opens with one.
  // Match a single `#` followed by whitespace (not `##`+).
  const startsWithH1 = /^#\s/.test(trimmed);
  const doc = title && !startsWithH1
    ? `# ${title}\n\n${body}`
    : body;

  if (!doc.trim()) {
    throw new Error('buildDocx requires non-empty markdown');
  }

  const buffer = await runPandoc(doc);
  return { buffer, mimeType: DOCX_MIME };
}

function runPandoc(markdown) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(PANDOC_BIN, ['-f', 'markdown', '-t', 'docx', '-o', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`Failed to spawn pandoc: ${err.message}`));
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('pandoc binary not found. Install with `brew install pandoc` (macOS) or `apt install pandoc` (Debian/Ubuntu).'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(`pandoc exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    proc.stdin.on('error', (err) => reject(err));
    proc.stdin.end(markdown, 'utf8');
  });
}

export async function buildXlsx({ sheets }) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets || []) {
    const ws = wb.addWorksheet(sheet.name || 'Sheet1');
    if (sheet.headers?.length) {
      const headerRow = ws.addRow(sheet.headers);
      headerRow.font = { bold: true };
    }
    for (const row of sheet.rows || []) ws.addRow(row);
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, mimeType: XLSX_MIME };
}

export { DOCX_MIME, XLSX_MIME };
