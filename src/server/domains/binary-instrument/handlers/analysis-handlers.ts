/**
 * Static analysis sub-handler — Ghidra, IDA, JADX, Unidbg, hooks, plugins.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { GhidraAnalyzer, HookGenerator, getAvailablePlugins } from '@modules/binary-instrument';
import { probeCommand } from '@modules/external/ToolProbe';
import { UNIDBG_TIMEOUT_MS } from '@src/constants';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  readOptionalNumber,
  readOptionalBoolean,
  readStringArray,
  readHookOptions,
  isRecord,
  isGhidraAnalysisOutput,
  toHookTemplates,
  jsonResponse,
  textResponse,
  getUnidbgAvailability,
  execFileUtf8,
  invokeLegacyPlugin,
} from './shared';

export class AnalysisHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleGhidraAnalyze(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const timeout = readOptionalNumber(args, 'timeout');
    const ghidra = this.getGhidraAnalyzer();
    const availability = await ghidra.getAvailability();
    const analysis = await ghidra.analyze(
      binaryPath,
      timeout !== undefined ? { timeout } : undefined,
    );

    if (!availability.available) {
      return {
        available: false,
        capability: 'ghidra_headless',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
        binaryPath,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
        analysis,
      };
    }

    return { available: true, binaryPath, analysis };
  }

  async handleGhidraDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_ghidra_bridge', 'ghidra_decompile', args);
  }

  async handleIdaDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_ida_bridge', 'ida_decompile', args);
  }

  async handleJadxDecompile(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const className = readRequiredString(args, 'className');
    const methodName = readOptionalString(args, 'methodName');

    const jadxProbe = await probeCommand('jadx', ['--version']);
    if (jadxProbe.available) {
      return this.jadxNativeDecompile(jadxProbe.path ?? 'jadx', apkPath, className, methodName);
    }

    return invokeLegacyPlugin(this.state.context, 'plugin_jadx_bridge', 'jadx_decompile', args);
  }

  async handleApktoolDecode(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const explicitOutputDir = readOptionalString(args, 'outputDir');
    const force = readOptionalBoolean(args, 'force') ?? false;
    const apktoolProbe = await probeCommand('apktool', ['--version']);
    if (!apktoolProbe.available) {
      return jsonResponse({
        available: false,
        capability: 'apktool_cli',
        fix: 'Install apktool and ensure it is on PATH.',
        apkPath,
        reason: apktoolProbe.reason ?? 'apktool is not available',
      });
    }

    const outputDir = explicitOutputDir ?? join(tmpdir(), `jshook-apktool-${Date.now()}`);
    if (explicitOutputDir) {
      await mkdir(outputDir, { recursive: true });
    }

    try {
      const argsList = ['decode', '--output', outputDir];
      if (force) argsList.push('--force');
      argsList.push(apkPath);

      const result = await execFileUtf8(apktoolProbe.path ?? 'apktool', argsList, 120_000);
      return jsonResponse({
        available: true,
        apkPath,
        outputDir,
        force,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        apkPath,
        outputDir,
        force,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleApkManifestDump(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const manifestResult = await this.readZipEntryBuffer(apkPath, 'AndroidManifest.xml');
    if (!manifestResult.success) {
      return jsonResponse({
        available: false,
        apkPath,
        entry: 'AndroidManifest.xml',
        error: manifestResult.error,
      });
    }

    const manifestText = this.decodeTextEntry(manifestResult.buffer);
    if (manifestText !== null) {
      return jsonResponse({
        available: true,
        apkPath,
        entry: 'AndroidManifest.xml',
        format: 'xml',
        decodedBy: 'zip-entry',
        manifest: manifestText,
      });
    }

    const jadxProbe = await probeCommand('jadx', ['--version']);
    if (jadxProbe.available) {
      const decodedManifest = await this.decodeManifestWithJadx(jadxProbe.path ?? 'jadx', apkPath);
      if (decodedManifest.success) {
        return jsonResponse({
          available: true,
          apkPath,
          entry: 'AndroidManifest.xml',
          format: 'xml',
          decodedBy: 'jadx_cli',
          manifest: decodedManifest.manifest,
        });
      }
    }

    return jsonResponse({
      available: true,
      apkPath,
      entry: 'AndroidManifest.xml',
      format: 'binary-axml',
      decodedBy: 'zip-entry',
      size: manifestResult.buffer.length,
      manifestBase64: manifestResult.buffer.toString('base64'),
    });
  }

  async handleApkNativeLibsList(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const entriesResult = await this.listZipEntries(apkPath);
    if (!entriesResult.success) {
      return jsonResponse({
        available: false,
        apkPath,
        error: entriesResult.error,
      });
    }

    const libraries = entriesResult.entries
      .filter((entry) => /^lib\/.+\/[^/]+\.so$/i.test(entry))
      .map((entry) => {
        const parts = entry.split('/');
        return {
          path: entry,
          abi: parts[1] ?? '',
          name: parts[parts.length - 1] ?? '',
        };
      });

    return jsonResponse({
      available: true,
      apkPath,
      count: libraries.length,
      libraries,
    });
  }

  async handleGenerateHooks(args: Record<string, unknown>): Promise<unknown> {
    const legacyGhidraOutput = readOptionalString(args, 'ghidraOutput');
    if (legacyGhidraOutput) return this.handleLegacyGenerateHooks(legacyGhidraOutput);

    const legacyGhidraOutputObj = args['ghidraOutput'];
    if (isRecord(legacyGhidraOutputObj)) {
      return this.handleLegacyGenerateHooks(JSON.stringify(legacyGhidraOutputObj));
    }

    const symbols = readStringArray(args, 'symbols');
    if (symbols.length === 0) return textResponse('symbols or ghidraOutput is required');

    const options = readHookOptions(args, 'options');
    const hookGen = this.getHookGenerator();
    const script = hookGen.generateFridaHookScript(symbols, options);
    return jsonResponse({ available: true, symbolCount: symbols.length, script });
  }

  async handleExportHookScript(args: Record<string, unknown>): Promise<unknown> {
    const rawTemplates = readOptionalString(args, 'hookTemplates');
    if (!rawTemplates) {
      const generated = this.state.hookCodeGenerator.exportScript([], 'frida');
      const script = generated.includes('Java.perform')
        ? generated
        : `Java.perform(function() {\n${generated}\n});`;
      return jsonResponse({ format: 'frida', hookCount: 0, script });
    }

    try {
      const parsed = JSON.parse(rawTemplates);
      if (!Array.isArray(parsed)) return textResponse('Invalid JSON');
      const templates = toHookTemplates(parsed);
      const script = this.state.hookCodeGenerator.exportScript(templates, 'frida');
      return jsonResponse({ format: 'frida', hookCount: templates.length, script });
    } catch {
      return textResponse('Invalid JSON');
    }
  }

  async handleUnidbgEmulate(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const functionName = readRequiredString(args, 'functionName');
    const invokeArgs = readStringArray(args, 'args');
    const availability = await getUnidbgAvailability();

    if (!availability.available) {
      return {
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path.',
        binaryPath,
        functionName,
        args: invokeArgs,
        reason: availability.reason,
        result: { returnValue: '0x0', stdout: '', stderr: '', trace: ['mock-unidbg-unavailable'] },
      };
    }

    const result = await execFileUtf8(
      availability.command,
      ['-jar', availability.jarPath, binaryPath, functionName, ...invokeArgs],
      UNIDBG_TIMEOUT_MS,
    );

    return {
      available: true,
      binaryPath,
      functionName,
      args: invokeArgs,
      result: {
        returnValue: '0x0',
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        trace: [],
      },
    };
  }

  async handleUnidbgLaunch(args: Record<string, unknown>): Promise<unknown> {
    const soPath = readOptionalString(args, 'soPath');
    if (!soPath) return textResponse('Missing required string argument: soPath');
    const arch = readOptionalString(args, 'arch') ?? 'arm';

    try {
      const result = await this.state.unidbgRunner.launch(soPath, arch);
      return {
        available: true,
        sessionId: result.sessionId,
        soPath: result.soPath,
        arch: result.arch,
        sessions: this.state.unidbgRunner.listSessions(),
      };
    } catch (error) {
      return {
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path and retry.',
        soPath,
        arch,
        reason: error instanceof Error ? error.message : String(error),
        sessions: this.state.unidbgRunner.listSessions(),
      };
    }
  }

  async handleUnidbgCall(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');
    const functionName = readOptionalString(args, 'functionName');
    if (!functionName) return textResponse('Missing required string argument: functionName');

    const callArgs = isRecord(args['args']) ? (args['args'] as Record<string, unknown>) : {};
    try {
      const result = await this.state.unidbgRunner.callFunction(sessionId, functionName, callArgs);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }

  async handleUnidbgTrace(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');

    try {
      const result = await this.state.unidbgRunner.trace(sessionId);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }

  async handleGetAvailablePlugins(_args: Record<string, unknown>): Promise<unknown> {
    const plugins = this.state.context ? getAvailablePlugins(this.state.context) : [];
    return jsonResponse({ plugins, count: plugins.length });
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.state.ghidra) this.state.ghidra = new GhidraAnalyzer();
    return this.state.ghidra;
  }

  private getHookGenerator(): HookGenerator {
    if (!this.state.hookGen) this.state.hookGen = new HookGenerator();
    return this.state.hookGen;
  }

  private handleLegacyGenerateHooks(ghidraOutput: string): Promise<unknown> | unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ghidraOutput);
    } catch {
      return textResponse('Invalid JSON');
    }
    if (!isGhidraAnalysisOutput(parsed)) return textResponse('ghidraOutput is required');
    const hooks = this.state.hookCodeGenerator.generateHooks(parsed);
    return jsonResponse({ count: hooks.length, hooks });
  }

  private async listZipEntries(
    apkPath: string,
  ): Promise<{ success: true; entries: string[] } | { success: false; error: string }> {
    try {
      const zipFile = await this.openZipFile(apkPath);
      const entries = await new Promise<string[]>((resolve, reject) => {
        const names: string[] = [];
        let settled = false;

        const onEntry = (entry: ZipEntry) => {
          names.push(entry.fileName);
          zipFile.readEntry();
        };
        const onEnd = () => finish(() => resolve(names));
        const onError = (error: Error) => finish(() => reject(error));
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          zipFile.removeListener('entry', onEntry);
          zipFile.removeListener('end', onEnd);
          zipFile.removeListener('error', onError);
          callback();
        };

        zipFile.on('entry', onEntry);
        zipFile.on('end', onEnd);
        zipFile.on('error', onError);
        zipFile.readEntry();
      });

      return { success: true, entries };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readZipEntryBuffer(
    apkPath: string,
    entryName: string,
  ): Promise<{ success: true; buffer: Buffer } | { success: false; error: string }> {
    try {
      const zipFile = await this.openZipFile(apkPath);
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        let settled = false;

        const closeZip = () => {
          try {
            zipFile.close();
          } catch {
            // ignore close errors after early return
          }
        };
        const onEntry = (entry: ZipEntry) => {
          if (entry.fileName !== entryName) {
            zipFile.readEntry();
            return;
          }

          zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              finish(() => reject(error ?? new Error(`Unable to read ZIP entry: ${entryName}`)));
              closeZip();
              return;
            }

            this.readStreamToBuffer(stream)
              .then((content) => {
                finish(() => resolve(content));
                closeZip();
              })
              .catch((streamError) => {
                finish(() => reject(streamError));
                closeZip();
              });
          });
        };
        const onEnd = () => finish(() => reject(new Error(`ZIP entry not found: ${entryName}`)));
        const onError = (error: Error) => finish(() => reject(error));
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          zipFile.removeListener('entry', onEntry);
          zipFile.removeListener('end', onEnd);
          zipFile.removeListener('error', onError);
          callback();
        };

        zipFile.on('entry', onEntry);
        zipFile.on('end', onEnd);
        zipFile.on('error', onError);
        zipFile.readEntry();
      });

      return { success: true, buffer };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async jadxNativeDecompile(
    jadx: string,
    apkPath: string,
    className: string,
    methodName?: string,
  ): Promise<unknown> {
    const outDir = await mkdtemp(join(tmpdir(), 'jshook-jadx-'));
    try {
      const jadxArgs = ['--no-res', '--no-debug-info', '-d', outDir, apkPath];
      await this.runJadx(jadx, jadxArgs);

      const sourcesDir = join(outDir, 'sources');
      const resolvedClass = await this.resolveDecompiledClassFile(sourcesDir, className);
      if (!resolvedClass.success) {
        return jsonResponse({
          available: true,
          apkPath,
          className,
          error: `Class file not found after decompilation: ${className}`,
          suggestions: resolvedClass.suggestions,
        });
      }

      let source: string;
      try {
        source = await readFile(resolvedClass.classFile, 'utf8');
      } catch {
        return jsonResponse({
          available: true,
          apkPath,
          className,
          ...(resolvedClass.resolvedClassName !== className
            ? { resolvedClassName: resolvedClass.resolvedClassName }
            : {}),
          error: `Class file not found after decompilation: ${className}`,
        });
      }

      if (methodName) {
        const methodSource = this.extractMethodSource(source, methodName);
        if (!methodSource) {
          return jsonResponse({
            available: true,
            apkPath,
            className,
            ...(resolvedClass.resolvedClassName !== className
              ? { resolvedClassName: resolvedClass.resolvedClassName }
              : {}),
            methodName,
            source: '',
            error: `Method ${methodName} not found in ${className}`,
          });
        }
        return jsonResponse({
          available: true,
          apkPath,
          className,
          ...(resolvedClass.resolvedClassName !== className
            ? { resolvedClassName: resolvedClass.resolvedClassName }
            : {}),
          methodName,
          source: methodSource,
        });
      }

      return jsonResponse({
        available: true,
        apkPath,
        className,
        ...(resolvedClass.resolvedClassName !== className
          ? { resolvedClassName: resolvedClass.resolvedClassName }
          : {}),
        source,
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        apkPath,
        className,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }

  private openZipFile(apkPath: string): Promise<YauzlZipFile> {
    return new Promise((resolve, reject) => {
      openZipArchive(
        apkPath,
        {
          autoClose: true,
          lazyEntries: true,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: false,
        },
        (error, zipFile) => {
          if (error || !zipFile) {
            reject(error ?? new Error(`Unable to open ZIP archive: ${apkPath}`));
            return;
          }
          resolve(zipFile);
        },
      );
    });
  }

  private readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: string | Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private decodeTextEntry(buffer: Buffer): string | null {
    if (buffer.length === 0) return '';

    const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
    let controlByteCount = 0;
    for (const byte of sample) {
      if (byte === 0) return null;
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
        controlByteCount += 1;
      }
    }

    if (controlByteCount > sample.length * 0.1) {
      return null;
    }

    const text = buffer.toString('utf8');
    return text.trimStart().startsWith('<') ? text : null;
  }

  private async decodeManifestWithJadx(
    jadx: string,
    apkPath: string,
  ): Promise<{ success: true; manifest: string } | { success: false; error: string }> {
    const outDir = await mkdtemp(join(tmpdir(), 'jshook-jadx-manifest-'));
    try {
      await this.runJadx(jadx, ['--no-src', '-d', outDir, apkPath]);
      const manifestPath = join(outDir, 'resources', 'AndroidManifest.xml');
      const manifest = await readFile(manifestPath, 'utf8');
      if (!manifest.trimStart().startsWith('<')) {
        return { success: false, error: 'Decoded manifest is not XML' };
      }
      return { success: true, manifest };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }

  private async runJadx(jadx: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(jadx, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 }, (error) => {
        // JADX exits with code 1 on partial decompilation errors but still produces usable output.
        if (error && (error as { code?: number }).code !== 1) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async resolveDecompiledClassFile(
    sourcesDir: string,
    requestedClassName: string,
  ): Promise<
    | { success: true; classFile: string; resolvedClassName: string }
    | { success: false; suggestions: string[] }
  > {
    const exactFile = this.buildExpectedClassFile(sourcesDir, requestedClassName);
    try {
      await readFile(exactFile, 'utf8');
      return {
        success: true,
        classFile: exactFile,
        resolvedClassName: requestedClassName,
      };
    } catch {
      // fall through to best-effort class discovery
    }

    const candidates = await this.findClassCandidates(sourcesDir, requestedClassName);
    if (candidates.length === 0) {
      return { success: false, suggestions: [] };
    }
    if (candidates.length === 1) {
      const onlyCandidate = candidates[0];
      if (!onlyCandidate) {
        return { success: false, suggestions: [] };
      }
      return {
        success: true,
        classFile: onlyCandidate.classFile,
        resolvedClassName: onlyCandidate.className,
      };
    }

    const best = candidates[0];
    const second = candidates[1];
    if (!best || !second) {
      return {
        success: false,
        suggestions: candidates.slice(0, 10).map((candidate) => candidate.className),
      };
    }

    if (best.score > second.score) {
      return {
        success: true,
        classFile: best.classFile,
        resolvedClassName: best.className,
      };
    }

    return {
      success: false,
      suggestions: candidates.slice(0, 10).map((candidate) => candidate.className),
    };
  }

  private buildExpectedClassFile(sourcesDir: string, className: string): string {
    const parts = className.split('.');
    const simpleClassName = (parts[parts.length - 1] ?? '').split('$')[0] ?? '';
    return join(sourcesDir, ...parts.slice(0, -1), `${simpleClassName}.java`);
  }

  private async findClassCandidates(
    sourcesDir: string,
    requestedClassName: string,
  ): Promise<Array<{ className: string; classFile: string; score: number }>> {
    const requestedParts = requestedClassName.split('.');
    const requestedSimpleName =
      (requestedParts[requestedParts.length - 1] ?? '').split('$')[0] ?? '';
    const requestedPackage = requestedParts.slice(0, -1);
    const targetFileName = `${requestedSimpleName}.java`;
    const candidates: Array<{ className: string; classFile: string; score: number }> = [];

    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile() || entry.name !== targetFileName) continue;

        const relativePath = relative(sourcesDir, fullPath)
          .replace(/\\/g, '/')
          .replace(/\.java$/i, '');
        const className = relativePath.split('/').join('.');
        const candidatePackage = className.split('.').slice(0, -1);
        candidates.push({
          className,
          classFile: fullPath,
          score: this.scoreClassCandidate(requestedPackage, candidatePackage),
        });
      }
    };

    await walk(sourcesDir);
    return candidates.toSorted(
      (left, right) => right.score - left.score || left.className.localeCompare(right.className),
    );
  }

  private scoreClassCandidate(requestedPackage: string[], candidatePackage: string[]): number {
    let prefixMatches = 0;
    const prefixLimit = Math.min(requestedPackage.length, candidatePackage.length);
    while (
      prefixMatches < prefixLimit &&
      requestedPackage[prefixMatches] === candidatePackage[prefixMatches]
    ) {
      prefixMatches += 1;
    }

    let suffixMatches = 0;
    const suffixLimit = Math.min(requestedPackage.length, candidatePackage.length);
    while (
      suffixMatches < suffixLimit &&
      requestedPackage[requestedPackage.length - 1 - suffixMatches] ===
        candidatePackage[candidatePackage.length - 1 - suffixMatches]
    ) {
      suffixMatches += 1;
    }

    return prefixMatches * 10 + suffixMatches;
  }

  private extractMethodSource(source: string, methodName: string): string | null {
    const methodRegex = new RegExp(
      `(?:public|private|protected|static|final|abstract|synchronized|native)\\s+[\\w<>\\[\\]]+\\s+${methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)\\s*(?:throws[^{]*)?\\{`,
    );
    const matchStart = source.search(methodRegex);
    if (matchStart === -1) {
      return null;
    }

    let depth = 0;
    let index = source.indexOf('{', matchStart);
    for (; index < source.length; index++) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return source.slice(matchStart, index + 1);
  }
}
