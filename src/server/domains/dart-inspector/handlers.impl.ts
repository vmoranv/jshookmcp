/**
 * dart-inspector domain — single tool handler that wraps the
 * {@link StringsExtractor} module.
 *
 * Responsibilities:
 *  - Type-safe argument extraction via `parseArgs` utilities.
 *  - Compile every customRule input into a `CategoryRule` (rejecting
 *    ReDoS heuristics and invalid regex with a `ToolError(VALIDATION)`).
 *  - Defer streaming extraction and categorization to the module layer.
 *  - Wrap the result in the standard MCP envelope via {@link handleSafe}.
 */

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import { compileRuleInput } from '@modules/dart-inspector/classifiers';
import { PackageDetector } from '@modules/dart-inspector/PackageDetector';
import type { PackageDetectOptions } from '@modules/dart-inspector/types.packages';
import { SmiScanner } from '@modules/dart-inspector/SmiScanner';
import type { SmiScanOptions, SmiWidth } from '@modules/dart-inspector/SmiScanner';
import { Symbolizer } from '@modules/dart-inspector/Symbolizer';
import type {
  SymbolizeOptions,
  SymbolizerFormat,
  SymbolizerMode,
} from '@modules/dart-inspector/Symbolizer';
import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';
import type { FingerprintOptions, ParseOptions } from '@modules/dart-inspector/snapshot-types';
import { ObjectPoolDumper } from '@modules/dart-inspector/ObjectPoolDumper';
import type { DumpOptions } from '@modules/dart-inspector/pool-types';
import type { VersionFingerprint } from '@modules/dart-inspector/snapshot-types';
import type {
  CategoryRule,
  CategoryRuleInput,
  ExtractOptions,
  RuleMode,
} from '@modules/dart-inspector/types';
import { ToolError } from '@errors/ToolError';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import {
  argBool,
  argEnum,
  argNumber,
  argObject,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';

const ENCODING_SET = new Set(['ascii', 'utf16le', 'both'] as const);
const RULE_MODE_SET = new Set(['append', 'prepend', 'replace'] as const);
const SYMBOLIZER_FORMAT_SET = new Set(['auto', 'flat', 'pairs', 'object'] as const);
const SYMBOLIZER_MODE_SET = new Set(['forward', 'reverse'] as const);

/**
 * Coerce the raw `customRules` argument into a list of compiled
 * {@link CategoryRule}s, throwing {@link ToolError}(`VALIDATION`) on
 * malformed shape.
 */
function compileCustomRules(raw: unknown): CategoryRule[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError('VALIDATION', 'customRules must be an array of rule objects');
  }
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ToolError('VALIDATION', `customRules[${index}] must be an object`);
    }
    const input = entry as Record<string, unknown>;
    const { category, pattern, flags, exclude, excludeFlags } = input;
    if (typeof category !== 'string') {
      throw new ToolError('VALIDATION', `customRules[${index}].category must be a string`);
    }
    if (typeof pattern !== 'string') {
      throw new ToolError('VALIDATION', `customRules[${index}].pattern must be a string`);
    }
    const ruleInput: CategoryRuleInput = { category, pattern };
    if (typeof flags === 'string') ruleInput.flags = flags;
    if (typeof exclude === 'string') ruleInput.exclude = exclude;
    if (typeof excludeFlags === 'string') ruleInput.excludeFlags = excludeFlags;
    if (typeof input['confidence'] === 'number') {
      ruleInput.confidence = input['confidence'];
    }
    if (typeof input['enableWhenFileNameMatches'] === 'string') {
      ruleInput.enableWhenFileNameMatches = input['enableWhenFileNameMatches'];
    }
    if (typeof input['enableWhenFileNameFlags'] === 'string') {
      ruleInput.enableWhenFileNameFlags = input['enableWhenFileNameFlags'];
    }
    return compileRuleInput(ruleInput);
  });
}

export class DartInspectorHandlers {
  private readonly extractor: StringsExtractor;
  private readonly smiScanner: SmiScanner;
  private readonly symbolizer: Symbolizer;
  private readonly packageDetector: PackageDetector;
  private readonly snapshotFingerprint: SnapshotFingerprint;
  private readonly objectPoolDumper: ObjectPoolDumper;

  constructor(
    extractor: StringsExtractor = new StringsExtractor(),
    smiScanner: SmiScanner = new SmiScanner(),
    symbolizer: Symbolizer = new Symbolizer(),
    packageDetector?: PackageDetector,
    snapshotFingerprint: SnapshotFingerprint = new SnapshotFingerprint(),
    objectPoolDumper?: ObjectPoolDumper,
  ) {
    this.extractor = extractor;
    this.smiScanner = smiScanner;
    this.symbolizer = symbolizer;
    this.packageDetector = packageDetector ?? new PackageDetector(extractor);
    this.snapshotFingerprint = snapshotFingerprint;
    this.objectPoolDumper = objectPoolDumper ?? new ObjectPoolDumper(snapshotFingerprint);
  }

  handleDartStringsExtract(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const customRules = compileCustomRules(args['customRules']);

      const opts: ExtractOptions = {};
      const minLength = argNumber(args, 'minLength');
      if (minLength !== undefined) opts.minLength = minLength;
      const includeRaw = argBool(args, 'includeRaw');
      if (includeRaw !== undefined) opts.includeRaw = includeRaw;
      const includeOffsets = argBool(args, 'includeOffsets');
      if (includeOffsets !== undefined) opts.includeOffsets = includeOffsets;
      const encoding = argEnum(args, 'encoding', ENCODING_SET);
      if (encoding !== undefined) opts.encoding = encoding;
      const maxChunkBytes = argNumber(args, 'maxChunkBytes');
      if (maxChunkBytes !== undefined) opts.maxChunkBytes = maxChunkBytes;
      const maxOffsetsPerString = argNumber(args, 'maxOffsetsPerString');
      if (maxOffsetsPerString !== undefined) opts.maxOffsetsPerString = maxOffsetsPerString;
      const ruleMode = argEnum(args, 'ruleMode', RULE_MODE_SET) as RuleMode | undefined;
      if (ruleMode !== undefined) opts.ruleMode = ruleMode;
      const regexTimeoutMs = argNumber(args, 'regexTimeoutMs');
      if (regexTimeoutMs !== undefined) opts.regexTimeoutMs = regexTimeoutMs;
      if (customRules !== undefined) opts.customRules = customRules;

      const scanWindowRaw = argObject(args, 'scanWindow');
      if (scanWindowRaw !== undefined) {
        const start =
          typeof scanWindowRaw['start'] === 'number' ? scanWindowRaw['start'] : undefined;
        const end = typeof scanWindowRaw['end'] === 'number' ? scanWindowRaw['end'] : undefined;
        opts.scanWindow = { start, end };
      }
      const scanStride = argNumber(args, 'scanStride');
      if (scanStride !== undefined) opts.scanStride = scanStride;

      const strings = await this.extractor.extractFromFile(filePath, opts);
      return { strings };
    });
  }

  handleDartSmiScan(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: SmiScanOptions = {};
      const widthRaw = argString(args, 'width');
      if (widthRaw !== undefined) {
        if (widthRaw !== '4' && widthRaw !== '8') {
          throw new ToolError('VALIDATION', `width must be "4" or "8" (got "${widthRaw}")`);
        }
        opts.width = Number(widthRaw) as SmiWidth;
      }
      const stride = argNumber(args, 'stride');
      if (stride !== undefined) opts.stride = stride;
      const minValue = argNumber(args, 'minValue');
      if (minValue !== undefined) opts.minValue = minValue;
      const maxValue = argNumber(args, 'maxValue');
      if (maxValue !== undefined) opts.maxValue = maxValue;
      const includeZero = argBool(args, 'includeZero');
      if (includeZero !== undefined) opts.includeZero = includeZero;
      const includeNegative = argBool(args, 'includeNegative');
      if (includeNegative !== undefined) opts.includeNegative = includeNegative;
      const maxResults = argNumber(args, 'maxResults');
      if (maxResults !== undefined) opts.maxResults = maxResults;
      const maxChunkBytes = argNumber(args, 'maxChunkBytes');
      if (maxChunkBytes !== undefined) opts.maxChunkBytes = maxChunkBytes;

      const scanWindowRaw = argObject(args, 'scanWindow');
      if (scanWindowRaw !== undefined) {
        const start =
          typeof scanWindowRaw['start'] === 'number' ? scanWindowRaw['start'] : undefined;
        const end = typeof scanWindowRaw['end'] === 'number' ? scanWindowRaw['end'] : undefined;
        opts.scanWindow = { start, end };
      }

      const result = await this.smiScanner.scanFile(filePath, opts);
      return { smi: result };
    });
  }

  handleDartSymbolize(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const mapPath = argStringRequired(args, 'obfuscationMapFile');
      const rawNames = args['obfuscatedNames'];
      if (!Array.isArray(rawNames)) {
        throw new ToolError('VALIDATION', 'obfuscatedNames must be an array of strings');
      }
      const names = argStringArray(args, 'obfuscatedNames');
      if (names.length !== rawNames.length) {
        throw new ToolError('VALIDATION', 'obfuscatedNames contains non-string entries', {
          details: { firstNonStringIndex: rawNames.findIndex((v) => typeof v !== 'string') },
        });
      }
      const opts: SymbolizeOptions = {};
      const format = argEnum(args, 'format', SYMBOLIZER_FORMAT_SET);
      if (format !== undefined) opts.format = format as SymbolizerFormat;
      const mode = argEnum(args, 'mode', SYMBOLIZER_MODE_SET);
      if (mode !== undefined) opts.mode = mode as SymbolizerMode;
      const maxMapBytes = argNumber(args, 'maxMapBytes');
      if (maxMapBytes !== undefined) opts.maxMapBytes = maxMapBytes;
      const maxLookups = argNumber(args, 'maxLookups');
      if (maxLookups !== undefined) opts.maxLookups = maxLookups;

      const result = await this.symbolizer.resolveNames(names, mapPath, opts);
      return { symbols: result };
    });
  }

  handleDartPackagesDetect(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: PackageDetectOptions = { filePath };

      const includeFlutterStdlib = argBool(args, 'includeFlutterStdlib');
      if (includeFlutterStdlib !== undefined) opts.includeFlutterStdlib = includeFlutterStdlib;
      const includeFiles = argBool(args, 'includeFiles');
      if (includeFiles !== undefined) opts.includeFiles = includeFiles;
      const includeOffsets = argBool(args, 'includeOffsets');
      if (includeOffsets !== undefined) opts.includeOffsets = includeOffsets;
      const maxFilesPerPackage = argNumber(args, 'maxFilesPerPackage');
      if (maxFilesPerPackage !== undefined) opts.maxFilesPerPackage = maxFilesPerPackage;
      const maxPackages = argNumber(args, 'maxPackages');
      if (maxPackages !== undefined) opts.maxPackages = maxPackages;

      if (args['extraStdlibPackages'] !== undefined) {
        const raw = args['extraStdlibPackages'];
        if (!Array.isArray(raw)) {
          throw new ToolError('VALIDATION', 'extraStdlibPackages must be an array of strings');
        }
        // Preserve every element so PackageDetector can validate per-entry
        // shape (length / type) rather than silently dropping non-strings.
        opts.extraStdlibPackages = raw as readonly string[];
      }

      const report = await this.packageDetector.detect(opts);
      return { packages: report };
    });
  }

  handleDartSnapshotHeaderParse(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: ParseOptions = {};
      const maxScanBytes = argNumber(args, 'maxScanBytes');
      if (maxScanBytes !== undefined) opts.maxScanBytes = maxScanBytes;
      const snapshot = await this.snapshotFingerprint.parseHeader(filePath, opts);
      return { snapshot };
    });
  }

  handleDartVersionFingerprint(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: FingerprintOptions = {};
      const maxScanBytes = argNumber(args, 'maxScanBytes');
      if (maxScanBytes !== undefined) opts.maxScanBytes = maxScanBytes;
      const includeFeatures = argBool(args, 'includeFeatures');
      if (includeFeatures !== undefined) opts.includeFeatures = includeFeatures;
      const customTablePath = argString(args, 'customTablePath');
      if (customTablePath !== undefined && customTablePath.length > 0) {
        opts.customTablePath = customTablePath;
      }
      const fingerprint = await this.snapshotFingerprint.fingerprint(filePath, opts);
      return { fingerprint };
    });
  }

  handleDartObjectPoolDump(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const filePath = argStringRequired(args, 'filePath');
      const opts: DumpOptions = {};
      const maxSlots = argNumber(args, 'maxSlots');
      if (maxSlots !== undefined) opts.maxSlots = maxSlots;
      const previewBytes = argNumber(args, 'previewBytes');
      if (previewBytes !== undefined) opts.previewBytes = previewBytes;
      const grammar = argString(args, 'grammar');
      if (grammar !== undefined && grammar.length > 0) opts.grammar = grammar;

      const fingerprintRaw = argObject(args, 'fingerprint');
      if (fingerprintRaw !== undefined) {
        opts.fingerprint = coerceFingerprint(fingerprintRaw);
      }

      const dump = await this.objectPoolDumper.dump(filePath, opts);
      return { dump };
    });
  }

  handleDartLoadSnapshot(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      // Import dynamically to avoid circular dependencies
      const { DartAotLoader } = await import('@modules/native-emulator/dart/DartAotLoader');

      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');

      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      const loader = new DartAotLoader();
      const snapshot = await loader.loadSnapshot(apkPath ?? libappPath!);

      return {
        snapshot: {
          header: {
            magic: `0x${snapshot.header.magic.toString(16)}`,
            kind: snapshot.header.kind,
            features: snapshot.header.features.toString(16),
            baseObjects: snapshot.header.baseObjects,
            numObjects: snapshot.header.numObjects,
            numClusters: snapshot.header.numClusters,
            fieldTableLen: snapshot.header.fieldTableLen,
            codeStartOffset: snapshot.header.codeStartOffset.toString(16),
            dataStartOffset: snapshot.header.dataStartOffset.toString(16),
          },
          statistics: {
            totalClusters: snapshot.clusters.length,
            codeObjectCount: snapshot.codeObjects.length,
            objectPoolCount: snapshot.objectPools.length,
          },
        },
      };
    });
  }

  handleDartListFunctions(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const { DartAotLoader } = await import('@modules/native-emulator/dart/DartAotLoader');

      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');
      const maxFunctions = argNumber(args, 'maxFunctions');

      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      const loader = new DartAotLoader();
      const snapshot = await loader.loadSnapshot(apkPath ?? libappPath!);

      let functions = snapshot.codeObjects.map((code) => ({
        entryPoint: `0x${code.entryPoint.toString(16)}`,
        size: code.size,
        name: code.name,
        objectPool: `0x${code.objectPool.toString(16)}`,
        pcDescriptors: `0x${code.pcDescriptors.toString(16)}`,
      }));

      const truncated = maxFunctions && functions.length > maxFunctions;
      if (truncated) {
        functions = functions.slice(0, maxFunctions);
      }

      return {
        functions,
        totalCount: snapshot.codeObjects.length,
        truncated,
      };
    });
  }

  handleDartCallFunction(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const { DartAotExecutor } = await import('@modules/native-emulator/dart/DartAotExecutor');

      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');
      const functionAddress = argString(args, 'functionAddress');
      const functionName = argString(args, 'functionName');
      const argsRaw = args['args'];
      const maxSteps = argNumber(args, 'maxSteps') ?? 100000;
      const traceExecution = argBool(args, 'traceExecution') ?? false;

      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      if (!functionAddress && !functionName) {
        throw new ToolError(
          'VALIDATION',
          'Either functionAddress or functionName must be provided',
        );
      }

      // Parse arguments
      const functionArgs: bigint[] = [];
      if (Array.isArray(argsRaw)) {
        for (const arg of argsRaw) {
          if (typeof arg !== 'string') {
            throw new ToolError('VALIDATION', 'All args must be hex strings');
          }
          functionArgs.push(BigInt(arg));
        }
      }

      const executor = new DartAotExecutor();
      await executor.load(apkPath ?? libappPath!);

      const result = await executor.call({
        address: functionAddress ? BigInt(functionAddress) : undefined,
        name: functionName,
        args: functionArgs,
        maxSteps,
        trace: traceExecution,
      });

      return {
        result: {
          returnValue: `0x${result.returnValue.toString(16)}`,
          steps: result.steps,
          trace: result.trace,
          error: result.error,
        },
      };
    });
  }

  handleDartInspectObjectPool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const { DartAotLoader } = await import('@modules/native-emulator/dart/DartAotLoader');

      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');
      const poolAddress = argStringRequired(args, 'poolAddress');

      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      const loader = new DartAotLoader();
      const snapshot = await loader.loadSnapshot(apkPath ?? libappPath!);

      const addr = BigInt(poolAddress);
      const pool = snapshot.objectPools.find((p) => p.address === addr);

      if (!pool) {
        throw new ToolError('NOT_FOUND', `ObjectPool not found at address ${poolAddress}`);
      }

      return {
        pool: {
          address: poolAddress,
          length: pool.pool.getLength(),
          entries: pool.pool.getAllEntries().map((entry, index) => ({
            offset: `0x${(index * 8).toString(16)}`,
            type: entry.type,
            value: `0x${entry.value.toString(16)}`,
            name: entry.name,
          })),
        },
      };
    });
  }

  handleDartTraceExecution(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const { DartAotExecutor } = await import('@modules/native-emulator/dart/DartAotExecutor');

      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');
      const functionAddress = argString(args, 'functionAddress');
      const functionName = argString(args, 'functionName');
      const maxSteps = argNumber(args, 'maxSteps') ?? 1000;
      const argsRaw = args['args'];

      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      if (!functionAddress && !functionName) {
        throw new ToolError(
          'VALIDATION',
          'Either functionAddress or functionName must be provided',
        );
      }

      const functionArgs: bigint[] = [];
      if (Array.isArray(argsRaw)) {
        for (const arg of argsRaw) {
          if (typeof arg !== 'string') {
            throw new ToolError('VALIDATION', 'All args must be hex strings');
          }
          functionArgs.push(BigInt(arg));
        }
      }

      const executor = new DartAotExecutor();
      await executor.load(apkPath ?? libappPath!);

      const result = await executor.call({
        address: functionAddress ? BigInt(functionAddress) : undefined,
        name: functionName,
        args: functionArgs,
        maxSteps,
        trace: true,
      });

      return {
        trace: {
          steps: result.steps,
          instructions: result.trace,
          finalState: {
            returnValue: `0x${result.returnValue.toString(16)}`,
          },
          error: result.error,
        },
      };
    });
  }
}

/**
 * Coerce a partial fingerprint argument into a {@link VersionFingerprint}.
 * Missing fields are filled with neutral defaults so the dumper sees a
 * complete shape; callers typically only supply the SDK identification
 * fields (flutterVersion / dartSdkRev / targetArch).
 */
function coerceFingerprint(raw: Record<string, unknown>): VersionFingerprint {
  const fp: VersionFingerprint = {
    magic: typeof raw['magic'] === 'number' ? raw['magic'] : 0,
    kind: pickKind(raw['kind']),
    hash: typeof raw['hash'] === 'string' ? raw['hash'] : '',
    features: Array.isArray(raw['features'])
      ? raw['features'].filter((v): v is string => typeof v === 'string')
      : [],
    targetArch: pickArch(raw['targetArch']),
    isProduction: typeof raw['isProduction'] === 'boolean' ? raw['isProduction'] : false,
    fileOffset: typeof raw['fileOffset'] === 'number' ? raw['fileOffset'] : 0,
    source: pickSource(raw['source']),
    unknown: typeof raw['unknown'] === 'boolean' ? raw['unknown'] : false,
  };
  if (typeof raw['flutterVersion'] === 'string') fp.flutterVersion = raw['flutterVersion'];
  if (typeof raw['dartSdkRev'] === 'string') fp.dartSdkRev = raw['dartSdkRev'];
  if (typeof raw['engineCommit'] === 'string') fp.engineCommit = raw['engineCommit'];
  if (typeof raw['releaseDate'] === 'string') fp.releaseDate = raw['releaseDate'];
  return fp;
}

function pickKind(value: unknown): VersionFingerprint['kind'] {
  if (
    value === 'full' ||
    value === 'full-aot' ||
    value === 'full-jit' ||
    value === 'full-core' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function pickArch(value: unknown): VersionFingerprint['targetArch'] {
  if (
    value === 'arm32' ||
    value === 'arm64' ||
    value === 'x64' ||
    value === 'ia32' ||
    value === 'riscv64' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function pickSource(value: unknown): VersionFingerprint['source'] {
  if (value === 'symbol' || value === 'byte-scan') return value;
  return 'byte-scan';
}
