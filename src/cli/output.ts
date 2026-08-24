import { dim, terminalColumns, tone, wrapText } from '../lib/tty';

const JSON_INDENT = 2;

const writeStructured = (mode: OutputMode, value: unknown): void => {
  if (mode === 'agent') {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(JSON.stringify(value, null, JSON_INDENT));
};

const writeOut = (text: string): void => {
  console.log(text);
};

const writeErr = (text: string): void => {
  console.error(text);
};

/** Backwards-compat color shim. */
const color = {
  cyan: (text: string): string => tone.title(text),
  dim: (text: string): string => dim(text),
  green: (text: string): string => tone.accent(text),
  red: (text: string): string => tone.danger(text),
  yellow: (text: string): string => tone.warn(text),
};

const wrapHumanText = (text: string, width = terminalColumns()): string => wrapText(text, width);

const writeHumanText = (text: string): void => {
  console.log(wrapHumanText(text));
};

const failPayload = (
  message: string,
  code = 'error',
): { readonly ok: false; readonly code: string; readonly message: string } => ({
  code,
  message,
  ok: false,
});

type OutputMode = 'human' | 'json' | 'agent';

export { color, failPayload, wrapHumanText, writeErr, writeHumanText, writeOut, writeStructured };
export type { OutputMode };
