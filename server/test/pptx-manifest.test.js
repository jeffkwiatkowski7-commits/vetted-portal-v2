import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractManifest, InvalidPptxError } from '../lib/pptx-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PPTX = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

describe('extractManifest', () => {
  it('S1: returns v2 manifest with design_tokens for the seed pptx', async () => {
    const { manifest, thumbnailBuffer } = await extractManifest(SAMPLE_PPTX);

    expect(manifest.version).toBe(2);
    expect(manifest.slide_count).toBeGreaterThan(0);
    expect(Array.isArray(manifest.slides)).toBe(true);
    expect(manifest.slides.length).toBe(manifest.slide_count);

    for (const s of manifest.slides) {
      expect(typeof s.index).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
    }

    // Design tokens — three colors and two fonts, all non-empty strings.
    expect(manifest.design_tokens).toBeDefined();
    expect(typeof manifest.design_tokens.colors.primary).toBe('string');
    expect(typeof manifest.design_tokens.colors.accent).toBe('string');
    expect(typeof manifest.design_tokens.colors.background).toBe('string');
    expect(manifest.design_tokens.colors.primary.length).toBeGreaterThan(0);
    expect(typeof manifest.design_tokens.fonts.heading).toBe('string');
    expect(typeof manifest.design_tokens.fonts.body).toBe('string');
    expect(manifest.design_tokens.fonts.heading.length).toBeGreaterThan(0);

    expect(Buffer.isBuffer(thumbnailBuffer)).toBe(true);
    expect(thumbnailBuffer.length).toBeGreaterThan(0);

    const realTitles = manifest.slides.filter(s => !/^Slide \d+( \(parse error\))?$/.test(s.title));
    expect(realTitles.length).toBeGreaterThan(0);
  });

  it('throws InvalidPptxError when given a non-zip file', async () => {
    const notAPptx = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Manifest.json');
    await expect(extractManifest(notAPptx)).rejects.toThrow(InvalidPptxError);
  });
});
