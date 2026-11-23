/**
 * Android SOTA 3-Phase Engine Test Suite.
 *
 * Phase 1: ARM64 trace recording + taint propagation.
 * Phase 2: Symbolic CFG reconstruction / opaque-branch elimination.
 * Phase 3: JNI hardware snapshot replay through the REAL JNI dispatch path —
 *          caller supplies all device state; no pre-baked fingerprints.
 */
import { describe, expect, it } from 'vitest';

import { Arm64TraceRecorder } from '@modules/native-emulator/Arm64TraceRecorder';
import { NativeSymbolicDeobfuscator } from '@modules/native-emulator/NativeSymbolicDeobfuscator';
import {
  JniHardwareBridge,
  type DeviceHardwareSnapshot,
} from '@modules/native-emulator/JniHardwareBridge';
import { NativeEmulator } from '@modules/native-emulator/NativeEmulator';
import { JNI_INDEX } from '@modules/native-emulator/jni';

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

const callJni = (idx: number): number[] => [
  ...le(ldrOff(8, 19, 0)),
  ...le(ldrOff(9, 8, idx * 8)),
  ...le(blr(9)),
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

describe('Android SOTA 3-Phase Engine Test Suite', () => {
  it('Phase 1: Arm64TraceRecorder tracks steps and taint propagation accurately', () => {
    const recorder = new Arm64TraceRecorder();
    recorder.startRecording();

    recorder.setRegisterTaint(0, true);
    expect(recorder.isRegisterTainted(0)).toBe(true);
    expect(recorder.isRegisterTainted(1)).toBe(false);

    recorder.setMemoryTaint(0x1004, true);
    expect(recorder.isMemoryTainted(0x1000)).toBe(true); // aligned to 8-byte

    // Addresses above 0x7fffffff must align without 32-bit wrapping.
    recorder.setMemoryTaint(0x1_0000_0008, true);
    expect(recorder.isMemoryTainted(0x1_0000_0008)).toBe(true);
    expect(recorder.isMemoryTainted(0x8)).toBe(false);

    recorder.recordStep({
      step: 1,
      pc: 0x1000,
      insn: 0x8b010000, // add x0, x0, x1
      regDiffs: [{ reg: 0, name: 'x0', before: 5n, after: 10n }],
      memAccesses: [],
      isBranch: false,
    });

    recorder.recordStep({
      step: 2,
      pc: 0x1004,
      insn: 0x14000004, // b +16
      regDiffs: [],
      memAccesses: [],
      isBranch: true,
      targetPc: 0x1014,
    });

    const trace = recorder.stopRecording();
    expect(trace).toHaveLength(2);
    expect(trace[0]!.regDiffs[0]!.after).toBe(10n);
    expect(trace[1]!.isBranch).toBe(true);

    recorder.clearTaints();
    expect(recorder.isRegisterTainted(0)).toBe(false);
    expect(recorder.isMemoryTainted(0x1000)).toBe(false);
  });

  it('Phase 2: NativeSymbolicDeobfuscator reconstructs basic blocks and eliminates invariant branches', async () => {
    const recorder = new Arm64TraceRecorder();
    recorder.startRecording();
    recorder.recordStep({
      step: 1,
      pc: 0x2000,
      insn: 0xd2800000,
      regDiffs: [],
      memAccesses: [],
      isBranch: false,
    });
    recorder.recordStep({
      step: 2,
      pc: 0x2004,
      insn: 0x54000040, // b.eq
      regDiffs: [],
      memAccesses: [],
      isBranch: true,
      targetPc: 0x200c,
    });

    const trace = recorder.stopRecording();
    const result = await NativeSymbolicDeobfuscator.simplifyFlattenedCfg(trace);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.startPc).toBe(0x2000);
    expect(result.blocks[0]!.endPc).toBe(0x2004);
    expect(result.blocks[0]!.isOpaqueBranch).toBe(true);
    expect(result.eliminatedOpaqueBranches).toBe(1);

    const empty = await NativeSymbolicDeobfuscator.simplifyFlattenedCfg([]);
    expect(empty.blocks).toHaveLength(0);
    expect(empty.eliminatedOpaqueBranches).toBe(0);
  });

  it('Phase 2: Z3 bidirectional SAT classifies opaque predicates correctly', async () => {
    // x == 1 && x == 2 is UNSAT ⇒ always_false.
    const unsat = await NativeSymbolicDeobfuscator.evaluateOpaquePredicate({
      op: 'and',
      left: {
        op: 'eq',
        left: { kind: 'symbol', name: 'x', width: 64 },
        right: { kind: 'const', value: 1n, width: 64 },
      },
      right: {
        op: 'eq',
        left: { kind: 'symbol', name: 'x', width: 64 },
        right: { kind: 'const', value: 2n, width: 64 },
      },
    });
    expect(unsat).toBe('always_false');

    // x == x is SAT but ¬(x == x) is UNSAT ⇒ always_true.
    const tautology = await NativeSymbolicDeobfuscator.evaluateOpaquePredicate({
      op: 'eq',
      left: { kind: 'symbol', name: 'y', width: 64 },
      right: { kind: 'symbol', name: 'y', width: 64 },
    });
    expect(['always_true', 'solver_unavailable']).toContain(tautology);

    // x > 0 is genuinely dynamic (both SAT).
    const dynamic = await NativeSymbolicDeobfuscator.evaluateOpaquePredicate({
      op: 'ugt',
      left: { kind: 'symbol', name: 'z', width: 64 },
      right: { kind: 'const', value: 0n, width: 64 },
    });
    expect(['dynamic', 'solver_unavailable']).toContain(dynamic);
  });

  it('Phase 3: JniHardwareBridge replays a caller-supplied snapshot through the real JNI dispatch path', () => {
    const emulator = new NativeEmulator({ syscalls: false });
    const engine = emulator.engine;
    const jni = emulator.jni;

    // Caller owns the snapshot — values invented by the test, not pre-baked.
    const snapshot: DeviceHardwareSnapshot = {
      deviceIdentifiers: { android_id: 'test-device-id-001' },
      systemProperties: { 'ro.test.property': '42' },
      timestamp: 0,
    };
    JniHardwareBridge.applyHardwareSnapshot(emulator, snapshot);

    // Assemble: FindClass("android/os/SystemProperties") → GetStaticMethodID("get")
    // → NewStringUTF("ro.test.property") → CallStaticObjectMethod(env, clazz, mid, key)
    // → GetStringUTFChars(result) → pointer in x0.
    const CLASS_ADDR = 0x4000;
    const METHOD_ADDR = 0x4100;
    const SIG_ADDR = 0x4200;
    const KEY_ADDR = 0x4300;
    const CODE_ADDR = 0x300000;

    const className = 'android/os/SystemProperties';
    const methodName = 'get';
    const sig = '(Ljava/lang/String;)Ljava/lang/String;';
    const propKey = 'ro.test.property';

    engine.mapMemory(CLASS_ADDR, 0x500);
    engine.writeCode(CLASS_ADDR, enc(className));
    engine.writeCode(METHOD_ADDR, enc(methodName));
    engine.writeCode(SIG_ADDR, enc(sig));
    engine.writeCode(KEY_ADDR, enc(propKey));

    const code: number[] = [];
    const emit = (...words: number[]): void => {
      for (const w of words) code.push(...le(w));
    };
    // FindClass
    emit(movReg(0, 19), movz(1, CLASS_ADDR));
    code.push(...callJni(JNI_INDEX.FindClass));
    emit(movReg(20, 0)); // x20 = clazz
    // GetStaticMethodID
    emit(movReg(0, 19), movReg(1, 20), movz(2, METHOD_ADDR), movz(3, SIG_ADDR));
    code.push(...callJni(JNI_INDEX.GetStaticMethodID));
    emit(movReg(21, 0)); // x21 = jmethodID
    // NewStringUTF(propKey)
    emit(movReg(0, 19), movz(1, KEY_ADDR));
    code.push(...callJni(JNI_INDEX.NewStringUTF));
    emit(movReg(22, 0)); // x22 = jstring key
    // CallStaticObjectMethod(env, clazz, mid, key)
    emit(movReg(0, 19), movReg(1, 20), movReg(2, 21), movReg(3, 22));
    code.push(...callJni(JNI_INDEX.CallStaticObjectMethod));
    // GetStringUTFChars(result, NULL)
    emit(movReg(1, 0), movz(2, 0));
    code.push(...callJni(JNI_INDEX.GetStringUTFChars));

    const bytes = Uint8Array.from(code);
    engine.mapMemory(CODE_ADDR, bytes.length + 16);
    engine.writeCode(CODE_ADDR, bytes);
    engine.writeRegister('x19', jni.envPointer());
    engine.writeRegister('x0', jni.envPointer());
    engine.start(CODE_ADDR, CODE_ADDR + bytes.length);

    // Read the returned guest C-string — must equal the snapshot value.
    // The string buffer is allocated per-call; read byte-wise until NUL.
    const resultAddr = engine.readRegister('x0');
    let result = '';
    for (let i = 0; i < 16; i++) {
      const b = engine.readMemory(resultAddr + i, 1)[0]!;
      if (b === 0) break;
      result += String.fromCharCode(b);
    }
    expect(result).toBe('42');
  });
});
