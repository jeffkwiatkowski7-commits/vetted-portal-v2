// Pure helpers for the project-scoped branded canvas feature.
// No DB, no IO. Used by the system-prompt assembler and tests.

const DEFAULTS = {
  primary: '#1A1A1A',
  accent: '#C4A962',
  background: '#FFFFFF',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
};

export function getDesignTokens(manifest) {
  const t = manifest?.design_tokens;
  return {
    primary:     t?.colors?.primary     || DEFAULTS.primary,
    accent:      t?.colors?.accent      || DEFAULTS.accent,
    background:  t?.colors?.background  || DEFAULTS.background,
    headingFont: t?.fonts?.heading      || DEFAULTS.headingFont,
    bodyFont:    t?.fonts?.body         || DEFAULTS.bodyFont,
  };
}

export function buildBrandedCanvasBlock(templateName, tokens) {
  const tokenJson = JSON.stringify(tokens);
  return `## Branded canvas mode

You are working in a project branded with the "${templateName}" template. When the user asks for presentation-style output (e.g. "build me an IC memo for X", "draft a one-pager", "show me a deck", "make a property summary slide"), emit a single \`\`\`canvas-deck fenced block. For all other requests (e.g. "what's the cap rate?", "summarize this lease", "explain X"), respond with normal markdown.

Format:

\`\`\`canvas-deck
<!--TOKENS:${tokenJson}-->
<section data-layout="title">
  <h1>Investment Committee Memo</h1>
  <p class="subtitle">Hilliard Acquisition · April 2026</p>
</section>
<section data-layout="content">
  <h2>Investment Thesis</h2>
  <ul><li>Stable cash flow</li><li>Strategic location</li></ul>
</section>
\`\`\`

Layouts (set via the data-layout attribute, applied via --brand-primary, --brand-accent, --font-heading, --font-body CSS variables):
- title:    cover slide; <h1> + optional <p class="subtitle">
- section:  divider; large <h1>
- content:  default body slide; <h2> + paragraphs/lists
- two-col:  side-by-side; two <div class="col"> children
- stat:     hero number; <p class="stat">$12.4M</p> + <p class="caption">
- table:    data tables; one <table>
- quote:    pull quote; <blockquote> + optional <cite>
- closing:  thank-you / next steps; <h1> + optional CTA

Tokens — copy verbatim into the TOKENS comment, do not invent your own colors or fonts:
${tokenJson}

Hard rules:
- Never include <script>, <style>, <link>, or <iframe>; they will be stripped.
- Use only the 8 layout names above. Unknown layouts render as content.
- One fenced block per response.
`;
}
