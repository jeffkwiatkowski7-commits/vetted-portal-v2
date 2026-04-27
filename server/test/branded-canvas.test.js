import { describe, it, expect } from 'vitest';
import { getDesignTokens, buildBrandedCanvasBlock } from '../lib/branded-canvas.js';

describe('getDesignTokens', () => {
  it('returns brand defaults for a v1 manifest (no design_tokens)', () => {
    const t = getDesignTokens({ version: 1, slide_count: 1, slides: [] });
    expect(t).toEqual({
      primary: '#1A1A1A',
      accent: '#C4A962',
      background: '#FFFFFF',
      headingFont: 'Playfair Display',
      bodyFont: 'Inter',
    });
  });

  it('falls back per-key for partially populated tokens', () => {
    const t = getDesignTokens({
      version: 2,
      design_tokens: { colors: { primary: '#FF0000' }, fonts: {} },
    });
    expect(t.primary).toBe('#FF0000');
    expect(t.accent).toBe('#C4A962');         // default
    expect(t.background).toBe('#FFFFFF');     // default
    expect(t.headingFont).toBe('Playfair Display'); // default
    expect(t.bodyFont).toBe('Inter');         // default
  });

  it('returns all values when fully populated', () => {
    const t = getDesignTokens({
      version: 2,
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    expect(t).toEqual({
      primary: '#111', accent: '#222', background: '#333',
      headingFont: 'Foo', bodyFont: 'Bar',
    });
  });

  it('handles null/undefined manifest', () => {
    expect(getDesignTokens(null).primary).toBe('#1A1A1A');
    expect(getDesignTokens(undefined).primary).toBe('#1A1A1A');
  });
});

describe('buildBrandedCanvasBlock', () => {
  const tokens = {
    primary: '#1A1A1A', accent: '#C4A962', background: '#FFFFFF',
    headingFont: 'Playfair Display', bodyFont: 'Inter',
  };

  it('test 1: contains layout names, fence keyword, and CSS-variable names', () => {
    const out = buildBrandedCanvasBlock('PREP IC Memo', tokens);

    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);

    // Size budget — ships every assistant turn in a project chat.
    expect(out.length).toBeLessThanOrEqual(2048);

    // 8 layout names.
    for (const layout of ['title', 'section', 'content', 'two-col', 'stat', 'table', 'quote', 'closing']) {
      expect(out).toContain(layout);
    }

    // Fence keyword.
    expect(out).toContain('canvas-deck');

    // Template name interpolated.
    expect(out).toContain('PREP IC Memo');

    // Token JSON literal.
    expect(out).toContain('#C4A962');
    expect(out).toContain('Playfair Display');
  });
});
