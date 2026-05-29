/**
 * SessionManager — concurrency-safe lifecycle for native-emulator sessions.
 *
 * Each MCP tool call that needs emulator state gets its own NativeEmulator,
 * keyed by a session id. Because a NativeEmulator owns mutable CPU registers,
 * a guest stack, and a JNI object table, sharing one instance across concurrent
 * AI tool calls would let them overwrite each other's state — the production bug
 * this manager exists to prevent. Distinct sessions are fully isolated; within a
 * single session, CpuEngine.callSymbol runs synchronously (no await in its fetch
 * loop), so even interleaved async handler calls on the same session cannot tear
 * register state mid-instruction.
 *
 * Sessions also expire: an AI that forgets to destroy a session would otherwise
 * leak tens of MB (mapped .so bytes + stack + JNI tables) per orphan. An idle
 * sweep, modelled on AutoPruner's unref'd interval, reaps sessions untouched for
 * longer than the TTL. dispose() (wired into the server's graceful shutdown)
 * stops the timer and drops every session.
 */
import { randomUUID } from 'node:crypto';

import { NEMU_SESSION_IDLE_TTL_MS, NEMU_SESSION_SWEEP_MS, NEMU_MAX_SESSIONS } from '@src/constants';
import { NativeEmulator, type NativeEmulatorOptions } from './NativeEmulator';
import type { AndroidSyscallOptions } from './syscalls';

/** A live emulator session: its id, the isolated emulator, and usage timestamps. */
export interface EmulatorSession {
  readonly id: string;
  readonly emulator: NativeEmulator;
  readonly createdAt: number;
  lastUsedAt: number;
}

/** Session metadata exposed to callers (never leaks the emulator instance). */
export interface SessionInfo {
  id: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface SessionManagerOptions {
  /** Idle threshold before an untouched session is swept (ms). */
  idleTtlMs?: number;
  /** Sweep interval (ms). */
  sweepIntervalMs?: number;
  /** Options applied to every new NativeEmulator. */
  emulatorOptions?: NativeEmulatorOptions;
  /** Max concurrent sessions; createSession throws once exceeded. */
  maxSessions?: number;
}

/** Per-session emulator options (e.g. opt out of the Android syscall table). */
export interface CreateSessionOptions {
  syscalls?: AndroidSyscallOptions | false;
}

export class SessionManager {
  private readonly sessions = new Map<string, EmulatorSession>();
  private readonly idleTtlMs: number;
  private readonly sweepIntervalMs: number;
  private readonly maxSessions: number;
  private readonly emulatorOptions: NativeEmulatorOptions;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? NEMU_SESSION_IDLE_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? NEMU_SESSION_SWEEP_MS;
    this.maxSessions = options.maxSessions ?? NEMU_MAX_SESSIONS;
    this.emulatorOptions = options.emulatorOptions ?? {};
    this.startSweep();
  }

  /**
   * Create an isolated emulator session. Per-call `syscalls` overrides the
   * manager-wide emulator options. Throws once `maxSessions` is reached so a
   * runaway caller can't exhaust memory.
   */
  createSession(options: CreateSessionOptions = {}): EmulatorSession {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `Emulator session limit reached (${this.maxSessions}); destroy an existing session first`,
      );
    }
    const emulatorOptions: NativeEmulatorOptions =
      options.syscalls === undefined
        ? this.emulatorOptions
        : { ...this.emulatorOptions, syscalls: options.syscalls };
    const now = Date.now();
    const session: EmulatorSession = {
      id: randomUUID(),
      emulator: new NativeEmulator(emulatorOptions),
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Look up a session, refreshing its lastUsedAt; undefined when unknown. */
  getSession(id: string): EmulatorSession | undefined {
    const session = this.sessions.get(id);
    if (session) session.lastUsedAt = Date.now();
    return session;
  }

  /** Look up a session, refreshing its lastUsedAt; throws when unknown. */
  requireSession(id: string): EmulatorSession {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Unknown emulator session: ${id}`);
    }
    return session;
  }

  /** Destroy a session; returns whether it existed. */
  destroySession(id: string): boolean {
    return this.sessions.delete(id);
  }

  /** List session metadata without exposing the underlying emulators. */
  listSessions(): SessionInfo[] {
    const infos: SessionInfo[] = [];
    for (const s of this.sessions.values()) {
      infos.push({ id: s.id, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt });
    }
    return infos;
  }

  /** Current live session count. */
  count(): number {
    return this.sessions.size;
  }

  /** Stop the sweep timer and drop every session. Idempotent. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.sessions.clear();
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // Don't keep the event loop (and thus the process) alive for the sweep.
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /** Reap sessions whose last use is older than the idle TTL. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsedAt >= this.idleTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
