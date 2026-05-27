# APK Packer

Domain: `apk-packer`

Identify Android APK packer layers by matching `lib/<abi>/lib*.so` filenames against caller-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table. No unpacking, no dynamic execution, no payload interaction.

## Profiles

- full

## Typical scenarios

- Android packer-layer identification
- Multi-layer protection analysis
- Custom fingerprint matching

## Common combinations

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `apk_packer_detect` | Detect Android APK packers by matching `lib/&lt;abi&gt;/lib*.so` filenames against user-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table — callers provide their own. **Does not unpack, execute, or otherwise interact with the packed payload.** |
| `apk_packer_list_signatures` | List the built-in declarative fingerprint database used by `apk_packer_detect`. Optionally filter by case-insensitive vendor substring. Purely informational — no APK input required. |
