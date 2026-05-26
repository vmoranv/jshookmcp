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

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `dart_strings_extract` | Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and classify them (urls, paths, classNames, packageRefs, cryptoKeywords, plus customRules). ReDoS-guarded. |
| `dart_smi_scan` | Recover Dart Small Integer (Smi) constants from a libapp.so by reading aligned little-endian words and stripping the heap-pointer tag bit. |
| `dart_symbolize` | Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape). |
