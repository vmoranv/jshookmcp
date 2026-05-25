# APK Packer

Domain: `apk-packer`

Identify Android commercial packers (Qihoo Jiagu, Tencent Legu, Ijiami, Baidu, Aliyun, NetEase Yidun, DexGuard, DexProtector, AppSealing, Virbox, ...) by matching `lib/<abi>/lib*.so` filenames against a declarative fingerprint database. No unpacking, no dynamic execution.

## Profiles

- full

## Typical scenarios

- Android packer identification
- Multi-layer protection analysis
- Custom fingerprint matching

## Common combinations

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `apk_packer_detect` | Detect Android APK commercial packers by matching `lib/&lt;abi&gt;/lib*.so` filenames against a built-in declarative fingerprint database covering 16+ vendors (Qihoo Jiagu, Tencent Legu, Bangcle/SecNeo, Ijiami, Baidu, Aliyun, NetEase Yidun, DexGuard, DexProtector, AppSealing, Virbox, ApkProtect, Naga, Kiwi, UPX, ...). Supports user-supplied customSignatures with ReDoS-guarded regex compilation. **Does not unpack, execute, or otherwise interact with the packed payload.** |
| `apk_packer_list_signatures` | List the built-in declarative fingerprint database used by `apk_packer_detect`. Optionally filter by case-insensitive vendor substring. Purely informational — no APK input required. |
