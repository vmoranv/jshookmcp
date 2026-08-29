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
import type { Tool } from '@modelcontextprotocol/server';
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
        'Create an isolated ARM64 emulator session and return its sessionId. Each session owns its own CPU registers, guest stack, and JNI object table, so concurrent analyses never interfere. Destroy it with nemu_destroy_session when done; idle sessions auto-expire. Pass `files` to populate the virtual device filesystem (path→base64 content) so native code can fopen/fread assets like jiagu_config directly from the emulated FS.',
      )
      .boolean('installSyscalls', 'Install the default Android syscall table (default: true)', {
        default: true,
      })
      .prop('files', {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Virtual filesystem: path→base64 content for fopen/fread',
      })
      .prop('extraSymbols', {
        type: 'object',
        additionalProperties: { type: 'number' },
        description:
          'Extra symbol→address mappings for dlsym resolution (e.g. VM handler addresses not exported in .dynsym). Keys are symbol names, values are vaddrs.',
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
  tool('nemu_session_info', (t) =>
    t
      .desc(
        'Inspect one emulator session without executing native code. Returns timestamps, exported symbols, unresolved imports, constructor faults, and active session count.',
      )
      .string('sessionId', 'Session id returned by nemu_create_session')
      .required('sessionId')
      .query(),
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
  tool('nemu_load_library_chain', (t) =>
    t
      .desc(
        'Load a chain of dependent libraries into a session, resolving inter-library imports. Pass dependency .so paths as dependencyPaths (loaded first in order), then the primary .so path. Each dependency exports are visible to the primary and later dependencies. Use this for FFmpeg-style multi-library loads where libijkplayer.so calls exports from libijkffmpeg.so and libijksdl.so.',
      )
      .string('sessionId', 'Session identifier')
      .array(
        'dependencyPaths',
        { type: 'string' },
        'Filesystem paths to dependency .so files (loaded in order)',
      )
      .string('primaryPath', 'Filesystem path to the primary .so library')
      .required('sessionId', 'dependencyPaths', 'primaryPath'),
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
  tool('nemu_dump_got', (t) =>
    t
      .desc(
        'Dump the PLT trampoline → GOT → symbol mapping for an AArch64 ELF shared object. Scans .text for the 4-instruction trampoline pattern (adrp x16 → ldr x17 → add x17,x16,x17 → br x17) used by obfuscated SO files and cross-references each slot against dynamic relocations to resolve the callee name. Use this when you need to know what "bl 0xACD0" actually calls without manual readelf + Python scripting.',
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
        'Invoke an exported function by name following AArch64 AAPCS (integer args in x0..x7, result in x0). Auto-detects JNI signatures. Set injectJni=false to force raw arguments. Set debug=true for auto-NOP on NULL indirect calls + auto TLS prep.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .string('symbol', 'Exported symbol name to call (C++ mangled or plain)')
      .array(
        'args',
        { type: 'number' },
        'Integer arguments (x0..x7 for raw mode, x2.. for JNI-auto mode)',
      )
      .boolean(
        'injectJni',
        'Auto-detect JNI signature (default: auto). Set false to force raw args',
      )
      .boolean(
        'debug',
        'Enable auto-NOP on NULL indirect calls + auto TLS prep + verbose diag (default: false)',
      )
      .boolean(
        'codeProtect',
        'Write-protect the SO text segment before invocation. Self-modifying stores are silently dropped instead of crashing — eliminates the most common class of obfuscation bugs.',
        { default: false },
      )
      .object(
        'initRegisters',
        { additionalProperties: { type: 'number' } },
        'Map of register index → value to set BEFORE invocation (e.g. {"11":348496} for x11=0x55150). Applied after the default zeroing, so all registers except these start at 0.',
      )
      .number(
        'maxSteps',
        'Max instruction steps before aborting (default: 1M). Use for long-running bytecode loops.',
      )
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
      .number(
        'maxSteps',
        'Max instruction steps before aborting (default: 1M). Values above the server cap are clamped and the response carries clamped:true.',
      )
      .required('sessionId', 'symbol'),
  ),
  tool('nemu_call_address', (t) =>
    t
      .desc(
        'Call a function at an arbitrary guest address (e.g. a native method registered via RegisterNatives). Uses AArch64 AAPCS with args in x0..x7; returns x0. Set injectJni=true to prepend guest JNIEnv* as x0 + thiz=0 as x1 (standard JNI method convention).',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .number('address', 'Guest address of the function to call')
      .array('args', { type: 'number' }, 'Integer arguments passed in x0..x7 (default: none)')
      .boolean('injectJni', 'Prepend guest JNIEnv* + thiz=0 as x0/x1 (default: false)')
      .number('maxSteps', 'Max instruction steps before aborting (default: 1M)')
      .required('sessionId', 'address'),
  ),
  tool('nemu_setup_java_mock', (t) =>
    t
      .desc(
        'Register a mock Java method for JNI callbacks. returnInt/returnString/returnBytes for single constant; returnMap (JSON) for per-key dispatch: first Java arg matched as key→{type,value}. Single-constant is fallback for unmatched keys.',
      )
      .string('sessionId', 'Session id for the mock registration')
      .string('className', 'Java class name, e.g. "java/util/HashMap"')
      .string('methodName', 'Method name the native code looks up, e.g. "get"')
      .string('signature', 'JNI method signature, e.g. "(Ljava/lang/Object;)Ljava/lang/Object;"')
      .number('returnInt', 'Constant int/jboolean to return (mutually exclusive)')
      .string('returnString', 'Constant string to return as a jstring handle (mutually exclusive)')
      .string('returnBytes', 'Constant base64 bytes to return as a jbyteArray handle (exclusive)')
      .string(
        'returnObject',
        'Return a generic object of the given class name, e.g. "java/util/Set" or "java/util/ArrayList" (mutually exclusive)',
      )
      .string(
        'returnArray',
        'Return an Object array populated with the given handle IDs, as JSON array like "[1879048736]" (mutually exclusive)',
      )
      .string(
        'returnMap',
        'Conditional return map as JSON: {"key":{"type":"string|int|bytes","value":"..."}}. First Java argument is matched as key; single-value return acts as fallback. (exclusive)',
      )
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
  tool('nemu_setup_java_mocks', (t) =>
    t
      .desc(
        'Batch-register multiple Java method mocks in one call. Each entry in the array has the same fields as nemu_setup_java_mock: className, methodName, signature, plus one return value (returnInt, returnString, returnBytes, returnObject, returnArray, or returnMap). Use this to define the full mock chain without rebuilding jshook.',
      )
      .string('sessionId', 'Session id for the mock registration')
      .array(
        'mocks',
        {
          type: 'object',
          properties: {
            className: { type: 'string' },
            methodName: { type: 'string' },
            signature: { type: 'string' },
            returnInt: { type: 'number' },
            returnString: { type: 'string' },
            returnBytes: { type: 'string' },
            returnObject: { type: 'string' },
            returnArray: { type: 'string' },
            returnMap: { type: 'string' },
          },
          required: ['className', 'methodName', 'signature'],
        },
        'Array of mock method definitions',
      )
      .required('sessionId', 'mocks'),
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
      .number('address', 'Guest address to execute under trace (alternative to symbol)')
      .array('args', { type: 'number' }, 'Integer arguments passed in x0..x7 (default: none)')
      .array(
        'captureRegisters',
        { type: 'string' },
        'Register names to snapshot each step. GPR aliases: x0..x30, sp, pc. SIMD/FP vector aliases: v0..v31 (full 128-bit), or qN/dN/sN/hN/bN for the narrower width. Default: none.',
      )
      .enum(
        'mode',
        ['full', 'profile', 'calls', 'branches', 'memory'],
        'Trace filter mode. full=all instructions (default). profile=aggregate per-pc instruction-frequency statistics + a BL/BLR call tree instead of per-step rows (uses a much larger instruction budget — see maxSteps). calls=BLR/BR only. branches=all conditional + unconditional branches (B, B.cond, CBZ, CBNZ, TBZ, TBNZ, RET, BR, BLR). memory=LDR/STR only.',
        { default: 'full' },
      )
      .number(
        'topN',
        'Profile mode only: number of hottest instructions to return, by execution count (default: 20)',
        { default: 20 },
      )
      .boolean(
        'injectJni',
        'Auto-detect JNI signature and inject the guest JNIEnv* as x0 + synthetic thiz=0 as x1 (default: auto, matching nemu_call_symbol). Set false to force raw args; set true to force JNI injection for a symbol that the auto-detector would miss.',
      )
      .number(
        'maxSteps',
        'Maximum trace events to return (default: 1000; profile mode default and cap: 500,000 — frequency statistics need no per-step rows)',
        { default: 1000 },
      )
      .boolean(
        'persistArtifact',
        'When true, write the full trace JSON to artifacts/traces and return traceArtifact metadata',
        { default: false },
      )
      .number(
        'traceInlineLimit',
        'Maximum number of trace rows to include inline in the MCP response (default: all rows, up to maxSteps). The artifact (if persistArtifact is true) and the `.steps` count both reflect the full captured trace regardless of this limit.',
      )
      .number(
        'tableReg',
        'When set to a GPR index (e.g. 24 for x24), load/store instructions using that register as base are included in the trace regardless of mode, with register-offset details (tableIdx, indexValue) decoded. Use to trace data-table accesses (x24) during bytecode execution.',
      )
      .boolean(
        'captureBlArgs',
        'When true, capture x0-x7 (function call arguments) on every BL/BLR instruction.',
        { default: false },
      )
      .boolean(
        'debug',
        'Enable auto-NOP on NULL indirect calls + auto TLS prep + verbose diag during trace (default: false)',
      )
      .boolean(
        'codeProtect',
        'Write-protect the SO text segment before trace. Self-modifying stores are silently dropped.',
        { default: false },
      )
      .object(
        'initRegisters',
        { additionalProperties: { type: 'number' } },
        'Map of register index → value to set BEFORE invocation (e.g. {"11":348496}). Same behavior as call_symbol.',
      )
      .boolean(
        'registerDiff',
        'When true and captureRegisters is set, only emit trace rows where at least one captured register changed value. Dramatically reduces trace size when hunting for the instruction that modifies a specific register.',
        { default: false },
      )
      .required('sessionId'),
  ),
  tool('nemu_session_load', (t) =>
    t
      .desc(
        'Load a JSON-serialised array of tool calls and execute them sequentially to set up a session. Each entry is {tool, args}. Supported tools: alloc_memory, write_regions, call_address, call_symbol, prepare_tls, setup_java_mocks, map_memory, bind_host_fn. Use this to replay a debug session from a saved JSON plan without repeating ~20 manual MCP calls.',
      )
      .string('sessionId', 'Session id')
      .string('planPath', 'Filesystem path to the JSON plan file')
      .required('sessionId', 'planPath'),
  ),
  tool('nemu_bind_host_fn', (t) =>
    t
      .desc(
        'Register a JavaScript host function at a specific guest address, overriding any existing stub. The function receives guest registers (ctx.x(0)..x(7)), can read/write guest memory (ctx.read/ctx.write), and returns a BigInt value placed in x0. Use to mock custom shell imports at their resolved GOT addresses.',
      )
      .string('sessionId', 'Session id')
      .number('address', 'Guest address to bind the host function')
      .string(
        'fn',
        'JavaScript function body. Receives ctx with .x(n) .read(addr,len) .write(addr,bytes). Must return a Number or BigInt.',
      )
      .required('sessionId', 'address', 'fn'),
  ),
  tool('nemu_bind_all_imports', (t) =>
    t
      .desc(
        'Batch-bind host functions to ALL resolved import stubs in the GOT. Reads the GOT table (0x74000 range), finds every unique resolved address, and binds the given JS function body to each. Call after load_library to mock every unresolved shell import at once.',
      )
      .string('sessionId', 'Session id')
      .string(
        'fn',
        'JavaScript function body for ALL imports. Receives ctx. Returns Number/BigInt placed in x0.',
      )
      .number('gotStart', 'Start of GOT VA range (default: SO GOT start)')
      .number('gotEnd', 'End of GOT VA range (default: auto-detect)')
      .required('sessionId', 'fn'),
  ),
  tool('nemu_set_registers', (t) =>
    t
      .desc(
        'Set arbitrary CPU registers by index. Pass an object mapping register number to value (e.g. {0: 0x60000000, 10: 0, 11: 0x55150}). Supports x0-x30 and floating-point d0-d31. Use to fix up loop variables or inject context pointers before/after host function calls.',
      )
      .string('sessionId', 'Session id')
      .object('registers', {}, 'Map of register index → value. Integer for GPR, float for SIMD.')
      .required('sessionId', 'registers'),
  ),
  tool('nemu_set_pac_key', (t) =>
    t
      .desc(
        'Configure the ARMv8.3 Pointer Authentication key set used by PACIA/PACIB/AUTIA/AUTIB instructions in this emulator session. Set a 128-bit key (32 hex chars) by key slot (ia/ib/da/db) to match keys dumped from a real device via Frida, so AUTIA can verify and strip real-hardware PAC signatures.',
      )
      .string('sessionId', 'Session id to configure')
      .string('key', '128-bit key as a 32-hex-char string (w0[0..15]||k0[0..15])')
      .enum('slot', ['ia', 'ib', 'da', 'db'], 'Key slot to update', { default: 'ia' })
      .required('sessionId', 'key'),
  ),
  tool('nemu_create_vtable', (t) =>
    t
      .desc(
        'Create a C++ vtable-backed object in guest memory. Allocates a vtable with `numSlots` entries (each pointing to a return-0 host stub) and an object that points to it. Use when native code does direct vtable dispatch (BLR X8 through [obj+offset]) — common in obfuscated SO files calling virtual methods on C++ objects. Returns {objectAddr, vtableAddr} for use with nemu_call_address/nemu_call_symbol.',
      )
      .string('sessionId', 'Session id')
      .integer('numSlots', 'Number of vtable slots (default 16). Each slot is 8 bytes.', {
        default: 16,
      })
      .string(
        'returnStubAddr',
        'Address of host stub for default return value (default auto-created return-0 stub)',
        { default: '' },
      )
      .required('sessionId'),
  ),
  tool('nemu_mem_shadow', (t) =>
    t
      .desc(
        'Add a shadow memory overlay at a specific address. Reads from shadow take priority over underlying memory — use to provide mock data at addresses that would otherwise crash (e.g. address 0 where SO ELF header resides). Does NOT modify the underlying SO mapping.',
      )
      .string('sessionId', 'Session id')
      .integer('address', 'Guest address to shadow')
      .integer('size', 'Shadow region size in bytes (default 8)', { default: 8 })
      .string('dataBase64', 'Base64-encoded bytes to serve on reads')
      .required('sessionId', 'address', 'dataBase64'),
  ),
  tool('nemu_set_vtable_slot', (t) =>
    t
      .desc(
        'Override a specific vtable slot with a custom host function. The slot at vtableAddr + slotIndex*8 is rewritten to point to a stub executing `fnBody` (JS, with ctx.x/ctx.writeU64/ctx.persistReg etc.). Use to mock specific C++ virtual methods after creating a vtable with nemu_create_vtable.',
      )
      .string('sessionId', 'Session id')
      .integer('vtableAddr', 'Address of the vtable (from nemu_create_vtable)')
      .integer('slotIndex', 'Zero-based slot index to override (e.g. 6 for offset 0x30)')
      .string('fn', 'JS function body for the stub. Receives ctx. Must return a BigInt or number.')
      .required('sessionId', 'vtableAddr', 'slotIndex', 'fn'),
  ),
  tool('nemu_create_jni_handle', (t) =>
    t
      .desc(
        'Create a mock JNI object handle pre-populated with controlled data. Use BEFORE calling JNI functions to seed the handle table so that GetStringUTFChars / GetObjectArrayElement / GetIntField return expected values. Returns the handle id to pass as an argument to nemu_call_address or nemu_call_symbol.',
      )
      .string('sessionId', 'Session id with a library already loaded')
      .enum('kind', ['string', 'objarray', 'integer', 'boolean', 'object'], 'JNI object kind')
      .string(
        'value',
        'Value: string for string kind, JSON array of handles for objarray, number string for integer, "true"/"false" for boolean',
      )
      .string('className', 'Class name for object kind (e.g. "java/util/HashMap")')
      .required('sessionId', 'kind'),
  ),
  tool('nemu_disassemble', (t) =>
    t
      .desc(
        'Disassemble instructions. Two modes: (1) single-instruction — pass `opcode` (a number, 0x hex string, or hex bytes) and optional `pc`; no session needed. (2) batch — pass `sessionId`, `vaddr`, and `count`; reads `count` 4-byte words from guest memory starting at `vaddr` and returns a `{pc, opcode, asm}[]` list. Batch supports fixed-width ISAs only (arm64/aarch64, riscv32/riscv64, mips/mips32/mipsel); x86/x64 are rejected. A local lightweight decoder for trace readability, including common SSE/AVX/AVX2/AVX-512 EVEX, RISC-V, and MIPS instructions.',
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
          'Single-instruction mode: opcode as a number, a 0x-prefixed hex string, or hex bytes separated by spaces (e.g. "62 f1 74 48 58 c2"). Required unless using batch mode (sessionId+vaddr+count).',
      })
      .string(
        'pc',
        'Program counter used for relative target formatting, as decimal or 0x hex. In batch mode defaults to `vaddr`.',
        {
          default: '0x0',
        },
      )
      .string(
        'sessionId',
        'Batch mode: session id with a library already loaded. When provided with vaddr+count, enables batch disassembly.',
      )
      .number('vaddr', 'Batch mode: guest address of the first instruction to disassemble.')
      .number('count', 'Batch mode: number of instructions (4 bytes each) to disassemble.')
      .required('architecture')
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
  tool('nemu_write_regions', (t) =>
    t
      .desc(
        'Write multiple memory regions in a single call. Accepts an array of {address, dataBase64} objects. ' +
          'Essential for atomic code patching: apply all patches in one call to avoid intermediate corrupt states.',
      )
      .string('sessionId', 'Session id to write to')
      .array(
        'regions',
        {
          type: 'object',
          properties: {
            address: { type: 'number', description: 'Guest virtual address to write to' },
            dataBase64: { type: 'string', description: 'Base64-encoded bytes to write' },
            writeProtect: {
              type: 'boolean',
              description:
                'If true, runtime STR/SIMD-store to this region are silently dropped (prevents self-modifying code from corrupting patches)',
            },
          },
        },
        'Array of {address, dataBase64, writeProtect?} objects to write',
      )
      .required('sessionId', 'regions'),
  ),
  tool('nemu_prepare_tls', (t) =>
    t
      .desc(
        'Map the TPIDR_EL0 (thread-pointer) TLS block so its memory is accessible for pre-population via nemu_write_regions. Returns the TLS base address. Use this before writing data to TLS offsets (e.g. frame-table pointer at +0x1768) that native code reads via mrs xN, tpidr_el0; ldr xM, [xN, #large_offset].',
      )
      .string('sessionId', 'Session id with a library loaded')
      .required('sessionId')
      .query(),
  ),
  // ── JNI diagnostics ──────────────────────────────────────────────
  tool('nemu_jni_diag', (t) =>
    t
      .desc(
        'Read the JNI diagnostic log for a session. Tracks every JNI function call (FindClass, GetMethodID, CallIntMethod, etc.) and unimplemented stub invocations. Use after nemu_call_symbol or nemu_trace to see what Java methods the native code tried to call. Actions: "read" (default) reads and clears the log; "snapshot" reads without clearing; "clear" clears without returning.',
      )
      .string('sessionId', 'Session id to read diagnostics from')
      .enum(
        'action',
        ['read', 'snapshot', 'clear'],
        'read=read+clear log, snapshot=read-only, clear=discard log',
        { default: 'read' },
      )
      .required('sessionId')
      .query(),
  ),
  tool('nemu_jni_handles', (t) =>
    t
      .desc(
        'List all JNI object handles allocated in a session, with their kind and summary. Handles are opaque IDs (jclass, jstring, jbyteArray, jobject) that native code passes around. Use to verify mock setups and debug handle leaks. Optionally filter by kind (e.g. "class", "string", "bytes", "method", "field", "auto-object", "mock-int", "mock-string", "mock-boolean", "objarray") or by specific handle number.',
      )
      .string('sessionId', 'Session id to inspect')
      .string(
        'kindFilter',
        'Optional: only show handles of this kind (e.g. "mock-string", "auto-object", "bytes")',
      )
      .number('handleFilter', 'Optional: only show this specific handle number')
      .required('sessionId')
      .query(),
  ),
  tool('nemu_get_jni_stub', (t) =>
    t
      .desc(
        'Get the guest stub address for a JNI table index. Pass a specific `index` to look up one entry (returns 0 + bound=false if the index was never bound), or omit to return all bound index→stubAddress mappings. Use to read stub addresses from a session so they can be written into SO caches or external tooling that expects specific JNI function addresses (especially the extended indices 280-336 used by obfuscation VM dispatch bridges).',
      )
      .string('sessionId', 'Session id to query JNI stub addresses from')
      .number(
        'index',
        'JNI table index to look up (e.g. 6=FindClass, 280=ExtFunc_280). Omit to return all bound entries.',
      )
      .required('sessionId')
      .query(),
  ),
  // ── Code discovery ─────────────────────────────────────────────────
  tool('nemu_dlsym_diag', (t) =>
    t
      .desc(
        'Read the dlsym resolution log from the current session. Tracks every symbol lookup the emulated code requested via dlsym() — essential for discovering which VM handler names an obfuscated dispatch engine tries to resolve. Actions: read (default, reads+clears), snapshot (read-only), clear.',
      )
      .string('sessionId', 'Session id to inspect')
      .enum(
        'action',
        ['read', 'snapshot', 'clear'],
        'read=read+clear log, snapshot=read-only, clear=discard',
        { default: 'read' },
      )
      .required('sessionId')
      .query(),
  ),
  // ── VM state bridge (Python ↔ Native) ────────────────────────────
  tool('nemu_vm_state_dump', (t) =>
    t
      .desc(
        'Dump LiteVM state from guest memory at specified base addresses. Reads ctx (32×64-bit), table (32×64-bit), and optional output buffer. Returns structured hex values suitable for comparison with Python LiteVM dumps. Use after nemu_call_symbol to inspect native VM execution results.',
      )
      .string('sessionId', 'Session id to read from')
      .number('ctxBase', 'Guest address of the VM context array (x27, 32×8 bytes)')
      .number('tableBase', 'Guest address of the data table array (x24, 32×8 bytes)')
      .number('outputBase', 'Guest address of the output buffer (256 bytes)')
      .number('ctxCount', 'Number of ctx slots to read (default: 32)', { default: 32 })
      .number('tableCount', 'Number of table slots to read (default: 32)', { default: 32 })
      .number('outputSize', 'Size of output buffer in bytes (default: 256)', { default: 256 })
      .required('sessionId', 'ctxBase', 'tableBase')
      .query(),
  ),
  tool('nemu_vm_state_load', (t) =>
    t
      .desc(
        'Load VM state into guest memory. Takes ctx values and table values as hex strings and writes them at the specified base addresses. Use to bridge Python LiteVM state into native VM: run Python vm.run(), dump ctx/table as hex, then load into nemu guest memory before calling bb2i34u32clsb.',
      )
      .string('sessionId', 'Session id to write to')
      .number('ctxBase', 'Guest address to write ctx array (32×8 bytes)')
      .number('tableBase', 'Guest address to write table array (32×8 bytes)')
      .number('outputBase', 'Guest address to write output buffer')
      .array(
        'ctx',
        { type: 'string' },
        'Array of ctx values as hex strings (e.g. "0x0") or decimal numbers. Must have ctxCount entries.',
      )
      .array(
        'table',
        { type: 'string' },
        'Array of table values as hex strings or decimal numbers. Must have tableCount entries.',
      )
      .string(
        'outputHex',
        'Output buffer as a hex string (e.g. "AE001626..."). Written at outputBase.',
      )
      .number('ctxCount', 'Number of ctx entries (default: 32)', { default: 32 })
      .number('tableCount', 'Number of table entries (default: 32)', { default: 32 })
      .required('sessionId', 'ctxBase', 'tableBase', 'ctx', 'table'),
  ),
  tool('nemu_vm_state_compare', (t) =>
    t
      .desc(
        'Compare native VM state (read from guest memory) against an expected state (e.g. Python LiteVM dump). For each of ctx, table, and output, reports whether they match and lists the first mismatches. Use to cross-validate native VM execution against the known-good Python implementation.',
      )
      .string('sessionId', 'Session id to read native state from')
      .number('ctxBase', 'Guest address of native ctx array (32×8 bytes)')
      .number('tableBase', 'Guest address of native table array (32×8 bytes)')
      .number('outputBase', 'Guest address of native output buffer')
      .array(
        'expectedCtx',
        { type: 'string' },
        'Expected ctx values as hex strings (from Python LiteVM dump)',
      )
      .array(
        'expectedTable',
        { type: 'string' },
        'Expected table values as hex strings (from Python LiteVM dump)',
      )
      .string('expectedOutputHex', 'Expected output as a hex string')
      .required('sessionId', 'ctxBase', 'tableBase', 'expectedCtx', 'expectedTable'),
  ),
  // ── Memory management ─────────────────────────────────────────
  tool('nemu_mem_map', (t) =>
    t
      .desc(
        'Map a memory region in guest address space. Use to extend the mapped area for output buffers or scratch data that would otherwise cause unmapped-memory faults. Idempotent — safe to call on already-mapped regions.',
      )
      .string('sessionId', 'Session id')
      .number('address', 'Guest virtual address to map (page-aligned internally)')
      .number('size', 'Size in bytes to map (rounded up to page size)')
      .required('sessionId', 'address', 'size'),
  ),
  // ── Bytecode analysis ─────────────────────────────────────────
  tool('nemu_bytecode_decode', (t) =>
    t
      .desc(
        'Decode a u32 LiteVM bytecode word into its opcode fields: group (G0-G7), sub-opcode, a1 register index, fl field index, imm signed offset, and validity. Matches the Python LiteVM Opcode.is_valid_opcode() semantics. No session needed — pure computation. Use to understand what a native bytecode word means without external scripts.',
      )
      .number('word', 'The u32 bytecode word to decode (e.g. 0x02000000)')
      .required('word')
      .query(),
  ),
  tool('nemu_bytecode_scan', (t) =>
    t
      .desc(
        'Scan a guest memory region and decode all valid LiteVM bytecode words. Reads `count` u32 words starting at `address`, decodes each one, and returns only the valid opcodes with their offsets. Much faster than manual decode+filter — one call to survey an entire bytecode table.',
      )
      .string('sessionId', 'Session id to read from')
      .number('address', 'Guest address of the first u32 word')
      .number('count', 'Number of u32 words to scan (default: 256)', { default: 256 })
      .string(
        'filePath',
        'Alternative to sessionId+address: filesystem path to a binary file (e.g. .so). Reads from file offset `address`.',
      )
      .string(
        'outputFormat',
        'Output format: "summary" (counts by group), "list" (all valid ops), "annotated" (all words with annotations)',
        { default: 'summary' },
      )
      .required('sessionId', 'address')
      .query(),
  ),
  // ── Pointer chain walking ─────────────────────────────────────
  tool('nemu_pointer_chain', (t) =>
    t
      .desc(
        "Walk a chain of pointers in guest memory. Starting from `base`, reads a u64 pointer, then follows it to the next address, repeating up to `maxDepth` times. At each hop, shows the address, the pointer value, and the first 32 bytes of data there. Essential for understanding CreateLitevm's x24 table indirection structure.",
      )
      .string('sessionId', 'Session id to read from')
      .number('base', 'Starting guest address for the pointer chain')
      .number('maxDepth', 'Maximum number of hops (default: 5)', { default: 5 })
      .number(
        'offset',
        'Byte offset to add at each hop before reading the next pointer (default: 0 = read the pointer at the target address directly)',
        { default: 0 },
      )
      .number('dataLen', 'Bytes of data to show at each hop (default: 32)', { default: 32 })
      .required('sessionId', 'base')
      .query(),
  ),
  // ── Structured data dump ───────────────────────────────────────
  tool('nemu_data_dump', (t) =>
    t
      .desc(
        'Read a guest memory region and format it as a structured table of u32 or u64 values. Each row shows offset, hex value, ASCII preview, and optional annotations. Auto-classifies each word as pointer, bytecode, ASCII, or raw data. Pointers are resolved to show target data when possible.',
      )
      .string('sessionId', 'Session id to read from')
      .number('address', 'Starting guest address')
      .number('count', 'Number of words to read (default: 64)', { default: 64 })
      .enum('wordSize', ['u32', 'u64'], 'Word size (default: u64)', { default: 'u64' })
      .number('columns', 'Words per output row (default: 4)', { default: 4 })
      .required('sessionId', 'address')
      .query(),
  ),
  // ── Frame inspection ──────────────────────────────────────────
  tool('nemu_dump_frame', (t) =>
    t
      .desc(
        'Read and decode a CreateLitevm frame structure from guest memory. Parses the 256-byte frame fields: chain pointer, bytecode count, frame data, and sub-function flags. Essential for understanding the VM dispatch state at any point during execution.',
      )
      .string('sessionId', 'Session id to read from')
      .number('address', 'Guest address of the frame (256 bytes)')
      .required('sessionId', 'address')
      .query(),
  ),
  // ── Batch patching ────────────────────────────────────────────
  tool('nemu_patch_apply', (t) =>
    t
      .desc(
        'Apply multiple memory patches in a single call. Each patch is {address, dataBase64, writeProtect?}. Faster than repeated nemu_write_memory calls — essential for atomic code patches that must be applied together to avoid intermediate corrupt states.',
      )
      .string('sessionId', 'Session id')
      .array(
        'patches',
        {
          type: 'object',
          properties: {
            address: { type: 'number' },
            dataBase64: { type: 'string' },
            writeProtect: { type: 'boolean' },
          },
        },
        'Array of {address, dataBase64, writeProtect?} objects',
      )
      .boolean('codeProtect', 'Also write-protect the SO text segment after applying patches', {
        default: false,
      })
      .required('sessionId', 'patches'),
  ),
  // ── Register snapshot ──────────────────────────────────────────
  tool('nemu_regs_save', (t) =>
    t
      .desc(
        'Save a named snapshot of current GPR registers (x0-x30, sp). Returns a snapshot id usable with nemu_regs_restore. The snapshot persists until the session is destroyed or the name is overwritten. Use to preserve registers before calling an obfuscated function that corrupts callee-saved state.',
      )
      .string('sessionId', 'Session id')
      .string('name', 'Snapshot name for later reference')
      .required('sessionId', 'name'),
  ),
  tool('nemu_regs_restore', (t) =>
    t
      .desc(
        'Restore GPR registers from a previously-saved snapshot (created by nemu_regs_save). Partially restores: only registers that were saved are written back. Use after an obfuscated function call to recover decode/context registers.',
      )
      .string('sessionId', 'Session id')
      .string('snapshotId', 'Snapshot id returned by nemu_regs_save')
      .array(
        'regs',
        { type: 'string' },
        'Specific register names to restore (e.g. ["x8","x10"]). If omitted, restores all saved registers.',
      )
      .required('sessionId', 'snapshotId'),
  ),
  // ── Memory scanning ────────────────────────────────────────────
  tool('nemu_scan_memory', (t) =>
    t
      .desc(
        'Scan emulated memory for a byte pattern (like Volatility). Searches a guest address range for an exact byte match using Boyer-Moore-Horspool. Returns a list of matched addresses. Skips unmapped regions silently — use nemu_mem_map to extend the scan range if needed.',
      )
      .string('sessionId', 'Session id to scan')
      .string('pattern', 'Byte pattern to search for, as a base64 string')
      .number('startAddr', 'Starting guest address of the scan range')
      .number('endAddr', 'Ending guest address of the scan range (exclusive)')
      .number('maxResults', 'Maximum number of results to return (default: 100, max: 1000)', {
        default: 100,
      })
      .required('sessionId', 'pattern', 'startAddr', 'endAddr'),
  ),
  // ── Memory XOR ─────────────────────────────────────────────────
  tool('nemu_xor_region', (t) =>
    t
      .desc(
        'XOR a region of emulated memory with a single-byte key. Returns the XOR result as base64. Use for quick decryption testing — XOR a buffer with a candidate key byte and inspect the preview without modifying guest state. Set dryRun=false to write the XOR result back into guest memory.',
      )
      .string('sessionId', 'Session id')
      .number('address', 'Starting guest address to XOR')
      .number('key', 'Single-byte XOR key (0-255)')
      .number('length', 'Number of bytes to XOR')
      .boolean(
        'dryRun',
        'If true (default), return XOR result without modifying memory. Set false to write back.',
        { default: true },
      )
      .required('sessionId', 'address', 'key', 'length'),
  ),
  // ── IPC Relay ──────────────────────────────────────────────────
  tool('nemu_relay', (t) =>
    t
      .desc(
        'Connect to a remote native-emulator session via IPC relay. ' +
          'Proxies nemu operations through a named pipe (Windows) or Unix domain socket (Linux/macOS) ' +
          'with JSON-RPC over length-prefixed frames. ' +
          'Use to drive ARM64 nemu sessions on a Linux host from a Windows MCP server (or vice versa).',
      )
      .enum(
        'action',
        ['connect', 'disconnect', 'status'],
        'connect=establish IPC link, disconnect=tear down, status=query connection state',
      )
      .string('sessionId', 'Remote session ID to connect/disconnect/query')
      .string('host', 'Remote host for TCP fallback (default: localhost)')
      .number('port', 'TCP port for fallback (default: 17171)')
      .number('connectTimeoutMs', 'Connection timeout in ms (default: 5000)')
      .number('maxMessageBytes', 'Max inbound message bytes (default: 1 MiB)')
      .required('action'),
  ),
  // ── GDBServer ───────────────────────────────────────────────
  tool('nemu_gdbserver', (t) =>
    t
      .desc(
        'GDB Remote Serial Protocol (RSP) TCP server. ' +
          'Starts a real TCP server on host:port that GDB clients can connect to. ' +
          'Provides full register read/write, memory read/write, step, continue, ' +
          'software breakpoints (Z0/z0), vCont extended step/continue, qXfer target ' +
          'description, thread listing, and feature negotiation (qSupported). ' +
          'The server dispatches commands to the nemu emulator session in real-time. ' +
          'Packet format: $data#checksum (RFC 5.1 GDB Remote Serial Protocol). ' +
          'Actions: start (launch TCP server), stop (shut down), status (server + clients). ' +
          'Note: step/continue are simulated (PC += 4, immediate SIGTRAP); ' +
          'real execution control requires CpuEngine.runUntilBreakpoint() which is not yet exposed.',
      )
      .enum(
        'action',
        ['start', 'stop', 'status'],
        'start=launch TCP GDB server, stop=shut down, status=server info + connected clients',
      )
      .string('sessionId', 'Session id with a loaded library (required for start)')
      .string(
        'host',
        'TCP host to listen on (default: 127.0.0.1). Change to 0.0.0.0 only for remote debugging on trusted networks.',
        { default: '127.0.0.1' },
      )
      .number('port', 'TCP port to listen on (default: 1234)', { default: 1234 })
      .required('action'),
  ),
];
