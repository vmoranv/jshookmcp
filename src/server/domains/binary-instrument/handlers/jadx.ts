/**
 * JADX handlers: jadx_decompile, jadx_decompile_apk, jadx_search_code
 * APK manifest handlers: apk_manifest_dump, apk_manifest_query, apk_static_triage, apk_dex_intake
 */

import { mkdtemp, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { probeCommand } from '@modules/external/ToolProbe';
import { killProcessTree, toExecFileCommand } from '@modules/external/WindowsCommand';
import { JadxSearchEngine } from '@modules/jadx-search';
import type { JadxSearchOptions } from '@modules/jadx-search';
import { analyzeApkDexIntake } from '@modules/binary-instrument/apk-dex-intake';
import {
  matchApkSurfaceHints,
  type ApkSurfaceHintRule,
} from '@modules/binary-instrument/apk-surface-hints';
import { decodeApkManifest, listZipEntries } from '@modules/binary-instrument/apk-zip-inspection';
import { ToolError } from '@errors/ToolError';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  readOptionalNumber,
  readOptionalBoolean,
  readStringArray,
  isRecord,
  jsonResponse,
  invokeLegacyPlugin,
} from './shared';
import {
  resolveDecompiledClassFile,
  extractMethodSource,
  findFilesByExtension,
} from '../shared/jadx-utils';
import { summarizeManifestXml } from '../shared/apk-manifest-utils';

function uniqueStrings(values: string[], limit = 200): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function readSurfaceHintOptions(args: Record<string, unknown>): {
  customSurfaceHints?: ApkSurfaceHintRule[];
} {
  const customSurfaceHints = readCustomSurfaceHints(args);
  return customSurfaceHints ? { customSurfaceHints } : {};
}

function readCustomSurfaceHints(args: Record<string, unknown>): ApkSurfaceHintRule[] | undefined {
  const raw = args['customSurfaceHints'];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'customSurfaceHints must be an array of objects');
  }
  if (raw.length > 50) {
    throw new ToolError('VALIDATION', 'customSurfaceHints supports at most 50 rules');
  }

  const rules: ApkSurfaceHintRule[] = [];
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new ToolError('VALIDATION', `customSurfaceHints[${index}] must be an object`);
    }
    const name = entry['name'];
    const patterns = entry['patterns'];
    const kind = entry['kind'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ToolError('VALIDATION', `customSurfaceHints[${index}].name is required`);
    }
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new ToolError('VALIDATION', `customSurfaceHints[${index}].patterns is required`);
    }
    const normalizedPatterns = patterns.map((pattern, patternIndex) => {
      if (typeof pattern !== 'string' || pattern.trim().length === 0) {
        throw new ToolError(
          'VALIDATION',
          `customSurfaceHints[${index}].patterns[${patternIndex}] must be a non-empty string`,
        );
      }
      if (pattern.length > 256) {
        throw new ToolError(
          'VALIDATION',
          `customSurfaceHints[${index}].patterns[${patternIndex}] exceeds 256 characters`,
        );
      }
      return pattern.trim();
    });
    if (kind !== undefined && kind !== 'protector' && kind !== 'sdk') {
      throw new ToolError(
        'VALIDATION',
        `customSurfaceHints[${index}].kind must be protector or sdk`,
      );
    }
    rules.push({
      name: name.trim(),
      patterns: normalizedPatterns.slice(0, 50),
      ...(kind ? { kind } : {}),
    });
  });
  return rules;
}

export class JadxHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
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

  async handleJadxDecompileApk(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const outputDir = readOptionalString(args, 'outputDir');
    const noResources = readOptionalBoolean(args, 'noResources') ?? false;
    const force = readOptionalBoolean(args, 'force') ?? false;

    const jadxProbe = await probeCommand('jadx', ['--version']);
    if (!jadxProbe.available) {
      return jsonResponse({
        available: false,
        capability: 'jadx_cli',
        fix: 'Install JADX and ensure jadx is on PATH.',
        apkPath,
        reason: jadxProbe.reason ?? 'jadx is not available',
      });
    }

    const decompileDir =
      outputDir ?? (await mkdtemp(join(tmpdir(), `jshook-jadx-${basename(apkPath)}-`)));
    if (outputDir && force) {
      await rm(outputDir, { recursive: true, force: true });
    }
    await mkdir(decompileDir, { recursive: true });

    const jadxConfig = getReverseEngineeringConfig().jadx;
    const userTimeout = readOptionalNumber(args, 'timeoutMs');
    const timeoutMs = userTimeout ?? jadxConfig.decompileTimeoutMs;
    const threads = readOptionalNumber(args, 'threadsCount') ?? jadxConfig.threadsCount;
    const jadxArgs = ['--no-debug-info', '-j', String(threads)];
    if (noResources) jadxArgs.push('--no-res');
    jadxArgs.push('-d', decompileDir, apkPath);

    try {
      await this.runJadx(jadxProbe.path ?? 'jadx', jadxArgs, timeoutMs);
      const sourcesDir = join(decompileDir, 'sources');
      const sourcesAvailable = await stat(sourcesDir)
        .then((s) => s.isDirectory())
        .catch(() => false);
      const sampleFiles = sourcesAvailable
        ? await findFilesByExtension(sourcesDir, ['.java', '.kt'], 20)
        : [];
      return jsonResponse({
        available: true,
        apkPath,
        outputDir: decompileDir,
        sourcesDir,
        resourcesDir: join(decompileDir, 'resources'),
        noResources,
        sampleFiles,
        next: 'Use jadx_search_code with decompileDir set to sourcesDir.',
      });
    } catch (error) {
      return jsonResponse({
        available: true,
        apkPath,
        outputDir: decompileDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleJadxSearchCode(args: Record<string, unknown>): Promise<unknown> {
    let decompileDir = readOptionalString(args, 'decompileDir');
    const apkPath = readOptionalString(args, 'apkPath');
    const query = readRequiredString(args, 'query');
    const jadxConfig = getReverseEngineeringConfig().jadx;
    const userTimeout = readOptionalNumber(args, 'timeoutMs');
    const searchTimeoutMs = userTimeout ?? jadxConfig.searchTimeoutMs;
    const threads = readOptionalNumber(args, 'threadsCount') ?? jadxConfig.threadsCount;

    if (!decompileDir && !apkPath) {
      throw new ToolError(
        'VALIDATION',
        'Either decompileDir or apkPath must be provided for jadx_search_code.',
      );
    }
    let autoDecompiled = false;
    let outDir: string | undefined;
    try {
      if (!decompileDir && apkPath) {
        const jadxProbe = await probeCommand('jadx', ['--version']);
        if (!jadxProbe.available) {
          return jsonResponse({
            success: false,
            available: false,
            capability: 'jadx_cli',
            fix: 'Install JADX and ensure jadx is on PATH.',
            apkPath,
            reason: jadxProbe.reason ?? 'jadx is not available',
          });
        }
        outDir = await mkdtemp(join(tmpdir(), `jshook-jadx-search-${basename(apkPath)}-`));
        await this.runJadx(
          jadxProbe.path ?? 'jadx',
          ['--no-res', '--no-debug-info', '-j', String(threads), '-d', outDir, apkPath],
          searchTimeoutMs,
        );
        decompileDir = join(outDir, 'sources');
        autoDecompiled = true;
      }

      const opts: JadxSearchOptions = { decompileDir: decompileDir!, query };
      const literal = readOptionalBoolean(args, 'literal');
      if (literal !== undefined) opts.literal = literal;
      const caseInsensitive = readOptionalBoolean(args, 'caseInsensitive');
      if (caseInsensitive !== undefined) opts.caseInsensitive = caseInsensitive;
      const contextLines = readOptionalNumber(args, 'contextLines');
      if (contextLines !== undefined) opts.contextLines = contextLines;
      const maxMatchesPerFile = readOptionalNumber(args, 'maxMatchesPerFile');
      if (maxMatchesPerFile !== undefined) opts.maxMatchesPerFile = maxMatchesPerFile;
      const maxResults = readOptionalNumber(args, 'maxResults');
      if (maxResults !== undefined) opts.maxResults = maxResults;

      const rawGlobs = args['globs'];
      if (rawGlobs !== undefined) {
        if (!Array.isArray(rawGlobs)) {
          throw new ToolError('VALIDATION', 'globs must be an array of strings');
        }
        const globs = readStringArray(args, 'globs');
        if (globs.length !== rawGlobs.length) {
          throw new ToolError('VALIDATION', 'globs contains non-string entries');
        }
        if (globs.length > 0) opts.globs = globs;
      }

      const result = await this.getJadxSearchEngine().search(opts);
      return jsonResponse({
        success: true,
        matches: result.matches,
        filesMatched: result.filesMatched,
        totalMatches: result.totalMatches,
        engine: result.engine,
        durationMs: result.durationMs,
        decompileDir: result.decompileDir,
        ...(autoDecompiled ? { autoDecompiled: true } : {}),
        ...(apkPath ? { apkPath } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      });
    } finally {
      // The auto-decompile scratch dir is a per-request artifact: always remove
      // it, whether the search succeeded, threw, or was interrupted mid-flight.
      if (outDir !== undefined) {
        await rm(outDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async handleApkManifestDump(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const decodedManifest = await this.decodeManifest(apkPath);
    if (!decodedManifest.success) {
      return jsonResponse({
        available: false,
        apkPath,
        entry: 'AndroidManifest.xml',
        error: decodedManifest.error,
      });
    }

    if (decodedManifest.format === 'xml') {
      return jsonResponse({
        available: true,
        apkPath,
        entry: 'AndroidManifest.xml',
        format: 'xml',
        decodedBy: decodedManifest.decodedBy,
        manifest: decodedManifest.manifest,
      });
    }

    return jsonResponse({
      available: true,
      apkPath,
      entry: 'AndroidManifest.xml',
      format: 'binary-axml',
      decodedBy: 'zip-entry',
      size: decodedManifest.buffer.length,
      manifestBase64: decodedManifest.buffer.toString('base64'),
    });
  }

  async handleApkManifestQuery(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const includeRawManifest = readOptionalBoolean(args, 'includeRawManifest') ?? false;
    const decodedManifest = await this.decodeManifest(apkPath);
    if (!decodedManifest.success) {
      return jsonResponse({
        available: false,
        apkPath,
        error: decodedManifest.error,
      });
    }
    if (decodedManifest.format !== 'xml') {
      return jsonResponse({
        available: true,
        apkPath,
        format: decodedManifest.format,
        decodedBy: decodedManifest.decodedBy,
        error: 'Manifest is binary AXML and all decoders (JADX CLI, AXML parser) failed.',
        size: decodedManifest.buffer.length,
      });
    }

    const entriesResult = await listZipEntries(apkPath);
    const entries = entriesResult.success ? entriesResult.entries : [];
    const summary = summarizeManifestXml(decodedManifest.manifest);
    const surfaceHints = matchApkSurfaceHints(
      entries,
      decodedManifest.manifest,
      readSurfaceHintOptions(args),
    );
    return jsonResponse({
      available: true,
      apkPath,
      format: 'xml',
      decodedBy: decodedManifest.decodedBy,
      summary,
      sdkHints: surfaceHints.sdkHints,
      protectorHints: surfaceHints.protectorHints,
      ...(includeRawManifest ? { manifest: decodedManifest.manifest } : {}),
    });
  }

  async handleApkStaticTriage(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const config = getReverseEngineeringConfig().apk;
    const maxEntries = Math.max(
      config.staticTriageMinEntries,
      Math.min(
        readOptionalNumber(args, 'maxEntries') ?? config.staticTriageDefaultEntries,
        config.staticTriageMaxEntries,
      ),
    );
    const apkStat = await stat(apkPath).catch(() => undefined);
    if (!apkStat?.isFile()) {
      return jsonResponse({ available: false, apkPath, error: 'APK path is not a regular file' });
    }

    const entriesResult = await listZipEntries(apkPath);
    if (!entriesResult.success) {
      return jsonResponse({ available: false, apkPath, error: entriesResult.error });
    }
    const entries = entriesResult.entries;
    const decodedManifest = await this.decodeManifest(apkPath);
    const manifestXml =
      decodedManifest.success && decodedManifest.format === 'xml' ? decodedManifest.manifest : '';
    const nativeLibs = entries
      .filter((entry) => /^lib\/.+\/[^/]+\.so$/i.test(entry))
      .map((entry) => {
        const parts = entry.split('/');
        return { path: entry, abi: parts[1] ?? '', name: parts[parts.length - 1] ?? '' };
      });
    const dexFiles = entries.filter((entry) => /(^|\/)classes.*\.(dex|cdex)$/i.test(entry));
    const assetHints = entries
      .filter(
        (entry) =>
          /(^|\/)(assets|unknown)\//i.test(entry) &&
          /\.(jar|dex|dat|bin|json|txt|dve|y)$/i.test(entry),
      )
      .slice(0, config.staticTriageAssetHintLimit);
    const hintOptions = readSurfaceHintOptions(args);
    const surfaceHints = matchApkSurfaceHints(entries, manifestXml, hintOptions);

    return jsonResponse({
      available: true,
      apkPath,
      file: {
        size: apkStat.size,
      },
      zip: {
        entryCount: entries.length,
        entries: entries.slice(0, maxEntries),
        truncated: entries.length > maxEntries,
      },
      manifest:
        manifestXml.length > 0
          ? {
              decodedBy: decodedManifest.success ? decodedManifest.decodedBy : undefined,
              summary: summarizeManifestXml(manifestXml),
            }
          : {
              decodedBy: decodedManifest.success ? decodedManifest.decodedBy : undefined,
              error: decodedManifest.success
                ? 'Manifest is not decoded XML'
                : decodedManifest.error,
            },
      nativeLibs: {
        count: nativeLibs.length,
        abis: uniqueStrings(nativeLibs.map((lib) => lib.abi)),
        libraries: nativeLibs.slice(0, config.staticTriageNativeLibLimit),
      },
      dexFiles,
      assetHints,
      protectorHints: surfaceHints.protectorHints,
      sdkHints: surfaceHints.sdkHints,
      recommendedNextSteps: [
        surfaceHints.protectorHints.length > 0
          ? 'Packed/protected APK detected: start with adb_app_cold_start_trace/logcat and local APK artifact triage before escalating to device-specific runtime dumping.'
          : 'No strong protector hint found: run jadx_decompile_apk then jadx_search_code for startup/splash logic.',
        nativeLibs.length > 0
          ? 'Inspect native libraries relevant to protectors or startup SDKs with apk_native_libs_list and ghidra/unidbg tools.'
          : 'Native library surface appears small or absent.',
      ],
    });
  }

  async handleApkDexIntake(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const maxEntries = readOptionalNumber(args, 'maxEntries');
    const includeRawManifest = readOptionalBoolean(args, 'includeRawManifest');
    const maxDexFiles = readOptionalNumber(args, 'maxDexFiles');
    const maxDexBytes = readOptionalNumber(args, 'maxDexBytes');
    const maxTotalDexBytes = readOptionalNumber(args, 'maxTotalDexBytes');
    const customSurfaceHints = readCustomSurfaceHints(args);
    const result = await analyzeApkDexIntake({
      apkPath,
      ...(maxEntries !== undefined ? { maxEntries } : {}),
      ...(includeRawManifest !== undefined ? { includeRawManifest } : {}),
      ...(maxDexFiles !== undefined ? { maxDexFiles } : {}),
      ...(maxDexBytes !== undefined ? { maxDexBytes } : {}),
      ...(maxTotalDexBytes !== undefined ? { maxTotalDexBytes } : {}),
      ...(customSurfaceHints ? { customSurfaceHints } : {}),
    });
    return jsonResponse(result);
  }

  private getJadxSearchEngine(): JadxSearchEngine {
    if (!this.state.jadxSearchEngine) {
      this.state.jadxSearchEngine = new JadxSearchEngine();
    }
    return this.state.jadxSearchEngine;
  }

  private async jadxNativeDecompile(
    jadx: string,
    apkPath: string,
    className: string,
    methodName?: string,
  ): Promise<unknown> {
    const jadxConfig = getReverseEngineeringConfig().jadx;
    const outDir = await mkdtemp(join(tmpdir(), 'jshook-jadx-'));
    try {
      const jadxArgs = [
        '--no-res',
        '--no-debug-info',
        '-j',
        String(jadxConfig.threadsCount),
        '-d',
        outDir,
        apkPath,
      ];
      await this.runJadx(jadx, jadxArgs, jadxConfig.singleClassTimeoutMs);

      const sourcesDir = join(outDir, 'sources');
      const resolvedClass = await resolveDecompiledClassFile(sourcesDir, className);
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
        const methodSource = extractMethodSource(source, methodName);
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

  private async decodeManifest(
    apkPath: string,
  ): Promise<
    | { success: true; format: 'xml'; decodedBy: string; manifest: string }
    | { success: true; format: 'binary-axml'; decodedBy: 'zip-entry'; buffer: Buffer }
    | { success: false; error: string }
  > {
    return decodeApkManifest(apkPath, {
      decodeBinaryManifest: async () => {
        const jadxProbe = await probeCommand('jadx', ['--version']);
        if (!jadxProbe.available) return undefined;
        const decoded = await this.decodeManifestWithJadx(jadxProbe.path ?? 'jadx', apkPath);
        return decoded.success ? decoded.manifest : undefined;
      },
    });
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

  private async runJadx(jadx: string, args: string[], timeoutMs = 120_000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      // jadx ships as jadx.bat on Windows, which execFile cannot start without cmd.exe.
      const command = toExecFileCommand(jadx, args);
      const child = execFile(
        command.file,
        command.args,
        {
          encoding: 'utf8',
          windowsHide: true,
          windowsVerbatimArguments: command.windowsVerbatimArguments,
        },
        (error) => {
          clearTimeout(timer);
          // JADX exits with code 1 on partial decompilation errors but still produces usable output.
          if (error && (error as { code?: number }).code !== 1) {
            reject(error);
            return;
          }
          resolve();
        },
      );

      const timer = setTimeout(() => {
        // Force-kill the tree: Node's built-in timeout sends SIGTERM which Java ignores on Windows.
        killProcessTree(child);
        reject(new Error(`JADX timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
}
