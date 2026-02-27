import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const encodingTools: Tool[] = [
  {
    name: 'binary_detect_format',
    description:
      'Detect binary payload format/encoding via magic bytes, encoding heuristics, and Shannon entropy.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description:
            'Input payload string. For source=file, this is optional. For source=raw + requestId, this can be omitted.',
        },
        source: {
          type: 'string',
          enum: ['base64', 'hex', 'file', 'raw'],
          description: 'How to interpret input payload',
        },
        filePath: {
          type: 'string',
          description: 'File path when source=file (reads first 512 bytes)',
        },
        requestId: {
          type: 'string',
          description:
            'Optional captured network requestId to resolve response body from active page context',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'binary_decode',
    description:
      'Decode binary payloads (base64/hex/url/protobuf/msgpack) into hex, utf8, or json output.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Input encoded payload',
        },
        encoding: {
          type: 'string',
          enum: ['base64', 'hex', 'url', 'protobuf', 'msgpack'],
          description: 'Declared input encoding/format',
        },
        outputFormat: {
          type: 'string',
          enum: ['hex', 'utf8', 'json'],
          description: 'Target output format',
          default: 'hex',
        },
      },
      required: ['data', 'encoding'],
    },
  },
  {
    name: 'binary_encode',
    description: 'Encode utf8/hex/json input into base64/hex/url output.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Input payload',
        },
        inputFormat: {
          type: 'string',
          enum: ['utf8', 'hex', 'json'],
          description: 'How to parse input payload',
        },
        outputEncoding: {
          type: 'string',
          enum: ['base64', 'hex', 'url'],
          description: 'Desired output encoding',
        },
      },
      required: ['data', 'inputFormat', 'outputEncoding'],
    },
  },
  {
    name: 'binary_entropy_analysis',
    description:
      'Compute Shannon entropy + byte frequency distribution to assess plaintext/encoded/compressed/encrypted/random likelihood.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Input payload string (optional when source=file)',
        },
        source: {
          type: 'string',
          enum: ['base64', 'hex', 'raw', 'file'],
          description: 'How to interpret input payload',
        },
        filePath: {
          type: 'string',
          description: 'File path when source=file',
        },
        blockSize: {
          type: 'number',
          description: 'Block size for per-block entropy (default: 256)',
          default: 256,
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'protobuf_decode_raw',
    description:
      'Decode base64 protobuf bytes without schema using wire-type aware recursive parser.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Base64-encoded protobuf payload',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursive decode depth (default: 5)',
          default: 5,
        },
      },
      required: ['data'],
    },
  },
];
