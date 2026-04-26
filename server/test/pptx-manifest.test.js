import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractManifest, InvalidPptxError } from '../lib/pptx-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PPTX = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

describe('extractManifest', () => {
  it('S1: returns manifest with slide_count and titled slides for the seed pptx', async () => {
    const { manifest, thumbnailBuffer } = await extractManifest(SAMPLE_PPTX);

    expect(manifest.version).toBe(1);
    expect(manifest.slide_count).toBeGreaterThan(0);
    expect(Array.isArray(manifest.slides)).toBe(true);
    expect(manifest.slides.length).toBe(manifest.slide_count);

    for (const s of manifest.slides) {
      expect(typeof s.index).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
    }

    // thumbnailBuffer is null OR a Buffer — both acceptable per spec §6
    if (thumbnailBuffer !== null) {
      expect(Buffer.isBuffer(thumbnailBuffer)).toBe(true);
      expect(thumbnailBuffer.length).toBeGreaterThan(0);
    }
  });

  it('throws InvalidPptxError when given a non-zip file', async () => {
    const notAPptx = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Manifest.json');
    await expect(extractManifest(notAPptx)).rejects.toThrow(InvalidPptxError);
  });
});
