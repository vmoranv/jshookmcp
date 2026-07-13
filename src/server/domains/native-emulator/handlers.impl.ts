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
import { readFile } from 'node:fs/promises';

import { SessionManager, type EmulatorSession } from '@modules/native-emulator/SessionManager';
import { extractArm64Libs } from '@modules/native-emulator/apk';
import { inspectElfImports } from '@modules/native-emulator/import-inspector';
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
import { nativeCallFailure, nativeDiagnostics } from './handler-call';
import { formatOpcodeInput, parseOpcodeInput, parseProgramCounter } from './handler-disasm';
import { buildJavaFieldValue, buildJavaMockImpl } from './handler-java';
import { ensureRawMemorySize, rawMemoryLimit, toUint8 } from './handler-memory';
import { persistTraceArtifact, traceRow } from './handler-trace';

/** Cap on instruction-trace events returned, regardless of requested maxSteps. */
const TRACE_HARD_CAP = 100_000;
const DISASM_ARCHITECTURES = new Set(SUPPORTED_DISASSEMBLY_ARCHITECTURES);

export class NativeEmulatorHandlers {
  private readonly sessions: SessionManager;

  constructor(sessions?: SessionManager) {
    this.sessions = sessions ?? new SessionManager();
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
      const session = this.sessions.createSession(installSyscalls ? {} : { syscalls: false });
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
        activeSessions: this.sessions.count(),
      };
    });
  }

  handleDestroySession(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const sessionId = argStringRequired(args, 'sessionId');
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
      const bytes = await readFile(soPath);
      const loaded = session.emulator.loadLibrary(toUint8(bytes));
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

      // Read all dependency bytes
      const depBytes: Uint8Array[] = [];
      for (const depPath of dependencyPaths) {
        const bytes = await readFile(depPath);
        depBytes.push(toUint8(bytes));
      }

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
      const libs = await extractArm64Libs(apkPath);
      return {
        apkPath,
        abi: 'arm64-v8a',
        libs: libs.map((l) => ({ name: l.name, bytes: l.bytes.length })),
        count: libs.length,
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

  handleLoadApkLibrary(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const apkPath = argStringRequired(args, 'apkPath');
      const libName = argStringRequired(args, 'libName');
      const libs = await extractArm64Libs(apkPath);
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
    return this.handleNativeCall(args, 'call_symbol', (session, symbol) => {
      const callArgs = argNumberArray(args, 'args');
      return session.emulator.call(symbol, callArgs);
    });
  }

  handleCallJniExport(args: ToolArgs): Promise<ToolResponse> {
    return this.handleNativeCall(args, 'call_jni_export', (session, symbol) => {
      const javaArgs = argNumberArray(args, 'javaArgs');
      const thiz = argNumber(args, 'thiz', 0);
      return session.emulator.callJniExport(symbol, javaArgs, thiz);
    });
  }

  private async handleNativeCall(
    args: ToolArgs,
    phase: 'call_symbol' | 'call_jni_export',
    invoke: (session: EmulatorSession, symbol: string) => number,
  ): Promise<ToolResponse> {
    let session: EmulatorSession | undefined;
    let symbol = '';
    try {
      session = this.requireSession(args);
      symbol = argStringRequired(args, 'symbol');
      const result = invoke(session, symbol);
      return R.ok()
        .merge({
          sessionId: session.id,
          symbol,
          result,
          diagnostics: nativeDiagnostics(session),
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

  handleTrace(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const symbol = argStringRequired(args, 'symbol');
      const callArgs = argNumberArray(args, 'args');
      const captureRegisters = argStringArray(args, 'captureRegisters');
      const maxSteps = Math.min(argNumber(args, 'maxSteps', 1000), TRACE_HARD_CAP);
      const persistArtifact = argBool(args, 'persistArtifact', false);
      const inlineLimitArg = argNumber(args, 'traceInlineLimit');

      const events: Array<Record<string, unknown>> = [];
      let truncated = false;
      const unsubscribe = session.emulator.engine.addInstructionHook((ev) => {
        if (events.length >= maxSteps) {
          truncated = true;
          return;
        }
        events.push(traceRow(ev, captureRegisters));
      });
      try {
        const result = session.emulator.call(symbol, callArgs);
        const traceInlineLimit =
          inlineLimitArg === undefined
            ? events.length
            : Math.max(0, Math.min(Math.trunc(inlineLimitArg), events.length));
        const traceArtifact = persistArtifact
          ? await persistTraceArtifact(session.id, symbol, result, events, truncated)
          : undefined;
        return {
          sessionId: session.id,
          symbol,
          result,
          steps: events.length,
          truncated,
          traceInlineLimit,
          ...(traceArtifact ? { traceArtifact } : {}),
          trace: events.slice(0, traceInlineLimit),
        };
      } finally {
        unsubscribe();
      }
    });
  }

  handleDisassemble(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const architecture = argEnum(args, 'architecture', DISASM_ARCHITECTURES, 'arm64');
      const opcode = parseOpcodeInput(args['opcode']);
      const pc = parseProgramCounter(argString(args, 'pc', '0x0'));
      const asm = disassembleInstruction(architecture, opcode, pc);
      return {
        architecture,
        normalizedArchitecture: normalizeDisasmArchitecture(architecture),
        opcode: formatOpcodeInput(opcode),
        pc: `0x${pc.toString(16)}`,
        asm,
      };
    });
  }

  /** Forwarded by the graceful-shutdown closables list. Idempotent. */
  dispose(): void {
    this.sessions.dispose();
  }

  // ── Guest memory management ──────────────────────────────────────────

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

  handleWriteMemory(args: ToolArgs): Promise<ToolResponse> {
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

  private requireSession(args: ToolArgs): EmulatorSession {
    return this.sessions.requireSession(argStringRequired(args, 'sessionId'));
  }
}
