import { describe, expect, it } from 'bun:test';

import { renderMarkdown, sanitizeTerminalLine, sanitizeTerminalText } from '../src/lib/tty';

const hasUnsafeControl = (text: string): boolean => {
  for (const character of text) {
    const point = character.codePointAt(0);
    if (
      point !== undefined &&
      point !== 9 &&
      point !== 10 &&
      (point < 32 || (point >= 127 && point <= 159))
    ) {
      return true;
    }
  }
  return false;
};

describe('terminal output safety', () => {
  it('removes CSI, OSC, BEL, C0, and C1 control bytes from untrusted text', () => {
    const malicious =
      'safe\u001B[31mred\u001B[0m\u001B]52;c;YWJj\u0007tail\u0000\u009B2J\u202Ehidden\u2066';
    const safe = sanitizeTerminalText(malicious);

    expect(hasUnsafeControl(safe)).toBe(false);
    expect(safe).not.toContain('\u202E');
    expect(safe).not.toContain('\u2066');
    expect(safe).toContain('safe');
    expect(safe).toContain('tail');
  });

  it('normalizes carriage returns and keeps normal tabs and line feeds', () => {
    expect(sanitizeTerminalText('one\r\ntwo\rthree\tfour')).toBe('one\ntwo\nthree\tfour');
  });

  it('sanitizes GitHub Markdown before it reaches Bun markdown rendering', () => {
    const rendered = renderMarkdown('before\u001B]52;c;YWJj\u0007after', 80);

    expect(hasUnsafeControl(rendered)).toBe(false);
    expect(rendered).toContain('before');
    expect(rendered).toContain('after');
  });

  it('sanitizes numeric entities after the Markdown parser decodes them', () => {
    const rendered = renderMarkdown('before&#27;[31mred&#27;]52;c;YWJj&#7;after &#x1b;[2J', 80);

    expect(hasUnsafeControl(rendered)).toBe(false);
    expect(rendered).toContain('before');
    expect(rendered).toContain('after');
  });

  it('keeps untrusted scalar fields on one visible line', () => {
    const safe = sanitizeTerminalLine('path\r\nforged\trow\u0085next\u2028more\u2029last');

    expect(safe).toBe(String.raw`path\r\nforged\trow\u0085next\u2028more\u2029last`);
    expect(safe).not.toContain('\n');
    expect(safe).not.toContain('\r');
  });
});
