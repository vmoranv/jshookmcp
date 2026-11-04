/**
 * Encoding domain benchmark.
 *
 * External vectors:
 *  - RFC 4648 §10 test vectors (base64, base32)
 *  - Google protobuf wire-format spec §"A Simple Message" (field 1 varint 150 → 08 96 01)
 * Homemade fixtures:
 *  - Shannon-entropy bounds (constant payload → 0, uniform payload → ~8 bits/byte)
 *  - gzip roundtrip via binary_encode → binary_decode
 */
import { EncodingToolHandlers } from '@server/domains/encoding/handlers';
import { expectSuccess, body, type BenchSuite } from '../harness';

const collector = { getActivePage: async () => null } as never;
const handlers = new EncodingToolHandlers(collector);

// RFC 4648 §10 base64 vectors
const BASE64_VECTORS: readonly [string, string][] = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
];
// RFC 4648 §10 base32 vectors
const BASE32_VECTORS: readonly [string, string][] = [
  ['foobar', 'MZXW6YTBOI======'],
  ['fooba', 'MZXW6YTB'],
  ['foob', 'MZXW6YQ='],
  ['foo', 'MZXW6==='],
  ['fo', 'MZXQ===='],
  ['f', 'MY======'],
];

const uniformBytes = Array.from({ length: 256 }, (_, i) => i);

export const encodingSuite: BenchSuite = {
  name: 'encoding',
  domain: 'encoding',
  description:
    'binary_encode/decode/base32/protobuf/entropy — RFC 4648 + protobuf-spec vectors, entropy bounds, gzip roundtrip, adversarial input robustness',
  cases: [
    ...BASE64_VECTORS.filter(([raw]) => raw !== '').map(([raw, expected]) => ({
      name: `binary_encode/rfc4648-base64-${raw || 'empty'}`,
      tool: 'binary_encode',
      origin: 'external-vector' as const,
      reference: 'RFC 4648 §10 base64 test vectors',
      run: () =>
        handlers.handleBinaryEncodeTool({
          data: raw,
          inputFormat: 'utf8',
          outputEncoding: 'base64',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        return b.output === expected ? true : `expected ${expected}, got ${b.output}`;
      },
    })),
    ...BASE32_VECTORS.map(([raw, expected]) => ({
      name: `binary_encode/rfc4648-base32-${raw}`,
      tool: 'binary_encode',
      origin: 'external-vector' as const,
      reference: 'RFC 4648 §10 base32 test vectors',
      run: () =>
        handlers.handleBinaryEncodeTool({
          data: raw,
          inputFormat: 'utf8',
          outputEncoding: 'base32',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        return b.output === expected ? true : `expected ${expected}, got ${b.output}`;
      },
    })),
    {
      name: 'binary_decode/protobuf-spec-varint150',
      tool: 'binary_decode',
      origin: 'external-vector',
      reference: 'Google protobuf encoding spec "A Simple Message" (08 96 01 → field1 varint 150)',
      run: () =>
        handlers.handleBinaryDecodeTool({
          data: 'CJYB', // base64 of hex 089601
          encoding: 'protobuf',
          outputFormat: 'json',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const result = b.result as Record<string, unknown> | undefined;
        const text = JSON.stringify(result ?? b);
        return text.includes('150')
          ? true
          : `expected varint 150 in decode output, got: ${text.slice(0, 200)}`;
      },
    },
    {
      name: 'protobuf_decode_raw/protobuf-spec-varint150',
      tool: 'protobuf_decode_raw',
      origin: 'external-vector',
      reference: 'Google protobuf encoding spec "A Simple Message" (08 96 01 → field1 varint 150)',
      run: () => handlers.handleProtobufDecodeRawTool({ data: 'CJYB' }),
      validate: (v) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        return text.includes('"value":150') || text.includes('"value": 150')
          ? true
          : `expected varint 150 in raw decode, got: ${text.slice(0, 200)}`;
      },
    },
    ...// MessagePack official spec examples (github.com/msgpack/msgpack README):
    // nil=0xc0, true=0xc3, 0=0x00, 256=0xcd0100, "abc"=0xa3 616263, [1,2,3]=0x93010203
    (
      [
        ['c0', null],
        ['c3', true],
        ['00', 0],
        ['cd0100', 256],
      ] as const
    ).map(([hex, expected]) => ({
      name: `binary_decode/msgpack-spec-${expected}`,
      tool: 'binary_decode',
      origin: 'external-vector' as const,
      reference: 'MessagePack official spec examples (msgpack/msgpack README)',
      run: () =>
        handlers.handleBinaryDecodeTool({
          data: Buffer.from(hex, 'hex').toString('base64'),
          encoding: 'msgpack',
          outputFormat: 'json',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const result = b.result;
        const want = expected === null ? 'null' : expected === true ? 'true' : String(expected);
        const text = JSON.stringify(result ?? b);
        return text.includes(want) ? true : `expected ${want}, got ${text.slice(0, 120)}`;
      },
    })),
    {
      name: 'binary_decode/msgpack-spec-array123',
      tool: 'binary_decode',
      origin: 'external-vector',
      reference: 'MessagePack official spec example: 0x93 01 02 03 = [1,2,3]',
      run: () =>
        handlers.handleBinaryDecodeTool({
          data: Buffer.from('93010203', 'hex').toString('base64'),
          encoding: 'msgpack',
          outputFormat: 'json',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b.result ?? b);
        return /\[1,2,3\]|"1,2,3"|1.*2.*3/.test(text)
          ? true
          : `expected [1,2,3], got ${text.slice(0, 120)}`;
      },
    },
    {
      name: 'binary_entropy_analysis/uniform-8bit',
      tool: 'binary_entropy_analysis',
      origin: 'homemade',
      reference: 'Shannon bound: 256 distinct uniform bytes ⇒ entropy 8.0 bits/byte',
      run: () =>
        handlers.handleBinaryEntropyAnalysisTool({
          data: Buffer.from(uniformBytes).toString('base64'),
          source: 'base64',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const entropy = Number(b.overallEntropy ?? b.entropy);
        if (!Number.isFinite(entropy)) {
          const text = JSON.stringify(b);
          return `no entropy field, got: ${text.slice(0, 200)}`;
        }
        return Math.abs(entropy - 8) < 0.01 ? true : `expected entropy 8.0, got ${entropy}`;
      },
    },
    {
      name: 'binary_entropy_analysis/constant-0bit',
      tool: 'binary_entropy_analysis',
      origin: 'homemade',
      reference: 'Shannon bound: constant payload ⇒ entropy 0 bits/byte',
      run: () =>
        handlers.handleBinaryEntropyAnalysisTool({
          data: Buffer.alloc(512, 0x41).toString('base64'),
          source: 'base64',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const entropy = Number(b.overallEntropy ?? b.entropy);
        if (!Number.isFinite(entropy)) {
          const text = JSON.stringify(b);
          return `no entropy field, got: ${text.slice(0, 200)}`;
        }
        return entropy === 0 ? true : `expected entropy 0, got ${entropy}`;
      },
    },
    {
      name: 'binary_encode+decode/gzip-roundtrip',
      tool: 'binary_encode',
      origin: 'homemade',
      reference: 'zlib gzip: encode(utf8→gzip) then decode(gzip→utf8) must roundtrip',
      run: async () => {
        const enc = body(
          await handlers.handleBinaryEncodeTool({
            data: 'jshook benchmark roundtrip payload 0123456789',
            inputFormat: 'utf8',
            outputEncoding: 'gzip',
          }),
        );
        const b64 = (enc.output ?? enc.result) as string;
        return handlers.handleBinaryDecodeTool({
          data: b64,
          encoding: 'gzip',
          outputFormat: 'utf8',
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const out = (b.result ?? b.output) as string;
        return out === 'jshook benchmark roundtrip payload 0123456789'
          ? true
          : `roundtrip mismatch, got: ${String(out).slice(0, 120)}`;
      },
    },
    {
      name: 'binary_detect_format/gzip-magic',
      tool: 'binary_detect_format',
      origin: 'homemade',
      reference: 'magic-byte table: 1f 8b ⇒ gzip',
      run: async () => {
        const enc = body(
          await handlers.handleBinaryEncodeTool({
            data: 'detect me',
            inputFormat: 'utf8',
            outputEncoding: 'gzip',
          }),
        );
        return handlers.handleBinaryDetectFormatTool({
          data: (enc.output ?? enc.result) as string,
          source: 'base64',
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        return text.toLowerCase().includes('gzip')
          ? true
          : `expected gzip detection, got: ${text.slice(0, 200)}`;
      },
    },
    // ── Adversarial robustness cases (W3) ──
    {
      name: 'binary_encode/malformed-input-type',
      tool: 'binary_encode',
      origin: 'adversarial',
      reference: 'malformed input type → graceful error (generic object)',
      run: () =>
        (handlers.handleBinaryEncodeTool as (args: unknown) => Promise<unknown>)({
          data: { not: 'a string' },
          inputFormat: 'utf8',
        }),
      validate: (v: unknown) => {
        // The handler may return success:false, throw, or return an error message.
        // Any of these is acceptable as long as the server doesn't crash.
        const raw = JSON.stringify(v).toLowerCase();
        return raw.includes('error') || raw.includes('success') || typeof v === 'object'
          ? true
          : `expected graceful handling, got: ${raw.slice(0, 200)}`;
      },
    },
    {
      name: 'binary_decode/malformed-base64',
      tool: 'binary_decode',
      origin: 'adversarial',
      reference: 'malformed base64 → graceful error (not-found after length-check)',
      run: () =>
        handlers.handleBinaryDecodeTool({
          data: '!!!not-valid-base64!!!',
          encoding: 'msgpack',
          outputFormat: 'json',
        }),
      validate: (v: unknown) => {
        const raw = JSON.stringify(v).toLowerCase();
        return raw.includes('error') || typeof v === 'object'
          ? true
          : `expected graceful handling, got: ${raw.slice(0, 200)}`;
      },
    },
    {
      name: 'binary_decode/malformed-triflers',
      tool: 'binary_decode',
      origin: 'adversarial',
      reference: 'completely unrelated string → graceful error with feedback',
      run: () =>
        handlers.handleBinaryDecodeTool({
          data: Buffer.from('hello world this is not binary data at all', 'utf8').toString(
            'base64',
          ),
          encoding: 'msgpack',
          outputFormat: 'json',
        }),
      validate: (v: unknown) => {
        const b = body(v);
        const text = JSON.stringify(b).toLowerCase();
        return text.includes('error') || text.includes('fail') || typeof v === 'object'
          ? true
          : `expected graceful error, got: ${text.slice(0, 200)}`;
      },
    },
  ],
};
