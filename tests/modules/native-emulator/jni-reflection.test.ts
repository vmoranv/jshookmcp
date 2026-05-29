/**
 * L4.3 TDD — JNI reflection callback path (the programmable "mock Java world").
 *
 * Pins the registerJavaMethod → GetStaticMethodID → Call*Method loop that lets
 * emulated native code call *up* into a JS-defined Java implementation. A real
 * signing/crypto routine often does exactly this: native fetches a value or key
 * from a Java method, then folds it into the result. Here the native side calls
 * Config.getMagic() (registered to return 41) and adds 1, proving the round trip
 * through the function table, the jmethodID handle space, and the host stub.
 *
 * Encoders are the assembler-verified subset reused from jni-marshalling.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { JniEnvironment, JNI_INDEX } from '@modules/native-emulator/jni';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const movz = (rd: number, imm: number, hw = 0): number =>
  (0xd2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;
const movReg = (rd: number, rm: number): number => (0xaa000000 | (rm << 16) | (31 << 5) | rd) >>> 0;
const ldrOff = (rt: number, rn: number, byteOff: number): number =>
  (0xf9400000 | ((byteOff / 8) << 10) | (rn << 5) | rt) >>> 0;
const blr = (rn: number): number => (0xd63f0000 | (rn << 5)) >>> 0;
const addi = (rd: number, rn: number, imm: number): number =>
  (0x91000000 | ((imm & 0xfff) << 10) | (rn << 5) | rd) >>> 0;

/** ldr x8,[x19] ; ldr x9,[x8,#idx*8] ; blr x9 — dispatch a JNI fn (x19 = env). */
const callJni = (idx: number): number[] => [
  ...le(ldrOff(8, 19, 0)),
  ...le(ldrOff(9, 8, idx * 8)),
  ...le(blr(9)),
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

// Guest addresses the assembled code references for its string constants + code.
const CLASS_ADDR = 0x4000;
const METHOD_ADDR = 0x4100;
const SIG_ADDR = 0x4200;
const CODE_ADDR = 0x300000;

/**
 * Assemble a static-method call:
 *   FindClass(name) → GetStaticMethodID(clazz,method,sig) → CallStaticIntMethod(…)
 * x20 = clazz, x21 = jmethodID. Optionally pass one int arg in x3, and add 1 to
 * the result so a test can tell the impl's return apart from dispatch noise.
 */
function buildStaticCall(opts: { arg?: number; plusOne?: boolean } = {}): Uint8Array {
  const code: number[] = [];
  const emit = (...words: number[]): void => {
    for (const w of words) code.push(...le(w));
  };
  emit(movReg(0, 19), movz(1, CLASS_ADDR));
  code.push(...callJni(JNI_INDEX.FindClass));
  emit(movReg(20, 0)); // x20 = clazz
  emit(movReg(0, 19), movReg(1, 20), movz(2, METHOD_ADDR), movz(3, SIG_ADDR));
  code.push(...callJni(JNI_INDEX.GetStaticMethodID));
  emit(movReg(21, 0)); // x21 = jmethodID
  emit(movReg(0, 19), movReg(1, 20), movReg(2, 21));
  if (opts.arg !== undefined) emit(movz(3, opts.arg)); // x3 = first Java arg
  code.push(...callJni(JNI_INDEX.CallStaticIntMethod));
  if (opts.plusOne) emit(addi(0, 0, 1));
  return Uint8Array.from(code);
}

/** Map string constants + code, set entry registers, run to the end of the code. */
function run(
  engine: CpuEngine,
  jni: JniEnvironment,
  className: string,
  method: string,
  sig: string,
  code: Uint8Array,
): void {
  engine.mapMemory(CODE_ADDR, code.length + 16);
  engine.writeCode(CODE_ADDR, code);
  engine.mapMemory(CLASS_ADDR, 0x300);
  engine.writeCode(CLASS_ADDR, enc(className));
  engine.writeCode(METHOD_ADDR, enc(method));
  engine.writeCode(SIG_ADDR, enc(sig));
  engine.writeRegister('x19', jni.envPointer()); // callJni double-derefs x19
  engine.writeRegister('x0', jni.envPointer()); // first JNI arg = env
  engine.start(CODE_ADDR, CODE_ADDR + code.length);
}

describe('JNI reflection callback — L4.3', () => {
  it('calls a registered static Java method and uses its return value', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    jni.defineClass('Config');
    jni.registerJavaMethod('Config', 'getMagic', '()I', () => 41n);

    run(engine, jni, 'Config', 'getMagic', '()I', buildStaticCall({ plusOne: true }));

    expect(engine.readRegister('x0')).toBe(42); // 41 from Java + 1 in native
  });

  it('passes the receiver handle and Java arguments into the impl', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const clazz = jni.defineClass('Calc');
    let seenSelf = -1;
    let seenArg = -1n;
    jni.registerJavaMethod('Calc', 'twice', '(I)I', ({ args, self }) => {
      seenSelf = self;
      seenArg = args[0] ?? 0n;
      return (args[0] ?? 0n) * 2n;
    });

    run(engine, jni, 'Calc', 'twice', '(I)I', buildStaticCall({ arg: 21 }));

    expect(engine.readRegister('x0')).toBe(42); // impl returns 21 * 2
    expect(seenSelf).toBe(clazz); // static receiver is the jclass handle
    expect(seenArg).toBe(21n); // x3 reached the impl as args[0]
  });

  it('returns 0 for a jmethodID with no registered impl (benign null)', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    jni.defineClass('Unbound');

    run(engine, jni, 'Unbound', 'ghost', '()I', buildStaticCall());

    expect(engine.readRegister('x0')).toBe(0);
  });
});
