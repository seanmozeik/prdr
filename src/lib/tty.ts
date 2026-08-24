/* Typography + markdown→ANSI rendering for human terminal output.
 *
 * Built on Bun's primitives — no extra deps:
 *   - `Bun.color(input, "ansi")` auto-detects 16 / 256 / 16m and emits the right escape.
 *   - `Bun.color(input, "[rgb]")` returns `[r,g,b]` for building bg + fg combos.
 *   - `Bun.markdown.render(md, callbacks)` is the GFM AST walker (Zig).
 *   - `Bun.stringWidth(s)` handles emoji / wide chars / soft hyphens correctly.
 *
 * Palette: **Catppuccin Frappé** (the theme `markdown-display` defaults to). Semantic
 * roles map exactly to that project's resolver:
 *   bold      → pink  (#f4b8e4)
 *   italic    → sky   (#99d1db)
 *   code      → rosewater on mantle (#f2d5cf / #292c3c)
 *   h1 mauve, h2 lavender, h3 blue, h4 teal
 *   link/accent → blue (#8caaee)
 *   success → green, warning → peach, error → red
 *   muted overlay1, subtle surface1
 */

const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const BOLD_ON = `${ESC}[1m`;
const DIM_ON = `${ESC}[2m`;
const STRIKE_ON = `${ESC}[9m`;
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/gu;
const ANSI_OSC_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/gu;
const SOFT_HYPHEN_RE = /­/gu;

const DEFAULT_COLUMNS = 80;
const MIN_WRAP_COLUMNS = 20;
const MAX_WRAP_COLUMNS = 100;
const RULE_MAX = 80;

const SCORE_HIGH = 1000;
const SCORE_MED = 100;

const PERCENT = 100;

/* ── Catppuccin Frappé palette ───────────────────────────────────────────── */

const frappe = {
  base: '#303446',
  blue: '#8caaee',
  crust: '#232634',
  flamingo: '#eebebe',
  green: '#a6d189',
  lavender: '#babbf1',
  mantle: '#292c3c',
  maroon: '#ea999c',
  mauve: '#ca9ee6',
  overlay0: '#737994',
  overlay1: '#838ba7',
  overlay2: '#949cbb',
  peach: '#ef9f76',
  pink: '#f4b8e4',
  red: '#e78284',
  rosewater: '#f2d5cf',
  sapphire: '#85c1dc',
  sky: '#99d1db',
  subtext0: '#a5adce',
  subtext1: '#b5bfe2',
  surface0: '#414559',
  surface1: '#51576d',
  surface2: '#626880',
  teal: '#81c8be',
  text: '#c6d0f5',
  yellow: '#e5c890',
} as const;

/* ── primitive ANSI helpers ──────────────────────────────────────────────── */

const fg = (cssColor: string, text: string): string => {
  const open = Bun.color(cssColor, 'ansi') ?? '';
  if (open === '') {
    return text;
  }
  return `${open}${text}${RESET}`;
};

/** Emit foreground + background together (for inline code chips). */
const fgBg = (fgHex: string, bgHex: string, text: string): string => {
  const fgRgb = Bun.color(fgHex, '[rgb]');
  const bgRgb = Bun.color(bgHex, '[rgb]');
  if (!fgRgb || !bgRgb) {
    return fg(fgHex, text);
  }
  const [fr, fgG, fb] = fgRgb;
  const [br, bgG2, bb] = bgRgb;
  return `${ESC}[38;2;${fr};${fgG};${fb};48;2;${br};${bgG2};${bb}m${text}${RESET}`;
};

const bold = (text: string): string => `${BOLD_ON}${text}${RESET}`;
const dim = (text: string): string => `${DIM_ON}${text}${RESET}`;
const strike = (text: string): string => `${STRIKE_ON}${text}${RESET}`;

/** Bold + colored, single ANSI sequence. */
const boldFg = (cssColor: string, text: string): string => {
  const rgb = Bun.color(cssColor, '[rgb]');
  if (!rgb) {
    return bold(text);
  }
  const [r, g, b] = rgb;
  return `${ESC}[1;38;2;${r};${g};${b}m${text}${RESET}`;
};

/** Italic + colored, single ANSI sequence. */
const italicFg = (cssColor: string, text: string): string => {
  const rgb = Bun.color(cssColor, '[rgb]');
  if (!rgb) {
    return `${ESC}[3m${text}${RESET}`;
  }
  const [r, g, b] = rgb;
  return `${ESC}[3;38;2;${r};${g};${b}m${text}${RESET}`;
};

const underline = (text: string): string => `${ESC}[4m${text}${RESET}`;

/* ── semantic palette (matches markdown-display Frappé semantic.ts) ──────── */

const tone = {
  /* Primary text: leave untinted (terminal foreground) */
  text: (s: string): string => fg(frappe.text, s),
  /* Status colors */
  accent: (s: string): string => fg(frappe.green, s), // Success
  warn: (s: string): string => fg(frappe.peach, s), // Warning
  danger: (s: string): string => fg(frappe.red, s), // Error
  /* Hierarchy / chrome */
  link: (s: string): string => fg(frappe.blue, s), // Accent / info / h3
  muted: (s: string): string => fg(frappe.overlay1, s),
  subtle: (s: string): string => fg(frappe.surface1, s),
  /* Inline marks (match markdown-display overrides) */
  bold: (s: string): string => boldFg(frappe.pink, s),
  italic: (s: string): string => italicFg(frappe.sky, s),
  code: (s: string): string => fgBg(frappe.rosewater, frappe.mantle, s),
  /* Heading colors */
  h1: (s: string): string => boldFg(frappe.mauve, s),
  h2: (s: string): string => boldFg(frappe.lavender, s),
  h3: (s: string): string => boldFg(frappe.blue, s),
  h4: (s: string): string => boldFg(frappe.teal, s),
  /* Convenience: title block (same as h1) */
  title: (s: string): string => boldFg(frappe.mauve, s),
};

/* ── width / wrap ────────────────────────────────────────────────────────── */

const stripAnsi = (s: string): string => s.replace(ANSI_RE, '').replace(ANSI_OSC_RE, '');
const stripInvisible = (s: string): string => stripAnsi(s).replace(SOFT_HYPHEN_RE, '');
const visibleLength = (s: string): number => Bun.stringWidth(stripInvisible(s));

const terminalColumns = (): number => {
  const { columns } = process.stdout;
  if (typeof columns !== 'number' || columns < MIN_WRAP_COLUMNS) {
    return DEFAULT_COLUMNS;
  }
  return Math.min(columns, MAX_WRAP_COLUMNS);
};

const wrapLine = (line: string, width: number): string => {
  if (visibleLength(line) <= width || line.trim() === '') {
    return line;
  }
  const indent = /^\s*/u.exec(line)?.[0] ?? '';
  const words = line.trim().split(/\s+/u);
  const wrapped: string[] = [];
  let current = indent;
  for (const word of words) {
    const candidate = current.trim() === '' ? `${indent}${word}` : `${current} ${word}`;
    if (visibleLength(candidate) <= width || current.trim() === '') {
      current = candidate;
    } else {
      wrapped.push(current);
      current = `${indent}${word}`;
    }
  }
  if (current.trim() !== '') {
    wrapped.push(current);
  }
  return wrapped.join('\n');
};

const wrapText = (text: string, width = terminalColumns()): string =>
  text
    .split('\n')
    .map((line) => wrapLine(line, width))
    .join('\n');

const indentLines = (text: string, prefix: string): string =>
  text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');

/* ── layout primitives ───────────────────────────────────────────────────── */

const ruleWidth = (cols = terminalColumns()): number => Math.min(cols, RULE_MAX);

const rule = (cols = terminalColumns()): string => tone.subtle('─'.repeat(ruleWidth(cols)));

const heavyRule = (cols = terminalColumns()): string => tone.subtle('━'.repeat(ruleWidth(cols)));

const divider = (label: string, cols = terminalColumns()): string => {
  const inner = ` ${label} `;
  const total = ruleWidth(cols);
  const sideLen = Math.max(2, Math.floor((total - visibleLength(inner)) / 2));
  const left = '─'.repeat(sideLen);
  const right = '─'.repeat(Math.max(2, total - sideLen - visibleLength(inner)));
  return tone.subtle(`${left}${inner}${right}`);
};

const metaLine = (parts: readonly (string | undefined)[]): string => {
  const filtered = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return tone.muted(filtered.join('  ·  '));
};

const score = (n: number): string => {
  const text = `${n.toLocaleString()}↑`;
  if (n >= SCORE_HIGH) {
    return boldFg(frappe.green, text);
  }
  if (n >= SCORE_MED) {
    return tone.accent(text);
  }
  return tone.muted(text);
};

const percentBadge = (ratio: number): string => {
  const pct = Math.round(ratio * PERCENT);
  return tone.muted(`${pct}% upvoted`);
};

const link = (text: string, url: string): string =>
  text === url ? tone.link(underline(url)) : `${tone.link(underline(text))} ${tone.muted(url)}`;

/* ── markdown → ANSI via Bun.markdown.render ─────────────────────────────── */

const BULLETS = ['•', '◦', '▪'] as const;

const stripTrailing = (s: string): string => s.replace(/\n+$/u, '');

const renderMarkdown = (md: string, width = terminalColumns()): string => {
  if (md.trim() === '') {
    return '';
  }
  const out = Bun.markdown.render(md, {
    blockquote: (children) => `${indentLines(stripTrailing(children), `${tone.subtle('│')} `)}\n\n`,
    code: (children, meta) => {
      const lang = meta?.language ? tone.subtle(`  ${meta.language}`) : '';
      const body = stripTrailing(children)
        .split('\n')
        .map((line) => `    ${tone.code(line)}`)
        .join('\n');
      return `${lang === '' ? '' : `${lang}\n`}${body}\n\n`;
    },
    codespan: (children) => tone.code(` ${children} `),
    emphasis: (children) => tone.italic(children),
    heading: (children, meta) => {
      const text = children.trim();
      switch (meta?.level) {
        case 1: {
          return `${heavyRule(width)}\n${tone.h1(text)}\n${heavyRule(width)}\n\n`;
        }
        case 2: {
          return `\n${tone.h2(text)}\n${rule(width)}\n\n`;
        }
        case 3: {
          return `\n${tone.h3(text)}\n\n`;
        }
        default: {
          return `\n${tone.h4(text)}\n\n`;
        }
      }
    },
    hr: () => `${rule(width)}\n\n`,
    image: (_children, meta) => tone.muted(`[image: ${meta?.src ?? ''}]`),
    link: (children, meta) => link(children, meta?.href ?? ''),
    list: (children) => `${stripTrailing(children)}\n\n`,
    listItem: (children, meta) => {
      const depth = meta?.depth ?? 0;
      const indent = '  '.repeat(depth);
      let marker: string;
      if (meta?.checked === true) {
        marker = tone.accent('☑');
      } else if (meta?.checked === false) {
        marker = tone.muted('☐');
      } else if (meta?.ordered) {
        marker = tone.accent(`${(meta.start ?? 1) + (meta.index ?? 0)}.`);
      } else {
        marker = tone.accent(BULLETS[depth % BULLETS.length] ?? '•');
      }
      const body = stripTrailing(children).replaceAll('\n', `\n${indent}  `);
      return `${indent}${marker} ${body}\n`;
    },
    paragraph: (children) => `${children}\n\n`,
    strikethrough: (children) => strike(tone.muted(children)),
    strong: (children) => tone.bold(children),
    table: (children) => `${stripTrailing(children)}\n\n`,
    tbody: (children) => children,
    td: (children) => ` ${children.trim()} ${tone.subtle('│')}`,
    th: (children) => `${tone.bold(` ${children.trim()} `)}${tone.subtle('│')}`,
    thead: (children) => `${stripTrailing(children)}\n${tone.subtle(`├${'─'.repeat(20)}┤`)}\n`,
    tr: (children) => `${tone.subtle('│')}${children}\n`,
  });
  return wrapText(stripTrailing(out), width);
};

export {
  bold,
  dim,
  divider,
  fg,
  fgBg,
  frappe,
  heavyRule,
  indentLines,
  link,
  metaLine,
  percentBadge,
  renderMarkdown,
  rule,
  score,
  strike,
  stripAnsi,
  terminalColumns,
  tone,
  underline,
  visibleLength,
  wrapText,
};
