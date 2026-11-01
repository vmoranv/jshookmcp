/**
 * NativeEmulatorHandlers — MCP handlers over the in-process ARM64 emulator.
 *
 * Owns a SessionManager so each session is an isolated NativeEmulator (own CPU,
 * stack, JNI table); concurrent tool calls on different sessions never collide.
 * dispose() is wired into the server's graceful-shutdown closables list, which
 * stops the idle-sweep timer and drops every session.
 *
 * Binary inputs arrive as filesystem paths (read here with fs/promises); byte
 * payloads to and from guest memory cross the tool boundary as base64. The
 * Java-mock registration is declarative (a constant int/string/bytes) — no
 * caller-supplied code is ever evaluated.
 */
import { readFile, stat } from 'node:fs/promises';

import {
  SessionManager,
  type EmulatorSession,
  type SessionManagerOptions,
} from '@modules/native-emulator/SessionManager';
import type { BionicOptions } from '@modules/native-emulator/bionic';
import { extractArm64LibsDetailed } from '@modules/native-emulator/apk';
import { inspectElfImports } from '@modules/native-emulator/import-inspector';
import { dumpGot } from '@modules/native-emulator/got-inspector';
import { UnsupportedOpcodeError, type CpuEngine } from '@modules/native-emulator/CpuEngine';
import type { PacKeys } from '@modules/native-emulator/decoder/PointerAuth';
import type { HostContext } from '@modules/native-emulator/host-context';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import { handleSafe, R } from '@server/domains/shared/ResponseBuilder';
import {
  disassembleInstruction,
  normalizeDisasmArchitecture,
  SUPPORTED_DISASSEMBLY_ARCHITECTURES,
} from '@modules/native-emulator/disasm';
import {
  argBool,
  argEnum,
  argNumber,
  argNumberArray,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import type { ToolArgs, ToolResponse } from '@server/types';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import {
  NEMU_APK_MAX_TOTAL_SO_BYTES,
  NEMU_CALL_MAX_STEPS,
  NEMU_PROFILE_MAX_STEPS,
  NEMU_MAX_SO_BYTES,
  NEMU_VFS_MAX_FILE_BYTES,
  NEMU_VFS_MAX_TOTAL_BYTES,
} from '@src/constants';
import { nativeCallFailure, nativeDiagnostics } from './handler-call';
import {
  formatMemInspectIssues,
  memInspectSchema,
  type MemInspectArgs,
} from './handler-mem-inspect';
import { formatOpcodeInput, parseOpcodeInput, parseProgramCounter } from './handler-disasm';
import { buildJavaFieldValue, buildJavaMockImpl } from './handler-java';
import { decodeLiteVmWord, LITEVM_KNOWN_DATA } from './handler-litevm';
import { ensureRawMemorySize, rawMemoryLimit, toUint8 } from './handler-memory';
import {
  createTraceRowContext,
  persistTraceArtifact,
  traceFilterMatch,
  traceRow,
  type TraceMode,
  type TraceRowContext,
} from './handler-trace';
import {
  getOrCreateGdbServer,
  removeGdbServer,
  getGdbServer,
  listGdbServers,
} from '@native/GdbRspServer';

/** Cap on instruction-trace events returned, regardless of requested maxSteps. */
const TRACE_HARD_CAP = 100_000;

/** Parsed options for nemu_trace (extracted from handleTrace to stay under the
 * complexity gate; field semantics are unchanged). */
interface TraceCallOptions {
  debug: boolean | undefined;
  codeProtect: boolean;
  symbol: string | undefined;
  address: number | undefined;
  callArgs: number[];
  captureRegisters: string[];
  persistArtifact: boolean;
  inlineLimitArg: number | undefined;
  injectJni: boolean | undefined;
  mode: TraceMode;
  profileMode: boolean;
  maxSteps: number;
  topN: number;
  tableReg: number | undefined;
  captureBlArgs: boolean;
  registerDiff: boolean;
}

/** Mutable per-run aggregation state shared by the trace instruction hook. */
interface TraceRunState {
  profileMode: boolean;
  maxSteps: number;
  pcCounts: Map<number, { count: number; insn: number }>;
  callNodeByAddr: Map<number, ProfileCallNode>;
  callStack: number[];
  profileRoot?: ProfileCallNode;
  profileTotal: number;
  events: Array<Record<string, unknown>>;
  truncated: boolean;
  traceCtx: TraceRowContext;
  prevRegs?: Record<string, unknown>;
  captureRegisters: string[];
  mode: TraceMode;
  tableReg: number | undefined;
  captureBlArgs: boolean;
  registerDiff: boolean;
  engine: CpuEngine;
  recordCall: (target: number) => void;
}

/** Compile a guest-provided JS body into a safe bigint-returning host wrapper. */
function compileGuestHostFn(fnBody: string): (ctx: Record<string, unknown>) => bigint {
  return new Function(
    'ctx',
    `
              try {
                const result = (function(ctx) { ${fnBody} })(ctx);
                if (result === undefined || result === null) return 0n;
                if (typeof result === 'bigint') return result;
                return BigInt(Math.trunc(Number(result)));
              } catch (e) {
                return 0n;
              }
            `,
  ) as (ctx: Record<string, unknown>) => bigint;
}

function parseTraceCallOptions(args: ToolArgs): TraceCallOptions {
  // debug mode: auto-prepare TLS (applied by the caller)
  const debug = argBool(args, 'debug');
  // codeProtect: write-protect SO text segment to prevent self-modifying stores
  const codeProtect = argBool(args, 'codeProtect', false);
  const symbol = argString(args, 'symbol');
  const address = argNumber(args, 'address');
  if (!symbol && address === undefined) {
    throw new Error('Either "symbol" or "address" must be provided');
  }
  const callArgs = argNumberArray(args, 'args');
  const captureRegisters = argStringArray(args, 'captureRegisters');
  const persistArtifact = argBool(args, 'persistArtifact', false);
  const inlineLimitArg = argNumber(args, 'traceInlineLimit');
  const injectJni = argBool(args, 'injectJni'); // undefined → auto-detect (matches call_symbol)
  const mode: TraceMode =
    (argEnum(
      args,
      'mode',
      new Set(['full', 'profile', 'calls', 'branches', 'memory']),
      'full',
    ) as TraceMode) ?? 'full';
  const profileMode = mode === 'profile';
  // Profile mode trades per-step rows for volume: a much larger default budget.
  const maxSteps = Math.min(
    argNumber(args, 'maxSteps', profileMode ? NEMU_PROFILE_MAX_STEPS : 1000),
    profileMode ? NEMU_PROFILE_MAX_STEPS : TRACE_HARD_CAP,
  );
  const topN = Math.min(Math.max(Math.trunc(argNumber(args, 'topN', 20) || 20), 1), 1000);
  const tableRegRaw = argNumber(args, 'tableReg');
  const tableReg: number | undefined =
    tableRegRaw !== undefined && tableRegRaw >= 0 && tableRegRaw <= 30 ? tableRegRaw : undefined;
  const captureBlArgs = argBool(args, 'captureBlArgs', false);
  const registerDiff = argBool(args, 'registerDiff', false);
  return {
    debug,
    codeProtect,
    symbol,
    address,
    callArgs,
    captureRegisters,
    persistArtifact,
    inlineLimitArg,
    injectJni,
    mode,
    profileMode,
    maxSteps,
    topN,
    tableReg,
    captureBlArgs,
    registerDiff,
  };
}
const DISASM_ARCHITECTURES = new Set(SUPPORTED_DISASSEMBLY_ARCHITECTURES);

/**
 * Clamp a caller-supplied native-call step budget to the server ceiling
 * (`NEMU_CALL_MAX_STEPS`). Values at or under the ceiling pass through
 * untouched; oversized values are capped and flagged so the response can carry
 * a `clamped: true` marker. `0` and negative values would otherwise reach the
 * engine as an unbounded "no limit" (freezing the server on an infinite loop),
 * so they are clamped to the ceiling too — there is no unlimited escape hatch.
 */
function clampNativeMaxSteps(raw: number | undefined): {
  maxSteps: number | undefined;
  clamped: boolean;
} {
  if (raw === undefined) return { maxSteps: undefined, clamped: false };
  if (raw <= 0 || raw > NEMU_CALL_MAX_STEPS) {
    return { maxSteps: NEMU_CALL_MAX_STEPS, clamped: true };
  }
  return { maxSteps: raw, clamped: false };
}

/**
 * Stat a `.so` path and reject when its on-disk size exceeds `cap`, returning
 * the size. Sizing happens before any `readFile`, so an oversized library is
 * refused without first buffering it into memory (a malicious path can point at
 * an arbitrarily large file).
 */
async function ensureSoWithinCap(path: string, cap: number): Promise<number> {
  const info = await stat(path);
  if (info.size > cap) {
    throw new Error(`.so file "${path}" is ${info.size} bytes, which exceeds the ${cap}-byte cap`);
  }
  return info.size;
}

/** One node of the profile-mode call tree (BL/BLR targets aggregated). */
interface ProfileCallNode {
  address: string;
  count: number;
  symbolName?: string;
  callees: ProfileCallNode[];
}

/**
 * SessionManager subclass wired to handler-level cleanup: whenever a session
 * is released — explicit destroy, idle-TTL sweep, or dispose — the handler is
 * notified so per-session state (register snapshots, GDB RSP server) is
 * dropped along with the emulator instead of leaking past its lifetime.
 */
class ReleaseNotifyingSessionManager extends SessionManager {
  private readonly onRelease: (sessionId: string) => void;
  constructor(onRelease: (sessionId: string) => void, options?: SessionManagerOptions) {
    super(options);
    this.onRelease = onRelease;
  }

  protected override release(session: EmulatorSession): void {
    try {
      this.onRelease(session.id);
    } catch {
      // A faulty cleanup must not break session teardown — the sweep runs on
      // an unref'd timer, so an uncaught throw would crash the whole process.
    }
    super.release(session);
  }
}

export class NativeEmulatorHandlers {
  private readonly sessions: SessionManager;
  /** Per-session register snapshots: sessionId → (name → {reg:value}) */
  private readonly regSnapshots = new Map<string, Map<string, Record<string, bigint>>>();

  constructor(sessions?: SessionManager) {
    this.sessions =
      sessions ??
      new ReleaseNotifyingSessionManager((sessionId) => this.cleanupSessionResources(sessionId));
  }

  handleCapabilities(_args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => ({
      backend: 'self-built-arm64',
      available: true,
      external_dependencies: [],
      features: [
        'load-elf-so',
        'elf-relocations',
        'init-array-constructors',
        'pt-dynamic-symbols',
        'elf-import-inspection',
        'auto-wire-bionic-libc',
        'bionic-stdio-vfs',
        'raw-guest-memory',
        'android-syscalls',
        'getrandom',
        'system-register-read',
        'memory-barriers',
        'exclusive-load-store',
        'simd-fp-load-store',
        'simd-ld1-st1-multi',
        'aes-crypto',
        'sha1-crypto',
        'sha256-crypto',
        'sm3-crypto',
        'sm4-crypto',
        'pmull-ghash',
        'scalar-fp',
        'neon-integer-simd',
        'call-exported-symbol',
        'call-jni-export',
        'pointer-authentication',
        'null-indirect-call-detection',
        'jni-object-array-iteration',
        'java-mock-callback',
        'java-mock-field',
        'apk-arm64-extract',
        'instruction-trace',
      ],
      isa: 'aarch64-integer+neon+crypto+fp16',
      simd: {
        supported: [
          'simd-fp-load-store',
          'contiguous-ld1-st1',
          'ld2-ld3-ld4-deinterleaving',
          'aes-sha-pmull',
          'sm3-sm4-crypto',
          'scalar-fp',
          'neon-three-same',
          'neon-two-register-misc',
          'neon-dup',
          'neon-movi-mvni',
          'neon-shift-immediate',
          'neon-reductions',
          'neon-zip-uzp-trn',
          'neon-ext',
          'neon-tbl-tbx',
          'long-widening-neon',
          'saturating-neon',
          'neon-ins-general',
          'neon-bit-bif',
          'neon-pmul-vector',
          'vector-fmov-immediate',
          'fp16',
        ],
        unsupported: [],
      },
      activeSessions: this.sessions.count(),
      note: 'In-process AArch64 interpreter: integer ISA (incl. DMB/DSB/ISB barriers as no-ops) + a declared SIMD/FP subset + NEON integer-lane subset including saturating add/sub + crypto extension primitives + scalar IEEE-754 floating-point across single/double AND half precision (FEAT_FP16, software binary16 model). SIMD support is reported as supported/unsupported lists; unsupported opcodes fail loudly with the raw opcode instead of being treated as success. On load, DT_INIT + DT_INIT_ARRAY constructors run after relocation; constructor NULL indirect calls are tolerated and logged, while direct call_symbol/call_jni_export NULL indirect calls throw "NULL indirect call". Raw guest memory tools are bounded by configured byte caps and return previews unless full base64 output is explicitly requested. Managed runtime snapshot payloads are outside this emulator boundary.',
    }));
  }

  handleCreateSession(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const installSyscalls = argBool(args, 'installSyscalls', true);
      const bionic = decodeBionicOptions(args['files'], args['extraSymbols']);
      const session = this.sessions.createSession({
        ...(installSyscalls ? {} : { syscalls: false }),
        ...(bionic ? { bionic } : {}),
      });
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
        activeSessions: this.sessions.count(),
        ...(bionic?.files ? { filesLoaded: bionic.files.size } : {}),
      };
    });
  }

  handleDestroySession(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const sessionId = argStringRequired(args, 'sessionId');
      // Drop handler-owned per-session state (register snapshots, GDB RSP
      // server) before the emulator itself — the GDB server is stopped even
      // when the session id is unknown, clearing orphaned registry entries.
      this.cleanupSessionResources(sessionId);
      const destroyed = this.sessions.destroySession(sessionId);
      return {
        sessionId,
        destroyed,
        activeSessions: this.sessions.count(),
      };
    });
  }

  handleListSessions(_args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => ({
      sessions: this.sessions.listSessions(),
      count: this.sessions.count(),
    }));
  }

  handleSessionInfo(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const symbols = session.emulator.engine.exportedSymbolNames();
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        activeSessions: this.sessions.count(),
        symbols,
        symbolCount: symbols.length,
        diagnostics: nativeDiagnostics(session),
      };
    });
  }

  handleLoadLibrary(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const soPath = argStringRequired(args, 'soPath');
      await ensureSoWithinCap(soPath, NEMU_MAX_SO_BYTES);
      const bytes = toUint8(await readFile(soPath));
      const loaded = session.emulator.loadLibrary(bytes);
      return {
        sessionId: session.id,
        soPath,
        entry: loaded.entry,
        unresolvedImports: loaded.unresolvedImports,
        constructorFaults: loaded.constructorFaults,
        symbols: session.emulator.engine.exportedSymbolNames(),
      };
    });
  }

  handleLoadLibraryChain(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const dependencyPaths = argStringArray(args, 'dependencyPaths') ?? [];
      const primaryPath = argStringRequired(args, 'primaryPath');

      if (dependencyPaths.length === 0) {
        throw new Error('dependencyPaths must contain at least one dependency .so path');
      }

      // Size-check every file before reading: each dependency must fit within
      // the per-file cap, and their summed size must stay within the same
      // budget so a chain of many .so files cannot exhaust memory.
      let totalDependencyBytes = 0;
      for (const depPath of dependencyPaths) {
        totalDependencyBytes += await ensureSoWithinCap(depPath, NEMU_MAX_SO_BYTES);
        if (totalDependencyBytes > NEMU_MAX_SO_BYTES) {
          throw new Error(
            `dependency .so chain total ${totalDependencyBytes} bytes exceeds the ${NEMU_MAX_SO_BYTES}-byte cap`,
          );
        }
      }
      await ensureSoWithinCap(primaryPath, NEMU_MAX_SO_BYTES);

      // Read all dependency bytes
      const depBytes = await Promise.all(
        dependencyPaths.map(async (depPath) => toUint8(await readFile(depPath))),
      );

      // Read primary bytes
      const primaryBytes = toUint8(await readFile(primaryPath));

      // Load chain
      const loaded = session.emulator.loadLibraryChain(depBytes, primaryBytes);

      return {
        sessionId: session.id,
        dependencyPaths,
        primaryPath,
        entry: loaded.entry,
        unresolvedImports: loaded.unresolvedImports,
        constructorFaults: loaded.constructorFaults,
        symbols: session.emulator.engine.exportedSymbolNames(),
      };
    });
  }

  handleExtractApkLibs(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const apkPath = argStringRequired(args, 'apkPath');
      const { libs, truncated, totalBytes } = await extractArm64LibsDetailed(apkPath);
      return {
        apkPath,
        abi: 'arm64-v8a',
        libs: libs.map((l) => ({ name: l.name, bytes: l.bytes.length })),
        count: libs.length,
        truncated,
        totalBytes,
      };
    });
  }

  handleInspectImports(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const soPath = argStringRequired(args, 'soPath');
      const bytes = await readFile(soPath);
      return {
        soPath,
        ...inspectElfImports(toUint8(bytes)),
      };
    });
  }

  /** nemu_dump_got — map PLT trampolines → GOT entries → resolved symbols. */
  async handleDumpGot(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const soPath = argStringRequired(args, 'soPath');
      const bytes = await readFile(soPath);
      const clusters = dumpGot(toUint8(bytes));
      return {
        soPath,
        clusters,
        summary: clusters.map((c) => ({
          pageBase: `0x${c.pageBase.toString(16)}`,
          tableStart: `0x${c.tableStart.toString(16)}`,
          entries: c.entryCount,
          unmatched: c.unmatched.map((a) => `0x${a.toString(16)}`),
        })),
      };
    });
  }

  /** nemu_prepare_tls — ensure TLS is mapped so slots can be populated. */
  async handlePrepareTls(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const base = session.emulator.prepareTls();
      return { sessionId: session.id, tlsBase: `0x${base.toString(16)}`, tlsSize: 0x2000 };
    });
  }

  /** nemu_create_vtable — allocate a C++ vtable-backed object in guest memory. */
  async handleCreateVtable(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const numSlots = argNumber(args, 'numSlots', 16);
      const returnStubAddrStr = argString(args, 'returnStubAddr', '');

      // Per-session bump allocator for vtables (starts at 0x40010000, bumps by 0x10000 per call)
      const vtSession = session as { _vtableBump?: number };
      // eslint-disable-next-line no-underscore-dangle
      const bump = vtSession._vtableBump ?? 0x40010000;
      // eslint-disable-next-line no-underscore-dangle
      vtSession._vtableBump = bump + 0x10000;

      // Allocate or reuse return-0 host stub
      let returnStubAddr: number;
      if (returnStubAddrStr) {
        returnStubAddr = parseInt(returnStubAddrStr, 16) || parseInt(returnStubAddrStr, 10);
      } else {
        returnStubAddr = 0x68001000;
        session.emulator.engine.registerHostFunction(returnStubAddr, () => 0n);
      }

      const vtableSize = numSlots * 8;
      const vtableAddr = bump;
      const objectAddr = bump + vtableSize + 0x10;

      session.emulator.mapGuestMemory(vtableAddr, 4096); // map generous region for deep vtable access

      // Fill vtable slots with return-stub address
      const stubBuf = new Uint8Array(8);
      new DataView(stubBuf.buffer).setBigUint64(0, BigInt(returnStubAddr), true);
      const vtableData = new Uint8Array(vtableSize);
      for (let i = 0; i < numSlots; i++) vtableData.set(stubBuf, i * 8);
      session.emulator.writeGuestMemory(vtableAddr, vtableData);

      // Write object → vtable pointer
      const objData = new Uint8Array(8);
      new DataView(objData.buffer).setBigUint64(0, BigInt(vtableAddr), true);
      session.emulator.writeGuestMemory(objectAddr, objData);

      return {
        sessionId: session.id,
        objectAddr: `0x${objectAddr.toString(16)}`,
        vtableAddr: `0x${vtableAddr.toString(16)}`,
        numSlots,
        returnStubAddr: `0x${returnStubAddr.toString(16)}`,
      };
    });
  }

  /** nemu_mem_shadow — add a shadow memory overlay at a specific address. */
  async handleMemShadow(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      if (address === undefined) throw new Error('Missing required number: address');
      const dataBase64 = argStringRequired(args, 'dataBase64');
      const data = Buffer.from(dataBase64, 'base64');
      session.emulator.engine.addShadow(address, new Uint8Array(data));
      return {
        sessionId: session.id,
        address: `0x${address.toString(16)}`,
        size: data.length,
        shadowed: true,
      };
    });
  }

  /** nemu_set_vtable_slot — override a vtable slot with a custom host stub. */
  async handleSetVtableSlot(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const vtableAddr = argNumber(args, 'vtableAddr');
      const slotIndex = argNumber(args, 'slotIndex');
      const fnBody = argStringRequired(args, 'fn');
      if (vtableAddr === undefined || slotIndex === undefined) {
        throw new Error('Missing required args: vtableAddr, slotIndex');
      }
      // Bump allocator for custom stub addresses
      // eslint-disable-next-line no-underscore-dangle
      const stubBump = (session as { _stubBump?: number })._stubBump ?? 0;
      const stubAddr = 0x68002000 + stubBump;
      // eslint-disable-next-line no-underscore-dangle
      (session as { _stubBump?: number })._stubBump = stubBump + 8;

      const wrapper = new Function(
        'ctx',
        `
        try {
          const result = (function(ctx) { ${fnBody} })(ctx);
          if (result === undefined || result === null) return 0n;
          if (typeof result === 'bigint') return result;
          return BigInt(Math.trunc(Number(result)));
        } catch (e) {
          return 0n;
        }
      `,
      ) as (ctx: Record<string, unknown>) => bigint;

      let callIdx = 0;
      const hostFn = (
        hctx: import('@modules/native-emulator/host-context').HostContext,
      ): bigint => {
        const idx = ++callIdx;
        const ctx = {
          callIndex: idx,
          x: (n: number) => hctx.x(n),
          setX: (n: number, v: bigint | number) => hctx.setX(n, BigInt(v)),
          setCarry: (v: boolean) => hctx.setCarry?.(v),
          persistReg: (i: number, v: bigint | number) => hctx.persistReg?.(i, BigInt(v)),
          unpersistReg: (i: number) => hctx.unpersistReg?.(i),
          readU64: (a: number) => new DataView(hctx.read(a, 8).buffer, 0, 8).getBigUint64(0, true),
          readU32: (a: number) => new DataView(hctx.read(a, 4).buffer, 0, 4).getUint32(0, true),
          writeU64: (a: number, v: bigint | number) => {
            const buf = new Uint8Array(8);
            new DataView(buf.buffer).setBigUint64(0, BigInt(v), true);
            hctx.write(a, buf);
          },
        };
        return wrapper(ctx);
      };

      session.emulator.engine.registerHostFunction(stubAddr, hostFn);

      // Write stub address to vtable slot (little-endian)
      const slotData = new Uint8Array(8);
      new DataView(slotData.buffer).setBigUint64(0, BigInt(stubAddr), true);
      session.emulator.writeGuestMemory(vtableAddr + slotIndex * 8, slotData);

      return {
        sessionId: session.id,
        vtableAddr: `0x${vtableAddr.toString(16)}`,
        slotIndex,
        slotOffset: `0x${(slotIndex * 8).toString(16)}`,
        stubAddr: `0x${stubAddr.toString(16)}`,
        bound: true,
      };
    });
  }

  /** nemu_bind_host_fn — register a JS function at a guest address. */
  async handleBindHostFn(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      const fnBody = argStringRequired(args, 'fn');
      if (address === undefined) throw new Error('Missing required number: address');

      const wrapper = new Function(
        'ctx',
        `
        try {
          const result = (function(ctx) { ${fnBody} })(ctx);
          if (result === undefined || result === null) return 0n;
          if (typeof result === 'bigint') return result;
          return BigInt(Math.trunc(Number(result)));
        } catch (e) {
          return 0n;
        }
      `,
      ) as (ctx: Record<string, unknown>) => bigint;

      let callIndex = 0;
      const hostFn = (
        hctx: import('@modules/native-emulator/host-context').HostContext,
      ): bigint => {
        const idx = ++callIndex;
        const ctx = {
          callIndex: idx,
          x: (n: number) => hctx.x(n),
          setX: (n: number, v: bigint | number) => hctx.setX(n, BigInt(v)),
          setD: (n: number, v: number) => hctx.setD(n, v),
          setCarry: (v: boolean) => hctx.setCarry?.(v),
          persistReg: (i: number, v: bigint | number) => hctx.persistReg?.(i, BigInt(v)),
          unpersistReg: (i: number) => hctx.unpersistReg?.(i),
          saveRegs: () => hctx.saveRegs?.(),
          restoreRegs: (h: number) => hctx.restoreRegs?.(h),
          read: (a: number, l: number) => hctx.read(a, l),
          readU64: (a: number) => new DataView(hctx.read(a, 8).buffer, 0, 8).getBigUint64(0, true),
          readU32: (a: number) => new DataView(hctx.read(a, 4).buffer, 0, 4).getUint32(0, true),
          write: (a: number, b: Uint8Array) => hctx.write(a, b),
          writeU64: (a: number, v: bigint | number) => {
            const buf = new Uint8Array(8);
            new DataView(buf.buffer).setBigUint64(0, BigInt(v), true);
            hctx.write(a, buf);
          },
          writeU32: (a: number, v: number) => {
            const buf = new Uint8Array(4);
            new DataView(buf.buffer).setUint32(0, v, true);
            hctx.write(a, buf);
          },
          sp: hctx.sp,
        };
        return wrapper(ctx);
      };

      session.emulator.engine.registerHostFunction(address, hostFn);
      return { sessionId: session.id, address: `0x${address.toString(16)}`, bound: true };
    });
  }

  /** nemu_bind_all_imports — batch-bind host functions to all resolved import stubs. */
  async handleBindAllImports(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const fnBody = argStringRequired(args, 'fn');
      const gotStart = argNumber(args, 'gotStart') ?? 0x74000;
      const gotEnd = argNumber(args, 'gotEnd') ?? 0x74a90;

      // Create wrapper once (shared across all stubs)
      const wrapper = new Function(
        'ctx',
        `
        try {
          const result = (function(ctx) { ${fnBody} })(ctx);
          if (result === undefined || result === null) return 0n;
          if (typeof result === 'bigint') return result;
          return BigInt(Math.trunc(Number(result)));
        } catch (e) {
          return 0n;
        }
      `,
      ) as (ctx: Record<string, unknown>) => bigint;

      const engine = session.emulator.engine;
      const mem = engine['memory'] as { readMemory(addr: number, len: number): Uint8Array };

      const seen = new Set<number>();
      const bound: string[] = [];

      // Read GOT in 256-byte chunks
      for (let addr = gotStart; addr < gotEnd; addr += 256) {
        const chunkSize = Math.min(256, gotEnd - addr);
        const data = mem.readMemory(addr, chunkSize);
        for (let off = 0; off + 8 <= data.length; off += 8) {
          const stubAddr = Number(
            new DataView(data.buffer, data.byteOffset + off, 8).getBigUint64(0, true),
          );
          // Import stubs are in the 0x68000000-0x68100000 range
          if (stubAddr >= 0x68000000 && stubAddr < 0x68100000 && !seen.has(stubAddr)) {
            seen.add(stubAddr);
            const hostFn = (
              hctx: import('@modules/native-emulator/host-context').HostContext,
            ): bigint => {
              const ctx = {
                x: (n: number) => hctx.x(n),
                setX: (n: number, v: bigint | number) => hctx.setX(n, BigInt(v)),
                setD: (n: number, v: number) => hctx.setD(n, v),
                read: (a: number, l: number) => hctx.read(a, l),
                readU64: (a: number) =>
                  new DataView(hctx.read(a, 8).buffer, 0, 8).getBigUint64(0, true),
                readU32: (a: number) =>
                  new DataView(hctx.read(a, 4).buffer, 0, 4).getUint32(0, true),
                write: (a: number, b: Uint8Array) => hctx.write(a, b),
                writeU64: (a: number, v: bigint | number) => {
                  const buf = new Uint8Array(8);
                  new DataView(buf.buffer).setBigUint64(0, BigInt(v), true);
                  hctx.write(a, buf);
                },
                writeU32: (a: number, v: number) => {
                  const buf = new Uint8Array(4);
                  new DataView(buf.buffer).setUint32(0, v, true);
                  hctx.write(a, buf);
                },
                sp: hctx.sp,
              };
              return wrapper(ctx);
            };
            engine.registerHostFunction(stubAddr, hostFn);
            bound.push(`0x${stubAddr.toString(16)}`);
          }
        }
      }
      return {
        sessionId: session.id,
        totalUniqueStubs: seen.size,
        bound: bound.slice(0, 20),
        count: bound.length,
      };
    });
  }

  /** nemu_set_registers — directly set CPU registers. */
  async handleSetRegisters(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const registers = args.registers as Record<string, number | bigint> | undefined;
      if (!registers || typeof registers !== 'object')
        throw new Error('set_registers: missing registers object');
      const engine = session.emulator.engine;
      const set: string[] = [];
      for (const [key, val] of Object.entries(registers)) {
        const rn = Number(key);
        if (isNaN(rn)) continue;
        if (rn === 31) {
          engine['registerFile'].setFrame(BigInt(val));
          set.push(`x31/FP=0x${BigInt(val).toString(16)}`);
        } else if (rn >= 0 && rn <= 30) {
          engine['registerFile'].writeGpr(rn, BigInt(val));
          set.push(`x${rn}=0x${BigInt(val).toString(16)}`);
        } else if (rn >= 32 && rn <= 63) {
          // d-register: write 128-bit vector with upper 64 bits zeroed (ARM64 ABI)
          const bytes = new Uint8Array(16); // zero-initialized → upper half = 0
          new DataView(bytes.buffer).setFloat64(0, Number(val), true);
          engine['registerFile'].writeVector(rn - 32, bytes);
          set.push(`d${rn - 32}=${val}`);
        }
      }
      return { sessionId: session.id, set, count: set.length };
    });
  }

  /** nemu_session_load — replay a JSON plan to set up a session in one call. */
  async handleSessionLoad(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const planPath = argStringRequired(args, 'planPath');
      const buf = await readFile(planPath);
      const plan = JSON.parse(new TextDecoder().decode(buf));
      if (!Array.isArray(plan))
        throw new Error('Plan must be a JSON array of {tool, args} objects');
      const steps: string[] = [];
      for (const entry of plan) {
        const toolName = String(entry.tool ?? '');
        const a = (entry.args ?? {}) as Record<string, unknown>;
        a.sessionId = session.id; // override with current session
        this.applySessionLoadStep(session, toolName, a, steps);
      }
      return { sessionId: session.id, steps, count: steps.length };
    });
  }

  /** Execute one plan step of nemu_session_load (dispatch by tool name). */
  private applySessionLoadStep(
    session: EmulatorSession,
    toolName: string,
    a: Record<string, unknown>,
    steps: string[],
  ): void {
    switch (toolName) {
      case 'nemu_write_regions': {
        const regions = a.regions as Array<Record<string, unknown>> | undefined;
        if (!regions) throw new Error('write_regions: missing regions array');
        this.writeRegionsRaw(session, regions);
        steps.push(`write_regions: ${regions.length} regions`);
        break;
      }
      case 'nemu_prepare_tls':
        session.emulator.prepareTls();
        steps.push('prepare_tls');
        break;
      case 'nemu_call_address': {
        const addr = a.address as number | undefined;
        if (addr === undefined) throw new Error('call_address: missing address');
        const callArgs = (a.args as number[] | undefined) ?? [];
        session.emulator.callAddress(addr, callArgs);
        steps.push(`call_address: 0x${addr.toString(16)}`);
        break;
      }
      case 'nemu_call_symbol': {
        const sym = a.symbol as string | undefined;
        if (!sym) throw new Error('call_symbol: missing symbol');
        const callArgs = (a.args as number[] | undefined) ?? [];
        session.emulator.call(sym, callArgs);
        steps.push(`call_symbol: ${sym}`);
        break;
      }
      case 'nemu_alloc_memory': {
        const size = (a.size as number | undefined) ?? 4096;
        const addr = session.emulator.allocGuestMemory(size);
        steps.push(`alloc_memory: ${size}B @ 0x${addr.toString(16)}`);
        break;
      }
      case 'nemu_map_memory': {
        const mapAddr = a.address as number | undefined;
        const mapSize = (a.size as number | undefined) ?? 4096;
        if (mapAddr === undefined) throw new Error('map_memory: missing address');
        session.emulator.engine.mapMemory(mapAddr, mapSize);
        steps.push(`map_memory: 0x${mapAddr.toString(16)} +${mapSize}`);
        break;
      }
      case 'nemu_setup_java_mocks': {
        const mocks = a.mocks as Array<Record<string, unknown>> | undefined;
        if (!mocks) throw new Error('setup_java_mocks: missing mocks array');
        for (const m of mocks) {
          const impl = buildJavaMockImpl(m as Record<string, unknown>);
          session.emulator.setupJava(
            String(m.className ?? ''),
            String(m.methodName ?? ''),
            String(m.signature ?? ''),
            impl.fn,
          );
        }
        steps.push(`setup_java_mocks: ${mocks.length} mocks`);
        break;
      }
      case 'nemu_bind_host_fn':
        this.stepBindHostFn(session, a, steps);
        break;
      case 'nemu_bind_all_imports':
        this.stepBindAllImports(session, a, steps);
        break;
      case 'nemu_set_registers': {
        const regs = a.registers as Record<string, number | bigint> | undefined;
        if (!regs) throw new Error('set_registers: missing registers object');
        const eng = session.emulator.engine;
        const set: string[] = [];
        for (const [key, val] of Object.entries(regs)) {
          const rn = Number(key);
          if (isNaN(rn)) continue;
          if (rn >= 0 && rn <= 30) {
            eng['registerFile'].writeGpr(rn, BigInt(val));
            set.push(`x${rn}=0x${BigInt(val).toString(16)}`);
          }
        }
        steps.push(`set_registers: ${set.join(', ')}`);
        break;
      }
      default:
        throw new Error(`Unknown tool in plan: "${toolName}"`);
    }
  }

  /** nemu_bind_host_fn plan step: compile the guest-provided JS body into a
   * safe host wrapper and register it at the given address. */
  private stepBindHostFn(
    session: EmulatorSession,
    a: Record<string, unknown>,
    steps: string[],
  ): void {
    const addr = a.address as number | undefined;
    const fnBody = a.fn as string | undefined;
    if (addr === undefined || !fnBody) throw new Error('bind_host_fn: missing address or fn');
    const wrapper = compileGuestHostFn(fnBody);
    let callIdx = 0;
    const hostFn = (hctx: HostContext): bigint => {
      const idx = ++callIdx;
      const ctx = {
        callIndex: idx,
        x: (n: number) => hctx.x(n),
        setX: (n: number, v: bigint | number) => hctx.setX(n, BigInt(v)),
        setD: (n: number, v: number) => hctx.setD(n, v),
        setCarry: (v: boolean) => hctx.setCarry?.(v),
        saveRegs: () => hctx.saveRegs?.(),
        restoreRegs: (h: number) => hctx.restoreRegs?.(h),
        read: (guestAddr: number, l: number) => hctx.read(guestAddr, l),
        readU64: (guestAddr: number) =>
          new DataView(hctx.read(guestAddr, 8).buffer, 0, 8).getBigUint64(0, true),
        readU32: (guestAddr: number) =>
          new DataView(hctx.read(guestAddr, 4).buffer, 0, 4).getUint32(0, true),
        write: (guestAddr: number, b: Uint8Array) => hctx.write(guestAddr, b),
        writeU64: (guestAddr: number, v: bigint | number) => {
          const buf8 = new Uint8Array(8);
          new DataView(buf8.buffer).setBigUint64(0, BigInt(v), true);
          hctx.write(guestAddr, buf8);
        },
        writeU32: (guestAddr: number, v: number) => {
          const buf4 = new Uint8Array(4);
          new DataView(buf4.buffer).setUint32(0, v, true);
          hctx.write(guestAddr, buf4);
        },
        sp: hctx.sp,
      };
      return wrapper(ctx);
    };
    session.emulator.engine.registerHostFunction(addr, hostFn);
    steps.push(`bind_host_fn: 0x${addr.toString(16)}`);
  }

  /** nemu_bind_all_imports plan step: scan the GOT range and register the
   * guest-provided JS body as a host stub for each unresolved PLT entry. */
  private stepBindAllImports(
    session: EmulatorSession,
    a: Record<string, unknown>,
    steps: string[],
  ): void {
    const fnBody = a.fn as string | undefined;
    if (!fnBody) throw new Error('bind_all_imports: missing fn');
    const gotStart = (a.gotStart as number | undefined) ?? 0x74000;
    const gotEnd = (a.gotEnd as number | undefined) ?? 0x74a90;

    const wrapper = compileGuestHostFn(fnBody);
    const eng = session.emulator.engine;
    const mem = (
      eng as unknown as { memory: { readMemory(addr: number, len: number): Uint8Array } }
    ).memory;
    const seen = new Set<number>();
    let count = 0;
    for (let addr = gotStart; addr < gotEnd; addr += 256) {
      const chunkSize = Math.min(256, gotEnd - addr);
      const data = mem.readMemory(addr, chunkSize);
      for (let off = 0; off + 8 <= data.length; off += 8) {
        const stubAddr = Number(
          new DataView(data.buffer, data.byteOffset + off, 8).getBigUint64(0, true),
        );
        if (stubAddr >= 0x68000000 && stubAddr < 0x68100000 && !seen.has(stubAddr)) {
          seen.add(stubAddr);
          const hostFn = (hctx: HostContext): bigint => {
            const ctx = {
              x: (n: number) => hctx.x(n),
              setX: (n: number, v: bigint | number) => hctx.setX(n, BigInt(v)),
              setD: (n: number, v: number) => hctx.setD(n, v),
              read: (guestAddr: number, l: number) => hctx.read(guestAddr, l),
              readU64: (guestAddr: number) =>
                new DataView(hctx.read(guestAddr, 8).buffer, 0, 8).getBigUint64(0, true),
              readU32: (guestAddr: number) =>
                new DataView(hctx.read(guestAddr, 4).buffer, 0, 4).getUint32(0, true),
              write: (guestAddr: number, b: Uint8Array) => hctx.write(guestAddr, b),
              writeU64: (guestAddr: number, v: bigint | number) => {
                const buf8 = new Uint8Array(8);
                new DataView(buf8.buffer).setBigUint64(0, BigInt(v), true);
                hctx.write(guestAddr, buf8);
              },
              writeU32: (guestAddr: number, v: number) => {
                const buf4 = new Uint8Array(4);
                new DataView(buf4.buffer).setUint32(0, v, true);
                hctx.write(guestAddr, buf4);
              },
              sp: hctx.sp,
            };
            return wrapper(ctx);
          };
          eng.registerHostFunction(stubAddr, hostFn);
          count++;
        }
      }
    }
    steps.push(
      `bind_all_imports: ${count} stubs (got 0x${gotStart.toString(16)}-0x${gotEnd.toString(16)})`,
    );
  }

  handleLoadApkLibrary(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const apkPath = argStringRequired(args, 'apkPath');
      const libName = argStringRequired(args, 'libName');
      const { libs, truncated, totalBytes } = await extractArm64LibsDetailed(apkPath);
      if (truncated) {
        throw new Error(
          `APK extraction truncated at ${Math.round(NEMU_APK_MAX_TOTAL_SO_BYTES / (1024 * 1024))} MB cap (${totalBytes} bytes read, ${libs.length} lib(s) returned) — library "${libName}" may be incomplete or missing; re-extract with a higher cap`,
        );
      }
      const lib = libs.find((l) => l.name === libName);
      if (!lib) {
        throw new Error(
          `Library "${libName}" not found in ${apkPath} (available: ${libs.map((l) => l.name).join(', ') || 'none'})`,
        );
      }
      const loaded = session.emulator.loadLibrary(lib.bytes);
      return {
        sessionId: session.id,
        apkPath,
        libName,
        entry: loaded.entry,
        unresolvedImports: loaded.unresolvedImports,
        constructorFaults: loaded.constructorFaults,
        symbols: session.emulator.engine.exportedSymbolNames(),
      };
    });
  }

  handleListSymbols(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const symbols = session.emulator.engine.exportedSymbolNames();
      return { sessionId: session.id, symbols, count: symbols.length };
    });
  }

  handleCallSymbol(args: ToolArgs): Promise<ToolResponse> {
    const { maxSteps, clamped } = clampNativeMaxSteps(argNumber(args, 'maxSteps'));
    return this.handleNativeCall(
      args,
      'call_symbol',
      (session, symbol) => {
        const callArgs = argNumberArray(args, 'args');
        const injectJni = argBool(args, 'injectJni'); // undefined → auto-detect
        const initRegsRaw = args.initRegisters as Record<string, number> | undefined;
        const initRegs = initRegsRaw
          ? Object.fromEntries(Object.entries(initRegsRaw).map(([k, v]) => [Number(k), BigInt(v)]))
          : undefined;
        return session.emulator.call(symbol, callArgs, {
          injectJni,
          initRegisters: initRegs,
          maxSteps,
        });
      },
      clamped,
    );
  }

  handleCallJniExport(args: ToolArgs): Promise<ToolResponse> {
    const { maxSteps, clamped } = clampNativeMaxSteps(argNumber(args, 'maxSteps'));
    return this.handleNativeCall(
      args,
      'call_jni_export',
      (session, symbol) => {
        const javaArgs = argNumberArray(args, 'javaArgs');
        const thiz = argNumber(args, 'thiz', 0);
        return session.emulator.callJniExport(symbol, javaArgs, thiz, undefined, maxSteps);
      },
      clamped,
    );
  }

  handleCallAddress(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      if (address === undefined) throw new Error('Missing required number argument: "address"');
      const callArgs = argNumberArray(args, 'args');
      const injectJni = argBool(args, 'injectJni');
      const { maxSteps, clamped } = clampNativeMaxSteps(argNumber(args, 'maxSteps'));
      // When injectJni is set, prepend JNI env + 0 to args (standard JNI method convention).
      const effectiveArgs = injectJni
        ? [session.emulator.jni.envPointer(), 0, ...callArgs]
        : callArgs;
      const result = session.emulator.callAddress(address, effectiveArgs, maxSteps);
      return R.ok()
        .merge({
          sessionId: session.id,
          address: `0x${address.toString(16)}`,
          result,
          ...(clamped ? { clamped: true } : {}),
        })
        .json();
    });
  }

  private async handleNativeCall(
    args: ToolArgs,
    phase: 'call_symbol' | 'call_jni_export',
    invoke: (session: EmulatorSession, symbol: string) => number,
    clamped = false,
  ): Promise<ToolResponse> {
    let session: EmulatorSession | undefined;
    let symbol = '';
    try {
      session = this.requireSession(args);
      symbol = argStringRequired(args, 'symbol');
      // debug mode: auto-prepare TLS so MRS tpidr_el0 returns a valid base
      if (argBool(args, 'debug')) {
        session.emulator.prepareTls();
      }
      // codeProtect: write-protect SO text segment
      if (argBool(args, 'codeProtect', false)) {
        session.emulator.protectCodeSection();
      }
      const result = invoke(session, symbol);
      return R.ok()
        .merge({
          sessionId: session.id,
          symbol,
          result,
          diagnostics: nativeDiagnostics(session),
          ...(clamped ? { clamped: true } : {}),
        })
        .json();
    } catch (error) {
      return nativeCallFailure(error, session, symbol, phase);
    }
  }

  handleSetupJavaMock(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const className = argStringRequired(args, 'className');
      const methodName = argStringRequired(args, 'methodName');
      const signature = argStringRequired(args, 'signature');
      const impl = buildJavaMockImpl(args);
      session.emulator.setupJava(className, methodName, signature, impl.fn);
      return {
        sessionId: session.id,
        className,
        methodName,
        signature,
        returns: impl.kind,
      };
    });
  }

  /** Batch version of handleSetupJavaMock — register multiple mocks in one call. */
  async handleSetupJavaMocks(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const mocks = args.mocks as Array<Record<string, unknown>> | undefined;
      if (!mocks || !Array.isArray(mocks) || mocks.length === 0) {
        throw new Error('Missing required array argument: "mocks"');
      }
      const results: Array<{
        className: string;
        methodName: string;
        signature: string;
        returns: string;
      }> = [];
      for (const mockArgs of mocks) {
        const className = String(mockArgs.className ?? '');
        const methodName = String(mockArgs.methodName ?? '');
        const signature = String(mockArgs.signature ?? '');
        if (!className || !methodName || !signature) {
          throw new Error(
            `Invalid mock entry: requires className, methodName, signature. Got ${JSON.stringify(mockArgs)}`,
          );
        }
        const impl = buildJavaMockImpl(mockArgs as ToolArgs);
        session.emulator.setupJava(className, methodName, signature, impl.fn);
        results.push({ className, methodName, signature, returns: impl.kind });
      }
      return { sessionId: session.id, mocksRegistered: results.length, results };
    });
  }

  handleSetupJavaField(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const className = argStringRequired(args, 'className');
      const fieldName = argStringRequired(args, 'fieldName');
      const signature = argStringRequired(args, 'signature');
      const field = buildJavaFieldValue(session, args);
      session.emulator.setupJavaField(className, fieldName, signature, field.value);
      return {
        sessionId: session.id,
        className,
        fieldName,
        signature,
        kind: field.kind,
      };
    });
  }

  handleNewByteArray(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const dataBase64 = argStringRequired(args, 'dataBase64');
      const bytes = toUint8(Buffer.from(dataBase64, 'base64'));
      const handle = session.emulator.newByteArray(bytes);
      return { sessionId: session.id, handle, length: bytes.length };
    });
  }

  handleReadByteArray(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const handle = argNumber(args, 'handle');
      if (handle === undefined) {
        throw new Error('Missing required number argument: "handle"');
      }
      const bytes = session.emulator.bytesOf(handle);
      if (!bytes) {
        throw new Error(`Handle ${handle} does not resolve to a byte array`);
      }
      return {
        sessionId: session.id,
        handle,
        dataBase64: Buffer.from(bytes).toString('base64'),
        length: bytes.length,
      };
    });
  }

  /** Profile mode: seed the call tree with the traced entry as its root. */
  private seedProfileCallTree(
    session: EmulatorSession,
    symbol: string | undefined,
    address: number | undefined,
    st: TraceRunState,
    symbolNameAt: (addr: number) => string | undefined,
    callNodeByAddr: Map<number, ProfileCallNode>,
  ): void {
    const entryAddr = address ?? session.emulator.engine.lookupSymbol(symbol!) ?? 0;
    st.callStack = [entryAddr];
    st.profileRoot = { address: hexAddr(entryAddr), count: 1, callees: [] };
    const rootSym = symbolNameAt(entryAddr);
    if (rootSym !== undefined) st.profileRoot.symbolName = rootSym;
    callNodeByAddr.set(entryAddr, st.profileRoot);
  }

  /** Run the traced call, converting faults into a partial capture. */
  private executeTraceCall(
    session: EmulatorSession,
    args: ToolArgs,
    opts: TraceCallOptions,
    st: TraceRunState,
  ): { result: number; aborted: { pc: number; insn: number } | undefined } {
    const { symbol, address, callArgs, injectJni, profileMode } = opts;
    let result = 0;
    let aborted: { pc: number; insn: number } | undefined;
    try {
      // Parse initRegisters (same as handleCallSymbol)
      const initRegsRaw = args.initRegisters as Record<string, number> | undefined;
      const initRegs = initRegsRaw
        ? Object.fromEntries(Object.entries(initRegsRaw).map(([k, v]) => [Number(k), BigInt(v)]))
        : undefined;
      if (address !== undefined) {
        result = session.emulator.callAddress(address, callArgs);
      } else {
        result = session.emulator.call(symbol!, callArgs, {
          injectJni,
          initRegisters: initRegs,
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      result = 0;
      st.truncated = true;
      if (e instanceof UnsupportedOpcodeError) {
        aborted = { pc: e.pc, insn: e.insn };
        if (!profileMode && st.events.length < st.maxSteps) {
          st.events.push({
            step: st.events.length + 1,
            pc: `0x${e.pc.toString(16)}`,
            insn: `0x${e.insn.toString(16).padStart(8, '0')}`,
            asm: disassembleInstruction('arm64', e.insn, BigInt(e.pc)),
            error: 'unsupported opcode — trace aborted',
          });
        }
      } else {
        // Any other runtime fault (unmapped memory, null call, etc.) also
        // returns partial trace instead of surfacing nothing. call_symbol
        // still throws — an explicit call on an unmapped region is a real
        // gap worth surfacing, but trace is an exploration tool.
        const faultPc = session.emulator.engine.readRegister('pc');
        aborted = { pc: faultPc, insn: 0 };
        if (!profileMode && st.events.length < st.maxSteps) {
          st.events.push({
            step: st.events.length + 1,
            pc: `0x${faultPc.toString(16)}`,
            error: `execution fault — trace aborted: ${err}`,
          });
        }
      }
    }
    return { result, aborted };
  }

  /** Assemble the profile-mode trace response (hot PCs + call tree). */
  private buildProfileTraceResult(
    session: EmulatorSession,
    opts: TraceCallOptions,
    st: TraceRunState,
    extras: {
      result: number;
      abortError?: string;
      jniDiag?: readonly string[];
      pacDiag?: readonly unknown[];
    },
  ): Record<string, unknown> {
    const { address, symbol, topN } = opts;
    const total = st.profileTotal;
    const hot = [...st.pcCounts.entries()]
      .toSorted((a, b) => b[1].count - a[1].count || a[0] - b[0])
      .slice(0, topN)
      .map(([pc, rec]) => ({
        pc: hexAddr(pc),
        count: rec.count,
        percentage: pct(rec.count, total),
        asm: disassembleInstruction('arm64', rec.insn, BigInt(pc)),
      }));
    return {
      sessionId: session.id,
      ...(address !== undefined ? { address: hexAddr(address) } : { symbol: symbol! }),
      result: extras.result,
      mode: 'profile',
      totalInstructions: total,
      uniqueInstructions: st.pcCounts.size,
      hotInstructions: hot,
      callTree: st.profileRoot ? [st.profileRoot] : [],
      summary: {
        totalInstructions: total,
        uniqueInstructions: st.pcCounts.size,
        ...(hot[0] ? { topHotPc: hot[0].pc, topHotAsm: hot[0].asm } : {}),
      },
      steps: total,
      truncated: st.truncated,
      ...(extras.abortError ? { error: extras.abortError } : {}),
      ...(extras.jniDiag ? { jniCalls: extras.jniDiag } : {}),
      ...(extras.pacDiag && extras.pacDiag.length > 0 ? { pacMismatches: extras.pacDiag } : {}),
    };
  }

  /** Profile-mode hook arm: frequency counting + BL/BLR call-edge tracking. */
  private recordProfileInstruction(ev: TraceEvent, st: TraceRunState): void {
    if (st.profileTotal >= st.maxSteps) {
      st.truncated = true;
      st.engine.requestStop(); // hard-stop execution when budget exceeded
      return;
    }
    st.profileTotal += 1;
    const rec = st.pcCounts.get(ev.pc);
    if (rec) rec.count += 1;
    else st.pcCounts.set(ev.pc, { count: 1, insn: ev.insn });
    const insn = ev.insn;
    if ((insn & 0xfc000000) >>> 0 === 0x94000000) {
      // BL imm26 — sign-extended 26-bit word offset
      st.recordCall(ev.pc + (((insn & 0x03ffffff) << 6) >> 6) * 4);
    } else if ((insn & 0xfffff1ff) >>> 0 === 0xd63f0000) {
      // BLR family (BLR + PAC variants BLRAA/BLRAAZ/BLRAB/BLRABZ) — target
      // is Rn (bits[9:5]). Mask 0xfffff1ff zeroes bits[11:10] (PAC op3
      // discriminators) so all BLR variants are recorded as call edges.
      try {
        st.recordCall(Number(ev.x((insn >>> 5) & 0b11111)));
      } catch {
        /* register read may fault — skip this call edge */
      }
    } else if (insn === 0xd65f03c0 && st.callStack.length > 1) {
      st.callStack.pop(); // RET — pop the current frame (never the entry frame)
    }
  }

  /** Row-mode hook arm: build the trace row, apply registerDiff, filter, emit. */
  private appendTraceRow(ev: TraceEvent, st: TraceRunState): void {
    if (st.events.length >= st.maxSteps) {
      st.truncated = true;
      st.engine.requestStop(); // hard-stop execution when trace budget exceeded
      return;
    }
    const row = traceRow(
      ev,
      st.captureRegisters,
      st.mode,
      st.tableReg,
      st.captureBlArgs,
      st.traceCtx,
    );
    // registerDiff: only emit if at least one captured register changed
    if (st.registerDiff && st.captureRegisters && st.prevRegs) {
      const cur = row.registers as Record<string, unknown> | undefined;
      if (cur) {
        let changed = false;
        for (const r of st.captureRegisters) {
          if (cur[r] !== st.prevRegs[r]) {
            changed = true;
            break;
          }
        }
        if (!changed) return; // skip — no register changed
      }
    }
    // Update prevRegs for next comparison
    if (st.registerDiff && st.captureRegisters && row.registers) {
      st.prevRegs = { ...(row.registers as Record<string, unknown>) };
    }
    // Apply filter AFTER row is built (so memory details are populated
    // even in filtered modes; filtering just omits non-matching rows).
    if (traceFilterMatch(ev.insn, String(row.asm ?? ''), st.mode, st.tableReg)) {
      st.events.push(row);
    }
  }

  handleTrace(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const opts = parseTraceCallOptions(args);
      // debug mode: auto-prepare TLS
      if (opts.debug) {
        session.emulator.prepareTls();
      }
      // codeProtect: write-protect SO text segment to prevent self-modifying stores
      if (opts.codeProtect) {
        session.emulator.protectCodeSection();
      }
      const {
        symbol,
        address,
        captureRegisters,
        persistArtifact,
        inlineLimitArg,
        mode,
        profileMode,
        maxSteps,
        tableReg,
        registerDiff,
      } = opts;

      const events: Array<Record<string, unknown>> = [];
      // Per-trace-call disassembly cache: a VMP dispatch loop that re-executes
      // the same handful of PCs thousands of times pays disassembleArm64 once
      // per unique PC, not once per instruction.
      const traceCtx = createTraceRowContext();
      const engine = session.emulator.engine;
      // ── Profile-mode aggregation state (mode === 'profile') ────────
      // Per-pc frequency counters; the insn is kept so hot entries can be
      // disassembled after execution (top-N only — no per-step rows).
      const pcCounts = new Map<number, { count: number; insn: number }>();
      const callNodeByAddr = new Map<number, ProfileCallNode>();
      // Best-effort address → exported-symbol resolution (nearest preceding vaddr).
      const symbolByAddr = new Map<number, string>();
      if (profileMode) {
        for (const name of engine.exportedSymbolNames()) {
          const addr = engine.lookupSymbol(name);
          if (addr !== undefined) symbolByAddr.set(addr, name);
        }
      }
      const symbolNameAt = (addr: number): string | undefined => {
        let best: string | undefined;
        let bestAddr = -1;
        for (const [a, name] of symbolByAddr) {
          if (a <= addr && a > bestAddr) {
            best = name;
            bestAddr = a;
          }
        }
        return best;
      };
      /** Record a BL/BLR call edge (target) from the current call-stack frame. */
      const recordCall = (target: number): void => {
        let node = callNodeByAddr.get(target);
        if (!node) {
          node = { address: hexAddr(target), count: 0, callees: [] };
          const sym = symbolNameAt(target);
          if (sym !== undefined) node.symbolName = sym;
          callNodeByAddr.set(target, node);
        }
        node.count += 1;
        const parent = callNodeByAddr.get(traceState.callStack[traceState.callStack.length - 1]!);
        if (parent && parent !== node && !parent.callees.includes(node)) {
          parent.callees.push(node);
        }
        traceState.callStack.push(target);
      };
      const traceState: TraceRunState = {
        profileMode,
        maxSteps,
        pcCounts,
        callNodeByAddr,
        callStack: [],
        profileRoot: undefined,
        profileTotal: 0,
        events,
        truncated: false,
        traceCtx,
        prevRegs: undefined,
        captureRegisters,
        mode,
        tableReg,
        captureBlArgs: opts.captureBlArgs,
        registerDiff,
        engine,
        recordCall,
      };
      const unsubscribe = engine.addInstructionHook((ev) => {
        if (traceState.profileMode) {
          this.recordProfileInstruction(ev, traceState);
          return;
        }
        this.appendTraceRow(ev, traceState);
      });
      try {
        // Clear stale JNI diag from prior calls so only THIS trace's
        // JNI stub invocations are reported.
        session.emulator.clearJniDiag?.();
        // Profile mode: seed the call tree with the traced entry as its root.
        if (profileMode) {
          this.seedProfileCallTree(
            session,
            symbol,
            address,
            traceState,
            symbolNameAt,
            callNodeByAddr,
          );
        }
        const { result, aborted } = this.executeTraceCall(session, args, opts, traceState);
        // Snapshot JNI diag AFTER execution (non-destructive).
        const jniDiag = session.emulator.jniDiagSnapshot?.();
        const pacDiag = session.emulator.pacDiagSnapshot?.();
        const abortError = aborted
          ? `Unsupported ARM64 opcode 0x${aborted.insn.toString(16).padStart(8, '0')} at pc=0x${aborted.pc.toString(16)} — trace aborted with partial capture`
          : undefined;
        if (profileMode) {
          return this.buildProfileTraceResult(session, opts, traceState, {
            result,
            abortError,
            jniDiag,
            pacDiag,
          });
        }
        const traceInlineLimit =
          inlineLimitArg === undefined
            ? events.length
            : Math.max(0, Math.min(Math.trunc(inlineLimitArg), events.length));
        const traceLabel = address !== undefined ? `0x${address.toString(16)}` : symbol!;
        const traceArtifact = persistArtifact
          ? await persistTraceArtifact(session.id, traceLabel, result, events, traceState.truncated)
          : undefined;
        return {
          sessionId: session.id,
          ...(address !== undefined
            ? { address: `0x${address.toString(16)}` }
            : { symbol: symbol! }),
          result,
          steps: events.length,
          truncated: traceState.truncated,
          traceInlineLimit,
          ...(traceArtifact ? { traceArtifact } : {}),
          ...(jniDiag ? { jniCalls: jniDiag } : {}),
          ...(pacDiag && pacDiag.length > 0 ? { pacMismatches: pacDiag } : {}),
          ...(abortError ? { error: abortError } : {}),
          trace: events.slice(0, traceInlineLimit),
        };
      } finally {
        unsubscribe();
      }
    });
  }

  handleSetPacKey(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const key = argStringRequired(args, 'key');
      const slot = argEnum(args, 'slot', new Set(['ia', 'ib', 'da', 'db', 'ga']), 'ia');
      if (!/^[0-9a-fA-F]{32}$/.test(key)) {
        throw new Error('PAC key must be a 32-hex-char string (128-bit)');
      }
      // engine.pacKeys is always defined (DEFAULT_PAC_KEYS); no fallback — an
      // empty-string key would crash the QARMA key parse at execution time.
      const updated: PacKeys = { ...session.emulator.engine.pacKeys, [slot]: key };
      session.emulator.setPacKeys(updated);
      return { sessionId: session.id, slot, updated };
    });
  }

  handleDisassemble(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const architecture = argEnum(args, 'architecture', DISASM_ARCHITECTURES, 'arm64');
      const normalized = normalizeDisasmArchitecture(architecture);
      // Batch mode: when sessionId + vaddr + count are provided, disassemble `count`
      // instructions starting at `vaddr` by reading guest memory and decoding each
      // 4-byte word (arm64/riscv32/riscv64/mips/mips32/mipsel). x86/x64 use variable
      // length and are NOT supported in batch mode.
      const sessionId = argString(args, 'sessionId');
      const vaddr = argNumber(args, 'vaddr');
      const count = Math.min(argNumber(args, 'count') ?? 0, 10000);
      const batchRequested = sessionId && vaddr !== undefined && count !== undefined && count > 0;
      if (batchRequested) {
        if (normalized === 'x86' || normalized === 'x64') {
          throw new Error(
            'Batch disassembly is not supported for x86/x64 (variable-length ISA). Use single-instruction mode with `opcode`.',
          );
        }
        const session = this.sessions.requireSession(sessionId);
        const wordSize = 4;
        const totalBytes = count * wordSize;
        const bytes = session.emulator.readGuestMemory(vaddr, totalBytes);
        const pcStart = parseProgramCounter(argString(args, 'pc', `0x${vaddr.toString(16)}`));
        const instructions: Array<{ pc: string; opcode: string; asm: string }> = [];
        for (let i = 0; i < count; i += 1) {
          const off = i * wordSize;
          if (off + wordSize > bytes.length) break; // truncated read
          const word =
            (bytes[off]! |
              (bytes[off + 1]! << 8) |
              (bytes[off + 2]! << 16) |
              (bytes[off + 3]! << 24)) >>>
            0;
          const pc = pcStart + BigInt(i * wordSize);
          let asm: string;
          try {
            asm = disassembleInstruction(architecture, word, pc);
          } catch (err) {
            asm = `<unsupported: ${err instanceof Error ? err.message : String(err)}>`;
          }
          instructions.push({
            pc: `0x${pc.toString(16)}`,
            opcode: `0x${word.toString(16).padStart(8, '0')}`,
            asm,
          });
        }
        return {
          architecture,
          normalizedArchitecture: normalized,
          mode: 'batch',
          sessionId: session.id,
          vaddr,
          count: instructions.length,
          instructions,
        };
      }
      // Single-instruction mode (original behavior)
      const opcode = parseOpcodeInput(args['opcode']);
      const pc = parseProgramCounter(argString(args, 'pc', '0x0'));
      const asm = disassembleInstruction(architecture, opcode, pc);
      return {
        architecture,
        normalizedArchitecture: normalized,
        opcode: formatOpcodeInput(opcode),
        pc: `0x${pc.toString(16)}`,
        asm,
      };
    });
  }

  /** Forwarded by the graceful-shutdown closables list. Idempotent. */
  dispose(): void {
    this.sessions.dispose();
    // Dispose releases each session through the notifying manager, but clear
    // the handler-owned map explicitly so injected plain managers can't leak it.
    this.regSnapshots.clear();
  }

  /** Drop handler-owned per-session state (register snapshots, GDB RSP server). Idempotent. */
  private cleanupSessionResources(sessionId: string): void {
    this.regSnapshots.delete(sessionId);
    removeGdbServer(sessionId);
  }

  // ── Guest memory management ──────────────────────────────────────────

  handleCreateJniHandle(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const kind = argString(args, 'kind') as
        | 'string'
        | 'objarray'
        | 'integer'
        | 'boolean'
        | 'object';
      if (!kind) throw new Error('Missing required argument: "kind"');
      const className = argString(args, 'className');
      const rawValue = args.value;
      let value: unknown;
      switch (kind) {
        case 'string':
          value = typeof rawValue === 'string' ? rawValue : String(rawValue);
          break;
        case 'objarray':
          value = Array.isArray(rawValue)
            ? (rawValue as number[]).map(Number)
            : typeof rawValue === 'string'
              ? (JSON.parse(rawValue) as number[]).map(Number)
              : [];
          break;
        case 'integer':
          value = Number(rawValue);
          break;
        case 'boolean':
          value =
            typeof rawValue === 'string' ? rawValue.toLowerCase() === 'true' : Boolean(rawValue);
          break;
        case 'object':
          value = rawValue;
          break;
        default:
          throw new Error(`Unknown kind: ${kind}`);
      }
      const handle = session.emulator.createJniHandle(kind, value, className);
      return R.ok().merge({ sessionId: session.id, handle }).json();
    });
  }

  handleAllocMemory(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const size = argNumber(args, 'size');
      if (size === undefined || size <= 0) {
        throw new Error('Missing or invalid "size": must be a positive number');
      }
      const maxBytes = rawMemoryLimit(args);
      ensureRawMemorySize(size, maxBytes, 'allocation');
      const fillB64 = argString(args, 'fillBytes', '');
      const fillBytes = fillB64 ? toUint8(Buffer.from(fillB64, 'base64')) : undefined;
      if (fillBytes && fillBytes.length > size) {
        throw new Error(`fillBytes exceeds allocation size: ${fillBytes.length} > ${size} bytes`);
      }
      if (fillBytes) ensureRawMemorySize(fillBytes.length, maxBytes, 'fillBytes');
      const address = session.emulator.allocGuestMemory(size, fillBytes);
      return { sessionId: session.id, address, size };
    });
  }

  handleReadMemory(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      const length = argNumber(args, 'length');
      if (address === undefined || length === undefined || length <= 0) {
        throw new Error('Missing or invalid "address" or "length"');
      }
      const maxBytes = rawMemoryLimit(args);
      ensureRawMemorySize(length, maxBytes, 'read');
      const bytes = session.emulator.readGuestMemory(address, length);
      const includeDataBase64 = argBool(args, 'includeDataBase64', false);
      const previewBytes = Math.max(
        0,
        Math.min(
          argNumber(
            args,
            'previewBytes',
            getReverseEngineeringConfig().nativeEmulator.rawMemoryPreviewBytes,
          ),
          bytes.length,
        ),
      );
      return {
        sessionId: session.id,
        address,
        length: bytes.length,
        previewBase64: Buffer.from(bytes.subarray(0, previewBytes)).toString('base64'),
        ...(includeDataBase64
          ? { dataBase64: Buffer.from(bytes).toString('base64') }
          : { dataBase64Omitted: true }),
      };
    });
  }

  async handleWriteMemory(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      if (address === undefined) {
        throw new Error('Missing required number argument: "address"');
      }
      const dataBase64 = argStringRequired(args, 'dataBase64');
      const data = toUint8(Buffer.from(dataBase64, 'base64'));
      ensureRawMemorySize(data.length, rawMemoryLimit(args), 'write');
      session.emulator.writeGuestMemory(address, data);
      return { sessionId: session.id, address, bytesWritten: data.length };
    });
  }

  async handleWriteRegions(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const regions = args.regions as Array<{ address: number; dataBase64: string }> | undefined;
      if (!regions || !Array.isArray(regions) || regions.length === 0) {
        throw new Error(
          'Missing required array argument: "regions" (non-empty array of {address, dataBase64})',
        );
      }
      const results: Array<{ address: number; bytesWritten: number }> = [];
      let totalBytes = 0;
      for (const region of regions) {
        if (typeof region.address !== 'number' || typeof region.dataBase64 !== 'string') {
          throw new Error(
            `Invalid region entry: {address, dataBase64}, got ${JSON.stringify(region)}`,
          );
        }
        const data = toUint8(Buffer.from(region.dataBase64, 'base64'));
        ensureRawMemorySize(data.length, rawMemoryLimit(args), 'write');
        session.emulator.writeGuestMemory(region.address, data);
        // Optional write-protect: prevents runtime STR instructions from overwriting this region
        if ((region as any).writeProtect === true) {
          session.emulator.engine.addWriteProtect(region.address, data.length);
        }
        results.push({ address: region.address, bytesWritten: data.length });
        totalBytes += data.length;
      }
      return { sessionId: session.id, regionsWritten: results.length, totalBytes };
    });
  }

  /** Raw write for session_load replay (no response wrapping). */
  private writeRegionsRaw(session: EmulatorSession, regions: Array<Record<string, unknown>>): void {
    for (const region of regions) {
      const address = region.address as number;
      const b64 = region.dataBase64 as string;
      if (typeof address !== 'number' || typeof b64 !== 'string') {
        throw new Error(`Invalid region: ${JSON.stringify(region)}`);
      }
      const data = toUint8(Buffer.from(b64, 'base64'));
      session.emulator.writeGuestMemory(address, data);
    }
  }

  // ── JNI Diagnostics ──────────────────────────────────────────────

  /** nemu_jni_diag — read JNI diagnostic log. */
  async handleJniDiag(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const action = (argString(args, 'action') ?? 'read') as 'read' | 'snapshot' | 'clear';
      let entries: string[] = [];
      switch (action) {
        case 'read':
          entries = session.emulator.jniDiagnostics?.() ?? [];
          break;
        case 'snapshot':
          entries = session.emulator.jniDiagSnapshot?.() ?? [];
          break;
        case 'clear':
          session.emulator.clearJniDiag?.();
          break;
      }
      return { sessionId: session.id, action, entries, count: entries.length };
    });
  }

  /** nemu_get_jni_stub — return stub addresses for JNI table indices. */
  async handleGetJniStub(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const index = argNumber(args, 'index');
      if (index !== undefined) {
        // Single index lookup
        const addr = session.emulator.getJniStubAddress(index);
        return {
          sessionId: session.id,
          index,
          stubAddress: `0x${addr.toString(16)}`,
          bound: addr !== 0,
        };
      }
      // Return all bound stub addresses
      const all = session.emulator.getJniStubAddresses();
      const entries: Array<{ index: number; stubAddress: string }> = [];
      for (const [idx, addr] of all) {
        entries.push({ index: idx, stubAddress: `0x${addr.toString(16)}` });
      }
      return { sessionId: session.id, stubs: entries, count: entries.length };
    });
  }

  /** Summarize one JNI handle value by kind (extracted from handleJniHandles). */
  private summarizeJniHandle(
    kind: string,
    val:
      | {
          kind?: string;
          name?: string;
          value?: unknown;
          cls?: string;
          desc?: string;
          sig?: string;
        }
      | undefined,
    rawValue: unknown,
  ): string {
    switch (kind) {
      case 'class':
        return val?.name ?? '?';
      case 'string':
      case 'mock-string':
        return typeof val?.value === 'string' ? `"${(val.value as string).slice(0, 80)}"` : '?';
      case 'bytes':
        return val?.value instanceof Uint8Array ? `${val.value.length} bytes` : '?';
      case 'method':
        return `${val?.cls ?? '?'}.${val?.name ?? '?'}${val?.sig ?? ''}`;
      case 'field':
        return `${val?.cls ?? '?'}.${val?.name ?? '?'} (${val?.sig ?? '?'})`;
      case 'objarray': {
        const arr = val?.value as bigint[] | undefined;
        return arr ? `[${arr.length} elements]` : '?';
      }
      case 'auto-object':
        return val?.desc ?? val?.cls ?? '?';
      case 'mock-int':
      case 'mock-boolean':
        return String(val?.value ?? '?');
      default:
        return JSON.stringify(rawValue).slice(0, 120);
    }
  }

  /** nemu_jni_handles — list all JNI object handles. */
  async handleJniHandles(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const kindFilter = argString(args, 'kindFilter');
      const handleFilter = argNumber(args, 'handleFilter');

      const handles: Array<{ handle: string; kind: string; summary: string }> = [];
      const jni = session.emulator.jni;
      for (const [handleNum, value] of jni.handles) {
        if (handleFilter !== undefined && handleNum !== handleFilter) continue;
        const val = value as {
          kind?: string;
          name?: string;
          value?: unknown;
          cls?: string;
          desc?: string;
          sig?: string;
        };
        const kind = val?.kind ?? 'unknown';
        if (kindFilter && kind !== kindFilter) continue;
        handles.push({
          handle: `0x${handleNum.toString(16)}`,
          kind,
          summary: this.summarizeJniHandle(kind, val, value),
        });
      }

      return { sessionId: session.id, handles, count: handles.length };
    });
  }

  /** nemu_dlsym_diag — read dlsym resolution log (clears after read). */
  async handleDlsymDiag(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const action = (argString(args, 'action') ?? 'read') as 'read' | 'snapshot' | 'clear';
      let entries: string[] = [];
      switch (action) {
        case 'read':
          entries = session.emulator.bionicDlsymDiagnostics();
          break;
        case 'snapshot': {
          const copy = [...(session.emulator as any).bionic.dlsymLog];
          entries = copy;
          break;
        }
        case 'clear':
          (session.emulator as any).bionic.dlsymLog.length = 0;
          break;
      }
      return { sessionId: session.id, action, entries, count: entries.length };
    });
  }

  // ── VM State Bridge (Python ↔ Native) ────────────────────────────

  /** nemu_vm_state_dump — read LiteVM state from guest memory. */
  async handleVmStateDump(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const ctxBase = argNumber(args, 'ctxBase');
      const tableBase = argNumber(args, 'tableBase');
      const outputBase = argNumber(args, 'outputBase');
      const ctxCount = Math.min(argNumber(args, 'ctxCount', 32), 64);
      const tableCount = Math.min(argNumber(args, 'tableCount', 32), 64);
      const outputSize = Math.min(argNumber(args, 'outputSize', 256), 4096);

      if (ctxBase === undefined || tableBase === undefined) {
        throw new Error('ctxBase and tableBase are required');
      }

      const readU64 = (addr: number): bigint => {
        const bytes = session.emulator.readGuestMemory(addr, 8);
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
      };

      const ctx: string[] = [];
      for (let i = 0; i < ctxCount; i++) {
        ctx.push(
          `0x${readU64(ctxBase + i * 8)
            .toString(16)
            .toUpperCase()
            .padStart(16, '0')}`,
        );
      }

      const table: string[] = [];
      for (let i = 0; i < tableCount; i++) {
        table.push(
          `0x${readU64(tableBase + i * 8)
            .toString(16)
            .toUpperCase()
            .padStart(16, '0')}`,
        );
      }

      let outputHex = '';
      let outputBytes = '';
      if (outputBase !== undefined) {
        const outBytes = session.emulator.readGuestMemory(outputBase, outputSize);
        outputHex = Buffer.from(outBytes).toString('hex').toUpperCase();
        outputBytes = Buffer.from(outBytes).toString('base64');
      }

      return {
        sessionId: session.id,
        ctx,
        table,
        outputHex,
        outputBytes,
        addresses: {
          ctxBase: `0x${ctxBase.toString(16)}`,
          tableBase: `0x${tableBase.toString(16)}`,
          ...(outputBase !== undefined ? { outputBase: `0x${outputBase.toString(16)}` } : {}),
        },
      };
    });
  }

  /** nemu_vm_state_load — write LiteVM state into guest memory. */
  async handleVmStateLoad(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const ctxBase = argNumber(args, 'ctxBase');
      const tableBase = argNumber(args, 'tableBase');
      const outputBase = argNumber(args, 'outputBase');
      const ctxVals = args.ctx as string[] | undefined;
      const tableVals = args.table as string[] | undefined;
      const outputHex = argString(args, 'outputHex');
      const ctxCount = Math.min(argNumber(args, 'ctxCount', 32), 64);
      const tableCount = Math.min(argNumber(args, 'tableCount', 32), 64);

      if (ctxBase === undefined || tableBase === undefined) {
        throw new Error('ctxBase and tableBase are required');
      }
      if (!ctxVals || !Array.isArray(ctxVals)) {
        throw new Error('ctx array is required');
      }
      if (!tableVals || !Array.isArray(tableVals)) {
        throw new Error('table array is required');
      }

      const writeU64 = (addr: number, val: bigint): void => {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigUint64(0, val, true);
        session.emulator.writeGuestMemory(addr, buf);
      };

      // Write ctx
      const ctxLimit = Math.min(ctxVals.length, ctxCount);
      for (let i = 0; i < ctxLimit; i++) {
        writeU64(ctxBase + i * 8, parseVal(ctxVals[i]!));
      }

      // Write table
      const tableLimit = Math.min(tableVals.length, tableCount);
      for (let i = 0; i < tableLimit; i++) {
        writeU64(tableBase + i * 8, parseVal(tableVals[i]!));
      }

      // Write output buffer
      let outputBytesWritten = 0;
      if (outputBase !== undefined && outputHex) {
        const outBytes = Buffer.from(outputHex, 'hex');
        session.emulator.writeGuestMemory(outputBase, outBytes);
        outputBytesWritten = outBytes.length;
      }

      return {
        sessionId: session.id,
        written: {
          ctxBytes: ctxLimit * 8,
          tableBytes: tableLimit * 8,
          outputBytes: outputBytesWritten,
        },
        addresses: {
          ctxBase: `0x${ctxBase.toString(16)}`,
          tableBase: `0x${tableBase.toString(16)}`,
          ...(outputBase !== undefined ? { outputBase: `0x${outputBase.toString(16)}` } : {}),
        },
      };
    });
  }

  /** nemu_vm_state_compare — diff native VM state vs expected (Python dump). */
  async handleVmStateCompare(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const ctxBase = argNumber(args, 'ctxBase');
      const tableBase = argNumber(args, 'tableBase');
      const outputBase = argNumber(args, 'outputBase');
      const expectedCtx = args.expectedCtx as string[] | undefined;
      const expectedTable = args.expectedTable as string[] | undefined;
      const expectedOutputHex = argString(args, 'expectedOutputHex');

      if (ctxBase === undefined || tableBase === undefined) {
        throw new Error('ctxBase and tableBase are required');
      }
      if (!expectedCtx || !Array.isArray(expectedCtx)) {
        throw new Error('expectedCtx array is required');
      }
      if (!expectedTable || !Array.isArray(expectedTable)) {
        throw new Error('expectedTable array is required');
      }

      const readU64 = (addr: number): bigint => {
        const bytes = session.emulator.readGuestMemory(addr, 8);
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
      };

      // Compare ctx
      const ctxDiffs: Array<{ index: number; native: string; expected: string }> = [];
      const ctxLimit = Math.min(expectedCtx.length, 32);
      for (let i = 0; i < ctxLimit; i++) {
        const native = readU64(ctxBase + i * 8);
        const expected = parseVal(expectedCtx[i]!);
        if (native !== expected) {
          ctxDiffs.push({ index: i, native: fmtHex(native), expected: fmtHex(expected) });
        }
      }

      // Compare table
      const tableDiffs: Array<{ index: number; native: string; expected: string }> = [];
      const tableLimit = Math.min(expectedTable.length, 32);
      for (let i = 0; i < tableLimit; i++) {
        const native = readU64(tableBase + i * 8);
        const expected = parseVal(expectedTable[i]!);
        if (native !== expected) {
          tableDiffs.push({ index: i, native: fmtHex(native), expected: fmtHex(expected) });
        }
      }

      // Compare output
      let outputMatch = true;
      let outputDiffHex = '';
      if (outputBase !== undefined && expectedOutputHex) {
        const expectedOut = expectedOutputHex.toUpperCase();
        const nativeOutBytes = session.emulator.readGuestMemory(
          outputBase,
          Math.ceil(expectedOut.length / 2),
        );
        const nativeOutHex = Buffer.from(nativeOutBytes).toString('hex').toUpperCase();
        if (nativeOutHex !== expectedOut) {
          outputMatch = false;
          // Find first differing position
          let diffPos = 0;
          const minLen = Math.min(nativeOutHex.length, expectedOut.length);
          while (diffPos < minLen && nativeOutHex[diffPos] === expectedOut[diffPos]) diffPos++;
          outputDiffHex = `first diff at byte ${Math.floor(diffPos / 2)}: native[${diffPos}]=${nativeOutHex[diffPos] ?? '?'} expected[${diffPos}]=${expectedOut[diffPos] ?? '?'}`;
        }
      }

      return {
        sessionId: session.id,
        ctxMatch: ctxDiffs.length === 0,
        tableMatch: tableDiffs.length === 0,
        outputMatch,
        ctxDiffs: ctxDiffs.slice(0, 20),
        tableDiffs: tableDiffs.slice(0, 20),
        ctxDiffCount: ctxDiffs.length,
        tableDiffCount: tableDiffs.length,
        ...(outputDiffHex ? { outputDiffHex } : {}),
      };
    });
  }

  // ── Memory management ──────────────────────────────────────────

  /** nemu_mem_map — map a guest memory region. */
  async handleMemMap(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      const size = argNumber(args, 'size');
      if (address === undefined || size === undefined || size <= 0) {
        throw new Error('address and positive size are required');
      }
      session.emulator.mapGuestMemory(address, size);
      return { sessionId: session.id, address: `0x${address.toString(16)}`, size };
    });
  }

  // ── Bytecode analysis ──────────────────────────────────────────

  /** nemu_bytecode_decode — decode a u32 LiteVM bytecode word. */
  async handleBytecodeDecode(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const word = argNumber(args, 'word');
      if (word === undefined) throw new Error('word (u32) is required');
      const w = word >>> 0; // treat as unsigned 32-bit
      const d = decodeLiteVmWord(w);

      // Group-specific fields
      const g3_sel = (w >>> 5) & 0xf;
      const g3_f1 = (w >>> 9) & 0x1f;
      const g3_f2 = (w >>> 14) & 0x1f;
      const g3_f3 = (w >>> 19) & 0x1f;
      const g4_lsr = (w >>> 9) & 0x1f;
      const g4_ctx4 = (w >>> 22) & 0x1f;
      const rawG5 = (w >>> 5) & 0x3fffff;
      const g5_imm = rawG5 < 0x200000 ? rawG5 : rawG5 - 0x400000;
      const g6_a1 = (w >>> 5) & 0x1f;
      const g6_sub = (w >>> 10) & 0x1f;
      const g7_operand = (w >>> 5) & 0x1f;
      const rawOff = (w >>> 10) & 0x1fff;
      const g7_offset = rawOff < 0x1000 ? rawOff : rawOff - 0x2000;

      return {
        word: `0x${w.toString(16).padStart(8, '0').toUpperCase()}`,
        group: d.group,
        sub: d.sub,
        a1: d.a1,
        imm: d.imm,
        fl: d.fl,
        ...(d.group === 3 ? { g3_sel, g3_f1, g3_f2, g3_f3 } : {}),
        ...(d.group === 4 ? { g4_lsr, g4_ctx4 } : {}),
        ...(d.group === 5 ? { g5_imm } : {}),
        ...(d.group === 6 ? { g6_a1, g6_sub } : {}),
        ...(d.group === 7 ? { g7_operand, g7_offset } : {}),
        valid: d.valid,
        handler: d.handler,
      };
    });
  }

  // ── Bytecode scanning ──────────────────────────────────────────

  /** nemu_bytecode_scan — scan guest memory for valid bytecode words. */
  async handleBytecodeScan(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const addr = argNumber(args, 'address');
      const count = Math.min(argNumber(args, 'count', 256), 4096);
      const format = argString(args, 'outputFormat', 'summary');
      if (addr === undefined) throw new Error('address is required');

      // Read u32 words from guest memory
      const bytes = session.emulator.readGuestMemory(addr, count * 4);
      const words: number[] = [];
      for (let i = 0; i < count && i * 4 + 4 <= bytes.length; i++) {
        words.push(
          (bytes[i * 4]! |
            (bytes[i * 4 + 1]! << 8) |
            (bytes[i * 4 + 2]! << 16) |
            (bytes[i * 4 + 3]! << 24)) >>>
            0,
        );
      }

      // Decode all (pick the shared fields; keep the legacy output shape)
      const decoded = words.map((w, i) => {
        const d = decodeLiteVmWord(w);
        return {
          index: i,
          offset: addr + i * 4,
          word: `0x${w.toString(16).padStart(8, '0').toUpperCase()}`,
          group: d.group,
          sub: d.sub,
          a1: d.a1,
          imm: d.imm,
          fl: d.fl,
          valid: d.valid,
          handler: d.handler,
        };
      });

      // Format output
      const validOps = decoded.filter((d) => d.valid);
      const byGroup: Record<string, number> = {};
      const allByGroup: Record<string, number> = {};
      for (const d of decoded) {
        const k = d.handler;
        allByGroup[k] = (allByGroup[k] || 0) + 1;
      }
      for (const d of validOps) {
        const k = d.handler;
        byGroup[k] = (byGroup[k] || 0) + 1;
      }

      let result: Record<string, unknown>;
      switch (format) {
        case 'list':
          result = { validOps, totalWords: decoded.length, validCount: validOps.length };
          break;
        case 'annotated':
          result = {
            words: decoded.map((d) => ({ ...d, tag: d.valid ? 'OP' : 'DATA' })),
            totalWords: decoded.length,
            validCount: validOps.length,
          };
          break;
        default: // summary
          result = {
            totalWords: decoded.length,
            validCount: validOps.length,
            dataCount: decoded.length - validOps.length,
            byGroup,
            allByGroup,
            firstValid: validOps.length > 0 ? validOps[0] : null,
            lastValid: validOps.length > 0 ? validOps[validOps.length - 1] : null,
            validIndices: validOps.map((d) => d.index),
          };
      }

      return { sessionId: session.id, address: `0x${addr.toString(16)}`, ...result };
    });
  }

  // ── Pointer chain walking ─────────────────────────────────────

  /** nemu_pointer_chain — walk a chain of pointers in guest memory. */
  async handlePointerChain(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const base = argNumber(args, 'base');
      const maxDepth = Math.min(argNumber(args, 'maxDepth', 5), 20);
      const offset = argNumber(args, 'offset', 0);
      const dataLen = Math.min(argNumber(args, 'dataLen', 32), 128);
      if (base === undefined) throw new Error('base address is required');

      const hops: Array<Record<string, unknown>> = [];
      let currentAddr = base;
      for (let i = 0; i < maxDepth; i++) {
        try {
          // Read the pointer at current address+offset
          const ptrBytes = session.emulator.readGuestMemory(currentAddr + offset, 8);
          const ptr = new DataView(ptrBytes.buffer, ptrBytes.byteOffset, 8).getBigUint64(0, true);
          if (ptr === 0n) {
            hops.push({
              hop: i,
              address: `0x${currentAddr.toString(16)}`,
              pointer: '0x0 (NULL)',
              data: '(end of chain)',
            });
            break;
          }
          // Read data at the target
          const targetAddr = Number(ptr);
          let dataHex = '';
          try {
            const dataBytes = session.emulator.readGuestMemory(targetAddr, dataLen);
            dataHex = Buffer.from(dataBytes).toString('hex').toUpperCase();
            if (dataHex.length > 64) dataHex = dataHex.slice(0, 64) + '...';
          } catch {
            dataHex = '(unmapped)';
          }
          hops.push({
            hop: i,
            address: `0x${currentAddr.toString(16)}`,
            offset: `+0x${offset.toString(16)}`,
            pointer: `0x${ptr.toString(16).toUpperCase()}`,
            target: `0x${targetAddr.toString(16)}`,
            data: dataHex,
          });
          currentAddr = targetAddr;
        } catch {
          hops.push({
            hop: i,
            address: `0x${currentAddr.toString(16)}`,
            pointer: '(unmapped)',
            data: '(unmapped)',
          });
          break;
        }
      }

      return {
        sessionId: session.id,
        base: `0x${base.toString(16)}`,
        maxDepth,
        hops,
        chainLength: hops.length,
      };
    });
  }

  // ── Structured data dump ───────────────────────────────────────

  /** nemu_data_dump — structured memory dump with auto-classification. */
  async handleDataDump(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const addr = argNumber(args, 'address');
      const count = Math.min(argNumber(args, 'count', 64), 256);
      const wordSize = argString(args, 'wordSize', 'u64') as 'u32' | 'u64';
      if (addr === undefined) throw new Error('address is required');

      const bytesPerWord = wordSize === 'u32' ? 4 : 8;
      const bytes = session.emulator.readGuestMemory(addr, count * bytesPerWord);

      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < count; i++) {
        const off = i * bytesPerWord;
        if (off + bytesPerWord > bytes.length) break;
        let val: bigint;
        let valHex: string;
        if (wordSize === 'u64') {
          val = new DataView(bytes.buffer, bytes.byteOffset + off, 8).getBigUint64(0, true);
          valHex = `0x${val.toString(16).toUpperCase().padStart(16, '0')}`;
        } else {
          val = BigInt(
            (bytes[off]! |
              (bytes[off + 1]! << 8) |
              (bytes[off + 2]! << 16) |
              (bytes[off + 3]! << 24)) >>>
              0,
          );
          valHex = `0x${val.toString(16).toUpperCase().padStart(8, '0')}`;
        }

        const addrStr = `0x${(addr + off).toString(16)}`;
        const row: Record<string, unknown> = { offset: addrStr, value: valHex };

        // Annotations for u32 mode
        if (wordSize === 'u32') {
          const w = Number(val);
          const op = decodeLiteVmWord(w);
          if (op.valid) row.tag = 'OP';
          else if (op.isAscii) row.tag = 'ASCII';
          else if (LITEVM_KNOWN_DATA.has(w >>> 0)) row.tag = 'BITMASK';
          else row.tag = 'DATA';
          row.decode = op;
        } else {
          // u64: try to classify
          const v = Number(val);
          if (v === 0) row.tag = 'NULL';
          else if (v >= 0x40000000 && v < 0xa0000000) {
            row.tag = 'PTR';
            try {
              const tgt = session.emulator.readGuestMemory(v, 16);
              row.pointsTo = Buffer.from(tgt).toString('hex').toUpperCase().slice(0, 32);
            } catch {
              row.pointsTo = '(unmapped)';
            }
          } else if (v >= 0x20 && v < 0x7f) row.tag = 'ASCII';
          else row.tag = 'DATA';
        }
        rows.push(row);
      }

      return {
        sessionId: session.id,
        address: `0x${addr.toString(16)}`,
        wordSize,
        count: rows.length,
        rows,
      };
    });
  }

  // ── Frame dump ─────────────────────────────────────────────────

  /** nemu_dump_frame — decode a CreateLitevm frame structure. */
  async handleDumpFrame(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const addr = argNumber(args, 'address');
      if (addr === undefined) throw new Error('address is required');

      const bytes = session.emulator.readGuestMemory(addr, 256);
      const readU64 = (off: number) =>
        new DataView(bytes.buffer, bytes.byteOffset + off, 8).getBigUint64(0, true);
      const readU32 = (off: number) =>
        (bytes[off]! |
          (bytes[off + 1]! << 8) |
          (bytes[off + 2]! << 16) |
          (bytes[off + 3]! << 24)) >>>
        0;
      return {
        sessionId: session.id,
        frameAddr: `0x${addr.toString(16)}`,
        fields: {
          chainPtr: fmt(readU64(0)),
          bytecodeLen: readU32(8),
          frameData: {
            x20_data: fmt(readU64(96)),
            w8_skipFlag: readU32(152),
            x27_context: fmt(readU64(16)),
          },
          raw: Buffer.from(bytes).toString('hex').toUpperCase(),
        },
      };
    });
  }

  // ── Batch patching ─────────────────────────────────────────────

  /** nemu_patch_apply — apply multiple memory patches at once. */
  async handlePatchApply(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const patches = args.patches as
        | Array<{ address: number; dataBase64: string; writeProtect?: boolean }>
        | undefined;
      if (!patches || !Array.isArray(patches) || patches.length === 0) {
        throw new Error('patches: non-empty array of {address, dataBase64} required');
      }
      const results: Array<{ address: string; bytes: number; protected?: boolean }> = [];
      for (const p of patches) {
        if (typeof p.address !== 'number' || typeof p.dataBase64 !== 'string') {
          throw new Error(`Invalid patch: ${JSON.stringify(p)}`);
        }
        const data = toUint8(Buffer.from(p.dataBase64, 'base64'));
        session.emulator.writeGuestMemory(p.address, data);
        if (p.writeProtect) session.emulator.engine.addWriteProtect(p.address, data.length);
        results.push({
          address: `0x${p.address.toString(16)}`,
          bytes: data.length,
          ...(p.writeProtect ? { protected: true } : {}),
        });
      }
      let codeInfo = null;
      if (argBool(args, 'codeProtect', false)) {
        codeInfo = session.emulator.protectCodeSection();
      }
      return {
        sessionId: session.id,
        patchesApplied: results.length,
        totalBytes: results.reduce((s, r) => s + r.bytes, 0),
        ...(codeInfo ? { codeProtect: codeInfo } : {}),
      };
    });
  }

  // ── Register save/restore ──────────────────────────────────────

  /** nemu_regs_save — snapshot current GPR values. */
  async handleRegsSave(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const name = argString(args, 'name');
      if (!name) throw new Error('snapshot name is required');
      const eng = session.emulator.engine;
      const snap: Record<string, bigint> = {};
      for (let i = 0; i <= 30; i++) {
        snap[`x${i}`] = eng['registerFile'].readGpr(i);
      }
      snap['sp'] = eng['registerFile'].sp;
      // Store in session-scoped map
      let sessionSnaps = this.regSnapshots.get(session.id);
      if (!sessionSnaps) {
        sessionSnaps = new Map();
        this.regSnapshots.set(session.id, sessionSnaps);
      }
      sessionSnaps.set(name, snap);
      return {
        sessionId: session.id,
        name,
        snapshotId: `${session.id}::${name}`,
        regCount: Object.keys(snap).length,
      };
    });
  }

  /** nemu_regs_restore — restore GPRs from a saved snapshot. */
  async handleRegsRestore(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const snapshotId = argString(args, 'snapshotId');
      if (!snapshotId) throw new Error('snapshotId is required');
      const regFilter = argStringArray(args, 'regs');
      // snapshotId format: "sessionId::name"
      const parts = snapshotId.split('::');
      const sessId = parts[0] ?? snapshotId;
      const snapName = parts[1] ?? snapshotId;
      const sessionSnaps = this.regSnapshots.get(sessId);
      if (!sessionSnaps) throw new Error(`No snapshots found for session ${sessId}`);
      const snap = sessionSnaps.get(snapName);
      if (!snap) throw new Error(`Snapshot "${snapName}" not found`);
      const eng = session.emulator.engine;
      const restored: string[] = [];
      for (const [reg, val] of Object.entries(snap)) {
        if (regFilter && !regFilter.includes(reg)) continue;
        if (reg === 'sp') {
          eng['registerFile'].sp = val;
        } else {
          const idx = parseInt(reg.slice(1), 10);
          if (!isNaN(idx) && idx >= 0 && idx <= 30) {
            eng['registerFile'].writeGpr(idx, val);
          }
        }
        restored.push(reg);
      }
      return { sessionId: session.id, snapshotId, restored, count: restored.length };
    });
  }

  // ── Memory scanning ────────────────────────────────────────────

  /** nemu_scan_memory — scan guest memory for a byte pattern. */
  async handleScanMemory(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const patternB64 = argStringRequired(args, 'pattern');
      const startAddr = argNumber(args, 'startAddr');
      const endAddr = argNumber(args, 'endAddr');
      const maxResults = Math.min(argNumber(args, 'maxResults', 100), 1000);
      if (startAddr === undefined || endAddr === undefined) {
        throw new Error('startAddr and endAddr are required');
      }
      const pattern = toUint8(Buffer.from(patternB64, 'base64'));
      if (pattern.length === 0) throw new Error('pattern must be non-empty');
      const addresses = session.emulator.scanMemory(pattern, startAddr, endAddr, maxResults);
      return {
        sessionId: session.id,
        patternLength: pattern.length,
        range: { startAddr: `0x${startAddr.toString(16)}`, endAddr: `0x${endAddr.toString(16)}` },
        matches: addresses.map((a) => `0x${a.toString(16)}`),
        count: addresses.length,
        truncated: addresses.length >= maxResults,
      };
    });
  }

  // ── Memory XOR ─────────────────────────────────────────────────

  /** nemu_xor_region — XOR a memory region with a single-byte key. */
  async handleXorRegion(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const address = argNumber(args, 'address');
      const key = argNumber(args, 'key');
      const length = argNumber(args, 'length');
      const dryRun = argBool(args, 'dryRun', true);
      if (address === undefined || key === undefined || length === undefined || length <= 0) {
        throw new Error('address, key, and positive length are required');
      }
      if (key < 0 || key > 255 || !Number.isInteger(key)) {
        throw new Error('key must be a byte value (0-255)');
      }
      const maxBytes = rawMemoryLimit(args);
      ensureRawMemorySize(length, maxBytes, 'xor region');
      const result = session.emulator.xorMemory(address, key, length, dryRun);
      const previewLen = Math.min(
        256,
        getReverseEngineeringConfig().nativeEmulator.rawMemoryPreviewBytes,
        result.length,
      );
      return {
        sessionId: session.id,
        address: `0x${address.toString(16)}`,
        key,
        length: result.length,
        dryRun,
        previewBase64: Buffer.from(result.subarray(0, previewLen)).toString('base64'),
        previewHex: Buffer.from(result.subarray(0, previewLen)).toString('hex').toUpperCase(),
        ...(result.length > previewLen
          ? { previewTruncated: true, previewLength: previewLen }
          : {}),
        dataBase64: Buffer.from(result).toString('base64'),
      };
    });
  }

  async handleRelay(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const action = argStringRequired(args, 'action');
      const sessionId = argString(args, 'sessionId', '');
      const host = argString(args, 'host', '127.0.0.1');
      const port = argNumber(args, 'port', 17171);
      const connectTimeoutMs = argNumber(args, 'connectTimeoutMs');
      const maxMessageBytes = argNumber(args, 'maxMessageBytes');

      const { getOrCreateRelay, removeRelay, getRelayStatus, listRelays } =
        await import('@src/native/ipc/IpcRelay');

      switch (action) {
        case 'connect': {
          if (!sessionId) throw new Error('sessionId is required for connect');
          const relay = getOrCreateRelay({
            sessionId,
            host,
            port,
            connectTimeoutMs,
            maxMessageBytes,
          });
          await relay.connect();
          return { connected: true, status: relay.status };
        }
        case 'disconnect': {
          if (!sessionId) throw new Error('sessionId is required for disconnect');
          const removed = removeRelay(sessionId);
          return { disconnected: removed, sessionId };
        }
        case 'status': {
          if (sessionId) {
            const status = getRelayStatus(sessionId);
            return status ?? { sessionId, connected: false, reason: 'not found' };
          }
          return { relays: listRelays() };
        }
        default:
          throw new Error(
            `nemu_relay: invalid action "${action}" — expected connect, disconnect, or status`,
          );
      }
    });
  }

  // ── GDBServer ────────────────────────────────────────────────────────
  //
  // Real GDB RSP TCP server that GDB/GEF/x64dbg clients can connect to.
  // The server dispatches commands to the emulator session in real-time:
  // register read/write, memory read/write, step, continue, breakpoints,
  // vCont extended operations, qXfer target description, feature negotiation.
  //
  // Packet format: $<data>#<checksum>
  // Checksum = sum of <data> bytes, mod 256, hex-encoded.
  //
  async handleGdbserver(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const action = argStringRequired(args, 'action');

      if (action === 'status') {
        const sessionId = argString(args, 'sessionId');
        if (sessionId) {
          const server = getGdbServer(sessionId);
          if (server) return server.status;
          // Also check global list for orphaned servers.
          const allServers = listGdbServers();
          const match = allServers.find((s) => s.sessionId === sessionId);
          if (match) return match;
        }
        return { running: false, servers: listGdbServers() };
      }

      if (action === 'stop') {
        const sessionId = argString(args, 'sessionId');
        if (sessionId) {
          const removed = removeGdbServer(sessionId);
          return { stopped: removed, sessionId };
        }
        // Stop all servers.
        const servers = listGdbServers();
        for (const s of servers) {
          removeGdbServer(s.sessionId);
        }
        return { stopped: true, count: servers.length };
      }

      if (action !== 'start') {
        throw new Error(
          `nemu_gdbserver: invalid action "${action}" — expected start, stop, or status`,
        );
      }

      // start — launch a real TCP GDB RSP server.
      const sessionId = argStringRequired(args, 'sessionId');
      const host = argString(args, 'host', '127.0.0.1');
      const port = argNumber(args, 'port', 1234);

      // Verify session exists.
      this.sessions.requireSession(sessionId);

      // Check for existing server on this session.
      const existing = getGdbServer(sessionId);
      if (existing?.running) {
        return existing.status;
      }

      // Create and start the server.
      const server = getOrCreateGdbServer(sessionId, {
        host,
        port,
        sessionId,
        getSession: (sid) => this.sessions.requireSession(sid),
      });

      await server.start();
      return server.status;
    });
  }

  /**
   * nemu_mem_inspect — convergence entry point for the guest-memory inspection
   * family. Validates the `action`-discriminated union (see ./handler-mem-inspect)
   * and delegates each subcommand to the wrapped tool's existing handler
   * unchanged: read → handleReadMemory, dump → handleDataDump,
   * chain → handlePointerChain, frame → handleDumpFrame, scan → handleScanMemory.
   * No family logic is duplicated here — the wrapped handlers stay authoritative.
   */
  async handleMemInspect(args: ToolArgs): Promise<ToolResponse> {
    const parsed = memInspectSchema.safeParse(args);
    if (!parsed.success) {
      return R.fail(
        new Error(
          `nemu_mem_inspect: invalid subcommand arguments — ${formatMemInspectIssues(parsed.error)}`,
        ),
      ).json();
    }
    return this.dispatchMemInspect(parsed.data);
  }

  /** Route a validated subcommand to its wrapped handler (exhaustive over the union). */
  private dispatchMemInspect(sub: MemInspectArgs): Promise<ToolResponse> {
    switch (sub.action) {
      case 'read':
        return this.handleReadMemory(sub);
      case 'dump':
        return this.handleDataDump(sub);
      case 'chain':
        return this.handlePointerChain(sub);
      case 'frame':
        return this.handleDumpFrame(sub);
      case 'scan':
        return this.handleScanMemory(sub);
    }
  }

  private requireSession(args: ToolArgs): EmulatorSession {
    return this.sessions.requireSession(argStringRequired(args, 'sessionId'));
  }
}

/** Parse a hex or decimal string into a BigInt (used by vm_state_load + vm_state_compare). */
function parseVal(v: string): bigint {
  const trimmed = v.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) return BigInt(trimmed);
  return BigInt(trimmed);
}

/** Format a BigInt as a 16-digit uppercase hex string (used by vm_state_compare + dump_frame). */
function fmtHex(v: bigint): string {
  return `0x${v.toString(16).toUpperCase().padStart(16, '0')}`;
}

/** Format a BigInt or number as a 16-digit uppercase hex string (used by dump_frame). */
function fmt(v: bigint | number): string {
  return `0x${BigInt(v).toString(16).toUpperCase().padStart(16, '0')}`;
}

/** Format a guest address as a lowercase 0x-hex string (matches trace rows). */
function hexAddr(n: number): string {
  return `0x${n.toString(16)}`;
}

/** Exact 3-decimal percentage: count / total × 100. */
function pct(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100000) / 1000;
}

// RSP helpers (decodeRspPacket, encodeRspPacket, parseRspFields, bytesToHex,
// hexToBytes, GDB_REG_NAMES) are now imported from @native/GdbRspProtocol.

/**
 * Exact decoded byte count of a base64 string, computed without allocating a
 * buffer. Mirrors `Buffer.from(encoded, 'base64').length` for well-formed
 * base64 (the shape produced by `Buffer#toString('base64')`).
 */
function base64DecodedLength(encoded: string): number {
  const len = encoded.length;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor(((len - padding) * 3) / 4);
}

function decodeBionicOptions(
  filesValue: unknown,
  extraSymbolsValue?: unknown,
): BionicOptions | undefined {
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  if (typeof filesValue === 'object' && filesValue !== null && !Array.isArray(filesValue)) {
    for (const [path, encoded] of Object.entries(filesValue)) {
      if (typeof encoded === 'string') {
        // Reject oversized payloads from their encoded length BEFORE decoding:
        // otherwise an attacker can submit N×16MB base64 blobs and force every
        // one to be allocated before the total-cap check throws.
        const decodedLength = base64DecodedLength(encoded);
        if (decodedLength > NEMU_VFS_MAX_FILE_BYTES) {
          throw new Error(
            `VFS file "${path}" is ${decodedLength} bytes, which exceeds the ${NEMU_VFS_MAX_FILE_BYTES}-byte per-file cap`,
          );
        }
        totalBytes += decodedLength;
        if (totalBytes > NEMU_VFS_MAX_TOTAL_BYTES) {
          throw new Error(
            `VFS files total ${totalBytes} bytes exceeds the ${NEMU_VFS_MAX_TOTAL_BYTES}-byte cap`,
          );
        }
        files.set(path, toUint8(Buffer.from(encoded, 'base64')));
      }
    }
  }
  const extraSymbols = new Map<string, number>();
  if (
    typeof extraSymbolsValue === 'object' &&
    extraSymbolsValue !== null &&
    !Array.isArray(extraSymbolsValue)
  ) {
    for (const [name, addr] of Object.entries(extraSymbolsValue)) {
      if (typeof addr === 'number') extraSymbols.set(name, addr);
    }
  }
  if (files.size === 0 && extraSymbols.size === 0) return undefined;
  const opts: BionicOptions = {};
  if (files.size > 0) opts.files = files;
  if (extraSymbols.size > 0) opts.extraSymbols = extraSymbols;
  return opts;
}
