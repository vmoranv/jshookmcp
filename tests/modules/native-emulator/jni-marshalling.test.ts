/**
 * L4 TDD — Java_* calling convention + end-to-end string/byte-array marshalling.
 *
 * The flagship test hand-assembles a *real* JNI native method —
 *   jbyteArray Java_Crypto_transform(JNIEnv* env, jobject thiz, jbyteArray in)
 * — that XORs every input byte with 0x5A and returns a fresh array. It exercises
 * the full stack: AAPCS prologue/epilogue spilling callee-saved x19..x26, five
 * indirect JNI dispatches through the function table (GetArrayLength,
 * NewByteArray, GetByteArrayElements, SetByteArrayRegion), and a CBZ/B loop. The
 * jbyteArray crosses the JS↔guest boundary in both directions, which is exactly
 * what an app's signing/crypto routine does.
 *
 * Every instruction encoding here was cross-checked against an assembler.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { JniEnvironment, JNI_INDEX } from '@modules/native-emulator/jni';

// ── Minimal A64 encoders (only what these tests assemble) ──
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
const ldrb = (rt: number, rn: number, imm = 0): number =>
  (0x39400000 | ((imm & 0xfff) << 10) | (rn << 5) | rt) >>> 0;
const strb = (rt: number, rn: number, imm = 0): number =>
  (0x39000000 | ((imm & 0xfff) << 10) | (rn << 5) | rt) >>> 0;
const eor = (rd: number, rn: number, rm: number): number =>
  (0x4a000000 | (rm << 16) | (rn << 5) | rd) >>> 0;
const addi = (rd: number, rn: number, imm: number): number =>
  (0x91000000 | ((imm & 0xfff) << 10) | (rn << 5) | rd) >>> 0;
const subi = (rd: number, rn: number, imm: number): number =>
  (0xd1000000 | ((imm & 0xfff) << 10) | (rn << 5) | rd) >>> 0;
const cbz = (rt: number, off: number): number =>
  (0xb4000000 | (((off / 4) & 0x7ffff) << 5) | rt) >>> 0;
const bImm = (off: number): number => (0x14000000 | ((off / 4) & 0x03ffffff)) >>> 0;
const stpPre = (rt: number, rt2: number, rn: number, imm: number): number =>
  (0xa9800000 | (((imm / 8) & 0x7f) << 15) | (rt2 << 10) | (rn << 5) | rt) >>> 0;
const ldpPost = (rt: number, rt2: number, rn: number, imm: number): number =>
  (0xa8c00000 | (((imm / 8) & 0x7f) << 15) | (rt2 << 10) | (rn << 5) | rt) >>> 0;
const stpOff = (rt: number, rt2: number, rn: number, imm: number): number =>
  (0xa9000000 | (((imm / 8) & 0x7f) << 15) | (rt2 << 10) | (rn << 5) | rt) >>> 0;
const ldpOff = (rt: number, rt2: number, rn: number, imm: number): number =>
  (0xa9400000 | (((imm / 8) & 0x7f) << 15) | (rt2 << 10) | (rn << 5) | rt) >>> 0;
const ret = (): number => 0xd65f03c0;

const I = JNI_INDEX;

/** mov x0,x19 ; ldr x8,[x19] ; ldr x9,[x8,#idx*8] ; blr x9 — dispatch a JNI fn (x0 = env). */
function callJni(idx: number): number[] {
  return [...le(ldrOff(8, 19, 0)), ...le(ldrOff(9, 8, idx * 8)), ...le(blr(9))];
}

/** Assemble Java_Crypto_transform: XOR each input byte with `key`, return a new array. */
function assembleXorTransform(key: number): Uint8Array {
  const code: number[] = [];
  const emit = (...words: number[]): void => {
    for (const w of words) code.push(...le(w));
  };
  // prologue: save FP/LR and callee-saved x19..x26.
  emit(stpPre(29, 30, 31, -64));
  emit(stpOff(19, 20, 31, 16));
  emit(stpOff(21, 22, 31, 32));
  emit(stpOff(23, 24, 31, 48));
  emit(stpPre(25, 26, 31, -16));
  emit(movReg(19, 0)); // x19 = env
  emit(movReg(20, 2)); // x20 = input
  emit(movReg(0, 19), movReg(1, 20));
  code.push(...callJni(I.GetArrayLength));
  emit(movReg(21, 0)); // x21 = len
  emit(movReg(0, 19), movReg(1, 21));
  code.push(...callJni(I.NewByteArray));
  emit(movReg(22, 0)); // x22 = out array
  emit(movReg(0, 19), movReg(1, 20), movz(2, 0));
  code.push(...callJni(I.GetByteArrayElements));
  emit(movReg(23, 0)); // x23 = src buffer
  emit(movReg(24, 23)); // x24 = cursor
  emit(movReg(25, 21)); // x25 = remaining
  emit(movz(26, key)); // w26 = key
  const loopStart = code.length;
  const cbzPos = code.length;
  emit(0); // placeholder: cbz x25, done
  emit(ldrb(3, 24, 0));
  emit(eor(3, 3, 26));
  emit(strb(3, 24, 0));
  emit(addi(24, 24, 1));
  emit(subi(25, 25, 1));
  const bPos = code.length;
  emit(0); // placeholder: b loop
  const done = code.length;
  code.splice(cbzPos, 4, ...le(cbz(25, done - cbzPos)));
  code.splice(bPos, 4, ...le(bImm(loopStart - bPos)));
  // SetByteArrayRegion(env, out, 0, len, src)
  emit(movReg(0, 19), movReg(1, 22), movz(2, 0), movReg(3, 21), movReg(4, 23));
  code.push(...callJni(I.SetByteArrayRegion));
  emit(movReg(0, 22)); // return out
  // epilogue
  emit(ldpPost(25, 26, 31, 16));
  emit(ldpOff(19, 20, 31, 16));
  emit(ldpOff(21, 22, 31, 32));
  emit(ldpOff(23, 24, 31, 48));
  emit(ldpPost(29, 30, 31, 64));
  emit(ret());
  return Uint8Array.from(code);
}

describe('JNI Java_* calling convention + marshalling — L4', () => {
  it('runs a real XOR transform over a jbyteArray and returns a new array', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const code = assembleXorTransform(0x5a);
    const CODE = 0x300000;
    engine.mapMemory(CODE, code.length + 16);
    engine.writeCode(CODE, code);

    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const inputHandle = jni.allocHandle({ kind: 'bytes', value: input });

    // Provide a stack (this entry isn't via callSymbol).
    engine.mapMemory(0x7fff0000 - 0x10000, 0x10000);
    engine.writeRegister('sp', 0x7fff0000);
    engine.writeRegister('x0', jni.envPointer());
    engine.writeRegister('x1', 0); // thiz
    engine.writeRegister('x2', inputHandle);
    engine.writeRegister('x30', 0); // sentinel LR

    engine.start(CODE, 0);

    const outHandle = engine.readRegister('x0');
    const outValue = jni.valueOf(outHandle) as { kind: string; value: Uint8Array };
    expect(outValue.kind).toBe('bytes');
    expect(Array.from(outValue.value)).toEqual([1 ^ 0x5a, 2 ^ 0x5a, 3 ^ 0x5a, 4 ^ 0x5a, 5 ^ 0x5a]);
  });

  it('NewStringUTF/GetStringUTFChars round-trips a UTF-8 string through guest memory', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);

    // Host-side: create a jstring, then ask for its UTF chars and read them back.
    const strHandle = jni.allocHandle({ kind: 'string', value: 'sig=abc123' });
    // Drive GetStringUTFChars directly via a tiny stub call sequence:
    //   ldr x8,[x19] ; ldr x9,[x8,#GetStringUTFChars*8] ; blr x9   (x0=env, x1=jstring)
    const code = [
      ...le(ldrOff(8, 19, 0)),
      ...le(ldrOff(9, 8, JNI_INDEX.GetStringUTFChars * 8)),
      ...le(blr(9)),
    ];
    const CODE = 0x2000;
    engine.mapMemory(CODE, code.length + 4);
    engine.writeCode(CODE, Uint8Array.from(code));
    engine.writeRegister('x19', jni.envPointer());
    engine.writeRegister('x0', jni.envPointer());
    engine.writeRegister('x1', strHandle);
    engine.start(CODE, CODE + code.length);

    const charsPtr = engine.readRegister('x0');
    // Read the NUL-terminated UTF-8 back out of guest memory.
    const bytes: number[] = [];
    for (let p = charsPtr; ; p++) {
      const b = engine.readMemory(p, 1)[0]!;
      if (b === 0) break;
      bytes.push(b);
    }
    expect(new TextDecoder().decode(Uint8Array.from(bytes))).toBe('sig=abc123');
  });
});
