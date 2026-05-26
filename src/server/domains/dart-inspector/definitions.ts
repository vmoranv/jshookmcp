import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const dartInspectorTools: Tool[] = [
  tool('dart_strings_extract', (t) =>
    t
      .desc(
        'Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and ' +
          'classify them (urls, paths, classNames, packageRefs, cryptoKeywords, ' +
          'plus customRules). ReDoS-guarded.',
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
        'Recover Dart Small Integer (Smi) constants from a libapp.so by reading ' +
          'aligned little-endian words and stripping the heap-pointer tag bit.',
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
  tool('dart_symbolize', (t) =>
    t
      .desc(
        'Resolve obfuscated Dart identifiers using a developer-supplied ' +
          'Flutter --save-obfuscation-map JSON (flat, pairs, or object shape).',
      )
      .string(
        'obfuscationMapFile',
        'Absolute path to the obfuscation-map.json emitted by `flutter build ... ' +
          '--extra-gen-snapshot-options=--save-obfuscation-map=FILE`',
      )
      .array(
        'obfuscatedNames',
        { type: 'string', description: 'An obfuscated (or original, in reverse mode) identifier' },
        'List of identifiers to resolve against the map',
      )
      .enum(
        'format',
        ['auto', 'flat', 'pairs', 'object'],
        'Force a specific parser; auto sniffs the JSON shape',
        { default: 'auto' },
      )
      .enum(
        'mode',
        ['forward', 'reverse'],
        'Lookup direction (forward: obfuscated→original, reverse: original→obfuscated)',
        { default: 'forward' },
      )
      .number('maxMapBytes', 'Cap on map file size in bytes', { default: 16 * 1024 * 1024 })
      .number('maxLookups', 'Cap on number of lookups attempted (extras go to unresolved)')
      .required('obfuscationMapFile', 'obfuscatedNames')
      .query(),
  ),
  tool('flutter_packages_detect', (t) =>
    t
      .desc(
        'Detect third-party Dart `package:` refs in a Flutter libapp.so, ' +
          'aggregated and SDK-stdlib-filtered.',
      )
      .string('filePath', 'Absolute path to the libapp.so (or arbitrary binary) to scan')
      .boolean('includeFlutterStdlib', 'Keep Flutter SDK packages in the result', {
        default: false,
      })
      .boolean('includeFiles', 'Emit the list of `package:foo/...` files per package', {
        default: true,
      })
      .boolean('includeOffsets', 'Emit aggregated byte offsets per package', { default: false })
      .integer('maxFilesPerPackage', 'Per-package file cap (excess marks filesTruncated)', {
        minimum: 1,
      })
      .integer('maxPackages', 'Global package cap (excess marks truncated:true)', { minimum: 1 })
      .array(
        'extraStdlibPackages',
        { type: 'string', minLength: 1, maxLength: 128 },
        'Additional package names to treat as stdlib (filtered when includeFlutterStdlib=false)',
      )
      .required('filePath')
      .query(),
  ),
  tool('dart_snapshot_header_parse', (t) =>
    t
      .desc(
        'Parse the Dart isolate snapshot header in a libapp.so: magic, kind, 32-byte hash, ' +
          'features, target arch. Read-only.',
      )
      .string('filePath', 'Absolute path to the libapp.so to parse')
      .number('maxScanBytes', 'Upper bound on the byte-scan fallback (defaults to env)', {
        minimum: 0,
      })
      .required('filePath')
      .query(),
  ),
  tool('dart_version_fingerprint', (t) =>
    t
      .desc(
        'Identify Flutter/Dart SDK release from a libapp.so by combining header parse ' +
          'with a built-in (and optionally user-supplied) hash table.',
      )
      .string('filePath', 'Absolute path to the libapp.so to fingerprint')
      .boolean('includeFeatures', 'Include the raw features array in the response', {
        default: true,
      })
      .string(
        'customTablePath',
        'Optional path to a JSON file extending the built-in hash table (user wins on collision)',
      )
      .required('filePath')
      .query(),
  ),
];
