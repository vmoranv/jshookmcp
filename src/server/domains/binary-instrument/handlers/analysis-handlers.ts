/**
 * Static analysis sub-handler — Ghidra, IDA, JADX, Unidbg, hooks, plugins.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { GhidraAnalyzer, HookGenerator, getAvailablePlugins } from '@modules/binary-instrument';
import { AndroidRuntimeDumpSessionManager } from '@modules/binary-instrument/android-runtime-dump-session';
import { analyzeApkDexIntake } from '@modules/binary-instrument/apk-dex-intake';
import {
  matchApkSurfaceHints,
  type ApkSurfaceHintRule,
} from '@modules/binary-instrument/apk-surface-hints';
import { decodeApkManifest, listZipEntries } from '@modules/binary-instrument/apk-zip-inspection';
import { JadxSearchEngine } from '@modules/jadx-search';
import type { JadxSearchOptions } from '@modules/jadx-search';
import { probeCommand } from '@modules/external/ToolProbe';
import { ToolError } from '@errors/ToolError';
import {
  BINARY_STRINGS_MAX_RESULTS_DEFAULT,
  BINARY_STRINGS_MAX_RESULTS_LIMIT,
  BINARY_STRINGS_MIN_LENGTH_CEILING,
  BINARY_STRINGS_MIN_LENGTH_DEFAULT,
  BINARY_STRINGS_MIN_LENGTH_FLOOR,
  BINARY_STRINGS_PRINTABLE_ASCII_MAX,
  BINARY_STRINGS_PRINTABLE_ASCII_MIN,
  UNIDBG_TIMEOUT_MS,
} from '@src/constants';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
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

function uniqueStrings(values: string[], limit = 200): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function readXmlAttr(tag: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    tag.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ??
    tag.match(new RegExp(`\\bandroid:${escaped}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
  );
}

function listTags(xml: string, tagName: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?<\\/${tagName}>)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[0]) tags.push(match[0]);
  }
  return tags;
}

function summarizeManifestXml(xml: string): Record<string, unknown> {
  const manifestOpen = xml.match(/<manifest\b[^>]*>/i)?.[0] ?? '';
  const applicationOpen = xml.match(/<application\b[^>]*>/i)?.[0] ?? '';
  const activities = listTags(xml, 'activity');
  const activityAliases = listTags(xml, 'activity-alias');
  const services = listTags(xml, 'service');
  const receivers = listTags(xml, 'receiver');
  const providers = listTags(xml, 'provider');
  const permissions = uniqueStrings(
    [...xml.matchAll(/<uses-permission\b[^>]*\bandroid:name="([^"]+)"/gi)].map(
      (match) => match[1] ?? '',
    ),
    500,
  );
  const usesFeatures = uniqueStrings(
    [...xml.matchAll(/<uses-feature\b[^>]*\bandroid:name="([^"]+)"/gi)].map(
      (match) => match[1] ?? '',
    ),
    200,
  );
  const launcherTag =
    [...activities, ...activityAliases].find(
      (tag) =>
        /android\.intent\.action\.MAIN/i.test(tag) &&
        /android\.intent\.category\.LAUNCHER/i.test(tag),
    ) ?? '';

  const components = {
    activities: uniqueStrings(
      activities.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    activityAliases: uniqueStrings(
      activityAliases.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      200,
    ),
    services: uniqueStrings(
      services.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    receivers: uniqueStrings(
      receivers.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    providers: uniqueStrings(
      providers.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
  };

  return {
    packageName: readXmlAttr(manifestOpen, 'package'),
    versionCode: readXmlAttr(manifestOpen, 'versionCode'),
    versionName: readXmlAttr(manifestOpen, 'versionName'),
    minSdk: xml.match(/<uses-sdk\b[^>]*\bandroid:minSdkVersion="([^"]+)"/i)?.[1],
    targetSdk: xml.match(/<uses-sdk\b[^>]*\bandroid:targetSdkVersion="([^"]+)"/i)?.[1],
    applicationClass: readXmlAttr(applicationOpen, 'name'),
    applicationLabel: readXmlAttr(applicationOpen, 'label'),
    debuggable: readXmlAttr(applicationOpen, 'debuggable'),
    launcherActivity: launcherTag ? readXmlAttr(launcherTag, 'name') : undefined,
    permissions,
    usesFeatures,
    components,
    counts: {
      permissions: permissions.length,
      activities: components.activities.length,
      services: components.services.length,
      receivers: components.receivers.length,
      providers: components.providers.length,
    },
  };
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

function parseUnidbgReturnValue(stdout: string): string | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.toReversed()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) continue;
      const value = parsed['returnValue'] ?? parsed['retval'] ?? parsed['result'];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    } catch {
      // Non-JSON trace/log lines are parsed by the text fallback below.
    }
  }

  const textMatch = /\b(?:returnValue|retval|return|ret)[=:\s]+(0x[0-9a-fA-F]+|-?\d+)\b/i.exec(
    stdout,
  );
  return textMatch?.[1];
}

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

    // Check availability BEFORE calling analyze() — avoids PrerequisiteError
    // escaping to the MCP transport layer where it becomes an opaque "no output".
    if (!availability.available) {
      const binaryBuffer = await readFile(binaryPath).catch(() => Buffer.alloc(0));
      const strings = this.extractPrintableStringsStatic(binaryBuffer);
      return {
        available: false,
        capability: 'ghidra_headless',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
        binaryPath,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
        functions: [] as string[],
        imports: [] as string[],
        exports: [] as string[],
        strings,
      };
    }

    const analysis = await ghidra.analyze(
      binaryPath,
      timeout !== undefined ? { timeout } : undefined,
    );
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

    const jadxArgs = ['--no-debug-info'];
    if (noResources) jadxArgs.push('--no-res');
    jadxArgs.push('-d', decompileDir, apkPath);

    try {
      await this.runJadx(jadxProbe.path ?? 'jadx', jadxArgs, 300_000);
      const sourcesDir = join(decompileDir, 'sources');
      const sourcesAvailable = await stat(sourcesDir)
        .then((s) => s.isDirectory())
        .catch(() => false);
      const sampleFiles = sourcesAvailable
        ? await this.findFilesByExtension(sourcesDir, ['.java', '.kt'], 20)
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

  /**
   * Read-only ripgrep-backed search over an *existing* jadx decompile directory.
   * Does NOT decompile — callers run jadx_decompile first, then pass decompileDir.
   * (Merged from the former standalone jadx-search domain.)
   */
  async handleJadxSearchCode(args: Record<string, unknown>): Promise<unknown> {
    let decompileDir = readOptionalString(args, 'decompileDir');
    const apkPath = readOptionalString(args, 'apkPath');
    const query = readRequiredString(args, 'query');

    if (!decompileDir && !apkPath) {
      throw new ToolError(
        'VALIDATION',
        'Either decompileDir or apkPath must be provided for jadx_search_code.',
      );
    }
    let autoDecompiled = false;
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
      const outDir = await mkdtemp(join(tmpdir(), `jshook-jadx-search-${basename(apkPath)}-`));
      await this.runJadx(
        jadxProbe.path ?? 'jadx',
        ['--no-res', '--no-debug-info', '-d', outDir, apkPath],
        300_000,
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
  }

  private getJadxSearchEngine(): JadxSearchEngine {
    if (!this.state.jadxSearchEngine) {
      this.state.jadxSearchEngine = new JadxSearchEngine();
    }
    return this.state.jadxSearchEngine;
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
        error: 'Manifest is binary AXML and JADX decode fallback was unavailable or failed.',
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

  async handleDexScanFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const outputDir = readOptionalString(args, 'outputDir');
    const config = getReverseEngineeringConfig();
    const dexConfig = config.dex;
    const maxHits = Math.max(
      1,
      Math.min(
        readOptionalNumber(args, 'maxHits') ?? dexConfig.scanDefaultMaxHits,
        dexConfig.scanMaxHits,
      ),
    );
    const extract = readOptionalBoolean(args, 'extract') ?? false;
    const data = await readFile(filePath);
    if (extract && outputDir) {
      await mkdir(outputDir, { recursive: true });
    }

    const hits: Array<Record<string, unknown>> = [];
    const magics = [
      { kind: 'dex', magic: Buffer.from(config.binaryMagic.dexMagicAscii, 'ascii') },
      { kind: 'cdex', magic: Buffer.from(config.binaryMagic.compactDexMagicAscii, 'ascii') },
    ];
    for (let offset = 0; offset < data.length && hits.length < maxHits; offset++) {
      const found = magics.find(
        (entry) =>
          offset + entry.magic.length <= data.length &&
          data.subarray(offset, offset + entry.magic.length).equals(entry.magic),
      );
      if (!found) continue;
      const version = data
        .subarray(
          offset + found.magic.length,
          Math.min(offset + found.magic.length + 4, data.length),
        )
        .toString('latin1')
        .replaceAll('\u0000', '');
      const fileSize = offset + 36 <= data.length ? data.readUInt32LE(offset + 32) : undefined;
      const plausibleSize =
        fileSize !== undefined &&
        fileSize > 0x70 &&
        fileSize <= data.length - offset &&
        fileSize < dexConfig.scanMaxExtractBytes
          ? fileSize
          : undefined;
      let extractedPath: string | undefined;
      if (extract && outputDir && plausibleSize) {
        extractedPath = join(outputDir, `${found.kind}_${offset.toString(16)}.${found.kind}`);
        await writeFile(extractedPath, data.subarray(offset, offset + plausibleSize));
      }
      hits.push({
        kind: found.kind,
        offset,
        offsetHex: `0x${offset.toString(16)}`,
        version,
        fileSize,
        plausibleSize,
        ...(extractedPath ? { extractedPath } : {}),
      });
      offset += Math.max(0, found.magic.length - 1);
    }

    return jsonResponse({
      success: true,
      filePath,
      size: data.length,
      count: hits.length,
      hits,
      truncated: hits.length >= maxHits,
    });
  }

  async handleBinaryStringsExtract(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const minLength = Math.max(
      BINARY_STRINGS_MIN_LENGTH_FLOOR,
      Math.min(
        readOptionalNumber(args, 'minLength') ?? BINARY_STRINGS_MIN_LENGTH_DEFAULT,
        BINARY_STRINGS_MIN_LENGTH_CEILING,
      ),
    );
    const maxResults = Math.max(
      1,
      Math.min(
        readOptionalNumber(args, 'maxResults') ?? BINARY_STRINGS_MAX_RESULTS_DEFAULT,
        BINARY_STRINGS_MAX_RESULTS_LIMIT,
      ),
    );
    const pattern = readOptionalString(args, 'pattern');
    const regex = pattern ? new RegExp(pattern, 'i') : undefined;
    const data = await readFile(filePath);
    const strings: Array<{ offset: number; encoding: 'ascii' | 'utf16le'; value: string }> = [];
    const addString = (offset: number, encoding: 'ascii' | 'utf16le', value: string) => {
      if (value.length < minLength) return;
      if (regex && !regex.test(value)) return;
      strings.push({ offset, encoding, value });
    };

    let start = -1;
    for (let i = 0; i <= data.length; i++) {
      const byte = i < data.length ? data[i]! : 0;
      const printable =
        byte >= BINARY_STRINGS_PRINTABLE_ASCII_MIN && byte <= BINARY_STRINGS_PRINTABLE_ASCII_MAX;
      if (printable && start < 0) start = i;
      if ((!printable || i === data.length) && start >= 0) {
        addString(start, 'ascii', data.subarray(start, i).toString('utf8'));
        if (strings.length >= maxResults) break;
        start = -1;
      }
    }

    for (let i = 0; i + minLength * 2 <= data.length && strings.length < maxResults; i += 2) {
      if (data[i + 1] !== 0) continue;
      const startOffset = i;
      let end = i;
      while (
        end + 1 < data.length &&
        data[end + 1] === 0 &&
        data[end]! >= BINARY_STRINGS_PRINTABLE_ASCII_MIN &&
        data[end]! <= BINARY_STRINGS_PRINTABLE_ASCII_MAX
      ) {
        end += 2;
      }
      if (end > startOffset) {
        addString(startOffset, 'utf16le', data.subarray(startOffset, end).toString('utf16le'));
        i = end;
      }
    }

    return jsonResponse({
      success: true,
      filePath,
      size: data.length,
      minLength,
      pattern,
      count: strings.length,
      strings: strings.slice(0, maxResults),
      truncated: strings.length >= maxResults,
    });
  }

  async handleApkNativeLibsList(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const entriesResult = await listZipEntries(apkPath);
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
        success: false,
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path.',
        binaryPath,
        functionName,
        args: invokeArgs,
        reason: availability.reason,
      };
    }

    const result = await execFileUtf8(
      availability.command,
      ['-jar', availability.jarPath, binaryPath, functionName, ...invokeArgs],
      UNIDBG_TIMEOUT_MS,
    );
    const returnValue = parseUnidbgReturnValue(result.stdout);

    return {
      success: true,
      available: true,
      binaryPath,
      functionName,
      args: invokeArgs,
      result: {
        ...(returnValue !== undefined ? { returnValue } : { returnValueKnown: false }),
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

  async handleFridaDexDump(args: Record<string, unknown>): Promise<unknown> {
    const outputDir = readRequiredString(args, 'outputDir');
    const target = readOptionalString(args, 'target');
    const pid = readOptionalNumber(args, 'pid');
    const usb = readOptionalBoolean(args, 'usb') ?? true;
    const config = getReverseEngineeringConfig().frida;
    const timeoutMs = readOptionalNumber(args, 'timeoutMs') ?? config.dexDumpTimeoutMs;
    if (!pid && !target) {
      throw new ToolError('VALIDATION', 'Either pid or target must be provided for frida_dex_dump');
    }
    const probe = await probeCommand('frida-dexdump', ['--help']);
    if (!probe.available) {
      return jsonResponse({
        available: false,
        capability: 'frida-dexdump',
        fix: 'Install with `pip install frida-dexdump` and ensure it is on PATH.',
        reason: probe.reason ?? 'frida-dexdump is not available',
      });
    }
    await mkdir(outputDir, { recursive: true });
    const dexArgs: string[] = [];
    if (usb) dexArgs.push('-U');
    if (pid) dexArgs.push('-p', String(pid));
    else if (target) dexArgs.push('-n', target);
    dexArgs.push('-o', outputDir);

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      signal?: string;
    }>((resolve) => {
      execFile(
        probe.path ?? 'frida-dexdump',
        dexArgs,
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: config.dexDumpMaxBufferBytes,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            exitCode:
              typeof (error as { code?: unknown } | null)?.code === 'number'
                ? ((error as { code: number }).code ?? 1)
                : 0,
            signal:
              typeof (error as { signal?: unknown } | null)?.signal === 'string'
                ? ((error as { signal: string }).signal ?? undefined)
                : undefined,
          });
        },
      );
    });
    const dumpedFiles = await this.findFilesByExtension(
      outputDir,
      ['.dex', '.cdex'],
      config.dexDumpFileLimit,
    );
    const success = result.exitCode === 0 && dumpedFiles.length > 0;
    return jsonResponse({
      available: true,
      success,
      target,
      pid,
      outputDir,
      dumpedFiles,
      count: dumpedFiles.length,
      ...(!success && result.exitCode === 0
        ? { reason: 'No DEX/CDEX artifacts were produced by frida-dexdump.' }
        : {}),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...(result.signal ? { signal: result.signal } : {}),
    });
  }

  async handleAndroidRuntimeDumpSession(args: Record<string, unknown>): Promise<unknown> {
    const action = readOptionalString(args, 'action') ?? 'start';
    const manager = this.getAndroidRuntimeDumpManager();
    if (action === 'start') {
      const outputDir = readRequiredString(args, 'outputDir');
      const packageName = readOptionalString(args, 'packageName');
      const pid = readOptionalNumber(args, 'pid');
      const mapsPath = readOptionalString(args, 'mapsPath');
      const maxDexFiles = readOptionalNumber(args, 'maxDexFiles');
      const maxDexFileBytes = readOptionalNumber(args, 'maxDexFileBytes');
      const maxTotalDexBytes = readOptionalNumber(args, 'maxTotalDexBytes');
      const maxMapsBytes = readOptionalNumber(args, 'maxMapsBytes');
      const maxMapsModules = readOptionalNumber(args, 'maxMapsModules');
      const session = await manager.start({
        ...(packageName ? { packageName } : {}),
        ...(pid !== undefined ? { pid } : {}),
        outputDir,
        ...(mapsPath ? { mapsPath } : {}),
        ...(maxDexFiles !== undefined ? { maxDexFiles } : {}),
        ...(maxDexFileBytes !== undefined ? { maxDexFileBytes } : {}),
        ...(maxTotalDexBytes !== undefined ? { maxTotalDexBytes } : {}),
        ...(maxMapsBytes !== undefined ? { maxMapsBytes } : {}),
        ...(maxMapsModules !== undefined ? { maxMapsModules } : {}),
      });
      const success = session.evidence.dumpedDex.count > 0;
      return jsonResponse({
        success,
        action,
        ...session,
        ...(!success ? { reason: 'No DEX/CDEX artifacts were indexed from outputDir.' } : {}),
      });
    }
    if (action === 'status') {
      const sessionId = readRequiredString(args, 'sessionId');
      const session = manager.status({ sessionId });
      if (!session) {
        return jsonResponse({
          success: false,
          action,
          sessionId,
          reason: `Unknown Android runtime dump session: ${sessionId}`,
        });
      }
      return jsonResponse({ success: true, action, ...session });
    }
    if (action === 'list') {
      const sessions = manager.list();
      return jsonResponse({ success: true, action, sessions, count: sessions.length });
    }
    throw new ToolError('VALIDATION', 'action must be one of: start, status, list');
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.state.ghidra) this.state.ghidra = new GhidraAnalyzer();
    return this.state.ghidra;
  }

  private getHookGenerator(): HookGenerator {
    if (!this.state.hookGen) this.state.hookGen = new HookGenerator();
    return this.state.hookGen;
  }

  private getAndroidRuntimeDumpManager(): AndroidRuntimeDumpSessionManager {
    if (!this.state.androidRuntimeDumpManager) {
      this.state.androidRuntimeDumpManager = new AndroidRuntimeDumpSessionManager();
    }
    return this.state.androidRuntimeDumpManager;
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
      execFile(jadx, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs }, (error) => {
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

  private async findFilesByExtension(
    root: string,
    extensions: string[],
    limit: number,
  ): Promise<string[]> {
    const out: string[] = [];
    const lowerExts = extensions.map((ext) => ext.toLowerCase());
    const walk = async (directory: string): Promise<void> => {
      if (out.length >= limit) return;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (out.length >= limit) return;
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!lowerExts.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
        out.push(relative(root, fullPath).replace(/\\/g, '/'));
      }
    };
    await walk(root);
    return out;
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

  /**
   * Lightweight printable-string extraction used when Ghidra is unavailable.
   * Duplicated from GhidraAnalyzer to avoid coupling the handler to the analyzer
   * when we explicitly skip creating one.
   */
  private extractPrintableStringsStatic(buffer: Buffer): string[] {
    const results: string[] = [];
    let current = '';
    for (const byte of buffer.values()) {
      if (byte >= 0x20 && byte <= 0x7e) {
        current += String.fromCharCode(byte);
        continue;
      }
      if (current.length >= 4) results.push(current);
      current = '';
    }
    if (current.length >= 4) results.push(current);
    return Array.from(new Set(results)).slice(0, 500);
  }
}
