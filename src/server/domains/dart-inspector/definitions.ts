import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const dartInspectorTools: Tool[] = [
  tool('dart_strings_extract', (t) =>
    t
      .desc(
        'Extract and classify printable strings from a Dart AOT libapp.so (or any binary). ' +
          'Streams the file in chunks, scans ASCII and/or UTF-16LE runs, merges offsets, and ' +
          'categorizes hits (urls, paths, classNames, packageRefs, cryptoKeywords, plus any ' +
          'customRules). Includes ReDoS guards for user-supplied regex rules.',
      )
      .string('filePath', 'Absolute path to the libapp.so (or arbitrary binary) to extract from')
      .number('minLength', 'Minimum string length to emit', { default: 4, minimum: 2, maximum: 64 })
      .boolean('includeRaw', 'Include unclassified strings under the `raw` bucket', {
        default: false,
      })
      .boolean('includeOffsets', 'Include byte offsets[] for each extracted string', {
        default: true,
      })
      .enum('encoding', ['ascii', 'utf16le', 'both'], 'Which encodings to scan', {
        default: 'both',
      })
      .number('maxChunkBytes', 'Streaming chunk size in bytes')
      .number('maxOffsetsPerString', 'Cap on offsets recorded per string (excess sets truncated)', {
        default: 1000,
      })
      .enum(
        'ruleMode',
        ['append', 'prepend', 'replace'],
        'How customRules interact with DEFAULT_RULES',
        { default: 'append' },
      )
      .number('regexTimeoutMs', 'Per-rule .test() wall-clock budget for the ReDoS guard')
      .number(
        'scanStride',
        'Only emit hits whose offset is divisible by stride (e.g. 4 for pointer-aligned scans)',
      )
      .object(
        'scanWindow',
        {
          start: { type: 'number', description: 'Inclusive start byte offset' },
          end: { type: 'number', description: 'Exclusive end byte offset' },
        },
        'Restrict scanning to a byte range (skip ELF headers, focus on a section, etc.)',
      )
      .array(
        'customRules',
        {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Category bucket name for matched strings' },
            pattern: { type: 'string', description: 'Regex source (anchored as needed)' },
            flags: {
              type: 'string',
              description: 'Regex flags (must be in DART_ALLOWED_REGEX_FLAGS)',
            },
            exclude: {
              type: 'string',
              description: 'Optional exclude regex applied before category match',
            },
            excludeFlags: { type: 'string', description: 'Flags for the exclude regex' },
            confidence: {
              type: 'number',
              description: 'Confidence weight in [0,1] carried onto each matching hit',
            },
            enableWhenFileNameMatches: {
              type: 'string',
              description: 'Rule only fires when source basename matches this regex',
            },
            enableWhenFileNameFlags: {
              type: 'string',
              description: 'Flags for enableWhenFileNameMatches',
            },
          },
          required: ['category', 'pattern'],
        },
        'Custom classification rules with safe regex compilation (ReDoS-guarded)',
      )
      .required('filePath')
      .query(),
  ),
  tool('dart_smi_scan', (t) =>
    t
      .desc(
        'Recover Dart Small Integer (Smi) constants from a libapp.so binary. ' +
          'The Dart VM tags every word-sized value with the low bit (0=Smi, 1=heap pointer) ' +
          'and stores integer literals as `value << 1`, so raw string/byte scans miss them. ' +
          'This tool reads aligned little-endian words and emits the decoded values.',
      )
      .string('filePath', 'Absolute path to the libapp.so (or arbitrary binary) to scan')
      .enum('width', ['4', '8'], 'Word width in bytes (4 for ARM32, 8 for ARM64)', { default: '8' })
      .number('stride', 'Bytes between consecutive scan positions; defaults to `width`')
      .number('minValue', 'Inclusive minimum decoded Smi value', { default: 1 })
      .number('maxValue', 'Inclusive maximum decoded Smi value', { default: 1_000_000 })
      .boolean('includeZero', 'Include decoded-to-zero hits', { default: false })
      .boolean('includeNegative', 'Include decoded-to-negative hits', { default: false })
      .number('maxResults', 'Cap on returned hits (truncates with truncated=true)')
      .number('maxChunkBytes', 'Streaming chunk size in bytes')
      .object(
        'scanWindow',
        {
          start: { type: 'number', description: 'Inclusive start byte offset' },
          end: { type: 'number', description: 'Exclusive end byte offset' },
        },
        'Restrict scanning to a byte range',
      )
      .required('filePath')
      .query(),
  ),
];
