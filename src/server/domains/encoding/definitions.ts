import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const encodingTools: Tool[] = [
  tool('binary_detect_format', (t) =>
    t
      .desc('Detect binary payload format and encoding signals.')
      .enum('source', ['base64', 'hex', 'file', 'raw'], 'How to interpret input payload')
      .string('data', 'Input payload for base64/hex/raw sources')
      .string('filePath', 'File path when source=file')
      .string('requestId', 'Captured requestId when a response body is available')
      .required('source')
      .query(),
  ),
  tool('binary_decode', (t) =>
    t
      .desc(
        'Decode binary payloads, transport encodings, and compressed blobs into hex, utf8, or json output.',
      )
      .string('data', 'Input encoded payload')
      .enum(
        'encoding',
        [
          'base64',
          'base32',
          'base32hex',
          'base32-crockford',
          'base58',
          'base85',
          'hex',
          'url',
          'gzip',
          'zlib',
          'deflate',
          'brotli',
          'protobuf',
          'msgpack',
        ],
        'Declared input encoding',
      )
      .enum('outputFormat', ['hex', 'utf8', 'json'], 'Target output format', { default: 'hex' })
      .required('data', 'encoding')
      .query(),
  ),
  tool('binary_encode', (t) =>
    t
      .desc('Encode utf8/hex/json input into transport encodings or compressed base64 blobs.')
      .string('data', 'Input payload')
      .enum('inputFormat', ['utf8', 'hex', 'json'], 'How to parse input')
      .enum(
        'outputEncoding',
        [
          'base64',
          'base32',
          'base32hex',
          'base32-crockford',
          'base58',
          'base85',
          'hex',
          'url',
          'gzip',
          'zlib',
          'deflate',
          'brotli',
        ],
        'Desired output encoding',
      )
      .required('data', 'inputFormat', 'outputEncoding')
      .query(),
  ),
  tool('binary_entropy_analysis', (t) =>
    t
      .desc('Compute entropy and byte frequency for a payload.')
      .enum('source', ['base64', 'hex', 'raw', 'file'], 'How to interpret input payload')
      .string('data', 'Input payload for base64/hex/raw sources')
      .string('filePath', 'File path when source=file')
      .number('blockSize', 'Block size for per-block entropy', {
        default: 256,
        minimum: 16,
        maximum: 8192,
      })
      .required('source')
      .query(),
  ),
  tool('protobuf_decode_raw', (t) =>
    t
      .desc(
        'Decode protobuf bytes. Raw wire-format walk by default; schema mode returns ProtoJSON, expands valid google.protobuf.Any messages, preserves open-enum numeric values, and reports unknown fields with raw bytes plus wire details.',
      )
      .string('data', 'Base64-encoded protobuf payload')
      .number('maxDepth', 'Maximum recursive decode depth', { default: 5, minimum: 1, maximum: 20 })
      .string(
        'schemaText',
        'Optional .proto schema source. When provided with messageName, decodes typed fields instead of raw wire numbers.',
      )
      .string('schemaPath', 'Optional path to a .proto file (used only if schemaText is absent).')
      .string(
        'messageName',
        'Fully-qualified message type name to decode (e.g. "Person"). Required for schema mode.',
      )
      .required('data')
      .query(),
  ),
];
