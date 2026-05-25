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

## Full tool list (1)

| Tool | Description |
| --- | --- |
| `dart_strings_extract` | Extract and classify printable strings from a Dart AOT libapp.so (or any binary). Streams the file in chunks, scans ASCII and/or UTF-16LE runs, merges offsets, and categorizes hits (urls, paths, classNames, packageRefs, cryptoKeywords, plus any customRules). Includes ReDoS guards for user-supplied regex rules. |
