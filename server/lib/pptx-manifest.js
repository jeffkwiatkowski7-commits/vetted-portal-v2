import fs from 'fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export class InvalidPptxError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidPptxError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

// Walks an arbitrarily-nested object looking for any `t` text node and concatenates them.
// Used to extract the title text from inside a placeholder shape — the text can be split
// across multiple <a:r><a:t>...</a:t></a:r> runs.
function collectText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return out; }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 't') {
        if (Array.isArray(v)) for (const tv of v) out.push(typeof tv === 'string' ? tv : (tv?.['#text'] ?? ''));
        else out.push(typeof v === 'string' ? v : (v?.['#text'] ?? ''));
      } else if (!k.startsWith('@_')) {
        collectText(v, out);
      }
    }
  }
  return out;
}

// Within a parsed slide XML, find the <p:sp> whose <p:nvSpPr><p:nvPr><p:ph type="title|ctrTitle"/>
// is set, and pull the concatenated text out of its txBody.
function extractTitleFromSlide(slideObj) {
  const sld = slideObj?.sld;
  if (!sld) return null;
  const cSld = sld.cSld;
  const spTree = cSld?.spTree;
  if (!spTree) return null;
  const sps = Array.isArray(spTree.sp) ? spTree.sp : (spTree.sp ? [spTree.sp] : []);
  for (const sp of sps) {
    const ph = sp?.nvSpPr?.nvPr?.ph;
    const phType = ph?.['@_type'];
    if (phType === 'title' || phType === 'ctrTitle') {
      const text = collectText(sp.txBody).join('').trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

/**
 * Extract slide titles + slide-1 thumbnail from a .pptx file.
 *
 * @param {string} filePath - absolute path to a .pptx file
 * @returns {Promise<{ manifest: object, thumbnailBuffer: Buffer | null }>}
 * @throws {InvalidPptxError} if the file isn't a valid pptx zip or lacks ppt/presentation.xml
 */
export async function extractManifest(filePath) {
  const buf = await fs.promises.readFile(filePath);

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new InvalidPptxError(`File is not a valid .pptx: ${e.message}`);
  }

  const presentationXmlFile = zip.file('ppt/presentation.xml');
  if (!presentationXmlFile) {
    throw new InvalidPptxError('File is not a valid .pptx (missing ppt/presentation.xml)');
  }

  const presentationXml = await presentationXmlFile.async('string');
  const presentationObj = parser.parse(presentationXml);

  const sldIdLst = presentationObj?.presentation?.sldIdLst?.sldId;
  const sldIds = Array.isArray(sldIdLst) ? sldIdLst : (sldIdLst ? [sldIdLst] : []);
  const slideCount = sldIds.length;

  // For each slide N, parse ppt/slides/slideN.xml and extract its title.
  // We use 1..N positional naming because that's the standard pptx convention.
  const slides = [];
  for (let i = 1; i <= slideCount; i++) {
    const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
    if (!slideFile) {
      slides.push({ index: i, title: `Slide ${i}` });
      continue;
    }
    let title;
    try {
      const slideXml = await slideFile.async('string');
      const slideObj = parser.parse(slideXml);
      title = extractTitleFromSlide(slideObj);
    } catch {
      slides.push({ index: i, title: `Slide ${i} (parse error)` });
      continue;
    }
    slides.push({ index: i, title: title && title.length > 0 ? title : `Slide ${i}` });
  }

  // Slide-1 thumbnail (optional)
  const thumbFile = zip.file('ppt/thumbnail.jpeg');
  const thumbnailBuffer = thumbFile ? Buffer.from(await thumbFile.async('uint8array')) : null;

  return {
    manifest: { version: 1, slide_count: slideCount, slides },
    thumbnailBuffer,
  };
}
