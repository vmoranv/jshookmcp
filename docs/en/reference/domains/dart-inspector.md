# Dart Inspector

Domain: `dart-inspector`

Extract and classify strings, recover Smi integer constants, and resolve obfuscated identifiers from Flutter AOT libapp.so using a developer-supplied obfuscation map.

## Profiles

- full

## Typical scenarios

- Flutter app reversing
- libapp.so string audit
- Smi integer constant recovery
- Obfuscation map symbol lookup

## Common combinations

- dart-inspector + binary-instrument
- dart-inspector + adb-bridge

## Full tool list (16)

| Tool | Description |
| --- | --- |
| `dart_strings_extract` | Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and classify them (urls, paths, classNames, packageRefs, cryptoKeywords, Dart identifiers, plus customRules). ReDoS-guarded. |
| `dart_smi_scan` | Recover Dart Small Integer (Smi) constants from a libapp.so by reading aligned little-endian words and stripping the heap-pointer tag bit. |
| `dart_symbolize` | Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape). |
| `flutter_packages_detect` | Detect third-party Dart `package:` refs in a Flutter libapp.so, aggregated and SDK-stdlib-filtered. |
| `dart_snapshot_header_parse` | Parse the Dart isolate snapshot header in a libapp.so: magic, kind, 32-byte hash, features, target arch. Read-only. |
| `dart_version_fingerprint` | Identify Flutter/Dart SDK release from a libapp.so by combining header parse with a built-in (and optionally user-supplied) hash table. |
| `dart_object_pool_dump` | Read-only static dump of the Dart isolate ObjectPool in a libapp.so: classify each slot as smi/mint/double/string/classRef/functionRef/pool/null/unknown. |
| `dart_load_snapshot` | Load and parse a Dart AOT snapshot from libapp.so, extracting metadata and statistics (Code objects, ObjectPool entries, clusters). Pass a sessionId from dart_create_session to reuse an already-parsed snapshot (skips re-parsing libapp.so). |
| `dart_list_functions` | List all Dart Code objects (compiled functions) from a loaded snapshot, with entry point address, size, and name (if available). Pass a sessionId to reuse a cached snapshot. |
| `dart_call_function` | Execute a Dart function in the ARM64 emulator by address or name, with simplified runtime (mock built-ins, tagged pointers). Pass a sessionId to reuse the cached snapshot; the executor still initialises fresh CPU state per call (register state is never shared across calls). |
| `dart_inspect_object_pool` | Dump an ObjectPool at a specific address, showing all entries with types and values. Pass a sessionId to reuse a cached snapshot. |
| `dart_trace_execution` | Trace Dart function execution step-by-step, emitting each instruction with register state (PC, x0-x30, PP, THR). Pass a sessionId to reuse the cached snapshot. |
| `dart_call_graph` | Build a best-effort static call graph from a Dart AOT snapshot: nodes are Code objects, edges are ObjectPool entries whose value matches another Code entry point (caller to callee). Pass a sessionId to reuse a cached snapshot. Honest boundary: indirect/dynamic calls without a pool entry, and PcDescriptors-level mapping, require instruction decoding (deferred — cross-Dart-SDK version work). |
| `dart_pc_descriptors` | Parse PcDescriptors for one or all Dart functions in a loaded snapshot and resolve call targets by decoding ARM64 BL instructions at each call-site PC offset. Returns structured call-site entries with pcOffset, kind (1=icCall, 2=unoptStaticCall, 3=runtimeCall), and optionally resolved target addresses when code section bytes are available. Pass a sessionId or file path to load the snapshot. |
| `dart_create_session` | Parse a Dart AOT snapshot once and cache it under a sessionId, so subsequent dart_load_snapshot / dart_list_functions / dart_call_graph / dart_inspect_object_pool / dart_call_function / dart_trace_execution calls can pass sessionId and skip re-parsing libapp.so (the dominant cost on a 10-40 MB Flutter snapshot). Destroy with dart_destroy_session when done; idle sessions auto-expire (TTL + sweep, see DART_SESSION_*). |
| `dart_destroy_session` | Destroy a Dart snapshot session created by dart_create_session, releasing the cached parsed snapshot. Returns destroyed=true if the session existed, false if it was unknown or already swept by the idle TTL. |
