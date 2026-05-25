# Dart Inspector

Domain: `dart-inspector`

Extract and classify strings from Flutter AOT libapp.so (URLs, paths, class names, package refs, crypto keywords).

## Profiles

- full

## Typical scenarios

- Flutter app reversing
- libapp.so string audit
- Crypto keyword location

## Common combinations

- dart-inspector + binary-instrument
- dart-inspector + adb-bridge

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `dart_strings_extract` | Extract and classify printable strings from a Dart AOT libapp.so (or any binary). Streams the file in chunks, scans ASCII and/or UTF-16LE runs, merges offsets, and categorizes hits (urls, paths, classNames, packageRefs, cryptoKeywords, plus any customRules). Includes ReDoS guards for user-supplied regex rules. |
| `dart_smi_scan` | Recover Dart Small Integer (Smi) constants from a libapp.so binary. The Dart VM tags every word-sized value with the low bit (0=Smi, 1=heap pointer) and stores integer literals as `value &lt;&lt; 1`, so raw string/byte scans miss them. This tool reads aligned little-endian words and emits the decoded values. |
