import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';
import { FRIDA_TIMEOUT_MS } from '@src/constants';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { ToolError } from '@errors/ToolError';

const FRIDA_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

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
    options: { timeoutMs?: number } = {},
  ): Promise<FridaScriptResult> {
    const session = this.requireActiveSession();
    const result = await this.runFridaCommandForSession(session, script, options.timeoutMs);

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
  ): Promise<FridaScriptResult> {
    const targetArgs =
      session.mode === 'spawn' && session.resumed !== true
        ? this.buildSpawnTargetArgs(session.target)
        : this.buildTargetArgs(session.target);
    return this.runFridaCommandWithArgs(session.target, targetArgs, script, timeoutMs);
  }

  private async runFridaCommandWithArgs(
    target: string,
    targetArgs: string[],
    script: string,
    timeoutMs?: number,
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
      const result = await this.execFileUtf8(command, args, timeoutMs ?? FRIDA_TIMEOUT_MS);
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

  private execFileUtf8(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: FRIDA_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
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
    });
  }
}
