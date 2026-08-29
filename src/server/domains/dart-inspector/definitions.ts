import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';
import {
  DART_EXEC_MAX_STEPS,
  DART_MAX_MAP_BYTES,
  DART_MAX_OFFSETS_PER_STRING,
  DART_MAX_SMI_VALUE,
  DART_MIN_LENGTH,
  DART_MIN_LENGTH_CEILING,
  DART_MIN_LENGTH_FLOOR,
  DART_TRACE_MAX_STEPS,
} from '@src/constants/dart';

export const dartInspectorTools: Tool[] = [
  tool('dart_strings_extract', (t) =>
    t
      .desc(
        'Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and ' +
          'classify them (urls, paths, classNames, packageRefs, cryptoKeywords, Dart identifiers, ' +
          'plus customRules). ReDoS-guarded.',
      )
      .string('filePath', 'Absolute path to the libapp.so (or arbitrary binary) to extract from')
      .number('minLength', 'Minimum string length to emit', {
        default: DART_MIN_LENGTH,
        minimum: DART_MIN_LENGTH_FLOOR,
        maximum: DART_MIN_LENGTH_CEILING,
      })
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
        default: DART_MAX_OFFSETS_PER_STRING,
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
      .number('maxValue', 'Inclusive maximum decoded Smi value', { default: DART_MAX_SMI_VALUE })
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
          '--extra-gen-snapshot-options=--save-obfuscation-map=FILE`. Optional: if omitted, ' +
          'auto-detected from apkPath or searchDir.',
      )
      .string(
        'apkPath',
        'Absolute path to an APK to auto-scan for an obfuscation-map sidecar ' +
          '(obfuscation.txt/.map/.json, including under assets/flutter_assets/)',
      )
      .string(
        'searchDir',
        'Absolute path to a directory tree to auto-scan for an obfuscation-map sidecar',
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
      .number('maxMapBytes', 'Cap on map file size in bytes', { default: DART_MAX_MAP_BYTES })
      .number('maxLookups', 'Cap on number of lookups attempted (extras go to unresolved)')
      .required('obfuscatedNames')
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
  tool('dart_object_pool_dump', (t) =>
    t
      .desc(
        'Read-only static dump of the Dart isolate ObjectPool in a libapp.so: classify each ' +
          'slot as smi/mint/double/string/classRef/functionRef/pool/null/unknown.',
      )
      .string('filePath', 'Absolute path to the libapp.so to dump')
      .number('maxSlots', 'Upper bound on emitted slots (defaults to env)', { minimum: 1 })
      .number('previewBytes', 'String slot preview byte cap (defaults to env)', { minimum: 0 })
      .string(
        'grammar',
        'Force a cluster grammar by sdkFamily (e.g. "2.10", "2.17", "3.0+"); overrides auto-pick',
      )
      .object(
        'fingerprint',
        {
          flutterVersion: { type: 'string' },
          dartSdkRev: { type: 'string' },
          targetArch: { type: 'string' },
        },
        'Optional pre-supplied snapshot fingerprint to skip internal lookup',
      )
      .string(
        'typeFilter',
        'Only return slots whose kind matches (e.g. "string", "smi", "functionRef", "classRef")',
      )
      .string(
        'valueContains',
        'Case-insensitive substring match against each slot decoded preview — collapses "is this key/URL/Smi in the pool?" to one call',
      )
      .required('filePath')
      .query(),
  ),
  tool('dart_load_snapshot', (t) =>
    t
      .desc(
        'Load and parse a Dart AOT snapshot from libapp.so, extracting metadata ' +
          'and statistics (Code objects, ObjectPool entries, clusters). Pass a sessionId from ' +
          'dart_create_session to reuse an already-parsed snapshot (skips re-parsing libapp.so).',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK (extracts arm64-v8a/libapp.so)')
      .string('libappPath', 'Absolute path to libapp.so directly')
      .query(),
  ),
  tool('dart_list_functions', (t) =>
    t
      .desc(
        'List all Dart Code objects (compiled functions) from a loaded snapshot, ' +
          'with entry point address, size, and name (if available). Pass a sessionId to reuse ' +
          'a cached snapshot.',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .number('maxFunctions', 'Cap on returned functions (default: unlimited)', { minimum: 1 })
      .query(),
  ),
  tool('dart_call_function', (t) =>
    t
      .desc(
        'Execute a Dart function in the ARM64 emulator by address or name, ' +
          'with simplified runtime (mock built-ins, tagged pointers). Pass a sessionId to reuse ' +
          'the cached snapshot; the executor still initialises fresh CPU state per call ' +
          '(register state is never shared across calls).',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .string('functionAddress', 'Hex address of function entry point (e.g., "0x12345678")')
      .string('functionName', 'Function name (if known, e.g., "main")')
      .array(
        'args',
        { type: 'string', description: 'Argument value as hex string (e.g., "0x0" for Smi(0))' },
        'Function arguments (Dart tagged pointers)',
      )
      .number('maxSteps', 'Maximum instruction steps before timeout', {
        default: DART_EXEC_MAX_STEPS,
        minimum: 1,
      })
      .boolean('traceExecution', 'Emit instruction trace in response', { default: false })
      .query(),
  ),
  tool('dart_inspect_object_pool', (t) =>
    t
      .desc(
        'Dump an ObjectPool at a specific address, showing all entries with types and values. ' +
          'Pass a sessionId to reuse a cached snapshot.',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .string('poolAddress', 'Hex address of ObjectPool (e.g., "0x12345678")')
      .required('poolAddress')
      .query(),
  ),
  tool('dart_trace_execution', (t) =>
    t
      .desc(
        'Trace Dart function execution step-by-step, emitting each instruction ' +
          'with register state (PC, x0-x30, PP, THR). Pass a sessionId to reuse the cached snapshot.',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .string('functionAddress', 'Hex address of function entry point')
      .string('functionName', 'Function name (alternative to address)')
      .number('maxSteps', 'Maximum steps to trace', {
        default: DART_TRACE_MAX_STEPS,
        minimum: 1,
        maximum: DART_EXEC_MAX_STEPS,
      })
      .array(
        'args',
        { type: 'string', description: 'Argument as hex string' },
        'Function arguments',
      )
      .query(),
  ),
  tool('dart_call_graph', (t) =>
    t
      .desc(
        'Build a best-effort static call graph from a Dart AOT snapshot: nodes are Code objects, ' +
          'edges are ObjectPool entries whose value matches another Code entry point (caller to callee). ' +
          'Pass a sessionId to reuse a cached snapshot. Honest boundary: indirect/dynamic calls ' +
          'without a pool entry, and PcDescriptors-level mapping, require instruction decoding ' +
          '(deferred — cross-Dart-SDK version work).',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .number('maxEdges', 'Cap on emitted edges (excess sets truncated=true)', { minimum: 1 })
      .query(),
  ),
  tool('dart_create_session', (t) =>
    t
      .desc(
        'Parse a Dart AOT snapshot once and cache it under a sessionId, so subsequent ' +
          'dart_load_snapshot / dart_list_functions / dart_call_graph / dart_inspect_object_pool / ' +
          'dart_call_function / dart_trace_execution calls can pass sessionId and skip re-parsing ' +
          'libapp.so (the dominant cost on a 10-40 MB Flutter snapshot). Destroy with ' +
          'dart_destroy_session when done; idle sessions auto-expire (TTL + sweep, see DART_SESSION_*).',
      )
      .string('apkPath', 'Absolute path to APK (extracts arm64-v8a/libapp.so)')
      .string('libappPath', 'Absolute path to libapp.so directly')
      // NOTE: "apkPath OR libappPath" cannot be expressed in JSON Schema
      // required[] (a literal 'apkPath|libappPath' entry matches no declared
      // property and is silently ignored). The handler enforces the OR:
      // handleDartCreateSession throws VALIDATION when neither is provided.
      .query(),
  ),
  tool('dart_pc_descriptors', (t) =>
    t
      .desc(
        'Parse PcDescriptors for one or all Dart functions in a loaded snapshot and resolve ' +
          'call targets by decoding ARM64 BL instructions at each call-site PC offset. ' +
          'Returns structured call-site entries with pcOffset, kind (1=icCall, 2=unoptStaticCall, ' +
          '3=runtimeCall), and optionally resolved target addresses when code section bytes are ' +
          'available. Pass a sessionId or file path to load the snapshot.',
      )
      .string('sessionId', 'Session id from dart_create_session (reuse cached snapshot)')
      .string('apkPath', 'Absolute path to APK')
      .string('libappPath', 'Absolute path to libapp.so')
      .string(
        'functionName',
        'Only return PcDescriptors for this named function; omit for all functions',
      )
      .string(
        'functionAddress',
        'Only return PcDescriptors for the function at this hex entry point',
      )
      .boolean('resolveTargets', 'Decode ARM64 BL instructions and resolve call targets', {
        default: true,
      })
      .boolean(
        'callSitesOnly',
        'Only return entries with call-site kinds (icCall/unoptStaticCall/runtimeCall)',
        {
          default: true,
        },
      )
      .number('maxResults', 'Cap on total entries returned', { minimum: 1 })
      .query(),
  ),
  tool('dart_destroy_session', (t) =>
    t
      .desc(
        'Destroy a Dart snapshot session created by dart_create_session, releasing the cached ' +
          'parsed snapshot. Returns destroyed=true if the session existed, false if it was unknown ' +
          'or already swept by the idle TTL.',
      )
      .string('sessionId', 'Session id returned by dart_create_session')
      .required('sessionId')
      .query(),
  ),
];
