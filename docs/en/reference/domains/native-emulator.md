# Native Emulator

Domain: `native-emulator`

In-process, dependency-free self-built ARM64 interpreter for emulating Android `.so` libraries: load a shared object, register mock Java methods, and invoke exported or `Java_*` JNI functions to recover signing/crypto algorithms — no device, JVM, or Frida. Sessions are isolated and explicitly managed (create → … → destroy) with idle auto-expiry. libapp.so (Flutter Dart AOT) is not executable here and routes to the Dart layer.

## Profiles

- full

## Typical scenarios

- Recover native/JNI signing and crypto algorithms
- Extract and load arm64-v8a .so from an APK
- Instruction-trace an obfuscated native function
- Mock the Java world via declarative callbacks

## Common combinations

- native-emulator + binary-instrument
- native-emulator + dart-inspector

## Full tool list (14)

| Tool | Description |
| --- | --- |
| `nemu_capabilities` | Report native-emulator backend availability and supported features (self-built ARM64 interpreter, no external dependencies). |
| `nemu_create_session` | Create an isolated ARM64 emulator session and return its sessionId. Each session owns its own CPU registers, guest stack, and JNI object table, so concurrent analyses never interfere. Destroy it with nemu_destroy_session when done; idle sessions auto-expire. |
| `nemu_destroy_session` | Destroy an emulator session and free its memory (mapped library, stack, JNI tables). |
| `nemu_list_sessions` | List active emulator sessions with their creation and last-use timestamps. |
| `nemu_load_library` | Load an AArch64 ELF shared object (.so) from a filesystem path into a session, mapping its segments and resolving exported symbols. Prerequisite for list_symbols / call_symbol / call_jni_export. |
| `nemu_extract_apk_libs` | List the loadable arm64-v8a native libraries (.so) packaged inside an APK, with their byte sizes. Use nemu_load_apk_library to load one. Note: libapp.so (Flutter Dart AOT) is listed but is not executable here — route it to the Dart layer. |
| `nemu_load_apk_library` | Extract a specific arm64-v8a .so from an APK by name and load it into a session in one step (no temp files). Pair with nemu_extract_apk_libs to discover library names. |
| `nemu_list_symbols` | List the exported function symbols of the loaded library — the names callable via call_symbol / call_jni_export. |
| `nemu_call_symbol` | Invoke an exported function by name following AArch64 AAPCS (integer args in x0..x7, result in x0). For plain native exports; use call_jni_export for Java_* JNI entry points. |
| `nemu_call_jni_export` | Invoke an exported Java_* JNI function. Injects the guest JNIEnv* and thiz, then the Java arguments. Returns x0 — an int/jboolean directly, or a jobject/jbyteArray/jstring handle to resolve via read_byte_array. The main entry point for reversing a native signing/crypto routine. |
| `nemu_setup_java_mock` | Register a mock Java method the emulated native code can call back into via JNI (GetMethodID/GetStaticMethodID + Call*Method). Declaratively specify the return value with returnInt, returnString, or returnBytes (base64) — emulating the 'Java world' a native routine reads from before computing its result. No code is executed; only the configured constant is returned. |
| `nemu_new_byte_array` | Wrap base64 bytes as a JNI jbyteArray handle to pass as an argument into call_jni_export (e.g. the plaintext a signing routine consumes). Returns the handle. |
| `nemu_read_byte_array` | Resolve a jbyteArray handle (e.g. a native call's return value) back to its bytes, returned as base64 plus length. |
| `nemu_trace` | Invoke an exported symbol while recording every instruction executed (pc, opcode, step), optionally snapshotting named registers per step. Bounded by maxSteps. Use to follow the control flow / algorithm of an obfuscated native function. |
