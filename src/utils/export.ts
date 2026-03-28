import ExcelJS from 'exceljs';

// Minimal interface — works with both local ChatMessage and global Message types
export interface ExportableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;    // MainChatPage local ChatMessage
  created_at?: string;   // Global Message type
}

// ── Table detection ──────────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Returns true if any assistant message contains a markdown table.
 */
export function hasMarkdownTables(messages: ExportableMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && extractTables(m.content).length > 0
  );
}

/**
 * Extract all markdown tables from a string.
 * A table is consecutive lines starting with `|` that include a separator row (--|--).
 */
function extractTables(text: string): ParsedTable[] {
  const lines = text.split('\n');
  const tables: ParsedTable[] = [];
  let block: string[] = [];

  const flushBlock = () => {
    if (block.length < 3) { block = []; return; }
    const sepIdx = block.findIndex((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
    if (sepIdx < 1) { block = []; return; }

    const parseRow = (line: string): string[] =>
      line.split('|').slice(1, -1).map((c) => c.trim());

    const headers = parseRow(block[sepIdx - 1]);
    const rows: string[][] = [];
    for (let i = sepIdx + 1; i < block.length; i++) {
      const cells = parseRow(block[i]);
      if (cells.length > 0) rows.push(cells);
    }
    if (headers.length > 0 && rows.length > 0) {
      tables.push({ headers, rows });
    }
    block = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      block.push(line);
    } else {
      flushBlock();
    }
  }
  flushBlock();
  return tables;
}

// ── Excel export ─────────────────────────────────────────────────────────────

/**
 * Export markdown tables from messages as an .xlsx file.
 * scope='last' -> only the last table from the last assistant message that has one.
 * scope='all'  -> all tables across all assistant messages.
 */
export async function exportToExcel(
  messages: ExportableMessage[],
  scope: 'last' | 'all',
  chatTitle: string
): Promise<void> {
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  let tables: ParsedTable[] = [];

  if (scope === 'all') {
    for (const msg of assistantMsgs) {
      tables.push(...extractTables(msg.content));
    }
  } else {
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
      const t = extractTables(assistantMsgs[i].content);
      if (t.length > 0) {
        tables = [t[t.length - 1]];
        break;
      }
    }
  }

  if (tables.length === 0) return;

  const workbook = new ExcelJS.Workbook();

  tables.forEach((table, idx) => {
    const sheet = workbook.addWorksheet(`Table ${idx + 1}`);

    const headerRow = sheet.addRow(table.headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F0E6' },
      };
    });

    for (const row of table.rows) {
      sheet.addRow(row);
    }

    sheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${sanitizeFilename(chatTitle)}-tables.xlsx`
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '-') || 'chat-export';
}
