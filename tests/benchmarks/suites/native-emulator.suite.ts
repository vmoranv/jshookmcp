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
// AArch64 JNI export: add x0, x2, x3; ret (skips JNIEnv* x0 and jobject x1)
const JNI_ADD_BYTES = [0x40, 0x00, 0x03, 0x8b, 0xc0, 0x03, 0x5f, 0xd6];
const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-nemu-'));
const soPath = join(tmp, 'libbenchadd.so');
const jniSoPath = join(tmp, 'libbenchjni.so');
const planPath = join(tmp, 'session-plan.json');
writeFileSync(soPath, buildMinimalArm64So(ADD_TWO_BYTES, [{ name: 'add_two', codeOffset: 0 }]));
writeFileSync(
  jniSoPath,
  buildMinimalArm64So(JNI_ADD_BYTES, [{ name: 'Java_bench_add', codeOffset: 0 }]),
);
writeFileSync(planPath, JSON.stringify([{ tool: 'nemu_prepare_tls', args: {} }]));
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

    // ── Coverage batch Wave 2 (autoresearch): execution, memory, registers, vtables, VM state ──
    {
      name: 'nemu_call_address/arm64-address-call',
      tool: 'nemu_call_address',
      origin: 'external-vector',
      reference: 'calls loaded add_two symbol directly by its guest virtual address (0x1000)',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath });
          return handlers.handleCallAddress({ sessionId, address: 0x1000, args: [35, 7] });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.result) !== 42) return `expected result 42, got ${b.result}`;
        return true;
      },
    },
    {
      name: 'nemu_mem_map/maps-region',
      tool: 'nemu_mem_map',
      origin: 'homemade',
      reference: 'maps an explicit guest memory region by base address and size',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleMemMap({ sessionId, address: 0x50000000, size: 4096 }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.size) !== 4096) return `expected size 4096, got ${b.size}`;
        return true;
      },
    },
    {
      name: 'nemu_scan_memory/finds-byte-pattern',
      tool: 'nemu_scan_memory',
      origin: 'homemade',
      reference: 'scans guest memory range and locates planted 4-byte pattern (CAFEBABE)',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const pattern = Buffer.from([0xca, 0xfe, 0xba, 0xbe]).toString('base64');
          const alloc = body(
            await handlers.handleAllocMemory({ sessionId, size: 32, fillBytes: pattern }),
          );
          const start = Number(alloc.address);
          return handlers.handleScanMemory({
            sessionId,
            pattern,
            startAddr: start,
            endAddr: start + 32,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) < 1 || !Array.isArray(b.matches))
          return `expected at least 1 match, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_xor_region/in-place-xor-decode',
      tool: 'nemu_xor_region',
      origin: 'homemade',
      reference: 'XORs memory region with byte key in-place and returns modified dataBase64',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const init = Buffer.from([0x41, 0x41, 0x41, 0x41]).toString('base64');
          const alloc = body(
            await handlers.handleAllocMemory({ sessionId, size: 4, fillBytes: init }),
          );
          return handlers.handleXorRegion({
            sessionId,
            address: alloc.address,
            key: 1,
            length: 4,
            dryRun: false,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const expected = Buffer.from([0x40, 0x40, 0x40, 0x40]).toString('base64');
        if (b.dataBase64 !== expected)
          return `expected XORed result ${expected}, got ${b.dataBase64}`;
        return true;
      },
    },
    {
      name: 'nemu_patch_apply/batch-write-patches',
      tool: 'nemu_patch_apply',
      origin: 'homemade',
      reference: 'applies multiple memory patches to guest memory in one batch call',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 16 }));
          return handlers.handlePatchApply({
            sessionId,
            patches: [
              {
                address: Number(alloc.address),
                dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
              },
            ],
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.patchesApplied) !== 1 || Number(b.totalBytes) !== 4)
          return `expected 1 patch applied, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_data_dump/u64-words-dump',
      tool: 'nemu_data_dump',
      origin: 'homemade',
      reference: 'dumps guest memory as typed u64 words with semantic classification tags',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 16 }));
          return handlers.handleDataDump({
            sessionId,
            address: Number(alloc.address),
            count: 2,
            wordSize: 'u64',
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) !== 2 || !Array.isArray(b.rows))
          return `expected 2 rows dumped, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_dump_frame/litevm-frame-decoding',
      tool: 'nemu_dump_frame',
      origin: 'homemade',
      reference: 'decodes LiteVM frame structure from guest memory address',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 256 }));
          return handlers.handleDumpFrame({ sessionId, address: Number(alloc.address) });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.fields || typeof b.fields !== 'object')
          return `missing fields in frame dump: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_pointer_chain/walks-two-hops',
      tool: 'nemu_pointer_chain',
      origin: 'homemade',
      reference: 'walks pointer chain in guest memory until NULL terminator',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc1 = body(await handlers.handleAllocMemory({ sessionId, size: 8 }));
          const alloc2 = body(await handlers.handleAllocMemory({ sessionId, size: 8 }));
          // Write alloc2 address into alloc1
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64LE(BigInt(Number(alloc2.address)), 0);
          await handlers.handleWriteMemory({
            sessionId,
            address: Number(alloc1.address),
            dataBase64: buf.toString('base64'),
          });
          return handlers.handlePointerChain({
            sessionId,
            base: Number(alloc1.address),
            maxDepth: 2,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.hops) || b.hops.length < 2)
          return `expected >= 2 hops, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_mem_inspect/routes-read-subcommand',
      tool: 'nemu_mem_inspect',
      origin: 'homemade',
      reference: 'dispatches unified read action through the nemu_mem_inspect facade',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const expected = Buffer.from([0xaa, 0xbb]).toString('base64');
          const alloc = body(
            await handlers.handleAllocMemory({ sessionId, size: 4, fillBytes: expected }),
          );
          return handlers.handleMemInspect({
            sessionId,
            action: 'read',
            address: Number(alloc.address),
            length: 2,
            includeDataBase64: true,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const expected = Buffer.from([0xaa, 0xbb]).toString('base64');
        if (b.dataBase64 !== expected) return `expected ${expected}, got ${b.dataBase64}`;
        return true;
      },
    },
    {
      name: 'nemu_bytecode_scan/scans-instruction-words',
      tool: 'nemu_bytecode_scan',
      origin: 'homemade',
      reference: 'scans guest memory for instruction words in summary format',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 16 }));
          return handlers.handleBytecodeScan({
            sessionId,
            address: Number(alloc.address),
            count: 4,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.totalWords) !== 4) return `expected totalWords === 4, got ${b.totalWords}`;
        return true;
      },
    },
    {
      name: 'nemu_set_registers/writes-gprs',
      tool: 'nemu_set_registers',
      origin: 'homemade',
      reference: 'directly sets guest GPR values x0 and x1',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleSetRegisters({
            sessionId,
            registers: { '0': 100, '1': 200 },
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) !== 2) return `expected count === 2, got ${b.count}`;
        return true;
      },
    },
    {
      name: 'nemu_regs_save/captures-gpr-snapshot',
      tool: 'nemu_regs_save',
      origin: 'homemade',
      reference: 'snapshots current GPR values and returns snapshotId',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleRegsSave({ sessionId, name: 'bench_snap' }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.snapshotId !== 'string' || Number(b.regCount) < 31)
          return `expected snapshotId and >=31 regs, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_regs_restore/restores-saved-snapshot',
      tool: 'nemu_regs_restore',
      origin: 'homemade',
      reference: 'restores CPU registers from a previously saved snapshot',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const snap = body(await handlers.handleRegsSave({ sessionId, name: 'snap_restore' }));
          return handlers.handleRegsRestore({ sessionId, snapshotId: String(snap.snapshotId) });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) < 31) return `expected >=31 restored regs, got ${b.count}`;
        return true;
      },
    },
    {
      name: 'nemu_create_vtable/allocates-vtable-object',
      tool: 'nemu_create_vtable',
      origin: 'homemade',
      reference: 'allocates a C++ vtable-backed object in guest memory with default return stub',
      run: () => withSession((handlers, sessionId) => handlers.handleCreateVtable({ sessionId })),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.objectAddr || !b.vtableAddr)
          return `missing objectAddr or vtableAddr: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_set_vtable_slot/binds-custom-stub',
      tool: 'nemu_set_vtable_slot',
      origin: 'homemade',
      reference: 'binds custom host JS stub into specified vtable slot index',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const vt = body(await handlers.handleCreateVtable({ sessionId }));
          const vtableAddr = parseInt(String(vt.vtableAddr), 16);
          return handlers.handleSetVtableSlot({
            sessionId,
            vtableAddr,
            slotIndex: 0,
            fn: 'return 99n;',
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.bound !== true) return `expected bound === true, got ${b.bound}`;
        return true;
      },
    },
    {
      name: 'nemu_vm_state_dump/dumps-ctx-and-table',
      tool: 'nemu_vm_state_dump',
      origin: 'homemade',
      reference: 'reads LiteVM ctx and table u64 arrays from allocated guest memory',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 128 }));
          const base = Number(alloc.address);
          return handlers.handleVmStateDump({
            sessionId,
            ctxBase: base,
            tableBase: base + 64,
            ctxCount: 4,
            tableCount: 4,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.ctx) || !Array.isArray(b.table))
          return `expected ctx and table arrays, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_vm_state_compare/diffs-expected-state',
      tool: 'nemu_vm_state_compare',
      origin: 'homemade',
      reference:
        'compares native VM memory state against expected Python arrays and reports matches',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 128 }));
          const base = Number(alloc.address);
          const zeroArray = Array(4).fill('0x0000000000000000');
          return handlers.handleVmStateCompare({
            sessionId,
            ctxBase: base,
            tableBase: base + 64,
            expectedCtx: zeroArray,
            expectedTable: zeroArray,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.ctxMatch !== true || b.tableMatch !== true)
          return `expected ctx and table to match zeros, got ctxMatch=${b.ctxMatch} tableMatch=${b.tableMatch}`;
        return true;
      },
    },
    {
      name: 'nemu_set_pac_key/updates-qarma-key',
      tool: 'nemu_set_pac_key',
      origin: 'homemade',
      reference: 'updates 128-bit QARMA pointer authentication key for slot ia',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleSetPacKey({
            sessionId,
            slot: 'ia',
            key: '0123456789abcdef0123456789abcdef',
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.slot !== 'ia') return `expected slot ia, got ${b.slot}`;
        return true;
      },
    },

    // ── Coverage batch Wave 3 (autoresearch): ELF imports/GOT, JNI/Java, TLS, host stubs, trace, relay/gdb ──
    {
      name: 'nemu_inspect_imports/parses-elf-imports',
      tool: 'nemu_inspect_imports',
      origin: 'homemade',
      reference: 'parses ELF64 .so import table cleanly via pure-TS ELF reader',
      run: () => {
        const h = new NativeEmulatorHandlers(
          new SessionManager({ emulatorOptions: { syscalls: false } }),
        );
        return h.handleInspectImports({ soPath }).finally(() => h.dispose());
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.soPath !== 'string' || !b.soPath.includes('libbenchadd.so'))
          return `missing soPath in import inspection: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_dump_got/scans-plt-clusters',
      tool: 'nemu_dump_got',
      origin: 'homemade',
      reference: 'scans ELF64 .so PLT/GOT clusters via pure-TS disassembler',
      run: () => {
        const h = new NativeEmulatorHandlers(
          new SessionManager({ emulatorOptions: { syscalls: false } }),
        );
        return h.handleDumpGot({ soPath }).finally(() => h.dispose());
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.clusters))
          return `expected clusters array in GOT dump: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_prepare_tls/maps-tpidr-el0',
      tool: 'nemu_prepare_tls',
      origin: 'homemade',
      reference: 'maps TLS segment and configures TPIDR_EL0 base address',
      run: () => withSession((handlers, sessionId) => handlers.handlePrepareTls({ sessionId })),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.tlsBase !== 'string' || Number(b.tlsSize) !== 0x2000)
          return `expected tlsBase and tlsSize=0x2000, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_mem_shadow/adds-overlay',
      tool: 'nemu_mem_shadow',
      origin: 'homemade',
      reference: 'adds shadow memory overlay at guest address',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleMemShadow({
            sessionId,
            address: 0x1000,
            dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.shadowed !== true || Number(b.size) !== 4)
          return `expected shadowed=true size=4, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_bind_host_fn/registers-stub',
      tool: 'nemu_bind_host_fn',
      origin: 'homemade',
      reference: 'registers custom JS host stub function at guest stub address',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleBindHostFn({
            sessionId,
            address: 0x68003000,
            fn: 'return 77n;',
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.bound !== true) return `expected bound=true, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_bind_all_imports/scans-got-range',
      tool: 'nemu_bind_all_imports',
      origin: 'homemade',
      reference: 'scans GOT address range for 0x68000000+ import stubs and binds JS wrapper',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const stubBuf = Buffer.alloc(8);
          stubBuf.writeBigUInt64LE(0x68004000n, 0);
          const alloc = body(
            await handlers.handleAllocMemory({
              sessionId,
              size: 8,
              fillBytes: stubBuf.toString('base64'),
            }),
          );
          const gotStart = Number(alloc.address);
          return handlers.handleBindAllImports({
            sessionId,
            fn: 'return 0n;',
            gotStart,
            gotEnd: gotStart + 8,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.totalUniqueStubs) !== 1 || Number(b.count) !== 1)
          return `expected 1 bound import stub, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_call_jni_export/jni-add-two-42',
      tool: 'nemu_call_jni_export',
      origin: 'external-vector',
      reference:
        'calls JNI export Java_bench_add(JNIEnv*, jobject, 40, 2) with auto-injected env/thiz → 42',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath: jniSoPath });
          return handlers.handleCallJniExport({
            sessionId,
            symbol: 'Java_bench_add',
            javaArgs: [40, 2],
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.result) !== 42) return `expected JNI result 42, got ${b.result}`;
        return true;
      },
    },
    {
      name: 'nemu_setup_java_mocks/batch-registration',
      tool: 'nemu_setup_java_mocks',
      origin: 'homemade',
      reference: 'batch-registers multiple declarative Java method mocks in one call',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleSetupJavaMocks({
            sessionId,
            mocks: [
              { className: 'com/app/A', methodName: 'm1', signature: '()I', returnInt: 1 },
              { className: 'com/app/B', methodName: 'm2', signature: '()Z', returnBoolean: true },
            ],
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.mocksRegistered) !== 2)
          return `expected mocksRegistered=2, got ${b.mocksRegistered}`;
        return true;
      },
    },
    {
      name: 'nemu_setup_java_field/registers-int-field',
      tool: 'nemu_setup_java_field',
      origin: 'homemade',
      reference: 'registers mock Java static/instance field value',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleSetupJavaField({
            sessionId,
            className: 'com/app/Config',
            fieldName: 'FLAG',
            signature: 'I',
            valueInt: 7,
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.kind !== 'int' || b.fieldName !== 'FLAG')
          return `unexpected java field result: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_write_regions/batch-writes-two-regions',
      tool: 'nemu_write_regions',
      origin: 'homemade',
      reference: 'writes multiple guest memory regions in a single batch call',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const a1 = body(await handlers.handleAllocMemory({ sessionId, size: 4 }));
          const a2 = body(await handlers.handleAllocMemory({ sessionId, size: 4 }));
          return handlers.handleWriteRegions({
            sessionId,
            regions: [
              {
                address: Number(a1.address),
                dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
              },
              {
                address: Number(a2.address),
                dataBase64: Buffer.from([5, 6, 7, 8]).toString('base64'),
              },
            ],
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.regionsWritten) !== 2 || Number(b.totalBytes) !== 8)
          return `expected 2 regions / 8 bytes, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_jni_diag/snapshot-log',
      tool: 'nemu_jni_diag',
      origin: 'homemade',
      reference: 'reads non-destructive JNI diagnostic log snapshot',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleJniDiag({ sessionId, action: 'snapshot' }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.entries)) return `expected entries array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_get_jni_stub/lists-bound-stubs',
      tool: 'nemu_get_jni_stub',
      origin: 'homemade',
      reference: 'lists bound JNI NativeInterface stub addresses',
      run: () => withSession((handlers, sessionId) => handlers.handleGetJniStub({ sessionId })),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.stubs) || Number(b.count) === 0)
          return `expected non-empty JNI stubs array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_dlsym_diag/snapshot-log',
      tool: 'nemu_dlsym_diag',
      origin: 'homemade',
      reference: 'reads non-destructive dlsym resolution log snapshot',
      run: () =>
        withSession((handlers, sessionId) =>
          handlers.handleDlsymDiag({ sessionId, action: 'snapshot' }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.entries)) return `expected entries array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_vm_state_load/writes-ctx-and-table',
      tool: 'nemu_vm_state_load',
      origin: 'homemade',
      reference: 'writes LiteVM ctx and table u64 arrays into guest memory',
      run: () =>
        withSession(async (handlers, sessionId) => {
          const alloc = body(await handlers.handleAllocMemory({ sessionId, size: 128 }));
          const base = Number(alloc.address);
          return handlers.handleVmStateLoad({
            sessionId,
            ctxBase: base,
            tableBase: base + 64,
            ctx: ['0x1', '0x2'],
            table: ['0x3', '0x4'],
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const written = b.written as { ctxBytes?: number; tableBytes?: number } | undefined;
        if (written?.ctxBytes !== 16 || written?.tableBytes !== 16)
          return `expected 16 ctx/table bytes written, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_session_load/replays-json-plan',
      tool: 'nemu_session_load',
      origin: 'homemade',
      reference: 'replays a 1-step JSON session setup plan file',
      run: () =>
        withSession((handlers, sessionId) => handlers.handleSessionLoad({ sessionId, planPath })),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.count) !== 1) return `expected 1 replayed step, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_trace/instruction-trace-add-two',
      tool: 'nemu_trace',
      origin: 'external-vector',
      reference: 'traces A64 instructions of add_two(40, 2) returning 42 with >=2 steps',
      run: () =>
        withSession(async (handlers, sessionId) => {
          await handlers.handleLoadLibrary({ sessionId, soPath });
          return handlers.handleTrace({
            sessionId,
            symbol: 'add_two',
            args: [40, 2],
            persistArtifact: false,
          });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.result) !== 42 || Number(b.steps) < 2)
          return `expected result=42 and steps>=2, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_relay/status-listing',
      tool: 'nemu_relay',
      origin: 'homemade',
      reference: 'queries IPC relay status list cleanly when idle',
      run: () => {
        const h = new NativeEmulatorHandlers(
          new SessionManager({ emulatorOptions: { syscalls: false } }),
        );
        return h.handleRelay({ action: 'status' }).finally(() => h.dispose());
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.relays)) return `expected relays array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'nemu_gdbserver/status-idle',
      tool: 'nemu_gdbserver',
      origin: 'homemade',
      reference: 'queries GDB RSP server status cleanly when no servers are running',
      run: () => {
        const h = new NativeEmulatorHandlers(
          new SessionManager({ emulatorOptions: { syscalls: false } }),
        );
        return h.handleGdbserver({ action: 'status' }).finally(() => h.dispose());
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.running !== 'boolean' || !Array.isArray(b.servers))
          return `expected running boolean and servers array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
  ],
};
