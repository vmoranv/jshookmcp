import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';
import { GHIDRA_TIMEOUT_MS } from '@src/constants';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { readEnvNullableString } from '@src/config/environment';

const GHIDRA_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const GHIDRA_ENV_PATHS = ['GHIDRA_HEADLESS_PATH', 'GHIDRA_ANALYZE_HEADLESS'] as const;
const GHIDRA_HOME_ENV_PATHS = ['GHIDRA_HOME', 'GHIDRA_INSTALL_DIR'] as const;
const GHIDRA_HEADLESS_NAMES =
  process.platform === 'win32'
    ? ['analyzeHeadless.bat', 'analyzeHeadless.cmd']
    : ['analyzeHeadless'];

/** Cache entry for incremental analysis results. */
interface AnalysisCache {
  hash: string; // SHA-256 of the binary
  fileSize: number;
  analyzedAt: number; // Unix timestamp
  result: GhidraAnalysisResult;
}

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

export type GhidraScriptLanguage = 'python' | 'java';

export interface GhidraAnalyzerOptions {
  /** Extra directories to scan for analyzeHeadless before falling back to PATH. */
  discoveryPaths?: string[];
}

export class GhidraAnalyzer {
  private ghidraProbe?: ProbeResult;
  private probePromise?: Promise<ProbeResult>;
  /** In-memory cache: binaryPath → AnalysisCache */
  private analysisCache = new Map<string, AnalysisCache>();
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
  private readonly discoveryPaths: string[];

  constructor(options: GhidraAnalyzerOptions = {}) {
    this.discoveryPaths = options.discoveryPaths ?? defaultGhidraDiscoveryRoots();
  }

  async analyze(
    binaryPath: string,
    options?: { timeout?: number; forceRefresh?: boolean },
  ): Promise<GhidraAnalysisResult> {
    await access(binaryPath);
    const fileBuffer = await readFile(binaryPath);
    const strings = this.extractPrintableStrings(fileBuffer);
    const imports = this.deriveImports(strings);
    const exports = this.deriveExports(strings);

    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new PrerequisiteError(
        [
          `Ghidra analyzeHeadless is not available: ${availability.reason || 'not found on PATH'}`,
          'Install Ghidra and add analyzeHeadless to your PATH.',
          'Windows: add <ghidra>/support to PATH. Linux/macOS: add <ghidra_install_dir>/support to PATH.',
        ].join(' '),
      );
    }

    // Incremental analysis: return cached result if binary unchanged
    if (!options?.forceRefresh) {
      const cached = this.getCachedResult(binaryPath, fileBuffer);
      if (cached) {
        logger.info(`[binary-instrument] Returning cached Ghidra analysis for ${binaryPath}`);
        return { ...cached, strings, imports, exports };
      }
    }

    const timeoutMs =
      typeof options?.timeout === 'number' && Number.isFinite(options.timeout)
        ? options.timeout
        : GHIDRA_TIMEOUT_MS;

    const scriptDirectory = await mkdtemp(join(tmpdir(), 'jshook-ghidra-script-'));
    const scriptPath = join(scriptDirectory, 'BinaryInstrumentDump.java');

    try {
      await writeFile(scriptPath, this.buildDefaultScript(), 'utf8');
      const output = await this.headlessAnalyze(scriptPath, binaryPath, timeoutMs);
      const functions = this.parseDecompiledOutput(output);
      const result: GhidraAnalysisResult = {
        functions,
        imports,
        exports,
        strings,
      };

      // Cache the result for incremental analysis
      this.cacheResult(binaryPath, fileBuffer, result);

      return result;
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

  /**
   * Batch-analyze multiple binaries in sequence.
   * Returns a map of binaryPath → GhidraAnalysisResult.
   * Failed analyses get an empty result (not an exception).
   */ async analyzeBatch(
    binaryPaths: string[],
    options?: { timeout?: number; forceRefresh?: boolean },
  ): Promise<Map<string, GhidraAnalysisResult>> {
    const results = new Map<string, GhidraAnalysisResult>();
    for (const path of binaryPaths) {
      try {
        const result = await this.analyze(path, options);
        results.set(path, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[binary-instrument] Batch analysis failed for ${path}`, { message });
        results.set(path, { functions: [], imports: [], exports: [], strings: [] });
      }
    }
    return results;
  }

  /**
   * Decompile a single named function via a fresh headless run (kimi-cu
   * report P2-6: replaces the plugin_ghidra_bridge HTTP dependency with the
   * stateless analyzeHeadless path — no bridge server, no plugin, ~5-10s
   * per call). `found: false` means the function name matched nothing in
   * the binary; agents should run ghidra_analyze first to list names.
   */
  async decompileFunction(
    binaryPath: string,
    functionName: string,
    options?: { timeout?: number },
  ): Promise<{ found: boolean; functions: DecompiledFunction[]; rawOutput?: string }> {
    await access(binaryPath);
    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new PrerequisiteError(
        [
          `Ghidra analyzeHeadless is not available: ${availability.reason || 'not found on PATH'}`,
          'Install Ghidra and add analyzeHeadless to your PATH.',
        ].join(' '),
      );
    }

    const timeoutMs =
      typeof options?.timeout === 'number' && Number.isFinite(options.timeout)
        ? options.timeout
        : GHIDRA_TIMEOUT_MS;

    const scriptDirectory = await mkdtemp(join(tmpdir(), 'jshook-ghidra-script-'));
    const scriptPath = join(scriptDirectory, 'BinaryInstrumentDecompileOne.java');
    try {
      await writeFile(scriptPath, this.buildFunctionDecompileScript(functionName), 'utf8');
      const output = await this.headlessAnalyze(scriptPath, binaryPath, timeoutMs);
      if (output.includes('FUNCTION_NOT_FOUND:')) {
        return { found: false, functions: [] };
      }
      const functions = this.parseDecompiledOutput(output);
      if (functions.length === 0) {
        return { found: false, functions: [], rawOutput: output.slice(0, 2_000) };
      }
      return { found: true, functions };
    } finally {
      await rm(scriptDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Run a custom Ghidra script against a binary.
   * The script receives no arguments but can use `currentProgram` and `monitor`.
   * Returns raw stdout+stderr from Ghidra.
   */
  async runCustomScript(
    binaryPath: string,
    scriptContent: string,
    options?: { timeout?: number; language?: GhidraScriptLanguage },
  ): Promise<string> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      throw new PrerequisiteError(
        [
          `Ghidra analyzeHeadless is not available: ${availability.reason || 'not found on PATH'}`,
          'Install Ghidra and add analyzeHeadless to your PATH.',
        ].join(' '),
      );
    }

    await access(binaryPath);
    const scriptDirectory = await mkdtemp(join(tmpdir(), 'jshook-ghidra-custom-'));
    const language = options?.language ?? inferGhidraScriptLanguage(scriptContent);
    const scriptPath = join(scriptDirectory, customScriptFilename(scriptContent, language));

    try {
      await writeFile(scriptPath, scriptContent, 'utf8');
      return await this.headlessAnalyze(
        scriptPath,
        binaryPath,
        options?.timeout ?? GHIDRA_TIMEOUT_MS,
      );
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
      throw new PrerequisiteError(availability.reason ?? 'Ghidra analyzeHeadless is not available');
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
    const normalizedOutput = stripGhidraLogPrefixes(output);
    const blockPattern =
      /FUNCTION_START\s*[\r\n]+NAME:(.+?)\s*[\r\n]+ADDRESS:(.+?)\s*[\r\n]+SIGNATURE:(.+?)\s*[\r\n]+DECOMPILED_START\s*[\r\n]+([\s\S]*?)\s*[\r\n]+DECOMPILED_END\s*[\r\n]+FUNCTION_END/g;

    let match = blockPattern.exec(normalizedOutput);
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

      match = blockPattern.exec(normalizedOutput);
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
      this.probePromise = this.probeAnalyzeHeadless();
    }

    const resolved = await this.probePromise;
    this.ghidraProbe = resolved;
    this.probePromise = undefined;
    return resolved;
  }

  private async probeAnalyzeHeadless(): Promise<ProbeResult> {
    const explicit = await this.resolveFromEnvironment();
    if (explicit) return explicit;

    const discovered = await this.resolveFromDiscoveryPaths();
    if (discovered) return discovered;

    return probeCommand('analyzeHeadless', ['-help']);
  }

  private async resolveFromEnvironment(): Promise<ProbeResult | null> {
    for (const key of GHIDRA_ENV_PATHS) {
      const raw = readEnvNullableString(key, { trim: true });
      if (!raw) continue;
      const resolved = await this.probeCandidate(raw, key);
      if (resolved) return resolved;
    }

    for (const key of GHIDRA_HOME_ENV_PATHS) {
      const raw = readEnvNullableString(key, { trim: true });
      if (!raw) continue;
      const resolved = await this.probeHomeDirectory(raw, key);
      if (resolved) return resolved;
    }

    return null;
  }

  private async resolveFromDiscoveryPaths(): Promise<ProbeResult | null> {
    for (const root of this.discoveryPaths) {
      const resolved = await this.probeHomeDirectory(root, 'auto-discovery');
      if (resolved) return resolved;

      for (const child of await listLikelyGhidraHomes(root)) {
        const nested = await this.probeHomeDirectory(child, 'auto-discovery');
        if (nested) return nested;
      }
    }
    return null;
  }

  private async probeHomeDirectory(root: string, source: string): Promise<ProbeResult | null> {
    const candidates = candidateHeadlessPaths(root);
    for (const candidate of candidates) {
      const resolved = await this.probeCandidate(candidate, source);
      if (resolved) return resolved;
    }
    return null;
  }

  private async probeCandidate(candidate: string, source: string): Promise<ProbeResult | null> {
    const normalized = normalize(candidate);
    const entry = await stat(normalized).catch(() => null);
    if (!entry?.isFile()) return null;

    try {
      await access(normalized, fsConstants.X_OK);
    } catch {
      try {
        await access(normalized, fsConstants.R_OK);
      } catch {
        return null;
      }
    }

    return {
      available: true,
      path: normalized,
      version: `analyzeHeadless (${source})`,
    };
  }

  /**
   * Escape a user-supplied name for embedding in a Java string literal so a
   * crafted functionName cannot break out of the generated postScript.
   */
  private escapeJavaStringLiteral(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]/g, '');
  }

  /**
   * Single-function dump script for decompileFunction: emits the same
   * FUNCTION_START/.../FUNCTION_END markers parseDecompiledOutput expects,
   * or a FUNCTION_NOT_FOUND marker when the name matches nothing.
   */
  private buildFunctionDecompileScript(functionName: string): string {
    const target = this.escapeJavaStringLiteral(functionName);
    return [
      '// @category BinaryInstrument',
      'import ghidra.app.decompiler.DecompInterface;',
      'import ghidra.app.decompiler.DecompileResults;',
      'import ghidra.app.script.GhidraScript;',
      'import ghidra.program.model.listing.Function;',
      'import ghidra.program.model.listing.FunctionIterator;',
      '',
      'public class BinaryInstrumentDecompileOne extends GhidraScript {',
      '  @Override',
      '  public void run() throws Exception {',
      `    String target = "${target}";`,
      '    DecompInterface decompiler = new DecompInterface();',
      '    decompiler.openProgram(currentProgram);',
      '',
      '    try {',
      '      FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);',
      '      boolean found = false;',
      '      while (functions.hasNext()) {',
      '        Function function = functions.next();',
      '        if (!target.equals(function.getName())) {',
      '          continue;',
      '        }',
      '        found = true;',
      '        emit("FUNCTION_START");',
      '        emit("NAME:" + function.getName());',
      '        emit("ADDRESS:" + function.getEntryPoint().toString());',
      '        emit("SIGNATURE:" + getSignature(function));',
      '        emit("DECOMPILED_START");',
      '        emit(decompileFunction(decompiler, function));',
      '        emit("DECOMPILED_END");',
      '        emit("FUNCTION_END");',
      '      }',
      '      if (!found) {',
      '        emit("FUNCTION_NOT_FOUND:" + target);',
      '      }',
      '    } finally {',
      '      decompiler.dispose();',
      '    }',
      '  }',
      '',
      '  private void emit(String value) {',
      '    System.out.println(value);',
      '  }',
      '',
      '  private String getSignature(Function function) {',
      '    try {',
      '      return function.getSignature().toString();',
      '    } catch (Exception ignored) {',
      '      return function.getName() + "()";',
      '    }',
      '  }',
      '',
      '  private String decompileFunction(DecompInterface decompiler, Function function) {',
      '    try {',
      '      DecompileResults results = decompiler.decompileFunction(function, 60, monitor);',
      '      if (results != null && results.decompileCompleted() && results.getDecompiledFunction() != null) {',
      '        return results.getDecompiledFunction().getC();',
      '      }',
      '      return "// no decompiled output";',
      '    } catch (Exception error) {',
      '      return "// decompile failed: " + error.getMessage();',
      '    }',
      '  }',
      '}',
    ].join('\n');
  }

  private buildDefaultScript(): string {
    return [
      '// @category BinaryInstrument',
      'import ghidra.app.decompiler.DecompInterface;',
      'import ghidra.app.decompiler.DecompileResults;',
      'import ghidra.app.script.GhidraScript;',
      'import ghidra.program.model.listing.Function;',
      'import ghidra.program.model.listing.FunctionIterator;',
      '',
      'public class BinaryInstrumentDump extends GhidraScript {',
      '  @Override',
      '  public void run() throws Exception {',
      '    DecompInterface decompiler = new DecompInterface();',
      '    decompiler.openProgram(currentProgram);',
      '',
      '    try {',
      '      FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);',
      '      while (functions.hasNext()) {',
      '        Function function = functions.next();',
      '        emit("FUNCTION_START");',
      '        emit("NAME:" + function.getName());',
      '        emit("ADDRESS:" + function.getEntryPoint().toString());',
      '        emit("SIGNATURE:" + getSignature(function));',
      '        emit("DECOMPILED_START");',
      '        emit(decompileFunction(decompiler, function));',
      '        emit("DECOMPILED_END");',
      '        emit("FUNCTION_END");',
      '      }',
      '    } finally {',
      '      decompiler.dispose();',
      '    }',
      '  }',
      '',
      '  private void emit(String value) {',
      '    System.out.println(value);',
      '  }',
      '',
      '  private String getSignature(Function function) {',
      '    try {',
      '      return function.getSignature().toString();',
      '    } catch (Exception ignored) {',
      '      return function.getName() + "()";',
      '    }',
      '  }',
      '',
      '  private String decompileFunction(DecompInterface decompiler, Function function) {',
      '    try {',
      '      DecompileResults results = decompiler.decompileFunction(function, 30, monitor);',
      '      if (results != null && results.decompileCompleted() && results.getDecompiledFunction() != null) {',
      '        return results.getDecompiledFunction().getC();',
      '      }',
      '      return "// no decompiled output";',
      '    } catch (Exception error) {',
      '      return "// decompile failed: " + error.getMessage();',
      '    }',
      '  }',
      '}',
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

  // ─── Incremental Analysis Cache ─────────────────────────────────

  private getCachedResult(binaryPath: string, fileBuffer: Buffer): GhidraAnalysisResult | null {
    const cached = this.analysisCache.get(binaryPath);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.analyzedAt > GhidraAnalyzer.CACHE_TTL_MS) {
      this.analysisCache.delete(binaryPath);
      return null;
    }

    const currentHash = this.computeHash(fileBuffer);
    if (currentHash !== cached.hash) {
      this.analysisCache.delete(binaryPath);
      return null;
    }

    return { ...cached.result };
  }

  private cacheResult(binaryPath: string, fileBuffer: Buffer, result: GhidraAnalysisResult): void {
    this.analysisCache.set(binaryPath, {
      hash: this.computeHash(fileBuffer),
      fileSize: fileBuffer.length,
      analyzedAt: Date.now(),
      result,
    });

    // Evict oldest entries if cache grows too large
    if (this.analysisCache.size > 20) {
      let oldest = '';
      let oldestTime = Infinity;
      for (const [path, entry] of this.analysisCache.entries()) {
        if (entry.analyzedAt < oldestTime) {
          oldestTime = entry.analyzedAt;
          oldest = path;
        }
      }
      if (oldest) this.analysisCache.delete(oldest);
    }
  }

  private computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex').substring(0, 32);
  }

  // ─── Command Execution ──────────────────────────────────────────

  protected execFileUtf8(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        file,
        args,
        {
          windowsHide: true,
          maxBuffer: GHIDRA_MAX_BUFFER_BYTES,
          encoding: 'utf8',
          shell: shouldUseShellForCommand(file),
        },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          if (error) {
            const output = [
              typeof stdout === 'string' && stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
              typeof stderr === 'string' && stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
            ]
              .filter((entry) => entry.length > 0)
              .join('\n');
            if (output && error instanceof Error) {
              error.message = `${error.message}\n${output}`;
            }
            reject(error);
            return;
          }

          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
          });
        },
      );

      // Manual timeout with force-kill. Node's built-in execFile timeout sends
      // SIGTERM which Java-based tools (Ghidra, apktool, JADX) ignore on Windows.
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        // pid > 0 proves the interpolated value is a positive integer —
        // taskkill cannot see an option-terminator-escaped flag.
        if (child.pid !== undefined && child.pid > 0) {
          execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => {});
        }
        reject(new Error(`${file} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
}

function candidateHeadlessPaths(rootOrCommand: string): string[] {
  const normalized = normalize(rootOrCommand);
  const direct = isAbsolute(normalized) ? normalized : resolvePath(normalized);
  const candidates = [direct];

  for (const name of GHIDRA_HEADLESS_NAMES) {
    candidates.push(join(direct, name));
    candidates.push(join(direct, 'support', name));
  }

  return Array.from(new Set(candidates));
}

async function listLikelyGhidraHomes(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /ghidra/i.test(entry.name))
      .slice(0, 20)
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

function defaultGhidraDiscoveryRoots(): string[] {
  const roots = new Set<string>();
  const add = (value: string | undefined) => {
    if (value && value.trim().length > 0) roots.add(value.trim());
  };

  add(process.cwd());
  add(process.env['USERPROFILE']);
  add(process.env['HOME']);

  if (process.platform === 'win32') {
    add(process.env['ProgramFiles']);
    add(process.env['ProgramFiles(x86)']);
    add('C:\\tools');
  } else {
    add('/opt');
    add('/usr/local');
    add('/Applications');
  }

  return Array.from(roots);
}

function shouldUseShellForCommand(command: string): boolean {
  return process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
}

function stripGhidraLogPrefixes(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(?:INFO|WARN|ERROR)\s+[^>]+>\s*(.*)$/.exec(line);
      if (!match) return line;
      return (match[1] ?? '').replace(/\s+\(GhidraScript\)\s*$/, '');
    })
    .join('\n');
}

function inferGhidraScriptLanguage(scriptContent: string): GhidraScriptLanguage {
  return /\bextends\s+GhidraScript\b/.test(scriptContent) ||
    /\bimport\s+ghidra\./.test(scriptContent) ||
    /\bpublic\s+class\s+\w+\b/.test(scriptContent)
    ? 'java'
    : 'python';
}

function customScriptFilename(scriptContent: string, language: GhidraScriptLanguage): string {
  if (language === 'python') return 'custom_script.py';

  const className = /\bpublic\s+class\s+([A-Za-z_$][\w$]*)\b/.exec(scriptContent)?.[1];
  return `${className ?? 'CustomScript'}.java`;
}
