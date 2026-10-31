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
import { Aarch64VaListReader } from './aarch64-va-list';
import { readGuestCString } from './c-strings';
import { encodeGuestU64, readGuestPointer, readGuestU64 } from './guest-memory';

export const JNI_VERSION_1_6 = 0x00010006;

/** JNINativeInterface slot indices (4 reserved slots precede GetVersion@4). */
export const JNI_INDEX = {
  GetVersion: 4,
  FindClass: 6,
  GetObjectClass: 31,
  IsInstanceOf: 32,
  GetMethodID: 33,
  CallObjectMethod: 34,
  CallObjectMethodV: 35,
  CallObjectMethodA: 36,
  CallBooleanMethod: 37,
  CallBooleanMethodV: 38,
  CallBooleanMethodA: 39,
  CallIntMethod: 49,
  CallIntMethodV: 50,
  CallIntMethodA: 51,
  CallLongMethod: 52,
  CallLongMethodV: 53,
  CallLongMethodA: 54,
  CallVoidMethod: 61,
  CallVoidMethodV: 62,
  CallVoidMethodA: 63,
  // Field access (instance).
  GetFieldID: 94,
  GetObjectField: 95,
  GetBooleanField: 96,
  GetIntField: 100,
  GetLongField: 101,
  SetObjectField: 104,
  SetBooleanField: 105,
  SetIntField: 109,
  SetLongField: 110,
  GetStaticMethodID: 113,
  CallStaticObjectMethod: 114,
  CallStaticObjectMethodV: 115,
  CallStaticObjectMethodA: 116,
  CallStaticBooleanMethod: 117,
  CallStaticBooleanMethodV: 118,
  CallStaticBooleanMethodA: 119,
  CallStaticIntMethod: 129,
  CallStaticIntMethodV: 130,
  CallStaticIntMethodA: 131,
  CallStaticLongMethod: 132,
  CallStaticLongMethodV: 133,
  CallStaticLongMethodA: 134,
  CallStaticVoidMethod: 141,
  CallStaticVoidMethodV: 142,
  CallStaticVoidMethodA: 143,
  // Static field access.
  GetStaticFieldID: 144,
  GetStaticObjectField: 145,
  GetStaticBooleanField: 146,
  GetStaticIntField: 150,
  GetStaticLongField: 151,
  SetStaticObjectField: 154,
  SetStaticIntField: 159,
  // Strings.
  NewStringUTF: 167,
  GetStringUTFLength: 168,
  GetStringUTFChars: 169,
  ReleaseStringUTFChars: 170,
  GetArrayLength: 171,
  // Object arrays.
  NewObject: 28,
  NewObjectArray: 172,
  GetObjectArrayElement: 173,
  SetObjectArrayElement: 174,
  NewByteArray: 176,
  GetByteArrayElements: 184,
  ReleaseByteArrayElements: 187,
  GetByteArrayRegion: 208,
  SetByteArrayRegion: 209,
  RegisterNatives: 215,
  GetJavaVM: 219,
  NewWeakGlobalRef: 226,
  DeleteWeakGlobalRef: 227,
  UnregisterNatives: 216,
  MonitorEnter: 217,
  MonitorExit: 218,
  // Extended indices — custom functions beyond the standard Oracle JNI table
  // (e.g. libmetasec_ml.so's VMP dispatch bridges into Java reflection at slots 280+)
  ExtFunc_280: 280,
  ExtFunc_300: 300,
  ExtFunc_316: 316,
  ExtFunc_322: 322,
  ExtFunc_326: 326,
  ExtFunc_336: 336,
  // Exceptions.
  Throw: 13,
  ThrowNew: 14,
  ExceptionOccurred: 15,
  ExceptionClear: 17,
  ExceptionCheck: 228,
  // References.
  NewGlobalRef: 21,
  DeleteGlobalRef: 22,
  DeleteLocalRef: 23,
  NewLocalRef: 25,
  IsSameObject: 24,
} as const;

/** Reverse lookup: JNI slot index → human-readable name (for diagnostics). */
const JNI_INDEX_NAMES: Record<number, string> = {};
for (const [name, idx] of Object.entries(JNI_INDEX)) {
  JNI_INDEX_NAMES[idx as number] = name;
}

/** JNIInvokeInterface (JavaVM) slot indices: 3 reserved, then the calls. */
export const JNI_INVOKE_INDEX = {
  DestroyJavaVM: 3,
  AttachCurrentThread: 4,
  DetachCurrentThread: 5,
  GetEnv: 6,
  AttachCurrentThreadAsDaemon: 7,
} as const;

const TABLE_SLOTS = 400; // ≥ highest extended index (336) + headroom for future custom stubs.
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
  /** fieldName+signature → jfieldID handle. */
  fields: Map<string, number>;
}

/** A native method registered via RegisterNatives (or installed directly). */
export interface NativeMethodBinding {
  name: string;
  signature: string;
  /** Guest address of the native implementation (entry to BL/callSymbol). */
  fnAddr: number;
}

/** A mock Java field's declared value (the constant native code reads back). */
interface JavaFieldEntry {
  className: string;
  name: string;
  sig: string;
  /** Declared value: a primitive bigint, or a handle (string/bytes) allocated lazily. */
  value: bigint;
}

export class JniEnvironment {
  private readonly engine: CpuEngine;
  private stubBump = STUB_BASE;
  private vmStubBump = VM_STUB_BASE;
  private handleBump = HANDLE_BASE;

  /** handle → host value (class/string/byte-array/etc.). */
  readonly handles = new Map<number, unknown>();
  /** JNI table index → stub guest address. Populated by bind(). */
  private readonly stubAddresses = new Map<number, number>();
  private readonly classes = new Map<string, number>(); // name → jclass handle
  private readonly classByHandle = new Map<number, JavaClass>();
  /** "className#method#sig" → fnAddr, populated by RegisterNatives. */
  private readonly natives = new Map<string, NativeMethodBinding>();
  /** Live GetByteArrayElements pointers → owning array handle, for write-back on Release. */
  private readonly arrayElements = new Map<number, { handle: number; length: number }>();
  /** Mock "Java world": jmethodID handle → its JS implementation. */
  private readonly javaMethods = new Map<number, JavaMethodEntry>();
  /** Mock Java fields: jfieldID handle → its declared value. */
  private readonly javaFields = new Map<number, JavaFieldEntry>();
  /** Currently-pending exception handle (0 = none), set by Throw/ThrowNew. */
  private pendingException = 0;

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
    this.classByHandle.set(handle, { name, methods: new Map(), fields: new Map() });
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

  /**
   * Register a mock Java field. When emulated native code calls
   * GetFieldID/GetStaticFieldID then Get<Type>Field, the dispatch returns this
   * declared `value` (a primitive, or a handle for object fields). Mirrors
   * registerJavaMethod for the "Java world" a native routine reads constants from.
   */
  registerJavaField(className: string, name: string, sig: string, value: bigint): void {
    const cls = this.classByHandle.get(this.defineClass(className));
    if (!cls) return;
    const key = `${name}#${sig}`;
    let id = cls.fields.get(key);
    if (id === undefined) {
      id = this.allocHandle({ kind: 'field', name, sig, cls: className });
      cls.fields.set(key, id);
    }
    this.javaFields.set(id, { className, name, sig, value });
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

  /**
   * Release all JNI resources: object handles (jclass/jstring/jbyteArray),
   * class registry, method/field registrations, native bindings, and
   * GetByteArrayElements tracking.
   *
   * Idempotent: safe to call multiple times. Follows the disposal pattern for
   * emulator-backed JNI environments, ensuring no handle leaks accumulate across
   * repeated session create/destroy cycles.
   */
  dispose(): void {
    // Clear handle table (releases all jclass/jstring/jbyteArray/jmethodID/jfieldID)
    this.handles.clear();
    this.handleBump = HANDLE_BASE;

    // Clear class registry
    this.classes.clear();
    this.classByHandle.clear();

    // Clear native method bindings
    this.natives.clear();

    // Clear GetByteArrayElements tracking
    this.arrayElements.clear();

    // Clear mock Java methods and fields
    this.javaMethods.clear();
    this.javaFields.clear();

    // Reset stub allocators
    this.stubBump = STUB_BASE;
    this.vmStubBump = VM_STUB_BASE;

    // Clear stub address map
    this.stubAddresses.clear();

    // Clear pending exception
    this.pendingException = 0;
  }

  // ── JNINativeInterface table construction ──

  /** Per-session diagnostic log of JNI calls to unimplemented slots. */
  private readonly jniDiagLog: string[] = [];

  /** Return a snapshot of diagnostic messages (cleared after read). */
  jniDiagnostics(): string[] {
    const copy = [...this.jniDiagLog];
    this.jniDiagLog.length = 0;
    return copy;
  }

  /** Return a snapshot WITHOUT clearing — for trace handlers that run
   *  after execution but shouldn't consume the log. */
  snapshotJniDiag(): string[] {
    return [...this.jniDiagLog];
  }

  /** Clear diagnostic log. */
  clearJniDiag(): void {
    this.jniDiagLog.length = 0;
  }

  private installEnvTable(): void {
    this.engine.mapMemory(ENV_PTR_ADDR, POINTER_SIZE);
    this.engine.mapMemory(ENV_TABLE_ADDR, TABLE_SLOTS * POINTER_SIZE);
    this.engine.mapMemory(STUB_BASE, TABLE_SLOTS * POINTER_SIZE); // guest data reads (ldr) from stub area
    this.writePointer(ENV_PTR_ADDR, ENV_TABLE_ADDR); // *JNIEnv = table base

    // Track which slots we explicitly implement, then auto-fill the rest with
    // diagnostic stubs that log the call and return 0 — no pre-baked behaviour,
    // just honest visibility into what the native code actually needs.
    const filled = new Set<number>();

    const b = (index: number, fn: (ctx: HostContext) => bigint | number | void) => {
      filled.add(index);
      const name = JNI_INDEX_NAMES[index] ?? `slot_${index}`;
      const wrapped = (ctx: HostContext): bigint | number | void => {
        this.jniDiagLog.push(
          `JNI: ${name} x1=0x${ctx.x(1).toString(16)} x2=0x${ctx.x(2).toString(16)} x3=0x${ctx.x(3).toString(16)} x4=0x${ctx.x(4).toString(16)} x5=0x${ctx.x(5).toString(16)} x6=0x${ctx.x(6).toString(16)} x7=0x${ctx.x(7).toString(16)}`,
        );
        return fn(ctx);
      };
      this.bind(index, wrapped);
    };

    b(JNI_INDEX.GetVersion, () => BigInt(JNI_VERSION_1_6));
    b(JNI_INDEX.FindClass, (ctx) => this.jniFindClass(ctx));
    b(JNI_INDEX.GetMethodID, (ctx) => this.jniGetMethodID(ctx));
    b(JNI_INDEX.RegisterNatives, (ctx) => this.jniRegisterNatives(ctx));
    b(JNI_INDEX.NewStringUTF, (ctx) => this.jniNewStringUTF(ctx));
    b(JNI_INDEX.GetStringUTFChars, (ctx) => this.jniGetStringUTFChars(ctx));
    b(JNI_INDEX.ReleaseStringUTFChars, () => undefined);
    b(JNI_INDEX.NewByteArray, (ctx) => this.jniNewByteArray(ctx));
    b(JNI_INDEX.GetArrayLength, (ctx) => this.jniGetArrayLength(ctx));
    b(JNI_INDEX.GetByteArrayElements, (ctx) => this.jniGetByteArrayElements(ctx));
    b(JNI_INDEX.ReleaseByteArrayElements, (ctx) => this.jniReleaseByteArrayElements(ctx));
    b(JNI_INDEX.SetByteArrayRegion, (ctx) => this.jniSetByteArrayRegion(ctx));
    b(JNI_INDEX.GetByteArrayRegion, (ctx) => this.jniGetByteArrayRegion(ctx));
    b(JNI_INDEX.GetJavaVM, (ctx) => this.jniGetJavaVM(ctx));
    // Call*Method family + static method lookup — the reflection callback path.
    b(JNI_INDEX.GetStaticMethodID, (ctx) => this.jniGetMethodID(ctx));
    b(JNI_INDEX.CallObjectMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallBooleanMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallIntMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallLongMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallVoidMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallObjectMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallObjectMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallBooleanMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallBooleanMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallIntMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallIntMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallLongMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallLongMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallVoidMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallVoidMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallStaticObjectMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallStaticIntMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallStaticBooleanMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallStaticLongMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallStaticVoidMethod, (ctx) => this.jniCallMethod(ctx));
    b(JNI_INDEX.CallStaticObjectMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallStaticObjectMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallStaticBooleanMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallStaticBooleanMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallStaticIntMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallStaticIntMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallStaticLongMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallStaticLongMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));
    b(JNI_INDEX.CallStaticVoidMethodV, (ctx) => this.jniCallMethod(ctx, 'vaList'));
    b(JNI_INDEX.CallStaticVoidMethodA, (ctx) => this.jniCallMethod(ctx, 'jvalueArray'));

    // Field access
    b(JNI_INDEX.GetFieldID, (ctx) => this.jniGetFieldID(ctx));
    b(JNI_INDEX.GetStaticFieldID, (ctx) => this.jniGetFieldID(ctx));
    b(JNI_INDEX.GetObjectField, (ctx) => this.jniGetField(ctx));
    b(JNI_INDEX.GetBooleanField, (ctx) => this.jniGetField(ctx));
    b(JNI_INDEX.GetIntField, (ctx) => this.jniGetField(ctx));
    b(JNI_INDEX.GetLongField, (ctx) => this.jniGetField(ctx));
    b(JNI_INDEX.GetStaticObjectField, (ctx) => this.jniGetStaticField(ctx));
    b(JNI_INDEX.GetStaticBooleanField, (ctx) => this.jniGetStaticField(ctx));
    b(JNI_INDEX.GetStaticIntField, (ctx) => this.jniGetStaticField(ctx));
    b(JNI_INDEX.GetStaticLongField, (ctx) => this.jniGetStaticField(ctx));
    b(JNI_INDEX.SetObjectField, () => undefined);
    b(JNI_INDEX.SetBooleanField, () => undefined);
    b(JNI_INDEX.SetIntField, () => undefined);
    b(JNI_INDEX.SetLongField, () => undefined);
    b(JNI_INDEX.SetStaticObjectField, () => undefined);
    b(JNI_INDEX.SetStaticIntField, () => undefined);

    // Object creation
    b(JNI_INDEX.NewObject, (_ctx) => {
      // jobject NewObject(JNIEnv*, jclass, jmethodID, ...)
      // Return a non-NULL auto-object handle so null-checks pass.
      return BigInt(this.allocHandle({ kind: 'auto-object', desc: 'java/lang/Object' }));
    });

    // Strings & arrays
    b(JNI_INDEX.GetStringUTFLength, (ctx) => this.jniGetStringUTFLength(ctx));
    b(JNI_INDEX.GetObjectClass, (ctx) => this.jniGetObjectClass(ctx));
    b(JNI_INDEX.NewObjectArray, (ctx) => this.jniNewObjectArray(ctx));
    b(JNI_INDEX.GetObjectArrayElement, (ctx) => this.jniGetObjectArrayElement(ctx));
    b(JNI_INDEX.SetObjectArrayElement, (ctx) => this.jniSetObjectArrayElement(ctx));

    // Exceptions
    b(JNI_INDEX.Throw, (ctx) => {
      this.pendingException = Number(ctx.x(1));
      return 0n;
    });
    b(JNI_INDEX.ThrowNew, (ctx) => {
      this.pendingException = this.allocHandle({ kind: 'throwable', cls: Number(ctx.x(1)) });
      return 0n;
    });
    b(JNI_INDEX.ExceptionOccurred, () => BigInt(this.pendingException));
    b(JNI_INDEX.ExceptionCheck, () => (this.pendingException !== 0 ? 1n : 0n));
    b(JNI_INDEX.ExceptionClear, () => {
      this.pendingException = 0;
      return undefined;
    });

    // References
    b(JNI_INDEX.NewGlobalRef, (ctx) => ctx.x(1));
    b(JNI_INDEX.NewLocalRef, (ctx) => ctx.x(1));
    b(JNI_INDEX.DeleteGlobalRef, () => undefined);
    b(JNI_INDEX.DeleteLocalRef, () => undefined);
    b(JNI_INDEX.NewWeakGlobalRef, (ctx) => ctx.x(1));
    b(JNI_INDEX.DeleteWeakGlobalRef, () => undefined);
    b(JNI_INDEX.UnregisterNatives, () => 0n);
    b(JNI_INDEX.MonitorEnter, () => 0n);
    b(JNI_INDEX.MonitorExit, () => 0n);
    b(JNI_INDEX.IsSameObject, (ctx) => (ctx.x(1) === ctx.x(2) ? 1n : 0n));
    b(JNI_INDEX.IsInstanceOf, () => 1n);

    // ── Extended index stubs (280+) — return identifiable values per slot ────
    // Each returns its own index so native callers get a distinguishable signal.
    // Later these will be replaced with real JNI impls (FindClass, GetMethodID, etc.).
    // Extended slots for metasec_ml dispatcher (JNI cache entries 280-336).
    // Map guesses based on observed JNI call patterns (CallBooleanMethodV in diag).
    // If mapping is wrong, JNI diag will show the actual call; swap to match.
    b(JNI_INDEX.ExtFunc_280, (ctx) => this.jniFindClass(ctx)); // FindClass
    b(JNI_INDEX.ExtFunc_300, (ctx) => this.jniGetMethodID(ctx)); // GetMethodID
    b(JNI_INDEX.ExtFunc_316, (ctx) => this.jniGetStringUTFChars(ctx)); // GetStringUTFChars
    b(JNI_INDEX.ExtFunc_322, (ctx) => this.jniCallMethod(ctx)); // CallObjectMethod
    b(JNI_INDEX.ExtFunc_326, (ctx) => this.jniNewStringUTF(ctx)); // NewStringUTF
    b(JNI_INDEX.ExtFunc_336, (ctx) => this.jniCallMethod(ctx)); // CallBooleanMethodV

    // ── Auto-fill every remaining NULL slot with a diagnostic stub ──────────
    // Instead of pre-baking every JNI function, we fill unfilled table entries
    // with honest logging stubs. When native code calls one, we get its index
    // in jniDiagLog without crashing. The agent can then implement the real
    // behaviour later. Memory is zeroed by mapMemory, so unfilled slots are
    // already NULL; we only fill the ones we discover at runtime.
    for (let idx = 0; idx < TABLE_SLOTS; idx++) {
      if (filled.has(idx)) continue;
      const slotIdx = idx; // capture for closure
      this.bind(idx, (ctx) => {
        const name = JNI_INDEX_NAMES[slotIdx] ?? `unknown_${slotIdx}`;
        const msg = `JNI stub: ${name} (slot ${slotIdx}) x1=0x${ctx.x(1).toString(16)} x2=0x${ctx.x(2).toString(16)} x3=0x${ctx.x(3).toString(16)} x4=0x${ctx.x(4).toString(16)} x5=0x${ctx.x(5).toString(16)} x6=0x${ctx.x(6).toString(16)} x7=0x${ctx.x(7).toString(16)}`;
        this.jniDiagLog.push(msg);
        return 0n;
      });
    }
  }

  private installVmTable(): void {
    this.engine.mapMemory(VM_PTR_ADDR, POINTER_SIZE);
    this.engine.mapMemory(VM_TABLE_ADDR, 32 * POINTER_SIZE); // 32 entries (was 16)
    this.engine.mapMemory(VM_STUB_BASE, 32 * POINTER_SIZE); // guest data reads from vm stub area
    this.writePointer(VM_PTR_ADDR, VM_TABLE_ADDR);

    // DestroyJavaVM(vm) → JNI_OK
    this.bindVm(JNI_INVOKE_INDEX.DestroyJavaVM, () => 0n);

    // AttachCurrentThread(vm, JNIEnv** out, void* args): store JNIEnv*, return JNI_OK.
    this.bindVm(JNI_INVOKE_INDEX.AttachCurrentThread, (ctx) => {
      const out = Number(ctx.x(1));
      this.writePointer(out, ENV_PTR_ADDR);
      return 0n;
    });

    // DetachCurrentThread(vm) → JNI_OK
    this.bindVm(JNI_INVOKE_INDEX.DetachCurrentThread, () => 0n);

    // GetEnv(vm, void** out, version): store the JNIEnv*, return 0 (JNI_OK).
    this.bindVm(JNI_INVOKE_INDEX.GetEnv, (ctx) => {
      const out = Number(ctx.x(1));
      this.writePointer(out, ENV_PTR_ADDR);
      return 0n;
    });

    // AttachCurrentThreadAsDaemon(vm, JNIEnv** out, void* args): store JNIEnv*, return JNI_OK.
    this.bindVm(JNI_INVOKE_INDEX.AttachCurrentThreadAsDaemon, (ctx) => {
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
    this.stubAddresses.set(index, stubAddr);
  }

  /**
   * Return the guest stub address for a JNI table index.
   * Returns 0 for indices that were never bound (no stub exists).
   */
  getJniStubAddress(index: number): number {
    return this.stubAddresses.get(index) ?? 0;
  }

  /** Return all bound JNI index → stub address mappings. */
  getJniStubAddresses(): ReadonlyMap<number, number> {
    return this.stubAddresses;
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
    const nameAddr = Number(ctx.x(1));
    // NULL pointer → return NULL to fail fast
    if (nameAddr === 0) {
      this.jniDiagLog.push(`FindClass: NULL name ptr → returning NULL`);
      return 0n;
    }
    const name = this.readCString(ctx, nameAddr);
    this.jniDiagLog.push(`FindClass: ${name}`);
    // Empty class name — log warning but still auto-define (old behavior,
    // needed because JNI_OnLoad reads class names from memory that may not
    // be initialized yet on first pass)
    if (!name || name.length === 0) {
      this.jniDiagLog.push(
        `FindClass: WARNING empty name at 0x${nameAddr.toString(16)}, auto-defining`,
      );
    }
    return BigInt(this.defineClass(name)); // auto-define unknown classes
  }

  /** jclass GetObjectClass(JNIEnv*, jobject): x1 = object handle. */
  private jniGetObjectClass(ctx: HostContext): bigint {
    const handle = Number(ctx.x(1));
    const info = this.handles.get(handle);
    if (info && typeof info === 'object') {
      // Resolve class name from handle metadata
      const cls = (info as { cls?: string }).cls;
      if (cls) return BigInt(this.defineClass(cls));
      // Infer class from handle kind
      const kind = (info as { kind?: string }).kind;
      if (kind === 'mock-string') return BigInt(this.defineClass('java/lang/String'));
      if (kind === 'mock-int' || kind === 'integer')
        return BigInt(this.defineClass('java/lang/Integer'));
      if (kind === 'mock-boolean' || kind === 'boolean')
        return BigInt(this.defineClass('java/lang/Boolean'));
      if (kind === 'bytes') return BigInt(this.defineClass('[B'));
      if (kind === 'objarray') return BigInt(this.defineClass('[Ljava/lang/Object;'));
      if (kind === 'object' || kind === 'auto-object') {
        return BigInt(this.defineClass(cls ?? 'java/lang/Object'));
      }
    }
    return BigInt(this.defineClass('java/lang/Object'));
  }

  /** jmethodID GetMethodID/GetStaticMethodID(JNIEnv*, jclass, const char* name, const char* sig). */
  private jniGetMethodID(ctx: HostContext): bigint {
    const clsHandle = Number(ctx.x(1));
    // NULL class handle → fail fast
    if (clsHandle === 0) {
      this.jniDiagLog.push(`GetMethodID: NULL class → returning NULL`);
      return 0n;
    }
    const cls = this.classByHandle.get(clsHandle);
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
    this.jniDiagLog.push(
      `RegisterNatives: cls=${cls?.name ?? '?'} count=${count} table=0x${methods.toString(16)}`,
    );
    for (let i = 0; i < count; i++) {
      const rec = methods + i * 24;
      const namePtr = this.readPointer(ctx, rec);
      const sigPtr = this.readPointer(ctx, rec + 8);
      const fnAddr = this.readPointer(ctx, rec + 16);
      const name = this.readCString(ctx, namePtr);
      const signature = this.readCString(ctx, sigPtr);
      const className = cls?.name ?? '';
      this.natives.set(`${className}#${name}#${signature}`, { name, signature, fnAddr });
      this.jniDiagLog.push(`  [${i}] ${className}#${name}#${signature} → 0x${fnAddr.toString(16)}`);
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

  /**
   * jsize GetArrayLength(JNIEnv*, jarray). Works for both jbyteArray and any
   * object array (String[]/Object[]) — a native loop like RootBeer's
   * `for (i=0; i<GetArrayLength(paths); i++)` drives off this count, so an
   * object array must report its real length, not 0.
   */
  private jniGetArrayLength(ctx: HostContext): bigint {
    const value = this.handles.get(Number(ctx.x(1)));
    if (isBytesValue(value)) return BigInt(value.value.length);
    if (isObjArrayValue(value)) return BigInt(value.value.length);
    // Auto-objects (from returnObject mocks) → return 1 so native code
    // thinks the set/map has an entry and doesn't throw SecException.
    if (value && typeof value === 'object' && (value as { kind?: string }).kind === 'auto-object')
      return 1n;
    return 0n;
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

  /** Direct mocked method, or match by class+name+sig from the method handle. */
  private resolveJavaMethodEntry(methodId: number): JavaMethodEntry | undefined {
    const entry = this.javaMethods.get(methodId);
    if (entry) return entry;
    // Method ID not directly mocked — try to match by class+name+sig from
    // the method handle (auto-allocated by an earlier GetMethodID call).
    const mi = this.handles.get(methodId);
    if (mi && typeof mi === 'object') {
      const mCls = (mi as { cls?: string }).cls;
      const mName = (mi as { name?: string }).name;
      const mSig = (mi as { sig?: string }).sig;
      if (mCls && mName && mSig) {
        for (const [, mock] of this.javaMethods) {
          if (mock.className === mCls && mock.name === mName && mock.sig === mSig) {
            return mock;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Check if `self` is a self-describing mock handle from a prior
   * conditional HashMap.get/Map.get — auto-unbox mock-int, mock-boolean,
   * mock-string, mock-bytes so intValue()/booleanValue()/toString() work
   * without an explicit per-method mock registration.
   * Returns the unboxed value, or undefined when `self` is not such a mock.
   */
  private unboxSelfDescribingMock(self: number, methodId: number): bigint | undefined {
    const selfValue = this.handles.get(self);
    if (!selfValue || typeof selfValue !== 'object') return undefined;
    const sk = (selfValue as { kind?: string }).kind;
    if (sk === 'mock-int') {
      return BigInt((selfValue as { value: number }).value);
    }
    if (sk === 'mock-boolean') {
      return BigInt((selfValue as { value: boolean }).value ? 1n : 0n);
    }
    // For mock-string: toString() returns self, getBytes() returns new byte[]
    if (sk === 'mock-string') {
      const mi2 = this.handles.get(methodId);
      const mName = (mi2 as { name?: string } | undefined)?.name;
      const mSig = (mi2 as { sig?: string } | undefined)?.sig;
      if (mName === 'getBytes' || (mSig && mSig.endsWith(')[B'))) {
        const str = (selfValue as { value: string }).value;
        const bytes = new TextEncoder().encode(str);
        return BigInt(this.allocHandle({ kind: 'bytes', value: bytes }));
      }
      return BigInt(self);
    }
    if (sk === 'mock-bytes') {
      return BigInt(self);
    }
    return undefined;
  }

  /**
   * ── Auto-object method resolution ──────────────────────────
   * When `self` is an auto-object (from a prior returnObject mock or
   * fallback allocation), look for a mock registered for the auto-object's
   * class + the called method. This enables chained iterator patterns:
   *   HashMap.entrySet() → Set.iterator() → Iterator.hasNext()/next()
   */
  private findAutoObjectEntry(self: number, methodId: number): JavaMethodEntry | undefined {
    const selfValue = this.handles.get(self);
    if (!selfValue || typeof selfValue !== 'object') return undefined;
    if ((selfValue as { kind?: string }).kind !== 'auto-object') return undefined;
    const mi = this.handles.get(methodId);
    const mName = (mi as { name?: string } | undefined)?.name ?? '';
    const mSig = (mi as { sig?: string } | undefined)?.sig ?? '';
    const autoCls = (selfValue as { cls?: string }).cls ?? '';
    if (!autoCls || !mName) return undefined;
    for (const [, mock] of this.javaMethods) {
      if (mock.className === autoCls && mock.name === mName && mock.sig === mSig) {
        return mock;
      }
    }
    return undefined;
  }

  /**
   * Fallback for auto-object method calls with no registered mock:
   * auto-return a non-zero handle for object-returning methods so native
   * code's cbz null-checks pass; boolean/int returns log and return 0.
   */
  private autoObjectFallback(self: number, methodId: number): bigint {
    const handleInfo = this.handles.get(methodId);
    const sig: string = (handleInfo as { sig?: string } | undefined)?.sig ?? '()V';
    const returnType = sig.substring(sig.indexOf(')') + 1);
    if (returnType.startsWith('L') || returnType.startsWith('[')) {
      // Extract class name from return type for auto-object chaining
      const retCls = returnType.startsWith('L')
        ? returnType.substring(1, returnType.indexOf(';'))
        : returnType;
      return BigInt(this.allocHandle({ kind: 'auto-object', cls: retCls, desc: sig }));
    }
    const selfInfo = this.handles.get(self);
    if (
      selfInfo &&
      typeof selfInfo === 'object' &&
      (selfInfo as { kind?: string }).kind === 'auto-object'
    ) {
      const mi = this.handles.get(methodId);
      const name = (mi as { name?: string } | undefined)?.name ?? '?';
      const autoCls = (selfInfo as { cls?: string }).cls ?? '?';
      this.jniDiagLog.push(`JNI: unmocked ${autoCls}.${name}() on auto-object`);
    }
    return 0n;
  }

  /** Decode Call*Method arguments per its direct, V, or A representation. */
  private readJniCallArguments(
    ctx: HostContext,
    mode: JniCallArgumentMode,
    parameterTypes: readonly JniParameterType[],
  ): bigint[] {
    if (mode === 'jvalueArray') {
      return parameterTypes.map((type, index) => {
        const raw = readGuestU64(ctx, Number(ctx.x(3)) + index * 8);
        return normalizeJniArgument(type, raw, false);
      });
    }
    if (mode === 'vaList') {
      return this.readVaListArguments(ctx, Number(ctx.x(3)), parameterTypes);
    }
    return parameterTypes.map((type, index) => {
      const raw = index < 5 ? ctx.x(3 + index) : 0n;
      return normalizeJniArgument(type, raw, false);
    });
  }

  /** Dispatch a Call*Method, decoding its direct, V, or A argument representation. */
  private jniCallMethod(ctx: HostContext, mode: JniCallArgumentMode = 'registers'): bigint {
    const self = Number(ctx.x(1));
    const methodId = Number(ctx.x(2));
    let entry = this.resolveJavaMethodEntry(methodId);
    if (!entry) {
      const unboxed = this.unboxSelfDescribingMock(self, methodId);
      if (unboxed !== undefined) return unboxed;
      entry = this.findAutoObjectEntry(self, methodId);
      if (!entry) {
        return this.autoObjectFallback(self, methodId);
      }
    }
    const parameterTypes = parseJniParameterTypes(entry.sig);
    const args = this.readJniCallArguments(ctx, mode, parameterTypes);
    const result = entry.impl({ args, self, jni: this });
    return result === undefined ? 0n : BigInt.asUintN(64, BigInt(result));
  }

  /** Decode Android arm64's `va_list` (stack/gr_top/vr_top/gr_offs/vr_offs). */
  private readVaListArguments(
    ctx: HostContext,
    vaListAddress: number,
    parameterTypes: readonly JniParameterType[],
  ): bigint[] {
    const args = new Aarch64VaListReader(ctx, vaListAddress);
    return parameterTypes.map((type) => {
      const floating = type === 'F' || type === 'D';
      const raw = floating ? args.nextFloating() : args.nextGeneral();
      return normalizeJniArgument(type, raw, floating);
    });
  }

  /**
   * jfieldID GetFieldID/GetStaticFieldID(JNIEnv*, jclass, name, sig): resolve (or
   * lazily mint) the field handle for the class so a later Get*Field can find it.
   */
  private jniGetFieldID(ctx: HostContext): bigint {
    const cls = this.classByHandle.get(Number(ctx.x(1)));
    const name = this.readCString(ctx, Number(ctx.x(2)));
    const sig = this.readCString(ctx, Number(ctx.x(3)));
    const key = `${name}#${sig}`;
    if (cls) {
      const existing = cls.fields.get(key);
      if (existing !== undefined) return BigInt(existing);
      const id = this.allocHandle({ kind: 'field', name, sig, cls: cls.name });
      cls.fields.set(key, id);
      return BigInt(id);
    }
    return BigInt(this.allocHandle({ kind: 'field', name, sig }));
  }

  /** Get<Type>Field(JNIEnv*, jobject, jfieldID): return the declared mock value. */
  private jniGetField(ctx: HostContext): bigint {
    const entry = this.javaFields.get(Number(ctx.x(2)));
    return entry ? entry.value : 0n;
  }

  /** GetStatic<Type>Field(JNIEnv*, jclass, jfieldID): same lookup as instance. */
  private jniGetStaticField(ctx: HostContext): bigint {
    const entry = this.javaFields.get(Number(ctx.x(2)));
    return entry ? entry.value : 0n;
  }

  /** jsize GetStringUTFLength(JNIEnv*, jstring): UTF-8 byte length of the string. */
  private jniGetStringUTFLength(ctx: HostContext): bigint {
    const value = this.handles.get(Number(ctx.x(1)));
    const str = isStringValue(value) ? value.value : '';
    return BigInt(new TextEncoder().encode(str).length);
  }

  /** jobjectArray NewObjectArray(JNIEnv*, jsize len, jclass, jobject init). */
  private jniNewObjectArray(ctx: HostContext): bigint {
    const length = Number(ctx.x(1));
    const init = ctx.x(3);
    const arr = Array.from<bigint>({ length }).fill(init);
    return BigInt(this.allocHandle({ kind: 'objarray', value: arr }));
  }

  /** jobject GetObjectArrayElement(JNIEnv*, jobjectArray, jsize index). */
  private jniGetObjectArrayElement(ctx: HostContext): bigint {
    const value = this.handles.get(Number(ctx.x(1)));
    const idx = Number(ctx.x(2));
    if (isObjArrayValue(value)) {
      const el = value.value[idx] ?? 0n;
      this.jniDiagLog.push(
        `  → GetObjectArrayElement[${idx}] = 0x${el.toString(16)} (len=${value.value.length})`,
      );
      return el;
    }
    this.jniDiagLog.push(
      `  → GetObjectArrayElement FAILED: not objarray, kind=${(value as { kind?: string } | null)?.kind ?? 'null'}`,
    );
    return 0n;
  }

  /** void SetObjectArrayElement(JNIEnv*, jobjectArray, jsize index, jobject val). */
  private jniSetObjectArrayElement(ctx: HostContext): void {
    const value = this.handles.get(Number(ctx.x(1)));
    const idx = Number(ctx.x(2));
    if (isObjArrayValue(value)) value.value[idx] = ctx.x(3);
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
    this.engine.writeCode(addr, encodeGuestU64(value));
  }

  private readPointer(ctx: HostContext, addr: number): number {
    return readGuestPointer(ctx, addr);
  }

  private readCString(ctx: HostContext, addr: number): string {
    return readGuestCString(ctx, addr);
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
interface ObjArrayValue {
  kind: 'objarray';
  value: bigint[];
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

type JniCallArgumentMode = 'registers' | 'vaList' | 'jvalueArray';
type JniParameterType = 'Z' | 'B' | 'C' | 'S' | 'I' | 'J' | 'F' | 'D' | 'L';

function parseJniParameterTypes(signature: string): JniParameterType[] {
  const open = signature.indexOf('(');
  const close = signature.indexOf(')', open + 1);
  if (open < 0 || close < 0) return [];
  const types: JniParameterType[] = [];
  for (let i = open + 1; i < close; i++) {
    const type = signature[i];
    if (type === '[') {
      while (signature[i] === '[') i++;
      if (signature[i] === 'L') {
        const end = signature.indexOf(';', i);
        if (end < 0 || end > close) break;
        i = end;
      }
      types.push('L');
      continue;
    }
    if (type === 'L') {
      const end = signature.indexOf(';', i);
      if (end < 0 || end > close) break;
      types.push('L');
      i = end;
      continue;
    }
    if (type && 'ZBCSIJFD'.includes(type)) types.push(type as JniParameterType);
  }
  return types;
}

function normalizeJniArgument(
  type: JniParameterType,
  raw: bigint,
  promotedFloating: boolean,
): bigint {
  switch (type) {
    case 'Z':
      return raw & 0xffn;
    case 'B':
      return BigInt.asIntN(8, raw);
    case 'C':
      return raw & 0xffffn;
    case 'S':
      return BigInt.asIntN(16, raw);
    case 'I':
      return BigInt.asIntN(32, raw);
    case 'J':
      return BigInt.asIntN(64, raw);
    case 'F': {
      if (!promotedFloating) return raw & 0xffff_ffffn;
      const source = new ArrayBuffer(8);
      const sourceView = new DataView(source);
      sourceView.setBigUint64(0, raw, true);
      const target = new ArrayBuffer(4);
      const targetView = new DataView(target);
      targetView.setFloat32(0, sourceView.getFloat64(0, true), true);
      return BigInt(targetView.getUint32(0, true));
    }
    case 'D':
    case 'L':
      return raw;
  }
}

function isStringValue(v: unknown): v is StringValue {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'string';
}

function isBytesValue(v: unknown): v is BytesValue {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'bytes';
}

function isObjArrayValue(v: unknown): v is ObjArrayValue {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'objarray';
}
