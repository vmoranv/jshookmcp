/**
 * native-emulator tool definitions (nemu_*).
 *
 * In-process, dependency-free ARM64 emulation of native shared libraries:
 * load a shared object, register a declarative managed-world callback surface,
 * and invoke exported or JNI-style functions to recover native algorithms —
 * without a device, managed VM, or external instrumentation bridge. Sessions are isolated and explicitly managed
 * (create → … → destroy), with idle auto-expiry as a leak backstop.
 *
 * Binary inputs are passed by filesystem path (soPath / apkPath), matching the
 * project-wide convention used by binary-instrument; byte payloads to/from
 * JNI byte arrays and raw guest memory cross the tool boundary as base64.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const nativeEmulatorTools: Tool[] = [
  tool('nemu_capabilities', (t) =>
    t
      .desc(
        'Report native-emulator backend availability, supported features, and explicit ISA/SIMD gaps. Unsupported opcodes fail loudly instead of being reported as emulated.',
      )
      .query(),
  ),
  tool('nemu_create_session', (t) =>
    t
      .desc(
        'Create an isolated ARM64 emulator session and return its sessionId. Each session owns its own CPU registers, guest stack, and JNI object table, so concurrent analyses never interfere. Destroy it with nemu_destroy_session when done; idle sessions auto-expire.',
      )
      .boolean('installSyscalls', 'Install the default Android syscall table (default: true)', {
        default: true,
      }),
  ),
  tool('nemu_destroy_session', (t) =>
    t
      .desc('Destroy an emulator session and free its memory (mapped library, stack, JNI tables).')
      .string('sessionId', 'Session id returned by nemu_create_session')
      .required('sessionId')
      .resettable(),
  ),
  tool('nemu_list_sessions', (t) =>
    t.desc('List active emulator sessions with their creation and last-use timestamps.').query(),
  ),
  tool('nemu_load_library', (t) =>
    t
      .desc(
        'Load an AArch64 ELF shared object (.so) from a filesystem path into a session, mapping its segments and resolving exported symbols. Prerequisite for list_symbols / call_symbol / call_jni_export.',
      )
      .string('sessionId', 'Session id returned by nemu_create_session')
      .string('soPath', 'Filesystem path to the .so library')
      .required('sessionId', 'soPath'),
  ),
  tool('nemu_inspect_imports', (t) =>
    t
      .desc(
        'Inspect an AArch64 ELF .so before emulation and list imported symbols from dynamic relocations, including GOT offsets and whether each import is backed by the built-in bionic stubs. Use this to diagnose PLT/GOT NULL indirect-call failures without writing ad-hoc readelf/Capstone scripts.',
      )
      .string('soPath', 'Filesystem path to the .so library')
      .required('soPath')
      .query(),
  ),
  tool('nemu_extract_apk_libs', (t) =>
    t
      .desc(
        'List the loadable arm64-v8a native libraries (.so) packaged inside an APK, with their byte sizes. Use nemu_load_apk_library to load one. Note: libapp.so (Flutter Dart AOT) is listed but is not executable here — route it to the Dart layer.',
      )
      .string('apkPath', 'Filesystem path to the APK file')
      .required('apkPath')
      .query(),
  ),
  tool('nemu_load_apk_library', (t) =>
    t
      .desc(
        'Extract a specific arm64-v8a .so from an APK by name and load it into a session in one step (no temp files). Pair with nemu_extract_apk_libs to discover library names.',
      )
      .string('sessionId', 'Session id returned by nemu_create_session')
      .string('apkPath', 'Filesystem path to the APK file')
      .string('libName', 'Library basename to load, e.g. "libnative-lib.so"')
      .required('sessionId', 'apkPath', 'libName'),
  ),
  tool('nemu_list_symbols', (t) =>
    t
      .desc(
        'List the exported function symbols of the loaded library — the names callable via call_symbol / call_jni_export.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .required('sessionId')
      .query(),
  ),
  tool('nemu_call_symbol', (t) =>
    t
      .desc(
        'Invoke an exported function by name following AArch64 AAPCS (integer args in x0..x7, result in x0). For plain native exports; use call_jni_export for `Java_*` JNI entry points.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .string('symbol', 'Exported symbol name to call')
      .array('args', { type: 'number' }, 'Integer arguments passed in x0..x7 (default: none)')
      .required('sessionId', 'symbol'),
  ),
  tool('nemu_call_jni_export', (t) =>
    t
      .desc(
        'Invoke an exported `Java_*` JNI function. Injects the guest `JNIEnv*` and thiz, then the Java arguments. Returns x0 — an int/jboolean directly, or a jobject/jbyteArray/jstring handle to resolve via read_byte_array. The main entry point for reversing a native signing/crypto routine.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .string('symbol', 'Exported `Java_*` JNI function name')
      .array('javaArgs', { type: 'number' }, 'Java arguments (ints or jobject handles) after thiz')
      .number('thiz', 'Receiver handle (jobject/jclass); 0 for static/none', { default: 0 })
      .required('sessionId', 'symbol'),
  ),
  tool('nemu_setup_java_mock', (t) =>
    t
      .desc(
        "Register a mock Java method the emulated native code can call back into via JNI (GetMethodID/GetStaticMethodID + `Call*Method`). Declaratively specify the return value with returnInt, returnString, or returnBytes (base64) — emulating the 'Java world' a native routine reads from before computing its result. No code is executed; only the configured constant is returned.",
      )
      .string('sessionId', 'Session id for the mock registration')
      .string('className', 'Java class name, e.g. "com/app/Config"')
      .string('methodName', 'Method name the native code looks up')
      .string('signature', 'JNI method signature, e.g. "()I" or "(I)[B"')
      .number('returnInt', 'Constant int/jboolean to return (mutually exclusive)')
      .string('returnString', 'Constant string to return as a jstring handle (mutually exclusive)')
      .string('returnBytes', 'Constant base64 bytes to return as a jbyteArray handle (exclusive)')
      .required('sessionId', 'className', 'methodName', 'signature'),
  ),
  tool('nemu_setup_java_field', (t) =>
    t
      .desc(
        "Register a mock Java field the emulated native code reads back via JNI (GetFieldID/GetStaticFieldID + Get<Type>Field). Declaratively specify the value with valueInt, valueString, or valueBytes (base64) — the 'Java world' constant a native routine folds into its result. No code is executed.",
      )
      .string('sessionId', 'Session id for the mock registration')
      .string('className', 'Java class name, e.g. "com/app/Config"')
      .string('fieldName', 'Field name the native code looks up')
      .string('signature', 'JNI field signature, e.g. "I", "J", or "Ljava/lang/String;"')
      .number('valueInt', 'Constant int/long/boolean value (mutually exclusive)')
      .string('valueString', 'Constant string returned as a jstring handle (mutually exclusive)')
      .string('valueBytes', 'Constant base64 bytes returned as a jbyteArray handle (exclusive)')
      .required('sessionId', 'className', 'fieldName', 'signature'),
  ),
  tool('nemu_new_byte_array', (t) =>
    t
      .desc(
        'Wrap base64 bytes as a JNI jbyteArray handle to pass as an argument into call_jni_export (e.g. the plaintext a signing routine consumes). Returns the handle.',
      )
      .string('sessionId', 'Session id to allocate the handle in')
      .string('dataBase64', 'Byte payload as a base64 string')
      .required('sessionId', 'dataBase64'),
  ),
  tool('nemu_read_byte_array', (t) =>
    t
      .desc(
        "Resolve a jbyteArray handle (e.g. a native call's return value) back to its bytes, returned as base64 plus length.",
      )
      .string('sessionId', 'Session id owning the handle')
      .number('handle', 'jbyteArray handle returned by a native call or new_byte_array')
      .required('sessionId', 'handle')
      .query(),
  ),
  tool('nemu_trace', (t) =>
    t
      .desc(
        'Invoke an exported symbol while recording every instruction executed (pc, opcode, step), optionally snapshotting named registers per step. Bounded by maxSteps. Use to follow the control flow / algorithm of an obfuscated native function.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .string('symbol', 'Exported symbol name to execute under trace')
      .array('args', { type: 'number' }, 'Integer arguments passed in x0..x7 (default: none)')
      .array(
        'captureRegisters',
        { type: 'string' },
        'Register names to snapshot each step. GPR aliases: x0..x30, sp, pc. SIMD/FP vector aliases: v0..v31 (full 128-bit), or qN/dN/sN/hN/bN for the narrower width. Default: none.',
      )
      .number('maxSteps', 'Maximum trace events to return (default: 1000)', { default: 1000 })
      .boolean(
        'persistArtifact',
        'When true, write the full trace JSON to artifacts/traces and return traceArtifact metadata',
        { default: false },
      )
      .number(
        'traceInlineLimit',
        'Maximum number of trace rows to include inline in the MCP response; the artifact still contains the full captured trace',
      )
      .required('sessionId', 'symbol'),
  ),
  tool('nemu_disassemble', (t) =>
    t
      .desc(
        'Disassemble a single instruction without creating an emulator session. Supports arm64/aarch64, x86, x64, riscv32/riscv64, mips/mips32, and mipsel. This is a local lightweight decoder for trace readability, including common SSE/AVX/AVX2/AVX-512 EVEX, RISC-V, and MIPS instructions.',
      )
      .enum(
        'architecture',
        ['arm64', 'aarch64', 'x86', 'x64', 'riscv32', 'riscv64', 'mips', 'mips32', 'mipsel'],
        'Instruction architecture / ISA mode',
        { default: 'arm64' },
      )
      .prop('opcode', {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description:
          'Instruction opcode as a number, a 0x-prefixed hex string, or hex bytes separated by spaces (e.g. "62 f1 74 48 58 c2").',
      })
      .string('pc', 'Program counter used for relative target formatting, as decimal or 0x hex', {
        default: '0x0',
      })
      .required('architecture', 'opcode')
      .query(),
  ),
  tool('nemu_alloc_memory', (t) =>
    t
      .desc(
        'Allocate raw guest memory (NOT a JNI handle — a real char* address). Optionally fill with initial data via fillBytes (base64). Returns the guest address to pass as an integer arg to call_symbol. Use at the start of a session to stage encrypted blobs for a native decrypt/signing routine, then read the output with nemu_read_memory.',
      )
      .string('sessionId', 'Session id to allocate in')
      .number('size', 'Number of bytes to allocate (rounded up to 4 KB pages)')
      .string('fillBytes', 'Optional base64 data to write at the start of the region')
      .number('maxBytes', 'Optional per-call cap, bounded by server configuration.')
      .required('sessionId', 'size'),
  ),
  tool('nemu_read_memory', (t) =>
    t
      .desc(
        'Read raw bytes from guest memory at a given address. Returns a bounded preview by default; set includeDataBase64=true for full base64 within the configured cap.',
      )
      .string('sessionId', 'Session id to read from')
      .number('address', 'Guest address to read from')
      .number('length', 'Number of bytes to read')
      .number('previewBytes', 'Number of bytes to include in previewBase64.')
      .number('maxBytes', 'Optional per-call cap, bounded by server configuration.')
      .boolean('includeDataBase64', 'Include full base64 bytes when true.', { default: false })
      .required('sessionId', 'address', 'length')
      .query(),
  ),
  tool('nemu_write_memory', (t) =>
    t
      .desc(
        'Write raw bytes into guest memory at a given address via base64 data. Use to update an input buffer between call_symbol invocations without re-allocating, or to patch code/data in place.',
      )
      .string('sessionId', 'Session id to write to')
      .number('address', 'Guest address to write to')
      .string('dataBase64', 'Data to write as a base64 string')
      .number('maxBytes', 'Optional per-call cap, bounded by server configuration.')
      .required('sessionId', 'address', 'dataBase64'),
  ),
];
