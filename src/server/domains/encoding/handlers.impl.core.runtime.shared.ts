export type DetectSource = 'base64' | 'hex' | 'file' | 'raw';
export type EntropySource = 'base64' | 'hex' | 'raw' | 'file';
export type DecodeEncoding = 'base64' | 'hex' | 'url' | 'protobuf' | 'msgpack';
export type OutputFormat = 'hex' | 'utf8' | 'json';
export type InputFormat = 'utf8' | 'hex' | 'json';
export type OutputEncoding = 'base64' | 'hex' | 'url';
export type EntropyAssessment = 'plaintext' | 'encoded' | 'compressed' | 'encrypted' | 'random';

export interface MagicSignature {
  readonly format: string;
  readonly bytes: readonly number[];
}

export interface ByteFrequencyEntry {
  byte: string;
  count: number;
  ratio: number;
}

export interface ProtobufFieldNode {
  index: number;
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  value: unknown;
}

export interface ProtobufParseResult {
  fields: ProtobufFieldNode[];
  bytesConsumed: number;
  error?: string;
}

export interface MsgPackDecodeResult {
  value: unknown;
  offset: number;
}

export const MAGIC_SIGNATURES: ReadonlyArray<MagicSignature> = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46] },
  { format: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
  { format: 'zip/apk', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

export const DETECT_SOURCE_SET: ReadonlySet<DetectSource> = new Set(['base64', 'hex', 'file', 'raw']);
export const ENTROPY_SOURCE_SET: ReadonlySet<EntropySource> = new Set(['base64', 'hex', 'raw', 'file']);
export const DECODE_ENCODING_SET: ReadonlySet<DecodeEncoding> = new Set([
  'base64',
  'hex',
  'url',
  'protobuf',
  'msgpack',
]);
export const OUTPUT_FORMAT_SET: ReadonlySet<OutputFormat> = new Set(['hex', 'utf8', 'json']);
export const INPUT_FORMAT_SET: ReadonlySet<InputFormat> = new Set(['utf8', 'hex', 'json']);
export const OUTPUT_ENCODING_SET: ReadonlySet<OutputEncoding> = new Set(['base64', 'hex', 'url']);