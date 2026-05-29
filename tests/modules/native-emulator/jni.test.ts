/**
 * L4 TDD — JNIEnv/JavaVM structure layout + indirect dispatch through the table.
 *
 * JNIEnv is a pointer to a const JNINativeInterface* — i.e. double indirection:
 *   env (x0) → [slot holding table ptr] → function-pointer table.
 * The table has 4 reserved slots (0..3) then GetVersion@4, FindClass@6, … each
 * an 8-byte guest pointer. We back each implemented slot with a host stub at a
 * unique guest address, so native code that does the standard
 *   ldr x8,[x0] ; ldr x9,[x8,#idx*8] ; blr x9
 * lands in our JS implementation.
 *
 * Indices are the stable Oracle JNI ABI (verified): GetVersion 4, FindClass 6,
 * GetMethodID 33, NewStringUTF 167, GetStringUTFChars 169, NewByteArray 176,
 * GetByteArrayElements 184, RegisterNatives 215, GetJavaVM 219.
 *
 * BLR/BR encodings (verified): blr x9 = 0xD63F0120, br = 0xD61F….
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { JniEnvironment, JNI_VERSION_1_6 } from '@modules/native-emulator/jni';

function le(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

describe('JniEnvironment — L4 JNIEnv layout + dispatch', () => {
  it('exposes a guest JNIEnv pointer that double-dereferences to the table', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const envPtr = jni.envPointer();
    expect(envPtr).toBeGreaterThan(0);
    // *envPtr is the function table base; reading it must not fault.
    const tableBytes = engine.readMemory(envPtr, 8);
    const tableBase = tableBytes.reduce((acc, b, i) => acc + b * 2 ** (i * 8), 0);
    expect(tableBase).toBeGreaterThan(0);
  });

  it('dispatches GetVersion through the table and returns JNI_VERSION_1_6', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const envPtr = jni.envPointer();

    // native: ldr x8,[x0] ; ldr x9,[x8,#4*8] ; blr x9 ; (stop)
    //   x0 = env. GetVersion is index 4 → byte offset 32.
    const code = [
      ...le(0xf9400008), // ldr x8, [x0]
      ...le(0xf9401109), // ldr x9, [x8, #32]   (index 4 * 8)
      ...le(0xd63f0120), // blr x9
    ];
    const CODE = 0x2000;
    engine.mapMemory(CODE, code.length + 4);
    engine.writeCode(CODE, Uint8Array.from(code));
    engine.writeRegister('x0', envPtr);
    engine.start(CODE, CODE + code.length);
    expect(engine.readRegister('x0')).toBe(JNI_VERSION_1_6);
  });

  it('FindClass returns a stable non-zero jclass handle for a class name', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    // Pre-seed a class so FindClass resolves it.
    jni.defineClass('com/example/Crypto');
    const envPtr = jni.envPointer();
    const NAME = 0x4000;
    engine.mapMemory(NAME, 32);
    engine.writeCode(NAME, new TextEncoder().encode('com/example/Crypto\0'));

    // native: ldr x8,[x0] ; ldr x9,[x8,#6*8] ; blr x9   (FindClass index 6 → 48)
    //   x0 = env, x1 = name ptr.
    const code = [
      ...le(0xf9400008), // ldr x8, [x0]
      ...le(0xf9401909), // ldr x9, [x8, #48]
      ...le(0xd63f0120), // blr x9
    ];
    const CODE = 0x2000;
    engine.mapMemory(CODE, code.length + 4);
    engine.writeCode(CODE, Uint8Array.from(code));
    engine.writeRegister('x0', envPtr);
    engine.writeRegister('x1', NAME);
    engine.start(CODE, CODE + code.length);
    const handle = engine.readRegister('x0');
    expect(handle).toBeGreaterThan(0);
    // The handle resolves back to the class name on the host side.
    expect(jni.classNameOf(handle)).toBe('com/example/Crypto');
  });

  it('JavaVM GetJavaVM-style pointer is available and distinct from JNIEnv', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    expect(jni.javaVmPointer()).toBeGreaterThan(0);
    expect(jni.javaVmPointer()).not.toBe(jni.envPointer());
  });
});
