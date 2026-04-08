import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';

const GHIDRA_TIMEOUT_MS = 120_000;
const GHIDRA_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export interface DecompiledFunction {
  name: string;
  address: string;
  signature: string;
  decompiled: string;
}

export interface GhidraAnalysisResult {
  functions: DecompiledFunction[];
  imports: string[];
  exports: string[];
  strings: string[];
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export class GhidraAnalyzer {
  private ghidraProbe?: ProbeResult;
  private probePromise?: Promise<ProbeResult>;

  async analyze(binaryPath: string, options?: { timeout?: number }): Promise<GhidraAnalysisResult> {
    await access(binaryPath);
    const fileBuffer = await readFile(binaryPath);
    const strings = this.extractPrintableStrings(fileBuffer);
    const imports = this.deriveImports(strings);
    const exports = this.deriveExports(strings);

    const availability = await this.getAvailability();
    if (!availability.available) {
      return {
        functions: [],
        imports,
        exports,
        strings,
      };
    }

    const timeoutMs =
      typeof options?.timeout === 'number' && Number.isFinite(options.timeout)
        ? options.timeout
        : GHIDRA_TIMEOUT_MS;

    const scriptDirectory = await mkdtemp(join(tmpdir(), 'jshook-ghidra-script-'));
    const scriptPath = join(scriptDirectory, 'BinaryInstrumentDump.py');

    try {
      await writeFile(scriptPath, this.buildDefaultScript(), 'utf8');
      const output = await this.headlessAnalyze(scriptPath, binaryPath, timeoutMs);
      const functions = this.parseDecompiledOutput(output);
      return {
        functions,
        imports,
        exports,
        strings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[binary-instrument] Ghidra analyze fallback', { binaryPath, message });
      return {
        functions: [],
        imports,
        exports,
        strings,
      };
    } finally {
      await rm(scriptDirectory, { recursive: true, force: true });
    }
  }

  async headlessAnalyze(
    scriptPath: string,
    binaryPath: string,
    timeoutMs = GHIDRA_TIMEOUT_MS,
  ): Promise<string> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? 'Ghidra analyzeHeadless is not available');
    }

    await access(binaryPath);
    await access(scriptPath);

    const command = availability.path ?? 'analyzeHeadless';
    const projectDirectory = await mkdtemp(join(tmpdir(), 'jshook-ghidra-project-'));
    const projectName = 'binary-instrument';

    try {
      const result = await this.execFileUtf8(
        command,
        [
          projectDirectory,
          projectName,
          '-import',
          binaryPath,
          '-scriptPath',
          dirname(scriptPath),
          '-postScript',
          basename(scriptPath),
        ],
        timeoutMs,
      );

      const combined = [result.stdout.trim(), result.stderr.trim()]
        .filter((entry) => entry.length > 0)
        .join('\n');

      return combined;
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  }

  parseDecompiledOutput(output: string): DecompiledFunction[] {
    const functions: DecompiledFunction[] = [];
    const blockPattern =
      /FUNCTION_START\s*[\r\n]+NAME:(.+?)\s*[\r\n]+ADDRESS:(.+?)\s*[\r\n]+SIGNATURE:(.+?)\s*[\r\n]+DECOMPILED_START\s*[\r\n]+([\s\S]*?)\s*[\r\n]+DECOMPILED_END\s*[\r\n]+FUNCTION_END/g;

    let match = blockPattern.exec(output);
    while (match) {
      const rawName = match[1] ?? '';
      const rawAddress = match[2] ?? '';
      const rawSignature = match[3] ?? '';
      const rawBody = match[4] ?? '';
      const name = rawName.trim();
      const address = this.normalizeHex(rawAddress.trim());
      const signature = rawSignature.trim();
      const decompiled = rawBody.trim();

      if (name.length > 0 && address.length > 0 && signature.length > 0) {
        functions.push({
          name,
          address,
          signature,
          decompiled,
        });
      }

      match = blockPattern.exec(output);
    }

    return functions;
  }

  async isAvailable(): Promise<boolean> {
    const availability = await this.getAvailability();
    return availability.available;
  }

  async getAvailability(): Promise<ProbeResult> {
    if (this.ghidraProbe) {
      return this.ghidraProbe;
    }

    if (!this.probePromise) {
      this.probePromise = probeCommand('analyzeHeadless', ['-help']);
    }

    const resolved = await this.probePromise;
    this.ghidraProbe = resolved;
    this.probePromise = undefined;
    return resolved;
  }

  private buildDefaultScript(): string {
    return [
      '# @category BinaryInstrument',
      'from ghidra.app.decompiler import DecompInterface',
      '',
      'program = currentProgram',
      'interface = DecompInterface()',
      'interface.openProgram(program)',
      'function_manager = program.getFunctionManager()',
      'functions = function_manager.getFunctions(True)',
      '',
      'for function in functions:',
      '    print("FUNCTION_START")',
      '    print("NAME:" + str(function.getName()))',
      '    print("ADDRESS:" + str(function.getEntryPoint()))',
      '    try:',
      '        signature = str(function.getSignature())',
      '    except:',
      '        signature = str(function.getName()) + "()"',
      '    print("SIGNATURE:" + signature)',
      '    print("DECOMPILED_START")',
      '    try:',
      '        decompiled = interface.decompileFunction(function, 30, monitor).getDecompiledFunction()',
      '        if decompiled:',
      '            print(str(decompiled.getC()))',
      '        else:',
      '            print("// no decompiled output")',
      '    except:',
      '        print("// decompile failed")',
      '    print("DECOMPILED_END")',
      '    print("FUNCTION_END")',
    ].join('\n');
  }

  private extractPrintableStrings(buffer: Buffer): string[] {
    const results: string[] = [];
    let current = '';

    for (const byte of buffer.values()) {
      if (byte >= 0x20 && byte <= 0x7e) {
        current += String.fromCharCode(byte);
        continue;
      }

      if (current.length >= 4) {
        results.push(current);
      }
      current = '';
    }

    if (current.length >= 4) {
      results.push(current);
    }

    return Array.from(new Set(results)).slice(0, 1_000);
  }

  private deriveImports(strings: string[]): string[] {
    return strings
      .filter((entry) =>
        /(?:\.dll|\.so|\.dylib|kernel32|user32|libc|printf|malloc|LoadLibrary)/i.test(entry),
      )
      .slice(0, 100);
  }

  private deriveExports(strings: string[]): string[] {
    return strings.filter((entry) => /^[A-Za-z_][A-Za-z0-9_@?$]{2,}$/.test(entry)).slice(0, 100);
  }

  private normalizeHex(value: string): string {
    return value.startsWith('0x') ? value : `0x${value}`;
  }

  private execFileUtf8(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: GHIDRA_MAX_BUFFER_BYTES,
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
