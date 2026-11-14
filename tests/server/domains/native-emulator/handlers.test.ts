/**
 * NativeEmulatorHandlers — MCP handler behaviour over the emulator session pool.
 *
 * Covers the happy path (create → load → call → JNI mock callback → byte
 * round-trip → trace → destroy), session-isolation, and the error paths
 * (unknown session, missing args, bad handle). A real assembler-verified .so is
 * written to a temp file because handlers read libraries by filesystem path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { SessionManager } from '@modules/native-emulator/SessionManager';
import { getGdbServer, getOrCreateGdbServer } from '@native/GdbRspServer';
import { NEMU_CALL_MAX_STEPS, NEMU_SESSION_SWEEP_MS } from '@src/constants';
import { decryptEnvelope, type EncryptedEnvelope } from '@utils/crypto/ephemeralCipher';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface SymbolSpec {
  name: string;
  codeOffset: number;
}

/** Assemble a .so with a code segment and named function exports. */
function buildSo(code: number[], symbols: SymbolSpec[], segVaddr = 0x1000): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const SHDR = 64;
  const SYM = 24;
  let dynstrStr = '\0';
  const nameOffsets = new Map<string, number>();
  for (const s of symbols) {
    nameOffsets.set(s.name, dynstrStr.length);
    dynstrStr += s.name + '\0';
  }
  const dynstr = Uint8Array.from([...dynstrStr].map((c) => c.charCodeAt(0)));
  const dynsym = new Uint8Array(SYM * (symbols.length + 1));
  {
    const dv = new DataView(dynsym.buffer);
    symbols.forEach((s, i) => {
      const base = SYM * (i + 1);
      dv.setUint32(base + 0x00, nameOffsets.get(s.name)!, true);
      dv.setUint8(base + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
      dv.setUint16(base + 0x06, 1, true);
      dv.setBigUint64(base + 0x08, BigInt(segVaddr + s.codeOffset), true);
    });
  }
  const segOffset = EHDR + PHDR;
  const dynstrOffset = segOffset + code.length;
  const dynsymOffset = dynstrOffset + dynstr.length;
  const shoff = dynsymOffset + dynsym.length;
  const shnum = 3;
  const buf = new ArrayBuffer(shoff + SHDR * shnum);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setBigUint64(0x18, BigInt(segVaddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, BigInt(shoff), true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, 1, true);
  dv.setUint16(0x3a, SHDR, true);
  dv.setUint16(0x3c, shnum, true);
  const p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b101, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(code.length), true);
  dv.setBigUint64(p + 0x28, BigInt(code.length), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);
  u8.set(code, segOffset);
  u8.set(dynstr, dynstrOffset);
  u8.set(dynsym, dynsymOffset);
  const writeShdr = (
    idx: number,
    shType: number,
    shOffset: number,
    shSize: number,
    shLink: number,
    shEntsize: number,
  ): void => {
    const s = shoff + idx * SHDR;
    dv.setUint32(s + 0x04, shType, true);
    dv.setBigUint64(s + 0x18, BigInt(shOffset), true);
    dv.setBigUint64(s + 0x20, BigInt(shSize), true);
    dv.setUint32(s + 0x28, shLink, true);
    dv.setBigUint64(s + 0x38, BigInt(shEntsize), true);
  };
  writeShdr(0, 0, 0, 0, 0, 0);
  writeShdr(1, SHT_DYNSYM, dynsymOffset, dynsym.length, 2, SYM);
  writeShdr(2, SHT_STRTAB, dynstrOffset, dynstr.length, 0, 0);
  return u8;
}

/** Parse the JSON payload out of an MCP text response. */
function payload(res: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

let tmpDir: string;
let soPath: string;
let nullCallSoPath: string;
let callerSoPath: string;
let loopSoPath: string;
let countJniSoPath: string;
// add_two: add x0, x0, x1 ; ret
const ADD_TWO = [0x00, 0x00, 0x01, 0x8b, 0xc0, 0x03, 0x5f, 0xd6];
// call_null: movz x8,#0 ; blr x8
const CALL_NULL = [0x08, 0x00, 0x80, 0xd2, 0x00, 0x01, 0x3f, 0xd6];
// caller (saves LR across the call; bl helper; restores; ret) + helper (add x0, x0, x1; ret)
// The LR save is required: the emulator halts when PC reaches the sentinel LR, so a
// caller that BLs must preserve x30 across the call like real prologues do.
const CALLER_HELPER = [
  0x00,
  0x00,
  0x01,
  0x8b, // helper +0x00: add x0, x0, x1
  0xc0,
  0x03,
  0x5f,
  0xd6, // helper +0x04: ret
  0xe9,
  0x03,
  0x1e,
  0xaa, // caller +0x08: mov x9, x30
  0xfd,
  0xff,
  0xff,
  0x97, // caller +0x0c: bl helper (0x97fffffd, offset -3)
  0xfe,
  0x03,
  0x09,
  0xaa, // caller +0x10: mov x30, x9
  0xc0,
  0x03,
  0x5f,
  0xd6, // caller +0x14: ret
];
// count_loop: subs x2, x2, #1 ; b.ne <subs> ; ret — runs 2N+1 instructions for x2=N
const COUNT_LOOP = [
  0x42,
  0x04,
  0x00,
  0xf1, // +0x00: subs x2, x2, #1
  0xe1,
  0xff,
  0xff,
  0x54, // +0x04: b.ne +0x00 (backward)
  0xc0,
  0x03,
  0x5f,
  0xd6, // +0x08: ret
];
// Java_com_app_count: movz x0,#0 ; add x0,x0,#1 ; subs x2,x2,#1 ; b.ne -2 ; ret
// 3 steps per iteration; with x2 = 1000000 it returns x0 = 1000000 if it runs to
// completion, and a tiny value if the step budget aborts it early.
const COUNT_RETURN_JNI = [
  0x00,
  0x00,
  0x80,
  0xd2, // +0x00: movz x0, #0
  0x00,
  0x04,
  0x00,
  0x91, // +0x04: add x0, x0, #1
  0x42,
  0x04,
  0x00,
  0xf1, // +0x08: subs x2, x2, #1
  0xc1,
  0xff,
  0xff,
  0x54, // +0x0c: b.ne -2 (back to add)
  0xc0,
  0x03,
  0x5f,
  0xd6, // +0x10: ret
];

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'nemu-handlers-'));
  soPath = join(tmpDir, 'libadd.so');
  nullCallSoPath = join(tmpDir, 'lib-null-call.so');
  callerSoPath = join(tmpDir, 'libcaller.so');
  loopSoPath = join(tmpDir, 'libloop.so');
  countJniSoPath = join(tmpDir, 'libcountjni.so');
  await writeFile(soPath, buildSo(ADD_TWO, [{ name: 'add_two', codeOffset: 0 }]));
  await writeFile(nullCallSoPath, buildSo(CALL_NULL, [{ name: 'call_null', codeOffset: 0 }]));
  await writeFile(
    callerSoPath,
    buildSo(CALLER_HELPER, [
      { name: 'helper', codeOffset: 0 },
      { name: 'caller', codeOffset: 8 },
    ]),
  );
  await writeFile(loopSoPath, buildSo(COUNT_LOOP, [{ name: 'count_loop', codeOffset: 0 }]));
  await writeFile(
    countJniSoPath,
    buildSo(COUNT_RETURN_JNI, [{ name: 'Java_com_app_count', codeOffset: 0 }]),
  );
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('NativeEmulatorHandlers — happy path', () => {
  let handlers: NativeEmulatorHandlers;

  afterEach(() => handlers.dispose());

  async function freshSession(): Promise<string> {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const created = payload(await handlers.handleCreateSession({ installSyscalls: false }));
    return created.sessionId as string;
  }

  it('reports capabilities without needing a session', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleCapabilities({}));
    expect(data.success).toBe(true);
    expect(data.backend).toBe('self-built-arm64');
    expect(data.available).toBe(true);
  });

  it('disassembles a single instruction without creating a session', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(
      await handlers.handleDisassemble({
        architecture: 'x64',
        opcode: '62 f1 74 48 58 c2',
        pc: '0x1000',
      }),
    );
    expect(data.success).toBe(true);
    expect(data.normalizedArchitecture).toBe('x64');
    expect(String(data.asm)).toContain('vaddps');
    expect(String(data.asm)).toContain('zmm');
  });

  it('advertises the post-Phase-F feature set and an honest ISA boundary', async () => {
    handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleCapabilities({}));
    const features = data.features as string[];
    // Phase 2-5 capabilities are surfaced for an AI to discover.
    expect(features).toContain('elf-relocations');
    expect(features).toContain('elf-import-inspection');
    // DT_INIT_ARRAY constructors run after relocation (a real .so with C++ static
    // constructors needs this to initialize its globals before its API is called).
    expect(features).toContain('init-array-constructors');
    expect(features).toContain('auto-wire-bionic-libc');
    // Bionic stdio VFS lets file-existence probes be evaluated.
    expect(features).toContain('bionic-stdio-vfs');
    expect(features).toContain('raw-guest-memory');
    // JNI object-array iteration (GetArrayLength on String[]) drives native loops.
    expect(features).toContain('jni-object-array-iteration');
    expect(features).toContain('java-mock-field');
    expect(features).toContain('exclusive-load-store');
    expect(features).toContain('system-register-read');
    // Memory barriers (DMB/DSB/ISB) are no-ops in the single-threaded interpreter.
    expect(features).toContain('memory-barriers');
    // Phase C/D crypto extension is implemented (bit-exact vs FIPS vectors).
    expect(features).toContain('aes-crypto');
    expect(features).toContain('sha256-crypto');
    expect(features).toContain('sha1-crypto');
    expect(features).toContain('pmull-ghash');
    // Phase E scalar IEEE-754 floating-point is implemented.
    expect(features).toContain('scalar-fp');
    // Phase F NEON integer-lane SIMD is implemented.
    expect(features).toContain('neon-integer-simd');
    // Contiguous LD1/ST1 of multiple registers (NEON kernels stream rows with these).
    expect(features).toContain('simd-ld1-st1-multi');
    // NULL indirect-call detection: a call through an uninitialised pointer throws
    // rather than masquerading as a clean return (the failure mode that hid STUR).
    expect(features).toContain('null-indirect-call-detection');
    expect(data.isa).toBe('aarch64-integer+neon+crypto+fp16');
    const simd = data.simd as { supported: string[]; unsupported: string[] };
    expect(simd.supported).toEqual(
      expect.arrayContaining([
        'contiguous-ld1-st1',
        'aes-sha-pmull',
        'scalar-fp',
        'ld2-ld3-ld4-deinterleaving',
        'long-widening-neon',
        'saturating-neon',
        'neon-ins-general',
        'neon-bit-bif',
        'neon-pmul-vector',
        'vector-fmov-immediate',
        'fp16',
      ]),
    );
    // E4 finale: all previously-declared gaps are now implemented + bit-exact
    // verified, so the unsupported list is empty.
    expect(simd.unsupported).toEqual([]);
    expect(String(data.note)).toMatch(/NEON/);
    expect(String(data.note)).toMatch(/saturating|widening/);
    // The NULL indirect-call guard is advertised in the note for AI/agent callers.
    expect(String(data.note)).toMatch(/NULL indirect call/i);
  });

  it('creates a session and lists it', async () => {
    const id = await freshSession();
    expect(typeof id).toBe('string');
    const list = payload(await handlers.handleListSessions({}));
    expect(list.count).toBe(1);
  });

  it('reports session info without executing native code', async () => {
    const sessionId = await freshSession();
    const beforeLoad = payload(await handlers.handleSessionInfo({ sessionId }));
    expect(beforeLoad.success).toBe(true);
    expect(beforeLoad.sessionId).toBe(sessionId);
    expect(beforeLoad.symbols).toEqual([]);
    expect(beforeLoad.symbolCount).toBe(0);
    expect(beforeLoad.diagnostics).toEqual({
      unresolvedImports: [],
      constructorFaults: [],
    });

    await handlers.handleLoadLibrary({ sessionId, soPath });
    const afterLoad = payload(await handlers.handleSessionInfo({ sessionId }));
    expect(afterLoad.symbols).toEqual(['add_two']);
    expect(afterLoad.symbolCount).toBe(1);
    expect(afterLoad.activeSessions).toBe(1);
    expect(typeof afterLoad.createdAt).toBe('number');
    expect(typeof afterLoad.lastUsedAt).toBe('number');
    expect(afterLoad.diagnostics).toEqual({
      unresolvedImports: [],
      constructorFaults: [],
    });
  });

  it('loads a .so by path and lists its symbols', async () => {
    const sessionId = await freshSession();
    const loaded = payload(await handlers.handleLoadLibrary({ sessionId, soPath }));
    expect(loaded.success).toBe(true);
    expect(loaded.symbols).toEqual(['add_two']);
    expect(loaded.unresolvedImports).toEqual([]);
    expect(loaded.constructorFaults).toEqual([]);
    const syms = payload(await handlers.handleListSymbols({ sessionId }));
    expect(syms.symbols).toEqual(['add_two']);
  });

  it('calls an exported symbol with integer args', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({ sessionId, symbol: 'add_two', args: [40, 2] }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
  });

  it('round-trips a jbyteArray through new/read byte array', async () => {
    const sessionId = await freshSession();
    const data = Buffer.from([1, 2, 3, 4]).toString('base64');
    const created = payload(await handlers.handleNewByteArray({ sessionId, dataBase64: data }));
    const handle = created.handle as number;
    const read = payload(await handlers.handleReadByteArray({ sessionId, handle }));
    expect(read.dataBase64).toBe(data);
    expect(read.length).toBe(4);
  });

  it('allocates, reads, and writes raw guest memory through MCP handlers', async () => {
    const sessionId = await freshSession();
    const initial = Buffer.from([0x41, 0x42, 0x43]).toString('base64');
    const allocated = payload(
      await handlers.handleAllocMemory({ sessionId, size: 3, fillBytes: initial }),
    );
    const address = allocated.address as number;
    expect(address).toBeGreaterThan(0);

    const firstRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(firstRead.dataBase64).toBe(initial);

    const patch = Buffer.from([0x78, 0x79]).toString('base64');
    const written = payload(
      await handlers.handleWriteMemory({ sessionId, address: address + 1, dataBase64: patch }),
    );
    expect(written.bytesWritten).toBe(2);

    const secondRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(secondRead.dataBase64).toBe(Buffer.from([0x41, 0x78, 0x79]).toString('base64'));
  });

  it('bounds raw guest memory allocation, reads, and writes', async () => {
    const sessionId = await freshSession();
    const tooLargeAlloc = payload(
      await handlers.handleAllocMemory({ sessionId, size: 8, maxBytes: 4 }),
    );
    expect(tooLargeAlloc.success).toBe(false);
    expect(tooLargeAlloc.error).toContain('exceeds');

    const allocated = payload(await handlers.handleAllocMemory({ sessionId, size: 4 }));
    const address = allocated.address as number;
    const tooLargeRead = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 4, maxBytes: 2 }),
    );
    expect(tooLargeRead.success).toBe(false);
    expect(tooLargeRead.error).toContain('exceeds');

    const tooLargeWrite = payload(
      await handlers.handleWriteMemory({
        sessionId,
        address,
        dataBase64: Buffer.from([1, 2, 3]).toString('base64'),
        maxBytes: 2,
      }),
    );
    expect(tooLargeWrite.success).toBe(false);
    expect(tooLargeWrite.error).toContain('exceeds');
  });

  it('omits full raw memory base64 unless explicitly requested', async () => {
    const sessionId = await freshSession();
    const allocated = payload(
      await handlers.handleAllocMemory({
        sessionId,
        size: 3,
        fillBytes: Buffer.from([0x41, 0x42, 0x43]).toString('base64'),
      }),
    );
    const address = allocated.address as number;

    const preview = payload(await handlers.handleReadMemory({ sessionId, address, length: 3 }));
    expect(preview.dataBase64).toBeUndefined();
    expect(preview.dataBase64Omitted).toBe(true);
    expect(preview.previewBase64).toBe(Buffer.from([0x41, 0x42, 0x43]).toString('base64'));

    const full = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, includeDataBase64: true }),
    );
    expect(full.dataBase64).toBe(Buffer.from([0x41, 0x42, 0x43]).toString('base64'));
  });

  it('registers a declarative Java mock (no code eval)', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaMock({
        sessionId,
        className: 'com/app/Config',
        methodName: 'getMagic',
        signature: '()I',
        returnInt: 42,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.returns).toBe('int');
  });

  it('rejects Java mocks with multiple return value kinds', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaMock({
        sessionId,
        className: 'com/app/Config',
        methodName: 'getMagic',
        signature: '()I',
        returnInt: 42,
        returnString: 'forty-two',
      }),
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('returnInt, returnString, and returnBytes');
  });

  it('registers a declarative Java field (int / string / bytes)', async () => {
    const sessionId = await freshSession();
    const asInt = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'magic',
        signature: 'I',
        valueInt: 1337,
      }),
    );
    expect(asInt.success).toBe(true);
    expect(asInt.kind).toBe('int');

    const asString = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'salt',
        signature: 'Ljava/lang/String;',
        valueString: 'pepper',
      }),
    );
    expect(asString.kind).toBe('string');

    const asBytes = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'key',
        signature: '[B',
        valueBytes: Buffer.from([1, 2, 3]).toString('base64'),
      }),
    );
    expect(asBytes.kind).toBe('bytes');
  });

  it('rejects Java fields with multiple value kinds', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleSetupJavaField({
        sessionId,
        className: 'com/app/Config',
        fieldName: 'magic',
        signature: 'I',
        valueInt: 1337,
        valueString: 'pepper',
      }),
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('valueInt, valueString, and valueBytes');
  });

  it('traces an exported symbol instruction-by-instruction', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleTrace({
        sessionId,
        symbol: 'add_two',
        args: [5, 6],
        captureRegisters: ['x0'],
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(11);
    expect(res.steps).toBeGreaterThan(0);
    expect(Array.isArray(res.trace)).toBe(true);
  });

  it('persists trace artifacts and limits inline trace rows when requested', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleTrace({
        sessionId,
        symbol: 'add_two',
        args: [5, 6],
        captureRegisters: ['x0'],
        persistArtifact: true,
        traceInlineLimit: 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(11);
    expect((res.trace as unknown[]).length).toBe(1);
    expect(res.traceInlineLimit).toBe(1);
    expect(res.traceArtifact).toEqual(
      expect.objectContaining({
        category: 'traces',
        eventCount: res.steps,
      }),
    );
    const artifact = res.traceArtifact as Record<string, unknown>;
    // Traces are a SENSITIVE_CATEGORIES entry: encrypted at rest (OPSEC
    // default), with the one-off key only available in this response.
    expect(artifact.encryption).toBe('aes-256-gcm');
    expect(artifact.encryptionKeyHex).toEqual(expect.any(String));
    const sealed = JSON.parse(await readFile(String(artifact.path), 'utf8')) as EncryptedEnvelope;
    const plaintext = decryptEnvelope(
      sealed,
      Buffer.from(String(artifact.encryptionKeyHex), 'hex'),
    ).toString('utf8');
    const artifactJson = JSON.parse(plaintext) as Record<string, unknown>;
    expect(artifactJson.symbol).toBe('add_two');
    expect(artifactJson.trace).toEqual(expect.any(Array));
  });

  it('destroying a session drops its GDB RSP server registration', async () => {
    handlers = new NativeEmulatorHandlers();
    const sessionId = payload(await handlers.handleCreateSession({})).sessionId as string;
    // Register without starting the TCP listener — stop() on a never-started
    // server is a no-op, so registry teardown can be asserted directly.
    getOrCreateGdbServer(sessionId, {
      host: '127.0.0.1',
      port: 0,
      sessionId,
      getSession: () => {
        throw new Error('unused in test');
      },
    });
    expect(getGdbServer(sessionId)).toBeDefined();
    const res = payload(await handlers.handleDestroySession({ sessionId }));
    expect(res.destroyed).toBe(true);
    // ReleaseNotifyingSessionManager routes destroy/sweep/dispose through the
    // handler cleanup, which stops the GDB server — no orphaned listener.
    expect(getGdbServer(sessionId)).toBeUndefined();
  });

  it('destroys a session', async () => {
    const sessionId = await freshSession();
    const res = payload(await handlers.handleDestroySession({ sessionId }));
    expect(res.destroyed).toBe(true);
    expect(res.activeSessions).toBe(0);
  });
});

describe('NativeEmulatorHandlers — isolation & errors', () => {
  let handlers: NativeEmulatorHandlers;
  afterEach(() => handlers.dispose());

  it('keeps two sessions isolated — a symbol loaded in one is unknown in the other', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const a = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    const b = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    await handlers.handleLoadLibrary({ sessionId: a, soPath });
    const symsA = payload(await handlers.handleListSymbols({ sessionId: a }));
    const symsB = payload(await handlers.handleListSymbols({ sessionId: b }));
    expect(symsA.symbols).toEqual(['add_two']);
    expect(symsB.symbols).toEqual([]); // b never loaded anything
  });

  it('returns a failure response for an unknown session', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleListSymbols({ sessionId: 'does-not-exist' }));
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('Unknown emulator session');
  });

  it('returns a failure response when sessionId is missing', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleLoadLibrary({}));
    expect(res.success).toBe(false);
  });

  it('returns a failure response for a non-byte-array handle', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const sessionId = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    const res = payload(await handlers.handleReadByteArray({ sessionId, handle: 0xdeadbeef }));
    expect(res.success).toBe(false);
  });

  it('auto-NOPs NULL indirect calls (BLR x0 → RET with result 0)', async () => {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const sessionId = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    await handlers.handleLoadLibrary({ sessionId, soPath: nullCallSoPath });

    const res = payload(await handlers.handleCallSymbol({ sessionId, symbol: 'call_null' }));
    expect(res.success).toBe(true);
    expect(res.symbol).toBe('call_null');
    // BLR through x8=0 is auto-patched to RET; x0=0 cleanly returned.
    expect(res.result).toBe(0);
    expect(res.diagnostics).toEqual(
      expect.objectContaining({
        unresolvedImports: [],
        constructorFaults: [],
      }),
    );
    // The auto-NOP patch is recorded for diagnostics.
    const diag = res.diagnostics as Record<string, unknown>;
    expect(diag.autoNopPatches).toBeInstanceOf(Array);
  });

  it('reports destroyed:false when destroying an unknown session', async () => {
    handlers = new NativeEmulatorHandlers();
    const res = payload(await handlers.handleDestroySession({ sessionId: 'ghost' }));
    expect(res.success).toBe(true);
    expect(res.destroyed).toBe(false);
  });

  it('stops the GDB RSP server and drops register snapshots on destroy', async () => {
    handlers = new NativeEmulatorHandlers();
    const a = payload(await handlers.handleCreateSession({}));
    const b = payload(await handlers.handleCreateSession({}));
    const sessionId = a.sessionId as string;

    const start = payload(await handlers.handleGdbserver({ action: 'start', sessionId, port: 0 }));
    expect(start.running).toBe(true);
    expect(getGdbServer(sessionId)).toBeDefined();

    await handlers.handleRegsSave({ sessionId, name: 'before' });

    const destroyed = payload(await handlers.handleDestroySession({ sessionId }));
    expect(destroyed.destroyed).toBe(true);
    expect(getGdbServer(sessionId)).toBeUndefined();

    // Snapshots must be gone too: restoring on a surviving session reports
    // "no snapshots" for the destroyed session instead of a stale hit.
    const restore = payload(
      await handlers.handleRegsRestore({
        sessionId: b.sessionId as string,
        snapshotId: `${sessionId}::before`,
      }),
    );
    expect(restore.success).toBe(false);
    expect(String(restore.error)).toContain('No snapshots found for session');
  });

  it('reaps the GDB server and register snapshots when the idle sweep drops a session', async () => {
    vi.useFakeTimers();
    handlers = new NativeEmulatorHandlers();
    try {
      const a = payload(await handlers.handleCreateSession({}));
      const b = payload(await handlers.handleCreateSession({}));
      const sessionId = a.sessionId as string;

      await handlers.handleRegsSave({ sessionId, name: 'before' });
      const start = payload(
        await handlers.handleGdbserver({ action: 'start', sessionId, port: 0 }),
      );
      expect(start.running).toBe(true);
      expect(getGdbServer(sessionId)).toBeDefined();

      // Advance past the idle TTL for session A while keeping B alive by
      // touching it mid-way (TTL = 5 × sweep interval).
      await vi.advanceTimersByTimeAsync(NEMU_SESSION_SWEEP_MS * 3);
      await handlers.handleSessionInfo({ sessionId: b.sessionId as string });
      await vi.advanceTimersByTimeAsync(NEMU_SESSION_SWEEP_MS * 2);

      expect(getGdbServer(sessionId)).toBeUndefined();
      const listed = payload(await handlers.handleListSessions({}));
      const ids = (listed.sessions as Array<{ id: string }>).map((s) => s.id);
      expect(ids).not.toContain(sessionId);
      expect(ids).toContain(b.sessionId);

      const restore = payload(
        await handlers.handleRegsRestore({
          sessionId: b.sessionId as string,
          snapshotId: `${sessionId}::before`,
        }),
      );
      expect(restore.success).toBe(false);
      expect(String(restore.error)).toContain('No snapshots found for session');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NativeEmulatorHandlers — nemu_trace profile mode', () => {
  let handlers: NativeEmulatorHandlers;
  afterEach(() => handlers.dispose());

  async function traceWith(
    so: string,
    symbol: string,
    args: number[],
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const sessionId = payload(await handlers.handleCreateSession({ installSyscalls: false }))
      .sessionId as string;
    await handlers.handleLoadLibrary({ sessionId, soPath: so });
    return payload(await handlers.handleTrace({ sessionId, symbol, args, ...extra }));
  }

  it('aggregates per-pc instruction frequency without per-step rows', async () => {
    const res = await traceWith(soPath, 'add_two', [5, 6], { mode: 'profile' });
    expect(res.success).toBe(true);
    expect(res.result).toBe(11);
    expect(res.trace).toBeUndefined();
    expect(res.totalInstructions).toBe(2);
    expect(res.uniqueInstructions).toBe(2);
    const hot = res.hotInstructions as Array<Record<string, unknown>>;
    expect(hot).toHaveLength(2);
    // Both instructions execute once: 50% each. Tie broken by pc (add first).
    expect(hot[0]).toMatchObject({ count: 1, percentage: 50 });
    expect(String(hot[0]!.asm)).toContain('add');
    expect(hot[1]).toMatchObject({ count: 1, percentage: 50 });
    expect(res.summary).toMatchObject({ totalInstructions: 2, uniqueInstructions: 2 });
    const summary = res.summary as { topHotPc: unknown; topHotAsm: unknown };
    expect(String(summary.topHotPc)).toBe('0x1000');
    expect(String(summary.topHotAsm)).toContain('add');
  });

  it('builds a call tree from BL targets with best-effort symbol names', async () => {
    const res = await traceWith(callerSoPath, 'caller', [3, 4], { mode: 'profile' });
    expect(res.success).toBe(true);
    expect(res.result).toBe(7);
    // mov x9,x30; bl; add; ret; mov x30,x9; ret = 6 instructions
    expect(res.totalInstructions).toBe(6);
    const callTree = res.callTree as Array<Record<string, unknown>>;
    expect(callTree).toHaveLength(1);
    expect(callTree[0]).toMatchObject({ count: 1, symbolName: 'caller' });
    const callees = callTree[0]!.callees as Array<Record<string, unknown>>;
    expect(callees).toHaveLength(1);
    expect(callees[0]).toMatchObject({ count: 1, symbolName: 'helper' });
    expect(callees[0]!.callees).toEqual([]);
  });

  it('computes exact 3-decimal percentages and honors topN', async () => {
    // x2=3 → 3×(subs,b.ne) + ret = 7 instructions
    const res = await traceWith(loopSoPath, 'count_loop', [0, 0, 3], { mode: 'profile', topN: 2 });
    expect(res.success).toBe(true);
    expect(res.totalInstructions).toBe(7);
    expect(res.uniqueInstructions).toBe(3);
    const hot = res.hotInstructions as Array<Record<string, unknown>>;
    expect(hot).toHaveLength(2);
    expect(hot[0]).toMatchObject({ count: 3, percentage: 42.857 });
    expect(String(hot[0]!.asm)).toContain('subs');
    expect(hot[1]).toMatchObject({ count: 3, percentage: 42.857 });
    expect(String(hot[1]!.asm)).toContain('b.ne');
    expect(res.summary).toMatchObject({ totalInstructions: 7, uniqueInstructions: 3 });
    expect(res.trace).toBeUndefined();
  });

  it('applies the profile instruction budget and reports truncation', async () => {
    // x2=9 → 19 instructions, but the 5-instruction budget stops the trace early
    const res = await traceWith(loopSoPath, 'count_loop', [0, 0, 9], {
      mode: 'profile',
      maxSteps: 5,
    });
    expect(res.success).toBe(true);
    expect(res.totalInstructions).toBe(5);
    expect(res.truncated).toBe(true);
    expect((res.hotInstructions as unknown[]).length).toBeGreaterThan(0);
  });
});

it('aligns NEMU_CALL_MAX_STEPS with the 1M engine runaway guard', () => {
  expect(NEMU_CALL_MAX_STEPS).toBe(1_000_000);
});

describe('NativeEmulatorHandlers — native-call step budget clamping', () => {
  let handlers: NativeEmulatorHandlers;
  afterEach(() => handlers.dispose());

  async function freshSession(): Promise<string> {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const created = payload(await handlers.handleCreateSession({ installSyscalls: false }));
    return created.sessionId as string;
  }

  it('clamps an oversized call_symbol maxSteps and marks the response', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({
        sessionId,
        symbol: 'add_two',
        args: [40, 2],
        maxSteps: NEMU_CALL_MAX_STEPS + 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
    expect(res.clamped).toBe(true);
  });

  it('leaves a call_symbol maxSteps under the cap unclamped', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({
        sessionId,
        symbol: 'add_two',
        args: [40, 2],
        maxSteps: 100,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
    expect(res.clamped).toBeUndefined();
  });

  it('clamps a call_symbol maxSteps of 0 to the server cap (no unlimited escape hatch)', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({
        sessionId,
        symbol: 'add_two',
        args: [40, 2],
        maxSteps: 0,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
    expect(res.clamped).toBe(true);
  });

  it('clamps a negative call_symbol maxSteps to the server cap (no unlimited escape hatch)', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallSymbol({
        sessionId,
        symbol: 'add_two',
        args: [40, 2],
        maxSteps: -1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
    expect(res.clamped).toBe(true);
  });

  it('clamps an oversized call_address maxSteps and marks the response', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallAddress({
        sessionId,
        address: 0x1000, // add_two entry (segVaddr)
        args: [40, 2],
        maxSteps: NEMU_CALL_MAX_STEPS + 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe(42);
    expect(res.clamped).toBe(true);
  });

  it('clamps an oversized call_jni_export maxSteps and marks the response', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath });
    const res = payload(
      await handlers.handleCallJniExport({
        sessionId,
        symbol: 'add_two',
        javaArgs: [40, 2],
        maxSteps: NEMU_CALL_MAX_STEPS + 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.clamped).toBe(true);
  });

  it('forwards a small call_jni_export maxSteps to the engine and aborts a counting loop', async () => {
    const sessionId = await freshSession();
    await handlers.handleLoadLibrary({ sessionId, soPath: countJniSoPath });
    // Pre-fix callJniExport ignored maxSteps entirely: the 1M-iteration loop
    // would run to completion and return x0 = 1000000. With maxSteps=10 the
    // engine must abort it early, leaving x0 far below that.
    const res = payload(
      await handlers.handleCallJniExport({
        sessionId,
        symbol: 'Java_com_app_count',
        javaArgs: [1000000],
        maxSteps: 10,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBeLessThan(1000);
    expect(res.clamped).toBeUndefined();
  });
});

describe('NativeEmulatorHandlers — nemu_read_memory / nemu_write_memory arg validation', () => {
  let handlers: NativeEmulatorHandlers;

  afterEach(() => handlers.dispose());

  async function freshSession(): Promise<string> {
    handlers = new NativeEmulatorHandlers(
      new SessionManager({ emulatorOptions: { syscalls: false } }),
    );
    const created = payload(await handlers.handleCreateSession({ installSyscalls: false }));
    return created.sessionId as string;
  }

  async function allocBytes(sessionId: string, bytes: number[]): Promise<number> {
    const allocated = payload(
      await handlers.handleAllocMemory({
        sessionId,
        size: bytes.length,
        fillBytes: Buffer.from(bytes).toString('base64'),
      }),
    );
    expect(allocated.success).not.toBe(false);
    return allocated.address as number;
  }

  it('rejects reads without an address', async () => {
    const sessionId = await freshSession();
    const res = payload(await handlers.handleReadMemory({ sessionId, length: 4 }));
    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing or invalid "address" or "length"');
  });

  it('rejects reads without a length', async () => {
    const sessionId = await freshSession();
    const res = payload(await handlers.handleReadMemory({ sessionId, address: 0x1000 }));
    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing or invalid "address" or "length"');
  });

  it('rejects reads with a zero or negative length', async () => {
    const sessionId = await freshSession();
    for (const length of [0, -8]) {
      const res = payload(await handlers.handleReadMemory({ sessionId, address: 0x1000, length }));
      expect(res.success).toBe(false);
      expect(res.error).toContain('Missing or invalid "address" or "length"');
    }
  });

  it('clamps previewBytes above the read length to the full data', async () => {
    const sessionId = await freshSession();
    const address = await allocBytes(sessionId, [0xde, 0xad, 0xbe]);
    const res = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 3, previewBytes: 100 }),
    );
    expect(res.previewBase64).toBe(Buffer.from([0xde, 0xad, 0xbe]).toString('base64'));
  });

  it('clamps a negative previewBytes to an empty preview', async () => {
    const sessionId = await freshSession();
    const address = await allocBytes(sessionId, [0xef, 0xfe]);
    const res = payload(
      await handlers.handleReadMemory({ sessionId, address, length: 2, previewBytes: -4 }),
    );
    expect(res.previewBase64).toBe('');
  });

  it('rejects writes without an address', async () => {
    const sessionId = await freshSession();
    const res = payload(
      await handlers.handleWriteMemory({
        sessionId,
        dataBase64: Buffer.from([1]).toString('base64'),
      }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing required number argument: "address"');
  });

  it('rejects writes without dataBase64', async () => {
    const sessionId = await freshSession();
    const res = payload(await handlers.handleWriteMemory({ sessionId, address: 0x1000 }));
    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing required string argument: "dataBase64"');
  });
});
