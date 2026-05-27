# APK Packer

Domain: `apk-packer`

Identify Android APK packer layers by matching `lib/<abi>/lib*.so` filenames against caller-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table. No unpacking, no dynamic execution, no payload interaction.

## Profiles

- full

## Typical scenarios

- Android packer-layer identification
- Multi-layer protection analysis
- Custom fingerprint matching
- Multi-layer protection analysis
- APK lib inventory audit

## Common combinations

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `apk_packer_detect` | Detect Android APK packers by matching `lib/&lt;abi&gt;/lib*.so` filenames against user-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table — callers provide their own. **Does not unpack, execute, or otherwise interact with the packed payload.** |
| `apk_packer_list_signatures` | List the in-process signature table used by `apk_packer_detect`. Empty by default; reflects caller-managed state at request time. Optionally filter by case-insensitive category substring. |
| `apk_signing_block_parse` | Read-only parser for the APK Signing Block (schemes v2/v3/v3.1/v4) plus key-rotation lineage detection and residue-block / dex-prefix / magic-offset anomaly flags. Never mutates the APK. |
