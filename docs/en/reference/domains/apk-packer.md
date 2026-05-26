# APK Packer

Domain: `apk-packer`

Match caller-supplied fingerprints against `lib/<abi>/*.so` filenames inside an APK. No built-in fingerprints — all signatures come from `customSignatures`.

## Profiles

- full

## Typical scenarios

- Custom fingerprint matching
- Multi-layer protection analysis
- APK lib inventory audit

## Common combinations

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `apk_packer_detect` | Detect Android APK packers by matching `lib/&lt;abi&gt;/lib*.so` filenames against user-supplied fingerprints with ReDoS-guarded regex compilation. Read-only - no unpacking or execution. |
| `apk_packer_list_signatures` | List the fingerprint entries currently visible to the apk-packer domain (the framework ships none; all entries come from caller-provided customSignatures). Optionally filter by case-insensitive category substring. Purely informational - no APK input required. |
| `apk_signing_block_parse` | Read-only parser for the APK Signing Block (schemes v2/v3/v3.1/v4) plus key-rotation lineage detection and residue-block / dex-prefix / magic-offset anomaly flags. Never mutates the APK. |
