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
| `dart_strings_extract` | Extract and classify printable strings from a Dart AOT libapp.so (or any binary). Streams the file in chunks, scans ASCII and/or UTF-16LE runs, merges offsets, and categorizes hits (urls, paths, classNames, packageRefs, cryptoKeywords, plus any customRules). Includes ReDoS guards for user-supplied regex rules. |
| `dart_smi_scan` | Recover Dart Small Integer (Smi) constants from a libapp.so binary. The Dart VM tags every word-sized value with the low bit (0=Smi, 1=heap pointer) and stores integer literals as `value &lt;&lt; 1`, so raw string/byte scans miss them. This tool reads aligned little-endian words and emits the decoded values. |
| `dart_symbolize` | Resolve obfuscated Dart identifiers back to their original names using a developer-supplied Flutter obfuscation map (--save-obfuscation-map output). Supports the flat pair array (Flutter default), 2-tuple array, and object shapes. The map is the developer's own choice to retain — this tool does not recover names the developer dropped. |
