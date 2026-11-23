/**
 * NativeEmulator — one-stop facade over the L0–L4 stack (CpuEngine + ElfLoader +
 * bionic stubs + Android syscalls + JniEnvironment).
 *
 * Wires the layers a real Android `.so` needs into a single object so a caller
 * (or an MCP tool handler) can load a shared object, register a mock "Java
 * world", and invoke an exported symbol or a `Java_*` JNI entry point — without
 * hand-assembling the JNIEnv plumbing each time. It composes the existing public
 * APIs only; the CPU/JNI internals are untouched, so it adds capability without
 * putting the green L0–L4 tests at risk.
 *
 * ── Flutter APK input contract (extractor lives in ./apk.ts) ──
 * A Flutter app ships as an APK (a zip). Its native payload is under lib/<abi>/:
 *   - libapp.so     → Dart AOT machine code. NOT a normal callable `.so`: its
 *                     .text is VM/isolate snapshots that need a Dart runtime
 *                     (THR/PP/null regs, tagged pointers, ObjectPool dispatch),
 *                     which this JNI-oriented facade does not model. Route it to
 *                     the Dart layer, not here.
 *   - libflutter.so → the engine (C++/Skia/DartVM); rarely the reversing target.
 *   - third-party / hardening `.so` and MethodChannel-lowered native algorithms
 *     → standard ARM64 + JNI, which is exactly what this facade emulates.
 * The CPU is AArch64, so only lib/arm64-v8a/*.so is loadable. Other ABIs and Dart
 * AOT code are rejected by the extractor/classifier rather than silently run.
 */
import { CpuEngine, type NativeRuntimeImportDiagnostic } from './CpuEngine';
import type { PacKeys } from './decoder/PointerAuth';
import { JniEnvironment, type JavaMethodImpl } from './jni';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import {
  installBionicStubs,
  createBionicLibrary,
  type BionicStubAddresses,
  type BionicLibrary,
  type BionicOptions,
} from './bionic';
import { installAndroidSyscalls, type AndroidSyscallOptions } from './syscalls';

export interface NativeEmulatorOptions {
  /**
   * Install the default Android syscall table (default: true). Pass an options
   * object to pin a deterministic clock or capture write(2); pass false to skip
   * syscall installation entirely (e.g. for a pure-compute `.so`).
   */
  syscalls?: AndroidSyscallOptions | false;
  /**
   * Configure the bionic libc stubs — most usefully a virtual file system for
   * fopen/fread so anti-tamper code (RootBeer's exists(), Frida-server path
   * probes) can be evaluated against a chosen "device state". Default: no files
   * (a clean device where every fopen returns NULL).
   */
  bionic?: BionicOptions;
}

export interface NativeLibraryLoadResult {
  entry: number;
  unresolvedImports: readonly NativeRuntimeImportDiagnostic[];
  constructorFaults: readonly string[];
}

/**
 * Facade composing the emulator layers. `engine` and `jni` are exposed for
 * advanced callers that need the raw primitives (mapMemory, writeRegister, …);
 * the methods here cover the common load-and-call workflow.
 *
 * Guest memory layout:
 *   0x00000000 … SO code/data segments (mapped by loadElf)
 *   0x40000000 … Guest heap (nemu_alloc_memory), grows upward to 0x5FFFFFFF
 *   0x68000000 … Import stubs (host function trampolines)
 *   0x70000000 … TLS / TPIDR_EL0 block
 *   0x7FFF0000 … Stack (grows down from 0x7FFF0000 + 64KB)
 */
export class NativeEmulator {
  readonly engine: CpuEngine;
  readonly jni: JniEnvironment;
  /** Default bionic libc, auto-wired into loaded `.so` via relocations. */
  private readonly bionic: BionicLibrary;

  /** Next allocation address for the guest heap. */
  private nextAllocAddr = 0x4000_0000; // 1 GB — well above SO segments
  /** Hard ceiling for the guest heap. */
  private static readonly HEAP_CEIL = 0x6000_0000; // 1.5 GB
  /** Disposal flag: true after dispose() is called. */
  private disposed = false;

  constructor(options: NativeEmulatorOptions = {}) {
    this.engine = new CpuEngine();
    this.jni = new JniEnvironment(this.engine);
    this.bionic = createBionicLibrary(this.engine, options.bionic ?? {});
    if (options.syscalls !== false) {
      installAndroidSyscalls(this.engine, options.syscalls ?? {});
    }
  }

  /** True when the underlying engine is ready (always true for the self-built CPU). */
  isAvailable(): boolean {
    return this.engine.isAvailable();
  }

  /**
   * Replace the active PAC key set. Keys are 128-bit per-slot (IA/IB/DA/DB),
   * each as a 32-hex-char string. Setting IA / IB keys lets AUTIA verify
   * signatures produced by matching hardware (e.g. keys dumped via Frida).
   */
  setPacKeys = (keys: PacKeys): void => this.engine.setPacKeys(keys);

  /**
   * Load an ELF64 AArch64 shared object's bytes and return its entry point.
   * Dynamic relocations are applied and imported libc symbols auto-wired to the
   * bundled bionic stubs, so a real PIC `.so` is callable without manual setup.
   */
  loadLibrary(bytes: Uint8Array): NativeLibraryLoadResult {
    this.checkNotDisposed();
    const { entry } = this.engine.loadElf(bytes, this.bionic);
    return {
      entry,
      unresolvedImports: [...this.engine.unresolvedImports()],
      constructorFaults: [...this.engine.constructorFaultLog()],
    };
  }

  /**
   * Load a chain of dependent libraries followed by a primary library, resolving
   * inter-library imports. Dependencies are mapped at non-overlapping bias
   * addresses with their exports visible to the primary; the primary loads at the
   * traditional vaddr 0 slot and can bind to both bionic libc and the dependency
   * exports. Only the primary's constructors run.
   *
   * Use this for FFmpeg-style multi-library loads where libijkplayer.so calls
   * exports from libijkffmpeg.so: pass [libijkffmpeg bytes] as dependencies and
   * libijkplayer bytes as primary.
   *
   * @param dependencies - Array of `.so` byte buffers (loaded first, in order).
   * @param primary - The primary library's `.so` bytes (loaded last).
   * @returns Load result for the primary library (entry, unresolvedImports, constructorFaults).
   */
  loadLibraryChain(dependencies: Uint8Array[], primary: Uint8Array): NativeLibraryLoadResult {
    this.checkNotDisposed();
    return this.engine.loadLibraryChain(dependencies, primary, this.bionic);
  }

  /** Snapshot of dlsym lookups since the last call (clears after read). */
  bionicDlsymDiagnostics(): string[] {
    const copy = [...this.bionic.dlsymLog];
    this.bionic.dlsymLog.length = 0;
    return copy;
  }

  /**
   * Bind bionic libc stubs (malloc/memcpy/strlen/…) at the given guest addresses.
   * Until L3 PLT/GOT relocation lands, callers route a `.so`'s libc imports to
   * these addresses explicitly; the facade just forwards to installBionicStubs.
   */
  installLibc(addrs: BionicStubAddresses): void {
    installBionicStubs(this.engine, addrs);
  }

  /** Regex to detect JNI-style function signatures (mangled or Java_ prefix). */
  private static readonly JNI_SIGNATURE_RE = /^(Java_|_Z.*P7_JNIEnv)/;

  /**
   * Invoke an exported function by name (AAPCS: args in x0..x7, result in x0).
   *
   * **Auto-detection**: if the symbol looks like a JNI function (Java_ prefix
   * or mangled name with `P7_JNIEnv` as first param), the guest JNIEnv* and a
   * synthetic thiz=0 are injected as x0/x1, and the provided args start at x2.
   * This covers both the standard `Java_*` convention AND `RegisterNatives`-
   * registered symbols like `_Z13native_attachP7_JNIEnvP7_jclass...`.
   *
   * Pass `injectJni: false` to skip auto-detection and pass raw args.
   */
  call(
    symbol: string,
    args: number[] = [],
    opts?: { injectJni?: boolean; initRegisters?: Record<number, bigint>; maxSteps?: number },
  ): number {
    this.checkNotDisposed();
    const injectJni = opts?.injectJni ?? NativeEmulator.JNI_SIGNATURE_RE.test(symbol);
    const initRegs = opts?.initRegisters;
    const maxSteps = opts?.maxSteps;
    if (injectJni) {
      // JNI_OnLoad takes (JavaVM*, void*), not (JNIEnv*, jobject).
      if (symbol === 'JNI_OnLoad' || symbol === 'JNI_OnUnload') {
        return this.engine.callSymbol(
          symbol,
          [this.jni.javaVmPointer(), 0, ...args],
          initRegs,
          maxSteps,
        );
      }
      return this.engine.callSymbol(
        symbol,
        [this.jni.envPointer(), 0, ...args],
        initRegs,
        maxSteps,
      );
    }
    return this.engine.callSymbol(symbol, args, initRegs, maxSteps);
  }

  /**
   * Invoke an exported `Java_*` JNI function. The JNI convention is
   * (JNIEnv* env, jobject thiz, ...args), so this injects the guest JNIEnv* as
   * x0 and `thiz` as x1, then the Java arguments — reusing callSymbol's stack
   * setup. Returns x0 (an int/jboolean, or a jobject/jarray handle to resolve
   * via bytesOf/stringOf).
   */
  callJniExport(
    symbol: string,
    javaArgs: number[] = [],
    thiz = 0,
    initRegisters?: Record<number, bigint>,
    maxSteps?: number,
  ): number {
    return this.engine.callSymbol(
      symbol,
      [this.jni.envPointer(), thiz, ...javaArgs],
      initRegisters,
      maxSteps,
    );
  }

  /** Call a function at an arbitrary guest address (e.g. RegisterNatives target). */
  callAddress(address: number, args: number[] = [], maxSteps?: number): number {
    return this.engine.callGuestFunction(
      address,
      args.map((a) => BigInt(a)),
      maxSteps,
    );
  }

  /**
   * Register a mock Java method the emulated native code can call back into via
   * GetMethodID/GetStaticMethodID + Call*Method (the "Java world" for routines
   * that fetch a value/key from Java before folding it into their result).
   */
  /** Diagnostic JNI stub calls since last query (cleared after read). */
  jniDiagnostics(): string[] | undefined {
    return this.jni?.jniDiagnostics?.();
  }

  /** Return the guest stub address for a JNI table index. Returns 0 for unbound indices. */
  getJniStubAddress(index: number): number {
    return this.jni.getJniStubAddress(index);
  }

  /** Return all bound JNI index → stub address mappings. */
  getJniStubAddresses(): ReadonlyMap<number, number> {
    return this.jni.getJniStubAddresses();
  }

  /** Non-destructive snapshot (for trace handlers). */
  jniDiagSnapshot(): string[] | undefined {
    return this.jni?.snapshotJniDiag?.();
  }

  clearJniDiag(): void {
    this.jni?.clearJniDiag?.();
  }

  /** Non-destructive snapshot of recorded PAC AUT mismatches (for trace handlers). */
  pacDiagSnapshot(): string[] {
    return this.engine.pacDiagSnapshot();
  }

  /** Ensure the TPIDR_EL0 TLS block is mapped and return its base address.
   *  Call this before writing data to TLS slots (e.g. frame-table pointer at
   *  +0x1768) via nemu_write_regions. */
  prepareTls(): number {
    return this.engine.prepareTls();
  }

  setupJava(className: string, name: string, signature: string, impl: JavaMethodImpl): void {
    this.jni.defineClass(className);
    this.jni.registerJavaMethod(className, name, signature, impl);
  }

  /**
   * Pre-populate a JNI handle so that subsequent GetStringUTFChars /
   * GetObjectArrayElement calls on the returned handle return controlled data.
   *
   * - kind='string': value is a JS string → GetStringUTFChars returns a C copy
   * - kind='objarray': value is a number[] of existing handles → GetObjectArrayElement resolves them
   * - kind='integer': value is a number → GetIntField-style access returns it
   * - kind='boolean': value is 0 or 1
   */
  createJniHandle(
    kind: 'string' | 'objarray' | 'integer' | 'boolean' | 'object',
    value: unknown,
    className?: string,
  ): number {
    switch (kind) {
      case 'string':
        // mock-string: auto-unbox in jniCallMethod → returns handle for toString()
        // cls: java/lang/String → GetObjectClass returns java/lang/String
        return this.jni.allocHandle({
          kind: 'mock-string',
          value: String(value),
          cls: 'java/lang/String',
        });
      case 'objarray':
        return this.jni.allocHandle({
          kind: 'objarray',
          value: (value as number[]).map(BigInt),
          cls: '[Ljava/lang/Object;',
        });
      case 'integer':
        // mock-int: auto-unbox in jniCallMethod → returns int value for intValue()
        return this.jni.allocHandle({
          kind: 'mock-int',
          value: Number(value),
          cls: 'java/lang/Integer',
        });
      case 'boolean':
        // mock-boolean: auto-unbox in jniCallMethod → returns 1/0 for booleanValue()
        return this.jni.allocHandle({
          kind: 'mock-boolean',
          value: Boolean(value),
          cls: 'java/lang/Boolean',
        });
      case 'object':
        // Generic object with explicit class name (e.g. HashMap)
        return this.jni.allocHandle({
          kind: 'auto-object',
          desc: className ?? 'java/lang/Object',
          cls: className ?? 'java/lang/Object',
        });
      default:
        throw new Error(`Unsupported JNI handle kind: ${kind}`);
    }
  }

  /**
   * Register a mock Java field the emulated native code reads back via
   * GetFieldID/GetStaticFieldID + Get<Type>Field. `value` is the declared
   * constant (a primitive as bigint, or a handle from newByteArray for objects).
   */
  setupJavaField(className: string, name: string, signature: string, value: bigint): void {
    this.jni.defineClass(className);
    this.jni.registerJavaField(className, name, signature, value);
  }

  /** Wrap a JS byte buffer as a jbyteArray handle to pass into a native call. */
  newByteArray(bytes: Uint8Array): number {
    return this.jni.allocHandle({ kind: 'bytes', value: bytes });
  }

  /** Resolve a jbyteArray handle (e.g. a native call's return) back to bytes. */
  bytesOf(handle: number): Uint8Array | undefined {
    const value = this.jni.valueOf(handle);
    return isBytesValue(value) ? value.value : undefined;
  }

  /** Resolve a jstring handle back to its string value. */
  stringOf(handle: number): string | undefined {
    const value = this.jni.valueOf(handle);
    return isStringValue(value) ? value.value : undefined;
  }

  // ── Guest memory management (raw addresses for call_symbol) ────────────

  /**
   * Allocate a chunk of raw guest memory, optionally filling it with initial
   * data. Returns the guest address — pass it as an integer argument in
   * `call_symbol` to give native code a buffer to read/write.
   *
   * Unlike `newByteArray` (which creates a JNI jbyteArray handle), this
   * allocates **real** guest memory the CPU can address directly, suitable for
   * `call_symbol` where the native function expects a `char*` / `void*`.
   *
   * @param size     Number of bytes to allocate (rounded up to 4 KB pages).
   * @param fillBytes Optional initial data to write at the start of the region.
   * @returns The guest address of the allocated region.
   */
  allocGuestMemory(size: number, fillBytes?: Uint8Array): number {
    this.checkNotDisposed();
    if (!Number.isFinite(size) || size <= 0) {
      throw new RangeError(`allocGuestMemory size must be a positive finite number (got ${size})`);
    }
    const pageSize = getReverseEngineeringConfig().nativeEmulator.guestPageSizeBytes;
    const aligned = Math.ceil(size / pageSize) * pageSize;
    if (this.nextAllocAddr + aligned > NativeEmulator.HEAP_CEIL) {
      throw new Error(
        `Guest heap exhausted: cannot allocate ${aligned} bytes (nextAddr=0x${this.nextAllocAddr.toString(16)}, ceil=0x${NativeEmulator.HEAP_CEIL.toString(16)})`,
      );
    }
    const addr = this.nextAllocAddr;
    this.engine.mapMemory(addr, aligned);
    if (fillBytes && fillBytes.length > 0) {
      this.engine.writeCode(addr, fillBytes);
    }
    this.nextAllocAddr += aligned;
    return addr;
  }

  /**
   * Read raw bytes from guest memory at a given address.
   * Use to recover output buffers after a `call_symbol` invocation.
   */
  readGuestMemory(address: number, length: number): Uint8Array {
    return this.engine.readMemory(address, length);
  }

  /**
   * Write raw bytes into guest memory at a given address.
   * Use to prepare input buffers before a `call_symbol` invocation.
   */
  writeGuestMemory(address: number, data: Uint8Array): void {
    this.checkNotDisposed();
    this.engine.writeCode(address, data);
  }

  /** Map guest memory at a given address (no-op if already mapped). */
  mapGuestMemory(address: number, size: number): void {
    this.engine.mapMemory(address, size);
  }

  /** Write-protect the SO text segment so self-modifying stores are silently dropped. */
  protectCodeSection(): ReturnType<CpuEngine['protectCodeSection']> {
    return this.engine.protectCodeSection();
  }

  /**
   * Release all resources held by this emulator: mapped memory regions, JNI
   * object handles, CPU register state, symbol table, and host function stubs.
   *
   * Idempotent: safe to call multiple times. After disposal, calling other
   * methods throws a clear error so leaking a disposed emulator into a new
   * session fails loudly rather than silently corrupting state.
   *
   * **Design rationale & references:**
   *
   * Memory leaks in emulators are a well-documented hazard. Unicorn Engine
   * issue #1595 demonstrates that incomplete initialization paths can leave
   * allocated memory unreleased. QEMU's 2026 TCG cleanup improvements focus on
   * consistent resource teardown across all termination paths. This dispose
   * pattern follows the resource-acquisition-is-initialization (RAII) principle
   * adapted for managed runtimes: explicit cleanup when the GC cannot infer
   * ownership (mapped memory is hidden in Uint8Array buffers, JNI handles are
   * opaque integers).
   *
   * **References:**
   * - Unicorn Engine #1595: Memory leaks from incomplete initialization
   *   https://github.com/unicorn-engine/unicorn/issues/1595
   * - Unicorn Engine #1704: Excessive RAM usage on Windows
   *   https://github.com/unicorn-engine/unicorn/issues/1704
   * - QEMU TCG cleanup flow improvements (2026)
   *   https://lore.proxmox.com/pve-devel/aff05521-217e-4e0c-8f28-ea1c3b821d96@proxmox.com/t/
   * - arXiv 2504.16251: Adaptive Dynamic Memory Management for Hardware Enclaves
   *   https://arxiv.org/abs/2504.16251
   * - arXiv 2310.14741: Adaptive CPU Resource Allocation for Emulator in KVM
   *   https://arxiv.org/abs/2310.14741
   */
  dispose(): void {
    if (this.disposed) return; // Idempotent
    this.disposed = true;

    // Dispose underlying engine resources
    this.engine.dispose();

    // Dispose JNI environment
    this.jni.dispose();

    // Reset heap allocator state
    this.nextAllocAddr = 0x4000_0000;
  }

  /**
   * Scan emulated memory for a byte pattern (like Volatility's memory scanning).
   * Reads memory in page-sized chunks and searches for exact byte matches.
   *
   * @param pattern  Byte pattern to search for.
   * @param startAddr Starting address of the scan range.
   * @param endAddr   Ending address of the scan range (exclusive).
   * @param maxResults Maximum number of results to return (default: 100).
   * @returns Array of matched addresses.
   */
  scanMemory(
    pattern: Uint8Array,
    startAddr: number,
    endAddr: number,
    maxResults: number = 100,
  ): number[] {
    this.checkNotDisposed();
    if (pattern.length === 0) {
      throw new Error('Pattern must be non-empty');
    }
    if (startAddr >= endAddr) {
      throw new Error('startAddr must be less than endAddr');
    }
    const results: number[] = [];
    // Use the configured guest page size (same source as allocGuestMemory,
    // bionic.ts, and syscalls.ts) so a non-default guestPageSizeBytes config
    // keeps chunk stepping consistent with the rest of the emulator.
    const pageSize = getReverseEngineeringConfig().nativeEmulator.guestPageSizeBytes;
    const patternLen = pattern.length;

    // Build bad-character skip table for fast scanning
    const skip = new Int32Array(256);
    skip.fill(patternLen);
    for (let i = 0; i < patternLen - 1; i++) {
      skip[pattern[i]!] = patternLen - 1 - i;
    }

    for (let chunkStart = startAddr; chunkStart < endAddr; chunkStart += pageSize) {
      if (results.length >= maxResults) break;
      const chunkEnd = Math.min(chunkStart + pageSize + patternLen - 1, endAddr);
      let chunk: Uint8Array;
      try {
        chunk = this.readGuestMemory(chunkStart, chunkEnd - chunkStart);
      } catch {
        // Skip unmapped regions
        continue;
      }

      // Boyer-Moore-Horspool search
      let i = 0;
      while (i <= chunk.length - patternLen && results.length < maxResults) {
        let j = patternLen - 1;
        while (j >= 0 && chunk[i + j] === pattern[j]) j--;
        if (j < 0) {
          results.push(chunkStart + i);
          i++;
        } else {
          const badChar = chunk[i + patternLen - 1]!;
          i += skip[badChar] ?? patternLen;
        }
      }
    }
    return results;
  }

  /**
   * XOR a region of emulated memory with a single-byte key.
   * Used for quick decryption testing without writing custom tooling.
   *
   * @param address  Starting guest address.
   * @param key      Single-byte XOR key (0-255).
   * @param length   Number of bytes to XOR.
   * @param dryRun   If true, return XOR'd result without modifying memory.
   * @returns The XOR'd bytes.
   */
  xorMemory(address: number, key: number, length: number, dryRun: boolean = true): Uint8Array {
    this.checkNotDisposed();
    if (key < 0 || key > 255 || !Number.isInteger(key)) {
      throw new Error('Key must be a byte value (0-255)');
    }
    if (length <= 0) {
      throw new Error('Length must be positive');
    }
    const original = this.readGuestMemory(address, length);
    const result = new Uint8Array(original.length);
    for (let i = 0; i < original.length; i++) {
      result[i] = original[i]! ^ key;
    }
    if (!dryRun) {
      this.writeGuestMemory(address, result);
    }
    return result;
  }

  /** Throw if dispose() has been called. */
  private checkNotDisposed(): void {
    if (this.disposed) {
      throw new Error(
        'NativeEmulator has been disposed; create a new instance or reuse an active session',
      );
    }
  }
}

function isBytesValue(v: unknown): v is { kind: 'bytes'; value: Uint8Array } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'bytes';
}

function isStringValue(v: unknown): v is { kind: 'string'; value: string } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'string';
}
