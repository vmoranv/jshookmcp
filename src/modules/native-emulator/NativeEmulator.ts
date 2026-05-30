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
import { CpuEngine } from './CpuEngine';
import { JniEnvironment, type JavaMethodImpl } from './jni';
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

/**
 * Facade composing the emulator layers. `engine` and `jni` are exposed for
 * advanced callers that need the raw primitives (mapMemory, writeRegister, …);
 * the methods here cover the common load-and-call workflow.
 */
export class NativeEmulator {
  readonly engine: CpuEngine;
  readonly jni: JniEnvironment;
  /** Default bionic libc, auto-wired into loaded `.so` via relocations. */
  private readonly bionic: BionicLibrary;

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
  loadLibrary(bytes: Uint8Array): { entry: number } {
    return this.engine.loadElf(bytes, this.bionic);
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
}

function isBytesValue(v: unknown): v is { kind: 'bytes'; value: Uint8Array } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'bytes';
}

function isStringValue(v: unknown): v is { kind: 'string'; value: string } {
  return typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'string';
}
