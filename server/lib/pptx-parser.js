import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

const MAX_MEDIA_SIZE = 500 * 1024; // 500KB
const MAX_MEDIA_COUNT = 10;

/**
 * Extract a hex color string from a PowerPoint color element.
 * Handles <a:srgbClr val="RRGGBB"/> and <a:sysClr lastClr="RRGGBB"/>.
 */
function extractColor(el) {
  if (!el) return null;
  if (el.srgbClr) {
    let hex = el.srgbClr['@_val'] || (typeof el.srgbClr === 'string' ? el.srgbClr : null);
    if (hex) return applyLumModifiers(hex, el.srgbClr);
    return null;
  }
  if (el.sysClr) {
    let hex = el.sysClr['@_lastClr'] || el.sysClr['@_val'];
    if (hex) return applyLumModifiers(hex, el.sysClr);
    return null;
  }
  return null;
}

/**
 * Apply lumMod/lumOff tint/shade modifiers to a hex color.
 */
function applyLumModifiers(hex, node) {
  if (!node || typeof node !== 'object') return `#${hex}`;
  const lumMod = node.lumMod?.['@_val'] || node.lumMod;
  const lumOff = node.lumOff?.['@_val'] || node.lumOff;
  if (!lumMod && !lumOff) return `#${hex}`;

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  if (lumMod) l = l * (parseInt(lumMod, 10) / 100000);
  if (lumOff) l = l + (parseInt(lumOff, 10) / 100000);
  l = Math.max(0, Math.min(1, l));

  let r2, g2, b2;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/**
 * Extract theme colors from a:clrScheme element.
 */
function extractColors(clrScheme) {
  if (!clrScheme) return {};
  const colorNames = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const outputNames = ['dark1', 'light1', 'dark2', 'light2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hyperlink', 'followedHyperlink'];
  const colors = {};
  colorNames.forEach((name, i) => {
    const color = extractColor(clrScheme[name]);
    if (color) colors[outputNames[i]] = color;
  });
  return colors;
}

/**
 * Extract heading and body fonts from theme font scheme.
 */
function extractFonts(fontScheme) {
  if (!fontScheme) return {};
  const fonts = {};
  const major = fontScheme.majorFont;
  const minor = fontScheme.minorFont;
  if (major?.latin?.['@_typeface']) fonts.heading = major.latin['@_typeface'];
  if (minor?.latin?.['@_typeface']) fonts.body = minor.latin['@_typeface'];
  return fonts;
}

/**
 * Extract background from slide master.
 */
function extractBackground(slideMasterXml) {
  if (!slideMasterXml) return [];
  const bg = slideMasterXml.sldMaster?.cSld?.bg?.bgPr;
  if (!bg) return [];

  if (bg.solidFill) {
    const color = extractColor(bg.solidFill);
    if (color) return [{ type: 'solid', color }];
  }

  if (bg.gradFill) {
    const gsLst = bg.gradFill.gsLst?.gs;
    if (gsLst) {
      const stops = (Array.isArray(gsLst) ? gsLst : [gsLst]).map(gs => ({
        color: extractColor(gs) || '#000000',
        position: parseInt(gs['@_pos'] || '0', 10) / 1000,
      }));
      return [{ type: 'gradient', stops }];
    }
  }

  return [];
}

/**
 * Extract layout names and placeholders from slide layout XML files.
 */
function extractLayout(layoutXml) {
  if (!layoutXml?.sldLayout) return null;
  const layout = layoutXml.sldLayout;
  const name = layout.cSld?.['@_name'] || layout['@_type'] || 'Unknown';
  const spTree = layout.cSld?.spTree?.sp;
  const shapes = Array.isArray(spTree) ? spTree : spTree ? [spTree] : [];
  const placeholders = shapes
    .map(sp => sp.nvSpPr?.nvPr?.ph?.['@_type'])
    .filter(Boolean);
  return { name, placeholders };
}

/**
 * Main entry point. Parses a .pptx file buffer and returns design tokens.
 * @param {Buffer} fileBuffer - The raw .pptx file bytes
 * @param {string} [fallbackName] - Filename to use if presentation.xml has no name
 * @returns {Promise<{tokens?: object, error?: string, skippedMedia?: string[]}>}
 */
export async function parsePptxTemplate(fileBuffer, fallbackName = 'Untitled') {
  let zip;
  try {
    zip = await JSZip.loadAsync(fileBuffer);
  } catch {
    return { error: 'File is not a valid PowerPoint file' };
  }

  const themeFile = zip.file('ppt/theme/theme1.xml');
  if (!themeFile) {
    return { error: 'No theme found in this PowerPoint file' };
  }
  const themeXml = parser.parse(await themeFile.async('text'));
  const themeElements = themeXml.theme?.themeElements;
  const colors = extractColors(themeElements?.clrScheme);
  const fonts = extractFonts(themeElements?.fontScheme);

  let name = fallbackName.replace(/\.pptx$/i, '');
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml = parser.parse(await presFile.async('text'));
    const presName = presXml.presentation?.['@_name'];
    if (presName) name = presName;
  }

  let backgrounds = [];
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml');
  if (masterFile) {
    const masterXml = parser.parse(await masterFile.async('text'));
    backgrounds = extractBackground(masterXml);
  }

  const layouts = [];
  const layoutFiles = zip.file(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
  for (const lf of layoutFiles) {
    const layoutXml = parser.parse(await lf.async('text'));
    const layout = extractLayout(layoutXml);
    if (layout) layouts.push(layout);
  }

  const media = [];
  const skippedMedia = [];
  const mediaFiles = zip.file(/^ppt\/media\//);
  for (const mf of mediaFiles) {
    if (media.length >= MAX_MEDIA_COUNT) {
      skippedMedia.push(`${mf.name} (max ${MAX_MEDIA_COUNT} media limit reached)`);
      continue;
    }
    const ext = '.' + mf.name.split('.').pop().toLowerCase();
    const mimeType = MIME_MAP[ext];
    if (!mimeType) {
      skippedMedia.push(`${mf.name} (unsupported format)`);
      continue;
    }
    const data = await mf.async('uint8array');
    if (data.byteLength > MAX_MEDIA_SIZE) {
      skippedMedia.push(`${mf.name} (${Math.round(data.byteLength / 1024)}KB exceeds 500KB limit)`);
      continue;
    }
    media.push({
      filename: mf.name.split('/').pop(),
      data: Buffer.from(data).toString('base64'),
      type: mimeType,
    });
  }

  const tokens = { name, colors, fonts };
  if (backgrounds.length > 0) tokens.backgrounds = backgrounds;
  if (layouts.length > 0) tokens.layouts = layouts;
  if (media.length > 0) tokens.media = media;

  return { tokens, skippedMedia };
}
