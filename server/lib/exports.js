/**
 * Server-side .docx and .xlsx generation for AI-driven chat exports.
 *
 * Pure builders consumed by the export_to_word / export_to_excel tools
 * registered in server/index.js. Input shape mirrors the JSON Schema
 * exposed to the model so the AI can pass structured content directly.
 */
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TextRun,
} from 'docx';
import ExcelJS from 'exceljs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildDocx({ title, sections }) {
  const children = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  for (const sec of sections || []) {
    if (sec.heading) children.push(new Paragraph({ text: sec.heading, heading: HeadingLevel.HEADING_2 }));
    for (const p of sec.paragraphs || []) children.push(new Paragraph({ children: [new TextRun(p)] }));
    for (const b of sec.bullets || []) children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    if (sec.table) children.push(buildDocxTable(sec.table));
  }
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, mimeType: DOCX_MIME };
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

function buildDocxTable({ headers, rows }) {
  const headerRow = new TableRow({
    children: (headers || []).map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        })
    ),
  });
  const bodyRows = (rows || []).map(
    (r) =>
      new TableRow({
        children: r.map(
          (cell) => new TableCell({ children: [new Paragraph(String(cell ?? ''))] })
        ),
      })
  );
  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export { DOCX_MIME, XLSX_MIME };
