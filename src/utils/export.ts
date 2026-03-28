import ExcelJS from 'exceljs';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';

// Minimal interface — works with both local ChatMessage and global Message types
export interface ExportableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;    // MainChatPage local ChatMessage
  created_at?: string;   // Global Message type
}

// ── Table detection ──────────────────────────────────────────────────────────

export interface ParsedTable {
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
export function extractTables(text: string): ParsedTable[] {
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

/**
 * Export pre-built table data as .xlsx (used by ExportPanel with edited cells).
 */
export async function exportTablesToExcel(
  tables: ParsedTable[],
  chatTitle: string
): Promise<void> {
  if (tables.length === 0) return;
  const workbook = new ExcelJS.Workbook();

  tables.forEach((table, idx) => {
    const sheet = workbook.addWorksheet(`Table ${idx + 1}`);
    const headerRow = sheet.addRow(table.headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0E6' } };
    });
    for (const row of table.rows) { sheet.addRow(row); }
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

/**
 * Export plain text content as a .docx Word document (used by ExportPanel with edited content).
 */
export async function exportTextToWord(
  text: string,
  chatTitle: string
): Promise<void> {
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({ text: chatTitle, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));

  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    children.push(new Paragraph({ text: line, spacing: { before: 60, after: 60 } }));
  }

  const doc = new Document({ sections: [{ children }] });
  const rawBlob = await Packer.toBlob(doc);
  const blob = new Blob([rawBlob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  downloadBlob(blob, `${sanitizeFilename(chatTitle)}-export.docx`);
}

// ── Word export ──────────────────────────────────────────────────────────────

/**
 * Export messages as a .docx Word document.
 * scope='last' -> only the last assistant message.
 * scope='all'  -> entire conversation with role labels and timestamps.
 */
export async function exportToWord(
  messages: ExportableMessage[],
  scope: 'last' | 'all',
  chatTitle: string
): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      text: chatTitle,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  const exportMessages =
    scope === 'last'
      ? [messages.filter((m) => m.role === 'assistant').pop()].filter(Boolean) as ExportableMessage[]
      : messages;

  for (const msg of exportMessages) {
    if (scope === 'all') {
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const time = msg.timestamp || msg.created_at || '';
      const labelRuns: TextRun[] = [
        new TextRun({ text: roleLabel, bold: true, size: 22 }),
      ];
      if (time) {
        labelRuns.push(
          new TextRun({ text: `  ${new Date(time).toLocaleString()}`, color: '888888', size: 18 })
        );
      }
      children.push(new Paragraph({ children: labelRuns, spacing: { before: 300, after: 100 } }));
    }

    children.push(...markdownToDocx(msg.content));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal' as any,
              text: '%1.',
              alignment: 'start' as any,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  const rawBlob = await Packer.toBlob(doc);
  const blob = new Blob([rawBlob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  downloadBlob(blob, `${sanitizeFilename(chatTitle)}-export.docx`);
}

/**
 * Convert markdown text to an array of docx Paragraph/Table elements.
 * Handles: headings, bold/italic, bullet lists, numbered lists, tables, code blocks, plain text.
 */
function markdownToDocx(text: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: codeLines.join('\n'),
              font: 'JetBrains Mono',
              size: 18,
            }),
          ],
          shading: { type: 'clear' as any, color: 'auto', fill: 'F5F5F5' },
          spacing: { before: 100, after: 100 },
        })
      );
      continue;
    }

    // Markdown table block
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseTableBlock(tableLines);
      if (parsed) {
        elements.push(buildDocxTable(parsed));
      }
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
      };
      elements.push(
        new Paragraph({
          text: headingMatch[2],
          heading: headingMap[level] || HeadingLevel.HEADING_4,
          spacing: { before: 200, after: 100 },
        })
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(line.replace(/^\s*[-*]\s+/, '')),
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
        })
      );
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)/);
    if (numberedMatch) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(numberedMatch[1]),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { before: 40, after: 40 },
        })
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Plain text paragraph
    elements.push(
      new Paragraph({
        children: parseInlineFormatting(line),
        spacing: { before: 60, after: 60 },
      })
    );
    i++;
  }

  return elements;
}

/**
 * Parse inline markdown formatting (bold, italic, bold+italic, inline code) into TextRun[].
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: 'JetBrains Mono', size: 18 }));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6] }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

/**
 * Parse a block of table lines into headers + rows.
 */
function parseTableBlock(lines: string[]): ParsedTable | null {
  const sepIdx = lines.findIndex((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
  if (sepIdx < 1) return null;

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map((c) => c.trim());

  const headers = parseRow(lines[sepIdx - 1]);
  const rows: string[][] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.length > 0) rows.push(cells);
  }
  return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
}

/**
 * Build a docx Table from parsed table data.
 */
function buildDocxTable(table: ParsedTable): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: table.headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { type: 'clear' as any, color: 'auto', fill: 'F5F0E6' },
        })
    ),
  });

  const dataRows = table.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ text: cell })],
            })
        ),
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
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
