import {
  failureEnvelope,
  type ProtocolEnvelope,
  type ProtocolValue,
  successEnvelope,
} from '../domain/protocol';

const JSON_INDENT = 2;
const unsafeJsonLineCharacterPattern = /[\u0085\u2028\u2029]|\p{Bidi_Control}/gu;

type OutputMode = 'human' | 'json' | 'agent';
type StructuredOutputMode = Exclude<OutputMode, 'human'>;

const escapeUnsafeJsonLineCharacter = (character: string): string => {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return character;
  }
  return String.raw`\u${codePoint.toString(16).padStart(4, '0')}`;
};

const serializeEnvelope = (mode: StructuredOutputMode, envelope: ProtocolEnvelope): string =>
  JSON.stringify(envelope, null, mode === 'json' ? JSON_INDENT : undefined).replace(
    unsafeJsonLineCharacterPattern,
    escapeUnsafeJsonLineCharacter,
  );

const writeEnvelope = (mode: StructuredOutputMode, envelope: ProtocolEnvelope): void => {
  process.stdout.write(`${serializeEnvelope(mode, envelope)}\n`);
};

const writeStructured = (mode: StructuredOutputMode, command: string, value: object): void => {
  writeEnvelope(mode, successEnvelope(command, { value }));
};

const writeStructuredFailure = (
  mode: StructuredOutputMode,
  command: string,
  message: string,
  code: string,
  details: ProtocolValue,
): void => {
  writeEnvelope(mode, failureEnvelope(command, message, code, details));
};

export { writeStructured, writeStructuredFailure };
export type { OutputMode, StructuredOutputMode };
