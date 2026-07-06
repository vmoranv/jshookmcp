# Binary Instrument

Domain: `binary-instrument`

Binary instrumentation domain providing binary analysis, runtime instrumentation, APK packer identification, and hardcoded key candidate scanning.

## Profiles

- full

## Typical scenarios

- Binary analysis
- Runtime instrumentation
- APK packer-layer identification
- Hardcoded key candidate detection

## Common combinations

- binary-instrument + memory
- binary-instrument + process

## Full tool list (40)

| Tool | Description |
| --- | --- |
| `binary_instrument_capabilities` | Report binary instrumentation backend availability. |
| `frida_attach` | Attach Frida to a local target and open a session. |
| `frida_spawn` | Spawn a target through Frida for early instrumentation before normal execution. |
| `frida_enumerate_modules` | List loaded modules in an attached Frida session. |
| `ghidra_analyze` | Analyze a binary and return metadata. |
| `generate_hooks` | Generate a Frida interceptor script for a list of symbols. |
| `unidbg_emulate` | Emulate a native function with Unidbg when available. |
| `frida_run_script` | Execute a Frida JavaScript snippet inside an attached Frida session. |
| `frida_resume` | Resume a target previously spawned for early Frida instrumentation. |
| `frida_detach` | Detach from a Frida session and clean up resources. |
| `frida_list_sessions` | List all active Frida attach sessions with target info. |
| `frida_dex_dump` | Run frida-dexdump as a high-level Android DEX dump helper by package/process name or PID. |
| `android_runtime_dump_session` | Create or inspect a managed Android runtime dump session from Frida/ADB dump artifacts, DEX files, and /proc/PID/maps snapshots. |
| `frida_generate_script` | Generate a Frida interceptor or hook script from built-in templates. |
| `frida_attach_interceptor` | Generate a real Frida Interceptor.attach block for a symbol and optionally install it in a session. |
| `get_available_plugins` | List installed binary analysis plugins. |
| `ghidra_decompile` | Decompile a function using Ghidra. |
| `ida_decompile` | Decompile a function using IDA Pro. |
| `jadx_decompile` | Decompile an APK class or method with JADX CLI. |
| `jadx_decompile_apk` | High-level JADX APK decompile: decompile the whole APK to a stable output directory and return sourcesDir for jadx_search_code. |
| `jadx_search_code` | Ripgrep-backed search over jadx output. Pass decompileDir for read-only search, or apkPath to auto-decompile to a temporary directory first. |
| `apktool_decode` | Decode an APK using apktool to inspect resources, manifest, and smali output. |
| `apk_manifest_dump` | Extract AndroidManifest.xml from an APK for quick inspection. |
| `apk_manifest_query` | Return a compact structured AndroidManifest summary: package, launcher activity, app class, SDKs, permissions, components, providers, and SDK/surface hints. |
| `apk_static_triage` | One-shot APK triage: ZIP metadata, manifest summary, native libs, asset hints, likely packers/protectors, and recommended next steps. |
| `apk_dex_intake` | Build a cohesive APK/DEX intake evidence packet: ZIP entries, manifest summary, DEX headers, native libraries, generic surface hints, caller-supplied hint matches, and next actions. |
| `dex_scan_file` | Scan a binary/memory-dump file for DEX or CompactDex magic and optionally extract hits. |
| `binary_strings_extract` | Extract printable ASCII/UTF-16LE strings from a binary file with regex filtering. |
| `binary_entropy_profile` | Compute Shannon entropy across fixed-size chunks of a binary file to locate encrypted / packed / compressed sections. High-entropy regions (&gt;=7.0 bits/byte) are likely encrypted or compressed; low-entropy (&lt;4.0) are typically code or text. Pure-compute, no external tools. |
| `apk_native_libs_list` | List packaged native shared libraries (.so) inside an APK. |
| `unidbg_launch` | Emulate a native shared library in Unidbg. |
| `unidbg_call` | Call a JNI function in a running Unidbg emulator session. |
| `unidbg_trace` | Get execution trace from Unidbg session with configurable detail. |
| `export_hook_script` | Export generated hook templates as a complete, runnable Frida script. |
| `frida_enumerate_functions` | Enumerate exported functions for a specific module in a Frida session. |
| `frida_find_symbols` | Search for symbols matching a pattern in a Frida session. |
| `apk_packer_detect` | Detect Android APK packers by matching `lib/&lt;abi&gt;/lib*.so` filenames against user-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table — callers provide their own. **Does not unpack, execute, or otherwise interact with packed code.** |
| `apk_packer_list_signatures` | List the in-process signature table used by `apk_packer_detect`. Empty by default; reflects caller-managed state at request time. Optionally filter by case-insensitive category substring. |
| `apk_signing_block_parse` | Read-only parser for the APK Signing Block (schemes v2/v3/v3.1/v4) plus key-rotation lineage detection and residue-block / dex-prefix / magic-offset anomaly flags. Never mutates the APK. |
| `binary_key_extract` | Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption. |
