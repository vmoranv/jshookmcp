import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';

const FRIDA_TIMEOUT_MS = 15_000;
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

export interface FridaSessionInfo {
  id: string;
  target: string;
  pid: number | null;
  status: 'attached' | 'detached' | 'error';
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
      throw new Error(availability.reason ?? 'Frida CLI is not available');
    }

    const sessionId = randomUUID();
    const record: FridaSessionRecord = {
      id: sessionId,
      target,
      pid: this.resolvePid(target),
      status: 'attached',
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

  async executeScript(script: string): Promise<FridaScriptResult> {
    const session = this.requireActiveSession();
    const result = await this.runFridaCommand(session.target, script);

    if (result.error) {
      session.status = 'error';
      session.lastError = result.error;
    }

    return result;
  }

  async enumerateModules(): Promise<FridaModuleInfo[]> {
    const session = this.requireActiveSession();
    const result = await this.runFridaCommand(
      session.target,
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

    return [this.createFallbackModule(session.target)];
  }

  async enumerateFunctions(moduleName: string): Promise<FridaFunctionInfo[]> {
    const session = this.requireActiveSession();
    const safeModuleName = JSON.stringify(moduleName);
    const result = await this.runFridaCommand(
      session.target,
      [
        `const entries = Module.enumerateExportsSync(${safeModuleName})`,
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

    return [
      {
        name: `${moduleName}!<unknown>`,
        address: '0x0',
        size: 0,
      },
    ];
  }

  async findSymbols(pattern: string): Promise<FridaSymbolInfo[]> {
    const session = this.requireActiveSession();
    const matchPattern = JSON.stringify(`exports:!*${pattern}*`);
    const result = await this.runFridaCommand(
      session.target,
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

    return [
      {
        name: pattern,
        address: '0x0',
        demangled: pattern,
      },
    ];
  }

  listSessions(): FridaSessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      target: session.target,
      pid: session.pid,
      status: session.status,
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

  private getActiveSessionRecord(): FridaSessionRecord | undefined {
    if (!this.activeSessionId) {
      return undefined;
    }

    return this.sessions.get(this.activeSessionId);
  }

  private requireActiveSession(): FridaSessionRecord {
    const session = this.getActiveSessionRecord();
    if (!session) {
      throw new Error('No active Frida session. Call attach() first.');
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
    const availability = await this.getAvailability();
    if (!availability.available) {
      return {
        output: '',
        error: availability.reason ?? 'Frida CLI is not available',
      };
    }

    const command = availability.path ?? 'frida';
    const args = [...this.buildTargetArgs(target), '--runtime=v8', '-q', '-e', script];

    try {
      const result = await this.execFileUtf8(command, args, FRIDA_TIMEOUT_MS);
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

  private buildTargetArgs(target: string): string[] {
    if (/^\d+$/.test(target)) {
      return ['-p', target];
    }

    if (target.includes('/') || target.includes('\\')) {
      return ['-f', target];
    }

    return ['-n', target];
  }

  private createFallbackModule(target: string): FridaModuleInfo {
    const simpleName = this.extractSimpleName(target);
    return {
      name: simpleName,
      base: '0x0',
      size: 0,
      path: target,
    };
  }

  private extractSimpleName(target: string): string {
    const parts = target.split(/[\\/]/).filter((part) => part.length > 0);
    const lastPart = parts.at(-1);
    return lastPart && lastPart.length > 0 ? lastPart : target;
  }

  private parseModuleList(output: string): FridaModuleInfo[] {
    const payload = this.extractJsonPayload(output);
    if (!Array.isArray(payload)) {
      return [];
    }

    const modules: FridaModuleInfo[] = [];
    for (const entry of payload) {
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
    const payload = this.extractJsonPayload(output);
    if (!Array.isArray(payload)) {
      return [];
    }

    const functions: FridaFunctionInfo[] = [];
    for (const entry of payload) {
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
    const payload = this.extractJsonPayload(output);
    if (!Array.isArray(payload)) {
      return [];
    }

    const symbols: FridaSymbolInfo[] = [];
    for (const entry of payload) {
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

  private extractJsonPayload(output: string): unknown {
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
