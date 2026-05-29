/**
 * jni — JNIEnv/JavaVM emulation for the native emulator (A-plan / L4).
 *
 * This is the "native Android" core: a `.so`'s JNI entry points expect a
 * JNIEnv* whose every operation (FindClass, GetMethodID, GetStringUTFChars,
 * NewByteArray, …) dispatches through a function-pointer table. We materialise
 * that table in guest memory, back each implemented slot with a host stub, and
 * keep a host-side object table so opaque handles (jclass/jstring/jbyteArray/
 * jmethodID) map to real JS values.
 *
 * Memory model (double indirection, matching the real ABI):
 *   JNIEnv*  → [8-byte slot] → JNINativeInterface table (220 slots × 8 bytes)
 *   JavaVM*  → [8-byte slot] → JNIInvokeInterface table
 *
 * Function-table indices are the stable Oracle JNI ABI; only the slots we
 * implement are filled, the rest stay NULL (calling them would fault loudly,
 * which is the honest signal that we need to add one).
 */
import type { CpuEngine, HostContext } from './CpuEngine';

export const JNI_VERSION_1_6 = 0x00010006;

/** JNINativeInterface slot indices (4 reserved slots precede GetVersion@4). */
export const JNI_INDEX = {
  GetVersion: 4,
  FindClass: 6,
  GetObjectClass: 31,
  GetMethodID: 33,
  CallObjectMethod: 34,
  CallBooleanMethod: 37,
  CallIntMethod: 49,
  CallVoidMethod: 61,
  GetStaticMethodID: 113,
  CallStaticObjectMethod: 114,
  CallStaticIntMethod: 119,
  GetStringUTFLength: 168,
  GetStringUTFChars: 169,
  ReleaseStringUTFChars: 170,
  NewStringUTF: 167,
  GetArrayLength: 171,
  NewByteArray: 176,
  GetByteArrayElements: 184,
  ReleaseByteArrayElements: 187,
  SetByteArrayRegion: 209,
  GetByteArrayRegion: 208,
  RegisterNatives: 215,
  GetJavaVM: 219,
} as const;

/** JNIInvokeInterface (JavaVM) slot indices: 3 reserved, then the calls. */
export const JNI_INVOKE_INDEX = {
  DestroyJavaVM: 3,
  AttachCurrentThread: 4,
  DetachCurrentThread: 5,
  GetEnv: 6,
  AttachCurrentThreadAsDaemon: 7,
} as const;

const TABLE_SLOTS = 232; // ≥ highest index we touch (219) + headroom.
const POINTER_SIZE = 8;

// Guest memory layout for the JNI scaffolding (distinct high addresses).
const ENV_PTR_ADDR = 0x6000_0000; // holds the table base (what JNIEnv* points at)
const ENV_TABLE_ADDR = 0x6000_0100; // JNINativeInterface table base
const STUB_BASE = 0x6010_0000; // unique guest addr per implemented function stub
const VM_PTR_ADDR = 0x6002_0000; // holds the invoke-table base (what JavaVM* points at)
const VM_TABLE_ADDR = 0x6002_0100; // JNIInvokeInterface table base
const VM_STUB_BASE = 0x6012_0000;

// Host-side handle space (opaque jobject/jclass/jstring/jarray values).
const HANDLE_BASE = 0x7000_0000;

interface JavaClass {
  name: string;
  /** methodName+signature → jmethodID handle. */
  methods: Map<string, number>;
}

/** A native method registered via RegisterNatives (or installed directly). */
export interface NativeMethodBinding {
  name: string;
  signature: string;
  /** Guest address of the native implementation (entry to BL/callSymbol). */
  fnAddr: number;
}

export class JniEnvironment {
  private readonly engine: CpuEngine;
  private stubBump = STUB_BASE;
  private vmStubBump = VM_STUB_BASE;
  private handleBump = HANDLE_BASE;

  /** handle → host value (class/string/byte-array/etc.). */
  private readonly handles = new Map<number, unknown>();
  private readonly classes = new Map<string, number>(); // name → jclass handle
  private readonly classByHandle = new Map<number, JavaClass>();
  /** "className#method#sig" → fnAddr, populated by RegisterNatives. */
  private readonly natives = new Map<string, NativeMethodBinding>();
  /** Live GetByteArrayElements pointers → owning array handle, for write-back on Release. */
  private readonly arrayElements = new Map<number, { handle: number; length: number }>();
  /** Mock "Java world": jmethodID handle → its JS implementation. */
  private readonly javaMethods = new Map<number, JavaMethodEntry>();

  constructor(engine: CpuEngine) {
    this.engine = engine;
    this.installEnvTable();
    this.installVmTable();
  }

  /** The guest JNIEnv* value to pass as the first arg of a Java_* function. */
  envPointer(): number {
    return ENV_PTR_ADDR;
  }

  /** The guest JavaVM* value to pass to JNI_OnLoad. */
  javaVmPointer(): number {
    return VM_PTR_ADDR;
  }

  /** Pre-register a class so FindClass resolves it; returns its jclass handle. */
  defineClass(name: string): number {
    const existing = this.classes.get(name);
    if (existing !== undefined) return existing;
    const handle = this.allocHandle({ kind: 'class', name });
    this.classes.set(name, handle);
    this.classByHandle.set(handle, { name, methods: new Map() });
    return handle;
  }

  /** Resolve a jclass handle back to its class name (host-side introspection). */
  classNameOf(handle: number): string | undefined {
    return this.classByHandle.get(handle)?.name;
  }

  /**
   * Register a mock Java method implementation. When emulated native code calls
   * GetMethodID/GetStaticMethodID for this class+name+sig and then a Call*Method
   * through the returned jmethodID, the dispatch lands in `impl` — a programmable
   * "Java world" so a native routine can call back up into Java (e.g. to fetch a
   * value it then encrypts). `impl` receives the Java arguments (x3.. as bigint)
   * and the receiver object handle; its return becomes the Call*Method result.
   */
  registerJavaMethod(className: string, name: string, sig: string, impl: JavaMethodImpl): void {
    const cls = this.classByHandle.get(this.defineClass(className));
    if (!cls) return;
    const key = `${name}#${sig}`;
    let id = cls.methods.get(key);
    if (id === undefined) {
      id = this.allocHandle({ kind: 'method', name, sig, cls: className });
      cls.methods.set(key, id);
    }
    this.javaMethods.set(id, { className, name, sig, impl });
  }

  /** Look up a native binding registered for a class/method/signature. */
  nativeBinding(className: string, method: string, sig: string): NativeMethodBinding | undefined {
    return this.natives.get(`${className}#${method}#${sig}`);
  }

  /** Read a host value previously stored behind a handle. */
  valueOf(handle: number): unknown {
    return this.handles.get(handle);
  }

  /** Allocate a fresh opaque handle bound to a host value. */
  allocHandle(value: unknown): number {
    const handle = this.handleBump;
    this.handleBump += POINTER_SIZE;
    this.handles.set(handle, value);
    return handle;
  }

  // ── JNINativeInterface table construction ──

  private installEnvTable(): void {
    this.engine.mapMemory(ENV_PTR_ADDR, POINTER_SIZE);
    this.engine.mapMemory(ENV_TABLE_ADDR, TABLE_SLOTS * POINTER_SIZE);
    this.writePointer(ENV_PTR_ADDR, ENV_TABLE_ADDR); // *JNIEnv = table base

    this.bind(JNI_INDEX.GetVersion, () => BigInt(JNI_VERSION_1_6));
    this.bind(JNI_INDEX.FindClass, (ctx) => this.jniFindClass(ctx));
    this.bind(JNI_INDEX.GetMethodID, (ctx) => this.jniGetMethodID(ctx));
    this.bind(JNI_INDEX.RegisterNatives, (ctx) => this.jniRegisterNatives(ctx));
    this.bind(JNI_INDEX.NewStringUTF, (ctx) => this.jniNewStringUTF(ctx));
    this.bind(JNI_INDEX.GetStringUTFChars, (ctx) => this.jniGetStringUTFChars(ctx));
    this.bind(JNI_INDEX.ReleaseStringUTFChars, () => undefined);
    this.bind(JNI_INDEX.NewByteArray, (ctx) => this.jniNewByteArray(ctx));
    this.bind(JNI_INDEX.GetArrayLength, (ctx) => this.jniGetArrayLength(ctx));
    this.bind(JNI_INDEX.GetByteArrayElements, (ctx) => this.jniGetByteArrayElements(ctx));
    this.bind(JNI_INDEX.ReleaseByteArrayElements, (ctx) => this.jniReleaseByteArrayElements(ctx));
    this.bind(JNI_INDEX.SetByteArrayRegion, (ctx) => this.jniSetByteArrayRegion(ctx));
    this.bind(JNI_INDEX.GetByteArrayRegion, (ctx) => this.jniGetByteArrayRegion(ctx));
    this.bind(JNI_INDEX.GetJavaVM, (ctx) => this.jniGetJavaVM(ctx));
    // Call*Method family + static method lookup — the reflection callback path.
    this.bind(JNI_INDEX.GetStaticMethodID, (ctx) => this.jniGetMethodID(ctx));
    this.bind(JNI_INDEX.CallObjectMethod, (ctx) => this.jniCallMethod(ctx));
    this.bind(JNI_INDEX.CallBooleanMethod, (ctx) => this.jniCallMethod(ctx));
    this.bind(JNI_INDEX.CallIntMethod, (ctx) => this.jniCallMethod(ctx));
    this.bind(JNI_INDEX.CallVoidMethod, (ctx) => this.jniCallMethod(ctx));
    this.bind(JNI_INDEX.CallStaticObjectMethod, (ctx) => this.jniCallMethod(ctx));
    this.bind(JNI_INDEX.CallStaticIntMethod, (ctx) => this.jniCallMethod(ctx));
  }

  private installVmTable(): void {
    this.engine.mapMemory(VM_PTR_ADDR, POINTER_SIZE);
    this.engine.mapMemory(VM_TABLE_ADDR, 16 * POINTER_SIZE);
    this.writePointer(VM_PTR_ADDR, VM_TABLE_ADDR);
    // GetEnv(vm, void** out, version): store the JNIEnv*, return 0 (JNI_OK).
    this.bindVm(JNI_INVOKE_INDEX.GetEnv, (ctx) => {
      const out = Number(ctx.x(1));
      this.writePointer(out, ENV_PTR_ADDR);
      return 0n;
    });
  }

  /** Bind a JNINativeInterface slot to a host stub and write its addr into the table. */
  private bind(index: number, fn: (ctx: HostContext) => bigint | number | void): void {
    const stubAddr = this.stubBump;
    this.stubBump += POINTER_SIZE;
    this.engine.registerHostFunction(stubAddr, fn);
    this.writePointer(ENV_TABLE_ADDR + index * POINTER_SIZE, stubAddr);
  }

  private bindVm(index: number, fn: (ctx: HostContext) => bigint | number | void): void {
    const stubAddr = this.vmStubBump;
    this.vmStubBump += POINTER_SIZE;
    this.engine.registerHostFunction(stubAddr, fn);
    this.writePointer(VM_TABLE_ADDR + index * POINTER_SIZE, stubAddr);
  }

  // ── JNI function implementations ──

  /** jclass FindClass(JNIEnv*, const char* name): x1 = name. */
  private jniFindClass(ctx: HostContext): bigint {
    const name = this.readCString(ctx, Number(ctx.x(1)));
    return BigInt(this.defineClass(name)); // auto-define unknown classes
  }

  /** jmethodID GetMethodID(JNIEnv*, jclass, const char* name, const char* sig). */
  private jniGetMethodID(ctx: HostContext): bigint {
    const cls = this.classByHandle.get(Number(ctx.x(1)));
    const name = this.readCString(ctx, Number(ctx.x(2)));
    const sig = this.readCString(ctx, Number(ctx.x(3)));
    const key = `${name}#${sig}`;
    if (cls) {
      const existing = cls.methods.get(key);
      if (existing !== undefined) return BigInt(existing);
      const id = this.allocHandle({ kind: 'method', name, sig, cls: cls.name });
      cls.methods.set(key, id);
      return BigInt(id);
    }
    return BigInt(this.allocHandle({ kind: 'method', name, sig }));
  }

  /**
   * jint RegisterNatives(JNIEnv*, jclass, const JNINativeMethod* methods, jint n).
   * JNINativeMethod = { char* name; char* signature; void* fnPtr } (24 bytes).
   */
  private jniRegisterNatives(ctx: HostContext): bigint {
    const cls = this.classByHandle.get(Number(ctx.x(1)));
    const methods = Number(ctx.x(2));
    const count = Number(ctx.x(3));
    for (let i = 0; i < count; i++) {
      const rec = methods + i * 24;
      const namePtr = this.readPointer(ctx, rec);
      const sigPtr = this.readPointer(ctx, rec + 8);
      const fnAddr = this.readPointer(ctx, rec + 16);
      const name = this.readCString(ctx, namePtr);
      const signature = this.readCString(ctx, sigPtr);
      const className = cls?.name ?? '';
      this.natives.set(`${className}#${name}#${signature}`, { name, signature, fnAddr });
    }
    return 0n; // JNI_OK
  }

  /** jstring NewStringUTF(JNIEnv*, const char* bytes): x1 = bytes. */
  private jniNewStringUTF(ctx: HostContext): bigint {
    const str = this.readCString(ctx, Number(ctx.x(1)));
    return BigInt(this.allocHandle({ kind: 'string', value: str }));
  }

  /** const char* GetStringUTFChars(JNIEnv*, jstring, jboolean* isCopy). */
  private jniGetStringUTFChars(ctx: HostContext): bigint {
    const value = this.handles.get(Number(ctx.x(1)));
    const str = isStringValue(value) ? value.value : '';
    const bytes = new TextEncoder().encode(str + '\0');
    const addr = this.allocGuestBuffer(bytes);
    return BigInt(addr);
  }

  /** jbyteArray NewByteArray(JNIEnv*, jsize length): x1 = length. */
  private jniNewByteArray(ctx: HostContext): bigint {
    const length = Number(ctx.x(1));
    return BigInt(this.allocHandle({ kind: 'bytes', value: new Uint8Array(length) }));
  }

  /** jsize GetArrayLength(JNIEnv*, jarray). */
  private jniGetArrayLength(ctx: HostContext): bigint {
    const value = this.handles.get(Number(ctx.x(1)));
    return BigInt(isBytesValue(value) ? value.value.length : 0);
  }

  /** jbyte* GetByteArrayElements(JNIEnv*, jbyteArray, jboolean* isCopy). */
  private jniGetByteArrayElements(ctx: HostContext): bigint {
    const handle = Number(ctx.x(1));
    const value = this.handles.get(handle);
    const bytes = isBytesValue(value) ? value.value : new Uint8Array(0);
    const addr = this.allocGuestBuffer(bytes);
    // Track the live pointer so ReleaseByteArrayElements can copy edits back to
    // the array handle — matching real JNI, where mode 0 commits and frees.
    this.arrayElements.set(addr, { handle, length: bytes.length });
    return BigInt(addr);
  }

  /** void ReleaseByteArrayElements(JNIEnv*, jbyteArray, jbyte* elems, jint mode). */
  private jniReleaseByteArrayElements(ctx: HostContext): void {
    const elems = Number(ctx.x(2));
    const mode = Number(ctx.x(3));
    const tracked = this.arrayElements.get(elems);
    if (!tracked) return;
    const value = this.handles.get(tracked.handle);
    // mode 0 (commit + free) and JNI_COMMIT (1) write edits back to the array.
    if (mode !== 2 /* JNI_ABORT */ && isBytesValue(value)) {
      value.value.set(ctx.read(elems, tracked.length));
    }
    if (mode !== 1 /* JNI_COMMIT keeps the buffer */) this.arrayElements.delete(elems);
  }

  /** void SetByteArrayRegion(JNIEnv*, jbyteArray, jsize start, jsize len, jbyte* buf). */
  private jniSetByteArrayRegion(ctx: HostContext): void {
    const value = this.handles.get(Number(ctx.x(1)));
    if (!isBytesValue(value)) return;
    const start = Number(ctx.x(2));
    const len = Number(ctx.x(3));
    const buf = Number(ctx.x(4));
    const src = ctx.read(buf, len);
    value.value.set(src.subarray(0, len), start);
  }

  /** void GetByteArrayRegion(JNIEnv*, jbyteArray, jsize start, jsize len, jbyte* buf). */
  private jniGetByteArrayRegion(ctx: HostContext): void {
    const value = this.handles.get(Number(ctx.x(1)));
    if (!isBytesValue(value)) return;
    const start = Number(ctx.x(2));
    const len = Number(ctx.x(3));
    const buf = Number(ctx.x(4));
    ctx.write(buf, value.value.subarray(start, start + len));
  }

  /** jint GetJavaVM(JNIEnv*, JavaVM** vm): store the VM pointer, return 0. */
  private jniGetJavaVM(ctx: HostContext): bigint {
    const out = Number(ctx.x(1));
    this.writePointer(out, VM_PTR_ADDR);
    return 0n;
  }

  /**
   * Call*Method dispatch: x1 = receiver (jobject/jclass), x2 = jmethodID,
   * x3..x7 = up to five Java arguments. Routes to the registered mock impl and
   * returns whatever it produces in x0. Unregistered methods return 0 (a benign
   * null/zero), which keeps a partially-modelled Java world from hard-faulting.
   */
  private jniCallMethod(ctx: HostContext): bigint {
    const self = Number(ctx.x(1));
    const methodId = Number(ctx.x(2));
    const entry = this.javaMethods.get(methodId);
    if (!entry) return 0n;
    const args = [ctx.x(3), ctx.x(4), ctx.x(5), ctx.x(6), ctx.x(7)];
    const result = entry.impl({ args, self, jni: this });
    return result === undefined ? 0n : BigInt.asUintN(64, BigInt(result));
  }

  // ── Guest memory helpers ──

  /** Map a fresh guest buffer, copy bytes in, return its address. */
  private allocGuestBuffer(bytes: Uint8Array): number {
    const addr = this.handleBump;
    this.handleBump += Math.max(POINTER_SIZE, bytes.length + 8);
    this.engine.mapMemory(addr, Math.max(POINTER_SIZE, bytes.length + 8));
    if (bytes.length > 0) this.engine.writeCode(addr, bytes);
    return addr;
  }

  private writePointer(addr: number, value: number): void {
    const bytes = new Uint8Array(POINTER_SIZE);
    let v = BigInt(value);
    for (let i = 0; i < POINTER_SIZE; i++) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    this.engine.writeCode(addr, bytes);
  }

  private readPointer(ctx: HostContext, addr: number): number {
    const bytes = ctx.read(addr, POINTER_SIZE);
    let value = 0;
    for (let i = 0; i < POINTER_SIZE; i++) value += bytes[i]! * 2 ** (i * 8);
    return value;
  }

  private readCString(ctx: HostContext, addr: number): string {
    if (addr === 0) return '';
    const out: number[] = [];
    let p = addr;
    for (;;) {
      const b = ctx.read(p, 1)[0]!;
      if (b === 0) break;
      out.push(b);
      p++;
    }
    return new TextDecoder().decode(Uint8Array.from(out));
  }
}

interface StringValue {
  kind: 'string';
  value: string;
}
interface BytesValue {
  kind: 'bytes';
  value: Uint8Array;
}

/** Arguments handed to a mock Java method implementation. */
export interface JavaMethodCall {
  /** Java arguments as passed in x3..x7 (BigInt, 64-bit). */
  args: bigint[];
  /** The receiver: jobject handle (instance calls) or jclass handle (static). */
  self: number;
  /** The owning environment, for allocating return handles (strings/arrays). */
  jni: JniEnvironment;
}

/** A mock Java method: returns the Call*Method result (handle/int/bool) or void. */
export type JavaMethodImpl = (call: JavaMethodCall) => bigint | number | void;

interface JavaMethodEntry {
  className: string;
  name: string;
  sig: string;
  impl: JavaMethodImpl;
}

function isStringValue(v: unknown): v is StringValue {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'string';
}

function isBytesValue(v: unknown): v is BytesValue {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'bytes';
}
