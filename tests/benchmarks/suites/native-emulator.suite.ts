/**
 * Native-emulator domain benchmark (ARM64 in-process CPU emulation subset).
 *
 * External reference:
 *  - ELF64 little-endian AArch64 shared object (EM_AARCH64 = 183, ET_DYN = 3)
 *  - ARMv8-A A64 encoding: `add x0, x0, x1` (0x8b010000) + `ret` (0xd65f03c0)
 * Homemade fixtures:
 *  - minimal `.so` compiled in memory with exported symbol `add_two(x0, x1) → x0 + x1`
 *  - per-case fresh SessionManager + dispose() guarantees 100% idempotency on re-execution
 */
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';
import { SessionManager } from '@modules/native-emulator/SessionManager';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const ET_DYN = 3;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

function buildMinimalArm64So(
  code: number[],
  symbols: Array<{ name: string; codeOffset: number }>,
  segVaddr = 0x1000,
): Uint8Array {
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

// AArch64: add x0, x0, x1; ret
const ADD_TWO_BYTES = [0x00, 0x00, 0x01, 0x8b, 0xc0, 0x03, 0x5f, 0xd6];
const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-nemu-'));
const soPath = join(tmp, 'libbenchadd.so');
writeFileSync(soPath, buildMinimalArm64So(ADD_TWO_BYTES, [{ name: 'add_two', codeOffset: 0 }]));
process.once('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

async function withSession<T>(
  fn: (handlers: NativeEmulatorHandlers, sessionId: string) => Promise<T>,
): Promise<T> {
  const handlers = new NativeEmulatorHandlers(
    new SessionManager({ emulatorOptions: { syscalls: false } }),
  );
  try {
    const created = body(await handlers.handleCreateSession({ installSyscalls: false }));
    const sessionId = String(created.sessionId ?? '');
    if (!sessionId) throw new Error('failed to create session');
    return await fn(handlers, sessionId);
  } finally {
    handlers.dispose();
  }
}

export const nativeEmulatorSuite: BenchSuite = {
  name: 'native-emulator',
  domain: 'native-emulator',
  description:
    'ARM64 in-process CPU emulation: session lifecycle, ELF load, symbol execution (add_two(40,2)=42), guest memory, JNI handles & mocks',
  cases: [
    {
      name: 'nemu_create_session/creates-isolated-session',
      tool: 'nemu_create_session',
      origin: 'homemade',
      reference: 'creates a fresh ARM64 emulator session and returns sessionId',
      run: async () => {
        const handlers = new NativeEmulatorHandlers(
          new SessionManager({ emulatorOptions: { syscalls: false } }),
        );
        try {
          return await handlers.handleCreateSession({ installSyscalls: false });
        } finally {
          handlers.dispose();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.sessionId !== 'string' || b.sessionId.length === 0)
          return `expected non-empty sessionId, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_destroy_session/tears-down-session',
      tool: 'nemu_destroy_session',
      origin: 'homemade',
      reference: 'destroys an active session and decrements activeSessions to 0',
      run: () => withSession((handlers, sessionId) => handlers.handleDestroySession({ sessionId })),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.destroyed !== true) return `expected destroyed=true, got ${b.destroyed}`;
        if (Number(b.activeSessions) !== 0)
          return `expected activeSessions=0, got ${b.activeSessions}`;
        return true;
      },
    },
    {
      name: 'nemu_list_sessions/enumerates-active-session',
      tool: 'nemu_list_sessions',
      origin: 'homemade',
      reference: 'lists active emulator sessions with count >= 1',
      run: () => withSession((handlers) => handlers.handleListSessions({})),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) !== 1) return `expected count === 1, got ${b.count}`;
        return true;
      },
    },
    {
      name: 'nemu_session_info/reports-loaded-symbols',
      tool: 'nemu_session_info',
      origin: 'homemade',
      reference: 'reports symbolCount and diagnostics for an emulator session',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath });
          return handlers.handleSessionInfo({ sessionId });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.symbolCount) !== 1) return `expected symbolCount === 1, got ${b.symbolCount}`;
        return true;
      },
    },
    {
      name: 'nemu_load_library/elf64-aarch64-dynsym',
      tool: 'nemu_load_library',
      origin: 'external-vector',
      reference: 'ELF64 AArch64 loader maps PT_LOAD segment and resolves SHT_DYNSYM add_two',
      run: () =>
        withSession((handlers, sessionId) => handlers.handleLoadLibrary({ sessionId, soPath })),
      validate: (v) => {
        const b = expectSuccess(v);
        const syms = (b.symbols as string[]) ?? [];
        if (!syms.includes('add_two'))
          return `expected add_two in loaded symbols, got ${JSON.stringify(syms)}`;
        return true;
      },
    },
    {
      name: 'nemu_list_symbols/enumerates-exports',
      tool: 'nemu_list_symbols',
      origin: 'homemade',
      reference: 'lists exported ELF symbols from loaded libraries',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath });
          return handlers.handleListSymbols({ sessionId });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const syms = (b.symbols as string[]) ?? [];
        if (!syms.includes('add_two'))
          return `expected add_two in symbol list, got ${JSON.stringify(syms)}`;
        return true;
      },
    },
    {
      name: 'nemu_call_symbol/arm64-add-two-42',
      tool: 'nemu_call_symbol',
      origin: 'external-vector',
      reference: 'ARMv8-A A64 `add x0, x0, x1; ret` executed on (40, 2) must return x0 = 42',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath });
          return handlers.handleCallSymbol({ sessionId, symbol: 'add_two', args: [40, 2] });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.result) !== 42) return `expected add_two(40, 2) === 42, got ${b.result}`;
        return true;
      },
    },
    {
      name: 'nemu_alloc_memory/guest-heap-allocation',
      tool: 'nemu_alloc_memory',
      origin: 'homemade',
      reference: 'allocates initialized guest memory buffer and returns non-zero address',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleAllocMemory({
            sessionId,
            size: 4,
            fillBytes: Buffer.from([0x41, 0x42, 0x43, 0x44]).toString('base64'),
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.address !== 'number' || b.address <= 0)
          return `expected positive address, got ${b.address}`;
        return true;
      },
    },
    {
      name: 'nemu_write_memory/patch-guest-bytes',
      tool: 'nemu_write_memory',
      origin: 'homemade',
      reference: 'writes base64 payload into allocated guest memory and reports bytesWritten',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 8 }));
          return handlers.handleWriteMemory({
            sessionId,
            address: alloc.address,
            dataBase64: Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'),
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.bytesWritten) !== 4)
          return `expected bytesWritten === 4, got ${b.bytesWritten}`;
        return true;
      },
    },
    {
      name: 'nemu_read_memory/roundtrip-guest-bytes',
      tool: 'nemu_read_memory',
      origin: 'homemade',
      reference: 'reads written guest bytes back identically via includeDataBase64',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const expected = Buffer.from([0x11, 0x22, 0x33, 0x44]).toString('base64');
          const alloc = body(
            await handlers.handleAllocMemory({ sessionId, size: 4, fillBytes: expected }),
          );
          return handlers.handleReadMemory({
            sessionId,
            address: alloc.address,
            length: 4,
            includeDataBase64: true,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const expected = Buffer.from([0x11, 0x22, 0x33, 0x44]).toString('base64');
        if (b.dataBase64 !== expected) return `expected ${expected}, got ${b.dataBase64}`;
        return true;
      },
    },
    {
      name: 'nemu_new_byte_array/jni-allocation',
      tool: 'nemu_new_byte_array',
      origin: 'homemade',
      reference: 'allocates JNI jbyteArray handle from base64 payload',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleNewByteArray({
            sessionId,
            dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.handle !== 'number' || b.handle <= 0)
          return `expected positive JNI handle, got ${b.handle}`;
        return true;
      },
    },
    {
      name: 'nemu_read_byte_array/jni-roundtrip',
      tool: 'nemu_read_byte_array',
      origin: 'homemade',
      reference: 'reads back exact byte array payload from JNI jbyteArray handle',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const dataBase64 = Buffer.from([5, 6, 7, 8]).toString('base64');
          const created = body(await handlers.handleNewByteArray({ sessionId, dataBase64 }));
          return handlers.handleReadByteArray({ sessionId, handle: created.handle });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const expected = Buffer.from([5, 6, 7, 8]).toString('base64');
        if (b.dataBase64 !== expected || Number(b.length) !== 4)
          return `expected ${expected} len=4, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_setup_java_mock/declarative-int-mock',
      tool: 'nemu_setup_java_mock',
      origin: 'homemade',
      reference: 'registers declarative Java method mock returning constant int',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleSetupJavaMock({
            sessionId,
            className: 'com/app/Config',
            methodName: 'getMagic',
            signature: '()I',
            returnInt: 42,
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.returns !== 'int') return `expected returns=int, got ${b.returns}`;
        return true;
      },
    },
    {
      name: 'nemu_create_jni_handle/string-object-handle',
      tool: 'nemu_create_jni_handle',
      origin: 'homemade',
      reference: 'creates typed JNI object handle in emulator JNI table',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleCreateJniHandle({
            sessionId,
            kind: 'string',
            value: 'bench-jni-string',
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.handle) return `missing handle in response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_jni_handles/enumerates-created-handles',
      tool: 'nemu_jni_handles',
      origin: 'homemade',
      reference: 'enumerates active JNI handles registered in session JNI table',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleCreateJniHandle({
            sessionId,
            kind: 'string',
            value: 'bench-jni-list',
          });
          return handlers.handleJniHandles({ sessionId });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const handles = b.handles as unknown[] | undefined;
        if (!Array.isArray(handles) || handles.length === 0)
          return `expected non-empty JNI handles list, got ${JSON.stringify(b)}`;
        return true;
      },
    },
  ],
};
