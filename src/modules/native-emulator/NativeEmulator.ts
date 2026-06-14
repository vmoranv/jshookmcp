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
  unresolvedImports: NativeRuntimeImportDiagnostic[];
  constructorFaults: string[];
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
   * Load an ELF64 AArch64 shared object's bytes and return its entry point.
   * Dynamic relocations are applied and imported libc symbols auto-wired to the
   * bundled bionic stubs, so a real PIC `.so` is callable without manual setup.
   */
  loadLibrary(bytes: Uint8Array): NativeLibraryLoadResult {
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
    return this.engine.loadLibraryChain(dependencies, primary, this.bionic);
  }

  /**
   * Bind bionic libc stubs (malloc/memcpy/strlen/…) at the given guest addresses.
   * Until L3 PLT/GOT relocation lands, callers route a `.so`'s libc imports to
   * these addresses explicitly; the facade just forwards to installBionicStubs.
   */
  installLibc(addrs: BionicStubAddresses): void {
    installBionicStubs(this.engine, addrs);
  }

  /** Invoke an exported function by name (AAPCS: args in x0..x7, result in x0). */
  call(symbol: string, args: number[] = []): number {
    return this.engine.callSymbol(symbol, args);
  }

  /**
   * Invoke an exported `Java_*` JNI function. The JNI convention is
   * (JNIEnv* env, jobject thiz, ...args), so this injects the guest JNIEnv* as
   * x0 and `thiz` as x1, then the Java arguments — reusing callSymbol's stack
   * setup. Returns x0 (an int/jboolean, or a jobject/jarray handle to resolve
   * via bytesOf/stringOf).
   */
  callJniExport(symbol: string, javaArgs: number[] = [], thiz = 0): number {
    return this.engine.callSymbol(symbol, [this.jni.envPointer(), thiz, ...javaArgs]);
  }

  /**
   * Register a mock Java method the emulated native code can call back into via
   * GetMethodID/GetStaticMethodID + Call*Method (the "Java world" for routines
   * that fetch a value/key from Java before folding it into their result).
   */
  setupJava(className: string, name: string, signature: string, impl: JavaMethodImpl): void {
    this.jni.registerJavaMethod(className, name, signature, impl);
  }

  /**
   * Register a mock Java field the emulated native code reads back via
   * GetFieldID/GetStaticFieldID + Get<Type>Field. `value` is the declared
   * constant (a primitive as bigint, or a handle from newByteArray for objects).
   */
  setupJavaField(className: string, name: string, signature: string, value: bigint): void {
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
    this.engine.writeCode(address, data);
  }
}

function isBytesValue(v: unknown): v is { kind: 'bytes'; value: Uint8Array } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'bytes';
}

function isStringValue(v: unknown): v is { kind: 'string'; value: string } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'string';
}
