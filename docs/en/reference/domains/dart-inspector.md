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

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `dart_strings_extract` | Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and classify them (urls, paths, classNames, packageRefs, cryptoKeywords, plus customRules). ReDoS-guarded. |
| `dart_smi_scan` | Recover Dart Small Integer (Smi) constants from a libapp.so by reading aligned little-endian words and stripping the heap-pointer tag bit. |
| `dart_symbolize` | Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape). |
| `flutter_packages_detect` | Detect third-party Dart `package:` refs in a Flutter libapp.so, aggregated and SDK-stdlib-filtered. |
| `dart_snapshot_header_parse` | Parse the Dart isolate snapshot header in a libapp.so: magic, kind, 32-byte hash, features, target arch. Read-only. |
| `dart_version_fingerprint` | Identify Flutter/Dart SDK release from a libapp.so by combining header parse with a built-in (and optionally user-supplied) hash table. |
