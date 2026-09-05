import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';
import { FRIDA_TIMEOUT_MS } from '@src/constants';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { ToolError } from '@errors/ToolError';

const FRIDA_MAX_BUFFER_BYTES = 5 * 1024 * 1024;
/** Grace period between the SIGTERM and SIGKILL escalation on cancellation. */
const FRIDA_KILL_ESCALATION_MS = 1_500;

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export interface FridaScriptResult {
  output: string;
  error?: string;
}

export interface FridaModuleInfo {
  name: string;
  base: string;
  size: number;
  path: string;
}

export interface FridaFunctionInfo {
  name: string;
  address: string;
  size: number;
}

export interface FridaSymbolInfo {
  name: string;
  address: string;
  demangled?: string;
}

export interface FridaMemoryMatch {
  address: string;
  size: number;
}

export interface FridaMemoryRead {
  address: string;
  size: number;
  hex: string;
}

export interface MemoryScanOptions {
  moduleName?: string;
  address?: string;
  size?: number;
  max?: number;
  /**
   * Per-invocation CLI timeout in milliseconds. Defaults to FRIDA_TIMEOUT_MS
   * (15s). Task-mode callers pass a larger value so broad memory scans
   * survive past the interactive timeout (MCP 2.0 Tasks retrofit).
   */
  timeoutMs?: number;
  /** Aborted by task cancellation — kills the frida CLI child mid-scan. */
  signal?: AbortSignal;
}

export type FridaSessionMode = 'attach' | 'spawn';

export interface FridaSessionInfo {
  id: string;
  target: string;
  pid: number | null;
  status: 'attached' | 'detached' | 'error';
  mode: FridaSessionMode;
  resumed?: boolean;
}

interface FridaSessionRecord extends FridaSessionInfo {
  attachedAt: string;
  lastError?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export class FridaSession {
  private readonly sessions = new Map<string, FridaSessionRecord>();
  private activeSessionId?: string;
  private fridaProbe?: ProbeResult;
  private probePromise?: Promise<ProbeResult>;

  async attach(target: string): Promise<string> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new PrerequisiteError(availability.reason ?? 'Frida CLI is not available');
    }

    const probe = await this.runFridaCommand(target, 'console.log("__frida_attach_ok__");');
    if (probe.error) {
      throw new ToolError('CONNECTION', probe.error);
    }

    const sessionId = randomUUID();
    const record: FridaSessionRecord = {
      id: sessionId,
      target,
      pid: this.resolvePid(target),
      status: 'attached',
      mode: 'attach',
      attachedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, record);
    this.activeSessionId = sessionId;
    return sessionId;
  }

  async spawn(target: string): Promise<string> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new PrerequisiteError(availability.reason ?? 'Frida CLI is not available');
    }

    const probe = await this.runFridaCommandWithArgs(
      target,
      this.buildSpawnTargetArgs(target),
      'console.log("__frida_spawn_ok__");',
    );
    if (probe.error) {
      throw new ToolError('CONNECTION', probe.error);
    }

    const sessionId = randomUUID();
    const record: FridaSessionRecord = {
      id: sessionId,
      target,
      pid: null,
      status: 'attached',
      mode: 'spawn',
      resumed: false,
      attachedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, record);
    this.activeSessionId = sessionId;
    return sessionId;
  }

  async detach(): Promise<void> {
    const active = this.getActiveSessionRecord();
    if (!active) {
      return;
    }

    active.status = 'detached';
    this.activeSessionId = undefined;
  }

  async executeScript(
    script: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<FridaScriptResult> {
    const session = this.requireActiveSession();
    const result = await this.runFridaCommandForSession(
      session,
      script,
      options.timeoutMs,
      options.signal,
    );

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return result;
  }

  async resume(sessionId?: string): Promise<FridaScriptResult> {
    if (sessionId && !this.useSession(sessionId)) {
      throw new PrerequisiteError(`Unknown Frida session: ${sessionId}`);
    }

    const session = this.requireActiveSession();
    const result = await this.runFridaCommandForSession(
      session,
      [
        'const resume = Process.resume;',
        'if (typeof resume === "function") {',
        '  resume();',
        '  console.log("__frida_resume_ok__");',
        '} else {',
        '  console.log("__frida_resume_unavailable__");',
        '}',
      ].join('\n'),
    );

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    } else {
      session.resumed = true;
    }

    return result;
  }

  async enumerateModules(): Promise<FridaModuleInfo[]> {
    const session = this.requireActiveSession();
    const result = await this.runFridaCommandForSession(
      session,
      'console.log(JSON.stringify(Process.enumerateModules()));',
    );
    const parsed = this.parseModuleList(result.output);

    if (parsed.length > 0) {
      return parsed;
    }

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return [];
  }

  async enumerateFunctions(moduleName: string): Promise<FridaFunctionInfo[]> {
    const session = this.requireActiveSession();
    const safeModuleName = JSON.stringify(moduleName);
    const result = await this.runFridaCommandForSession(
      session,
      [
        `const entries = Process.getModuleByName(${safeModuleName}).enumerateExports()`,
        '.filter(function (entry) { return entry.type === "function"; })',
        '.map(function (entry) {',
        '  return { name: entry.name, address: String(entry.address), size: 0 };',
        '});',
        'console.log(JSON.stringify(entries));',
      ].join(''),
    );
    const parsed = this.parseFunctionList(result.output);

    if (parsed.length > 0) {
      return parsed;
    }

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return [];
  }

  async findSymbols(pattern: string): Promise<FridaSymbolInfo[]> {
    const session = this.requireActiveSession();
    const trimmedPattern = pattern.trim();
    const resolvedPattern = trimmedPattern.includes(':')
      ? trimmedPattern
      : trimmedPattern.includes('!')
        ? `exports:${trimmedPattern}`
        : `exports:*!${trimmedPattern}*`;
    const matchPattern = JSON.stringify(resolvedPattern);
    const result = await this.runFridaCommandForSession(
      session,
      [
        'const resolver = new ApiResolver("module");',
        `const matches = resolver.enumerateMatches(${matchPattern});`,
        'const mapped = matches.map(function (entry) {',
        '  const resolvedName = typeof entry.name === "string" ? entry.name : "unknown";',
        '  const resolvedAddress = entry.address ? String(entry.address) : "0x0";',
        '  return { name: resolvedName, address: resolvedAddress, demangled: resolvedName };',
        '});',
        'console.log(JSON.stringify(mapped));',
      ].join(''),
    );
    const parsed = this.parseSymbolList(result.output);

    if (parsed.length > 0) {
      return parsed;
    }

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return [];
  }

  async memoryScan(pattern: string, options: MemoryScanOptions = {}): Promise<FridaMemoryMatch[]> {
    const session = this.requireActiveSession();
    const trimmedPattern = pattern.trim();
    if (trimmedPattern.length === 0) {
      return [];
    }
    const safePattern = JSON.stringify(trimmedPattern);
    const max = Math.max(1, Math.min(options.max ?? 1000, 10000));

    // Determine scan ranges: explicit address+size wins, then a named module,
    // else all readable ranges (broad memory search). scanSync is synchronous
    // and throws on unreadable ranges, so each range is independently guarded.
    const rangeSetup: string[] = [];
    if (options.address && typeof options.size === 'number' && options.size > 0) {
      const addr = JSON.stringify(options.address);
      const sz = Math.min(options.size, 64 * 1024 * 1024);
      rangeSetup.push(`var ranges = [{ base: ptr(${addr}), size: ${sz} }];`);
    } else if (options.moduleName) {
      const mod = JSON.stringify(options.moduleName);
      rangeSetup.push(
        `var mod = Process.getModuleByName(${mod});`,
        'var ranges = [{ base: mod.base, size: mod.size }];',
      );
    } else {
      rangeSetup.push(
        `var ranges = Process.enumerateRanges({ protection: 'r--', coalesce: false });`,
      );
    }

    const result = await this.runFridaCommandForSession(
      session,
      [
        ...rangeSetup,
        'var results = [];',
        `var max = ${max};`,
        'for (var i = 0; i < ranges.length && results.length < max; i++) {',
        '  try {',
        `    Memory.scanSync(ranges[i].base, ranges[i].size, ${safePattern}).forEach(function (m) {`,
        '      if (results.length < max) results.push({ address: String(m.address), size: m.size });',
        '    });',
        '  } catch (e) { /* range not readable, skip */ }',
        '}',
        'console.log(JSON.stringify(results));',
      ].join('\n'),
      options.timeoutMs,
      options.signal,
    );
    const parsed = this.parseMemoryMatchList(result.output);

    if (parsed.length > 0) {
      return parsed;
    }

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return [];
  }

  async memoryRead(address: string, size: number): Promise<FridaMemoryRead> {
    const session = this.requireActiveSession();
    const trimmedAddress = address.trim();
    const safeAddr = JSON.stringify(trimmedAddress);
    const safeSize = Math.max(1, Math.min(size, 65536)); // cap 64KB per read

    const result = await this.runFridaCommandForSession(
      session,
      [
        `var buf = ptr(${safeAddr}).readByteArray(${safeSize});`,
        'var view = new Uint8Array(buf);',
        'var hex = "";',
        'for (var i = 0; i < view.length; i++) {',
        '  hex += ("00" + view[i].toString(16)).slice(-2);',
        '}',
        `console.log(JSON.stringify({ address: ${safeAddr}, size: ${safeSize}, hex: hex }));`,
      ].join('\n'),
    );
    const parsed = this.parseMemoryReadResult(result.output, trimmedAddress, safeSize);

    if (parsed) {
      return parsed;
    }

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return { address: trimmedAddress, size: safeSize, hex: '' };
  }

  listSessions(): FridaSessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      target: session.target,
      pid: session.pid,
      status: session.status,
      mode: session.mode,
      resumed: session.resumed,
    }));
  }

  async isAvailable(): Promise<boolean> {
    const availability = await this.getAvailability();
    return availability.available;
  }

  async getAvailability(): Promise<ProbeResult> {
    if (this.fridaProbe) {
      return this.fridaProbe;
    }

    if (!this.probePromise) {
      this.probePromise = probeCommand('frida');
    }

    const resolved = await this.probePromise;
    this.fridaProbe = resolved;
    this.probePromise = undefined;
    return resolved;
  }

  useSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) {
      return false;
    }

    this.activeSessionId = sessionId;
    return true;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessionDiagnostics(
    sessionId: string,
  ): { status: FridaSessionInfo['status']; lastError?: string } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      status: session.status,
      lastError: session.lastError,
    };
  }

  private getActiveSessionRecord(): FridaSessionRecord | undefined {
    if (!this.activeSessionId) {
      return undefined;
    }

    return this.sessions.get(this.activeSessionId);
  }

  private requireActiveSession(): FridaSessionRecord {
    const session = this.getActiveSessionRecord();
    if (!session) {
      throw new PrerequisiteError('No active Frida session. Call attach() first.');
    }

    return session;
  }

  private resolvePid(target: string): number | null {
    if (!/^\d+$/.test(target)) {
      return null;
    }

    const parsed = Number.parseInt(target, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private async runFridaCommand(target: string, script: string): Promise<FridaScriptResult> {
    return this.runFridaCommandWithArgs(target, this.buildTargetArgs(target), script);
  }

  private async runFridaCommandForSession(
    session: FridaSessionRecord,
    script: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<FridaScriptResult> {
    const targetArgs =
      session.mode === 'spawn' && session.resumed !== true
        ? this.buildSpawnTargetArgs(session.target)
        : this.buildTargetArgs(session.target);
    return this.runFridaCommandWithArgs(session.target, targetArgs, script, timeoutMs, signal);
  }

  private async runFridaCommandWithArgs(
    target: string,
    targetArgs: string[],
    script: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<FridaScriptResult> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      return {
        output: '',
        error: availability.reason ?? 'Frida CLI is not available',
      };
    }

    const command = availability.path ?? 'frida';
    const args = [...targetArgs, '--runtime=v8', '-q', '-e', script];

    try {
      const result = await this.execFileUtf8(command, args, timeoutMs ?? FRIDA_TIMEOUT_MS, signal);
      const output = result.stdout.trim();
      const error = result.stderr.trim();
      return error ? { output, error } : { output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[binary-instrument] Frida command failed', { target, message });
      return {
        output: '',
        error: message,
      };
    }
  }

  private buildSpawnTargetArgs(target: string): string[] {
    return ['-f', target];
  }

  private buildTargetArgs(target: string): string[] {
    if (/^\d+$/.test(target)) {
      return ['-p', target];
    }

    if (target.includes('/') || target.includes('\\')) {
      return ['-f', target];
    }

    return ['-n', target];
  }

  private parseModuleList(output: string): FridaModuleInfo[] {
    const data = this.extractJsonData(output);
    if (!Array.isArray(data)) {
      return [];
    }

    const modules: FridaModuleInfo[] = [];
    for (const entry of data) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const name = this.readStringField(entry, 'name');
      const path = this.readStringField(entry, 'path');
      const base = this.normalizeHex(entry['base']);
      const size = this.readNumberField(entry, 'size');

      if (!name || !path || !base || size === undefined) {
        continue;
      }

      modules.push({ name, base, size, path });
    }

    return modules;
  }

  private parseFunctionList(output: string): FridaFunctionInfo[] {
    const data = this.extractJsonData(output);
    if (!Array.isArray(data)) {
      return [];
    }

    const functions: FridaFunctionInfo[] = [];
    for (const entry of data) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const name = this.readStringField(entry, 'name');
      const address = this.normalizeHex(entry['address']);
      const size = this.readNumberField(entry, 'size') ?? 0;

      if (!name || !address) {
        continue;
      }

      functions.push({ name, address, size });
    }

    return functions;
  }

  private parseSymbolList(output: string): FridaSymbolInfo[] {
    const data = this.extractJsonData(output);
    if (!Array.isArray(data)) {
      return [];
    }

    const symbols: FridaSymbolInfo[] = [];
    for (const entry of data) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const name = this.readStringField(entry, 'name');
      const address = this.normalizeHex(entry['address']);
      const demangled = this.readStringField(entry, 'demangled');

      if (!name || !address) {
        continue;
      }

      if (demangled) {
        symbols.push({ name, address, demangled });
      } else {
        symbols.push({ name, address });
      }
    }

    return symbols;
  }

  private parseMemoryMatchList(output: string): FridaMemoryMatch[] {
    const data = this.extractJsonData(output);
    if (!Array.isArray(data)) {
      return [];
    }

    const matches: FridaMemoryMatch[] = [];
    for (const entry of data) {
      if (!this.isRecord(entry)) {
        continue;
      }
      const address = this.normalizeHex(entry['address']);
      const size = this.readNumberField(entry, 'size') ?? 0;
      if (!address) {
        continue;
      }
      matches.push({ address, size });
    }

    return matches;
  }

  private parseMemoryReadResult(
    output: string,
    fallbackAddress: string,
    fallbackSize: number,
  ): FridaMemoryRead | undefined {
    const data = this.extractJsonData(output);
    if (!this.isRecord(data)) {
      return undefined;
    }

    const hex = this.readStringField(data, 'hex');
    if (hex === undefined) {
      return undefined;
    }

    const address = this.normalizeHex(data['address']) ?? fallbackAddress;
    const size = this.readNumberField(data, 'size') ?? fallbackSize;
    return { address, size, hex };
  }

  private extractJsonData(output: string): unknown {
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') || line.startsWith('['))
      .toReversed();

    for (const line of candidates) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private readStringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readNumberField(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private normalizeHex(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `0x${value.toString(16)}`;
    }

    if (typeof value === 'string' && value.length > 0) {
      return value.startsWith('0x') ? value : `0x${value}`;
    }

    return undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private execFileUtf8(
    file: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // The task may already be cancelled between the caller's check and
      // this spawn (TaskManager awaits, availability probes) — never start
      // work for an aborted task.
      if (signal?.aborted) {
        reject(abortError('Frida command aborted before spawn'));
        return;
      }

      let escalationTimer: ReturnType<typeof setTimeout> | undefined;

      const child = execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: FRIDA_MAX_BUFFER_BYTES,
          encoding: 'utf8',
          // POSIX: lead a new process group so cancellation can signal the
          // whole tree — in spawn mode the instrumented target is a
          // grandchild of the frida CLI. ExecFileOptions omits `detached`;
          // execFile forwards spawn options at runtime, hence the spread.
          ...(process.platform !== 'win32' ? { detached: true as const } : {}),
        },
        (error, stdout, stderr) => {
          signal?.removeEventListener('abort', onAbort);
          if (escalationTimer) {
            clearTimeout(escalationTimer);
          }
          if (error) {
            reject(error);
            return;
          }

          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
          });
        },
      );

      // Task cancellation must actually stop the CLI child — otherwise a
      // cancelled frida scan keeps burning CPU on the target for minutes.
      // Kill the whole tree (Windows: taskkill /T; POSIX: process-group
      // signal — the child was spawned detached) and escalate to SIGKILL
      // so a frida CLI that swallows SIGTERM cannot outlive cancellation.
      // All spawns here use argv arrays without a shell; PIDs come from
      // our own child process, never from user input.
      function onAbort() {
        if (child.pid === undefined) {
          return;
        }
        if (process.platform === 'win32') {
          execFile(
            'taskkill',
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true },
            () => {},
          );
          return;
        }
        const pid = child.pid;
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        escalationTimer = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }, FRIDA_KILL_ESCALATION_MS);
        escalationTimer.unref();
      }

      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}
