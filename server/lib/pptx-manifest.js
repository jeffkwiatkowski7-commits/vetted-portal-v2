import fs from 'fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { extractColors, extractFonts } from './pptx-parser.js';

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

// Within a parsed slide XML, find the title shape using a 4-strategy fallback chain.
// Handles both standard OOXML decks and custom-designed/Keynote-export decks where
// the title placeholder may not carry an explicit type attribute.
function extractTitleFromSlide(slideObj) {
  const sld = slideObj?.sld;
  if (!sld) return null;
  const spTree = sld.cSld?.spTree;
  if (!spTree) return null;
  const sps = Array.isArray(spTree.sp) ? spTree.sp : (spTree.sp ? [spTree.sp] : []);

  // Extract trimmed text from a shape's txBody. Returns null if empty.
  const shapeText = (sp) => {
    const text = collectText(sp.txBody).join('').trim();
    return text.length > 0 ? text : null;
  };

  // Strategy 1: explicit title/ctrTitle placeholder type
  for (const sp of sps) {
    const phType = sp?.nvSpPr?.nvPr?.ph?.['@_type'];
    if (phType === 'title' || phType === 'ctrTitle') {
      const t = shapeText(sp);
      if (t) return t;
    }
  }

  // Strategy 2: shape named "Title*" (Keynote/PowerPoint convention for designed decks)
  for (const sp of sps) {
    const name = sp?.nvSpPr?.cNvPr?.['@_name'];
    if (name && /^title/i.test(name)) {
      const t = shapeText(sp);
      if (t) return t;
    }
  }

  // Strategy 3: placeholder at idx=0 (conventionally the title slot)
  for (const sp of sps) {
    const ph = sp?.nvSpPr?.nvPr?.ph;
    if (ph && ph['@_idx'] === '0') {
      const t = shapeText(sp);
      if (t) return t;
    }
  }

  // Strategy 4: first text-bearing shape (heuristic, truncated to 80 chars)
  for (const sp of sps) {
    const t = shapeText(sp);
    if (t) return t.length > 80 ? t.slice(0, 77) + '...' : t;
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

  // Document thumbnail (optional). The OOXML spec puts it at docProps/thumbnail.jpeg;
  // some tools alternately use ppt/thumbnail.jpeg or .png variants.
  const thumbFile =
    zip.file('docProps/thumbnail.jpeg') ||
    zip.file('docProps/thumbnail.jpg') ||
    zip.file('docProps/thumbnail.png') ||
    zip.file('ppt/thumbnail.jpeg') ||
    zip.file('ppt/thumbnail.jpg') ||
    zip.file('ppt/thumbnail.png');
  const thumbnailBuffer = thumbFile ? Buffer.from(await thumbFile.async('uint8array')) : null;

  // Design tokens (v2). Extracted from ppt/theme/theme1.xml. Wrapped — a
  // missing or malformed theme falls back to brand defaults; never throws.
  let designTokens = {
    colors:
      { primary: '#1A1A1A', accent: '#C4A962', background: '#FFFFFF' },
    fonts:
      { heading: 'Playfair Display', body: 'Inter' },
  };
  try {
    const themeFile = zip.file('ppt/theme/theme1.xml');
    if (themeFile) {
      const themeXml = await themeFile.async('string');
      const themeObj = parser.parse(themeXml);
      const themeElements = themeObj?.theme?.themeElements;
      const colors = extractColors(themeElements?.clrScheme);
      const fonts = extractFonts(themeElements?.fontScheme);
      // Map pptx semantic names to our three-key vocabulary.
      // dark1/dk1 = primary text, accent1 = brand accent, light1/lt1 = background.
      designTokens = {
        colors: {
          primary:    colors.dark1   || designTokens.colors.primary,
          accent:     colors.accent1 || designTokens.colors.accent,
          background: colors.light1  || designTokens.colors.background,
        },
        fonts: {
          heading: fonts.heading || designTokens.fonts.heading,
          body:    fonts.body    || designTokens.fonts.body,
        },
      };
    }
  } catch {
    // Keep defaults.
  }

  return {
    manifest: {
      version: 2,
      slide_count: slideCount,
      slides,
      design_tokens: designTokens,
    },
    thumbnailBuffer,
  };
}
