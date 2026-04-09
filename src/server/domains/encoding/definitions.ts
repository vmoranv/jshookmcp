import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const encodingTools: Tool[] = [
  tool('binary_detect_format', (t) =>
    t
      .desc(
        'Detect binary payload format/encoding via magic bytes, encoding heuristics, and Shannon entropy',
      )
      .string('data', 'Input payload')
      .enum('source', ['base64', 'hex', 'file', 'raw'], 'How to interpret input payload')
      .string('filePath', 'File path when source=file')
      .string('requestId', 'Captured network requestId to resolve response body')
      .required('source')
      .query(),
  ),
  tool('binary_decode', (t) =>
    t
      .desc('Decode binary payloads into hex, utf8, or json output')
      .string('data', 'Input encoded payload')
      .enum('encoding', ['base64', 'hex', 'url', 'protobuf', 'msgpack'], 'Declared input encoding')
      .enum('outputFormat', ['hex', 'utf8', 'json'], 'Target output format', { default: 'hex' })
      .required('data', 'encoding'),
  ),
  tool('binary_encode', (t) =>
    t
      .desc('Encode utf8/hex/json input into base64/hex/url output')
      .string('data', 'Input payload')
      .enum('inputFormat', ['utf8', 'hex', 'json'], 'How to parse input')
      .enum('outputEncoding', ['base64', 'hex', 'url'], 'Desired output encoding')
      .required('data', 'inputFormat', 'outputEncoding'),
  ),
  tool('binary_entropy_analysis', (t) =>
    t
      .desc(
        'Compute Shannon entropy + byte frequency to assess plaintext/encoded/compressed/encrypted likelihood',
      )
      .string('data', 'Input payload')
      .enum('source', ['base64', 'hex', 'raw', 'file'], 'How to interpret input payload')
      .string('filePath', 'File path when source=file')
      .number('blockSize', 'Block size for per-block entropy', { default: 256 })
      .required('source')
      .query(),
  ),
  tool('protobuf_decode_raw', (t) =>
    t
      .desc('Decode base64 protobuf bytes without schema using wire-type aware recursive parser')
      .string('data', 'Base64-encoded protobuf payload')
      .number('maxDepth', 'Maximum recursive decode depth', { default: 5 })
      .required('data')
      .query(),
  ),
];
