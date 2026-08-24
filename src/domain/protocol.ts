import { Schema } from 'effect';

export const PROTOCOL_VERSION = 1 as const;

const ProtocolError = Schema.Struct({
  code: Schema.String,
  details: Schema.Unknown,
  message: Schema.String,
});

export const ProtocolSuccess = Schema.Struct({
  command: Schema.String,
  data: Schema.Unknown,
  ok: Schema.Literal(true),
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
});

export const ProtocolFailure = Schema.Struct({
  command: Schema.String,
  error: ProtocolError,
  ok: Schema.Literal(false),
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
});

export const ProtocolEnvelope = Schema.Union([ProtocolSuccess, ProtocolFailure]);
export type ProtocolEnvelope = typeof ProtocolEnvelope.Type;

export interface ProtocolValue {
  readonly value: unknown;
}

export const successEnvelope = (
  command: string,
  data: ProtocolValue,
): typeof ProtocolSuccess.Type => ({
  command,
  data: data.value,
  ok: true,
  protocolVersion: PROTOCOL_VERSION,
});

export const failureEnvelope = (
  command: string,
  message: string,
  code: string,
  details: ProtocolValue,
): typeof ProtocolFailure.Type => ({
  command,
  error: { code, details: details.value, message },
  ok: false,
  protocolVersion: PROTOCOL_VERSION,
});
