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
import type { JavaMethodCall } from '@modules/native-emulator/jni';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import {
  argBool,
  argNumber,
  argNumberArray,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import type { ToolArgs, ToolResponse } from '@server/types';

/** Cap on instruction-trace events returned, regardless of requested maxSteps. */
const TRACE_HARD_CAP = 100_000;

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
        'pt-dynamic-symbols',
        'auto-wire-bionic-libc',
        'bionic-stdio-vfs',
        'android-syscalls',
        'getrandom',
        'system-register-read',
        'exclusive-load-store',
        'simd-fp-load-store',
        'aes-crypto',
        'sha1-crypto',
        'sha256-crypto',
        'pmull-ghash',
        'scalar-fp',
        'neon-integer-simd',
        'call-exported-symbol',
        'call-jni-export',
        'java-mock-callback',
        'java-mock-field',
        'apk-arm64-extract',
        'instruction-trace',
      ],
      isa: 'aarch64-integer+neon+crypto+fp',
      activeSessions: this.sessions.count(),
      note: 'In-process AArch64 interpreter: integer ISA + SIMD/FP load-store + AES/SHA/PMULL crypto-extension (bit-exact vs FIPS-197/180-4/180-1) + scalar IEEE-754 floating-point (FADD/FMUL/FDIV/FSQRT/FCVT/FCMP/FCSEL, float32 via fround) + NEON integer-lane SIMD (three-same ADD/SUB/MUL/logical/compare/min-max, two-register-misc, DUP, MOVI/MVNI, shift-by-immediate, across-lanes reductions, ZIP/UZP/TRN, EXT, TBL/TBX). The long/widening and saturating NEON variants (e.g. SQADD, SADDL) are not yet emulated, so a `.so` relying on those will hit an unsupported opcode (reported with the raw opcode). libapp.so (Flutter Dart AOT) is not executable here.',
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

  handleLoadLibrary(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const soPath = argStringRequired(args, 'soPath');
      const bytes = await readFile(soPath);
      const { entry } = session.emulator.loadLibrary(toUint8(bytes));
      return {
        sessionId: session.id,
        soPath,
        entry,
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
      const { entry } = session.emulator.loadLibrary(lib.bytes);
      return {
        sessionId: session.id,
        apkPath,
        libName,
        entry,
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
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const symbol = argStringRequired(args, 'symbol');
      const callArgs = argNumberArray(args, 'args');
      const result = session.emulator.call(symbol, callArgs);
      return { sessionId: session.id, symbol, result };
    });
  }

  handleCallJniExport(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const session = this.requireSession(args);
      const symbol = argStringRequired(args, 'symbol');
      const javaArgs = argNumberArray(args, 'javaArgs');
      const thiz = argNumber(args, 'thiz', 0);
      const result = session.emulator.callJniExport(symbol, javaArgs, thiz);
      return { sessionId: session.id, symbol, result };
    });
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

      const events: Array<Record<string, unknown>> = [];
      let truncated = false;
      const unsubscribe = session.emulator.engine.addInstructionHook((ev: TraceEvent) => {
        if (events.length >= maxSteps) {
          truncated = true;
          return;
        }
        events.push(traceRow(ev, captureRegisters));
      });
      try {
        const result = session.emulator.call(symbol, callArgs);
        return {
          sessionId: session.id,
          symbol,
          result,
          steps: events.length,
          truncated,
          trace: events,
        };
      } finally {
        unsubscribe();
      }
    });
  }

  /** Forwarded by the graceful-shutdown closables list. Idempotent. */
  dispose(): void {
    this.sessions.dispose();
  }

  private requireSession(args: ToolArgs): EmulatorSession {
    return this.sessions.requireSession(argStringRequired(args, 'sessionId'));
  }
}

/** Convert a Node Buffer/Uint8Array view to a tight Uint8Array. */
function toUint8(buf: Uint8Array): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Build a trace row: pc/opcode/step, plus any requested register snapshots. */
function traceRow(ev: TraceEvent, captureRegisters: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {
    step: ev.step,
    pc: `0x${ev.pc.toString(16)}`,
    insn: `0x${ev.insn.toString(16).padStart(8, '0')}`,
  };
  if (captureRegisters.length > 0) {
    const regs: Record<string, number> = {};
    for (const name of captureRegisters) regs[name] = ev.reg(name);
    row.registers = regs;
  }
  return row;
}

/** Declarative Java-mock return — never evaluates caller code. */
interface JavaMockImpl {
  kind: 'int' | 'string' | 'bytes' | 'void';
  fn: (call: JavaMethodCall) => bigint | number | void;
}

/**
 * Resolve a declarative return spec into a JavaMethodImpl. Exactly one of
 * returnInt/returnString/returnBytes selects the value the mock hands back; with
 * none set the method returns void (0/null on the JNI side).
 */
function buildJavaMockImpl(args: ToolArgs): JavaMockImpl {
  const returnInt = argNumber(args, 'returnInt');
  const returnString = argString(args, 'returnString');
  const returnBytes = argString(args, 'returnBytes');

  if (returnInt !== undefined) {
    return { kind: 'int', fn: () => BigInt(Math.trunc(returnInt)) };
  }
  if (returnString !== undefined) {
    return {
      kind: 'string',
      fn: (call) => BigInt(call.jni.allocHandle({ kind: 'string', value: returnString })),
    };
  }
  if (returnBytes !== undefined) {
    const bytes = toUint8(Buffer.from(returnBytes, 'base64'));
    return {
      kind: 'bytes',
      fn: (call) => BigInt(call.jni.allocHandle({ kind: 'bytes', value: bytes })),
    };
  }
  return { kind: 'void', fn: () => undefined };
}

/** A resolved mock-field value: a primitive int, or a handle to a string/bytes object. */
interface JavaFieldValue {
  kind: 'int' | 'string' | 'bytes';
  value: bigint;
}

/**
 * Resolve a declarative field spec into the bigint the JNI Get<Type>Field returns.
 * valueInt is the primitive; valueString/valueBytes are allocated as handles in
 * the session's JNI object table (so Get*Field returns a jstring/jbyteArray).
 */
function buildJavaFieldValue(session: EmulatorSession, args: ToolArgs): JavaFieldValue {
  const valueInt = argNumber(args, 'valueInt');
  const valueString = argString(args, 'valueString');
  const valueBytes = argString(args, 'valueBytes');

  if (valueInt !== undefined) {
    return { kind: 'int', value: BigInt(Math.trunc(valueInt)) };
  }
  if (valueString !== undefined) {
    const handle = session.emulator.jni.allocHandle({ kind: 'string', value: valueString });
    return { kind: 'string', value: BigInt(handle) };
  }
  if (valueBytes !== undefined) {
    const bytes = toUint8(Buffer.from(valueBytes, 'base64'));
    const handle = session.emulator.newByteArray(bytes);
    return { kind: 'bytes', value: BigInt(handle) };
  }
  return { kind: 'int', value: 0n };
}
