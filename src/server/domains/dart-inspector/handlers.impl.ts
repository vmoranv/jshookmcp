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
import { locateObfuscationMap } from '@modules/dart-inspector/ObfuscationMapLocator';
import type {
  SymbolizeOptions,
  SymbolizerFormat,
  SymbolizerMode,
} from '@modules/dart-inspector/Symbolizer';
import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';
import type { FingerprintOptions, ParseOptions } from '@modules/dart-inspector/snapshot-types';
import { ObjectPoolDumper } from '@modules/dart-inspector/ObjectPoolDumper';
import { filterPoolSlots } from '@modules/dart-inspector/pool-filter';
import type { DumpOptions } from '@modules/dart-inspector/pool-types';
import type { VersionFingerprint } from '@modules/dart-inspector/snapshot-types';
import { DartSnapshotSessionManager } from '@modules/native-emulator/dart/DartSnapshotSessionManager';
import type { LoadedSnapshot } from '@modules/native-emulator/dart/DartAotLoader';
import {
  parsePcDescriptorsData,
  resolveCallTargets,
  filterCallEntries,
  buildFunctionMap,
  type PcDescriptorEntry,
} from '@modules/native-emulator/dart/PcDescriptorsParser';
import type {
  CategoryRule,
  CategoryRuleInput,
  ExtractOptions,
  RuleMode,
} from '@modules/dart-inspector/types';
import { ToolError } from '@errors/ToolError';
import {
  DART_CALL_GRAPH_MAX_EDGES,
  DART_EXEC_MAX_STEPS,
  DART_TRACE_MAX_STEPS,
} from '@src/constants/dart';
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

/** Format a bigint address as a lowercase hex string (`0x`-prefixed). */
const hex = (n: bigint): string => `0x${n.toString(16)}`;

/** Parse a `0x`-prefixed hex address, surfacing a VALIDATION error instead of a raw SyntaxError. */
function parseHexAddress(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^0x[0-9a-f]+$/i.test(trimmed)) {
    throw new ToolError(
      'VALIDATION',
      `${label} must be a hex address like 0x12345678 (got "${value}")`,
    );
  }
  return BigInt(trimmed);
}

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

/** One call-graph edge ("pool" = ObjectPool heuristic, "bl" = BL decode). */
interface DartCallGraphEdge {
  from: string;
  to: string;
  fromName?: string;
  toName?: string;
  resolved?: string;
}

/** Mutable counters shared by the two edge-collection phases. */
interface DartCallGraphState {
  edges: DartCallGraphEdge[];
  maxEdges: number;
  hitCap: boolean;
  poolsScanned: number;
  poolsMissing: number;
  blResolvedEdges: number;
  entryByAddr: Map<bigint, DartCodeObject>;
}

type DartCodeObject = LoadedSnapshot['codeObjects'][number];

/** Collect PcDescriptors cluster raw data keyed by hex offset (for BL resolution). */
function collectPcDescriptorData(snapshot: LoadedSnapshot): Map<string, Uint8Array> {
  const pcDescDataByOffset = new Map<string, Uint8Array>();
  for (const cluster of snapshot.clusters) {
    if (cluster.type !== 'PcDescriptors') continue;
    for (const obj of cluster.objects) {
      pcDescDataByOffset.set(`0x${obj.offset.toString(16)}`, obj.data);
    }
  }
  return pcDescDataByOffset;
}

/** Phase 1: ObjectPool-based edges (heuristic; pool entries may carry a Dart
 * heap tag bit, so each candidate is also tried tag-stripped −1). */
function collectPoolEdges(
  snapshot: LoadedSnapshot,
  code: DartCodeObject,
  state: DartCallGraphState,
): void {
  const pool = snapshot.objectPools.find((p) => p.address === code.objectPool);
  if (!pool) {
    state.poolsMissing++;
    return;
  }
  state.poolsScanned++;
  for (const poolEntry of pool.pool.getAllEntries()) {
    if (state.hitCap) break;
    if (poolEntry.value === 0n) continue;
    for (const candidate of [poolEntry.value, poolEntry.value - 1n]) {
      const target = state.entryByAddr.get(candidate);
      if (target && target.entryPoint !== code.entryPoint) {
        state.edges.push({
          from: hex(code.entryPoint),
          to: hex(target.entryPoint),
          fromName: code.name || undefined,
          toName: target.name || undefined,
          resolved: 'pool',
        });
        if (state.edges.length >= state.maxEdges) state.hitCap = true;
        break;
      }
    }
  }
}

/** Phase 2: ARM64 BL instruction edges resolved at PcDescriptors call sites. */
function collectBlEdges(
  code: DartCodeObject,
  state: DartCallGraphState,
  pcDescDataByOffset: Map<string, Uint8Array>,
  functionMap: ReturnType<typeof buildFunctionMap>,
): void {
  if (code.instructions.length === 0) return;
  const pcOffsetKey = `0x${code.pcDescriptors.toString(16)}`;
  const pcData = pcDescDataByOffset.get(pcOffsetKey);
  if (!pcData) return;

  const descriptors = parsePcDescriptorsData(pcData);
  const callDescriptors = filterCallEntries(descriptors);
  if (callDescriptors.length === 0) return;

  const targets = resolveCallTargets(
    callDescriptors,
    code.instructions,
    Number(code.entryPoint),
    functionMap,
  );

  for (const target of targets) {
    if (state.hitCap) break;
    if (!target.functionName) continue;
    if (target.targetAddress === Number(code.entryPoint)) continue;

    state.edges.push({
      from: hex(code.entryPoint),
      to: target.targetHex,
      fromName: code.name || undefined,
      toName: target.functionName,
      resolved: 'bl',
    });
    state.blResolvedEdges++;
    if (state.edges.length >= state.maxEdges) state.hitCap = true;
  }
}

/** Build the dart_call_graph response from a resolved snapshot. */
function buildDartCallGraph(snapshot: LoadedSnapshot, maxEdges: number): Record<string, unknown> {
  const codes = snapshot.codeObjects;

  const entryByAddr = new Map<bigint, DartCodeObject>();
  for (const code of codes) {
    entryByAddr.set(code.entryPoint, code);
  }

  const nodes = codes.map((code) => ({
    entry: hex(code.entryPoint),
    name: code.name,
    size: code.size,
    hasName: Boolean(code.name),
  }));

  const state: DartCallGraphState = {
    edges: [],
    maxEdges,
    hitCap: false,
    poolsScanned: 0,
    poolsMissing: 0,
    blResolvedEdges: 0,
    entryByAddr,
  };
  const pcDescDataByOffset = collectPcDescriptorData(snapshot);
  const functionMap = buildFunctionMap(codes);

  for (const code of codes) {
    if (state.hitCap) break;
    collectPoolEdges(snapshot, code, state);
    if (state.hitCap) break;
    collectBlEdges(code, state, pcDescDataByOffset, functionMap);
  }

  const entryPoints = nodes.filter((n) => /main|entry/i.test(n.name ?? ''));

  return {
    nodes,
    edges: state.edges,
    nodeCount: nodes.length,
    edgeCount: state.edges.length,
    entryPoints,
    poolsScanned: state.poolsScanned,
    poolsMissing: state.poolsMissing,
    blResolvedEdges: state.blResolvedEdges,
    truncated: state.hitCap,
    honestBoundary:
      'Edges are derived from (1) ObjectPool entries matching Code entry points (resolved=pool) ' +
      'and (2) ARM64 BL instruction decoding at PcDescriptors call-site PC offsets (resolved=bl). ' +
      'Indirect calls (BLR, dispatch tables, virtual/interface) are not resolved. PcDescriptors ' +
      'cluster format varies by Dart SDK version.',
  };
}

export class DartInspectorHandlers {
  private readonly extractor: StringsExtractor;
  private readonly smiScanner: SmiScanner;
  private readonly symbolizer: Symbolizer;
  private readonly packageDetector: PackageDetector;
  private readonly snapshotFingerprint: SnapshotFingerprint;
  private readonly objectPoolDumper: ObjectPoolDumper;
  private readonly sessions: DartSnapshotSessionManager;

  constructor(
    extractor: StringsExtractor = new StringsExtractor(),
    smiScanner: SmiScanner = new SmiScanner(),
    symbolizer: Symbolizer = new Symbolizer(),
    packageDetector?: PackageDetector,
    snapshotFingerprint: SnapshotFingerprint = new SnapshotFingerprint(),
    objectPoolDumper?: ObjectPoolDumper,
    sessions: DartSnapshotSessionManager = new DartSnapshotSessionManager(),
  ) {
    this.extractor = extractor;
    this.smiScanner = smiScanner;
    this.symbolizer = symbolizer;
    this.packageDetector = packageDetector ?? new PackageDetector(extractor);
    this.snapshotFingerprint = snapshotFingerprint;
    this.objectPoolDumper = objectPoolDumper ?? new ObjectPoolDumper(snapshotFingerprint);
    this.sessions = sessions;
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
        // Only pass a bounded window — { start: undefined, end: undefined } would
        // silently degrade to a full-file scan downstream.
        if (start !== undefined || end !== undefined) {
          opts.scanWindow = { start, end };
        }
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
        // Only pass a bounded window — { start: undefined, end: undefined } would
        // silently degrade to a full-file scan downstream.
        if (start !== undefined || end !== undefined) {
          opts.scanWindow = { start, end };
        }
      }

      const result = await this.smiScanner.scanFile(filePath, opts);
      return { smi: result };
    });
  }

  handleDartSymbolize(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const explicitMapPath = argString(args, 'obfuscationMapFile');
      const apkPath = argString(args, 'apkPath');
      const searchDir = argString(args, 'searchDir');
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

      let mapPath: string;
      let mapSource: string;
      if (explicitMapPath) {
        mapPath = explicitMapPath;
        mapSource = 'user-supplied';
      } else {
        if (!apkPath && !searchDir) {
          throw new ToolError(
            'VALIDATION',
            'Provide obfuscationMapFile, or apkPath/searchDir to auto-detect the obfuscation map',
          );
        }
        const located = await locateObfuscationMap({ apkPath, searchDir });
        if (!located) {
          throw new ToolError('NOT_FOUND', 'No obfuscation map sidecar found', {
            details: { apkPath, searchDir },
          });
        }
        mapPath = located.path;
        mapSource = located.source;
      }

      const result = await this.symbolizer.resolveNames(names, mapPath, opts);
      return { symbols: result, mapSource };
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
      const typeFilter = argString(args, 'typeFilter');
      const valueContains = argString(args, 'valueContains');
      if (typeFilter || valueContains) {
        const slots = filterPoolSlots(dump.slots, { typeFilter, valueContains });
        return {
          dump: { ...dump, slots, slotCount: slots.length, filtered: true },
        };
      }
      return { dump };
    });
  }

  handleDartLoadSnapshot(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshot = await this.resolveSnapshot(args);

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
      const snapshot = await this.resolveSnapshot(args);
      const maxFunctions = argNumber(args, 'maxFunctions');

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

  handleDartPcDescriptors(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshot = await this.resolveSnapshot(args);
      const functionName = argString(args, 'functionName');
      const functionAddress = argString(args, 'functionAddress');
      const resolveTargets = argBool(args, 'resolveTargets') ?? true;
      const callSitesOnly = argBool(args, 'callSitesOnly') ?? true;
      const maxResults = argNumber(args, 'maxResults');

      // Select target functions
      let codes = snapshot.codeObjects;
      if (functionAddress) {
        const addr = parseHexAddress(functionAddress, 'functionAddress');
        codes = codes.filter((c) => c.entryPoint === addr);
        if (codes.length === 0) {
          throw new ToolError('NOT_FOUND', `No function found at address ${functionAddress}`);
        }
      } else if (functionName) {
        codes = codes.filter((c) => c.name === functionName);
        if (codes.length === 0) {
          throw new ToolError('NOT_FOUND', `No function found with name "${functionName}"`);
        }
      }

      // Build PcDescriptors offset → raw data map from clusters
      const pcDescDataByOffset = new Map<string, Uint8Array>();
      for (const cluster of snapshot.clusters) {
        if (cluster.type !== 'PcDescriptors') continue;
        for (const obj of cluster.objects) {
          pcDescDataByOffset.set(`0x${obj.offset.toString(16)}`, obj.data);
        }
      }

      // Build function map for target resolution
      const functionMap = buildFunctionMap(snapshot.codeObjects);

      type PerFunction = {
        entryPoint: string;
        functionName?: string;
        size: number;
        totalDescriptors: number;
        callSites: number;
        descriptors: Array<Record<string, unknown>>;
        callTargets?: Array<Record<string, unknown>>;
      };

      const results: PerFunction[] = [];
      let totalEntries = 0;
      let wasTruncated = false;

      for (const code of codes) {
        if (maxResults !== undefined && totalEntries >= maxResults) {
          wasTruncated = true;
          break;
        }

        const pcOffsetKey = `0x${code.pcDescriptors.toString(16)}`;
        const pcData = pcDescDataByOffset.get(pcOffsetKey);

        const descriptors: PcDescriptorEntry[] = pcData ? parsePcDescriptorsData(pcData) : [];
        const filteredDescriptors = callSitesOnly ? filterCallEntries(descriptors) : descriptors;
        const remaining = maxResults === undefined ? Infinity : maxResults - totalEntries;
        const returnedDescriptors = filteredDescriptors.slice(0, remaining);
        if (returnedDescriptors.length < filteredDescriptors.length) wasTruncated = true;
        totalEntries += returnedDescriptors.length;

        const descriptorsOut = returnedDescriptors.map((d) => ({
          pcOffset: d.pcOffset,
          kind: d.kind,
          kindLabel: pcDescriptorKindLabel(d.kind),
          deoptId: d.deoptId,
          tokenPos: d.tokenPos,
        }));

        let callTargets: Record<string, unknown>[] | undefined;
        let blResolved = 0;
        let blUnresolved = 0;
        let blNotBl = 0;

        if (resolveTargets && returnedDescriptors.length > 0 && code.instructions.length > 0) {
          const targets = resolveCallTargets(
            returnedDescriptors,
            code.instructions,
            Number(code.entryPoint),
            functionMap,
          );
          callTargets = targets.map((t) => ({
            pcOffset: t.pcOffset,
            targetAddress: t.targetHex,
            functionName: t.functionName,
            instruction: `0x${t.instruction.toString(16).padStart(8, '0')}`,
            kind: t.kind,
            kindLabel: pcDescriptorKindLabel(t.kind),
          }));
          blResolved = targets.filter((t) => t.functionName).length;
          blUnresolved = targets.filter((t) => !t.functionName).length;
          blNotBl = returnedDescriptors.length - blResolved - blUnresolved;
        }

        results.push({
          entryPoint: hex(code.entryPoint),
          functionName: code.name,
          size: code.size,
          totalDescriptors: descriptors.length,
          callSites: returnedDescriptors.length,
          descriptors: descriptorsOut,
          callTargets,
          ...(resolveTargets ? { blResolved, blUnresolved, blNotBl } : {}),
        });
      }

      return {
        functions: results,
        totalFunctions: codes.length,
        totalDescriptors: totalEntries,
        truncated: wasTruncated,
        honestBoundary:
          'BL instruction decoding resolves only direct ARM64 BL calls. Indirect calls (BLR, ' +
          'dispatch tables, virtual/interface calls) are not resolved. PcDescriptors cluster format ' +
          'varies by Dart SDK version — entries parsed via uint32 array with auto-detected header offset.',
      };
    });
  }

  handleDartCallGraph(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshot = await this.resolveSnapshot(args);
      const maxEdges = argNumber(args, 'maxEdges') ?? DART_CALL_GRAPH_MAX_EDGES;
      return buildDartCallGraph(snapshot, maxEdges);
    });
  }

  handleDartCallFunction(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const { DartAotExecutor } = await import('@modules/native-emulator/dart/DartAotExecutor');

      const resolved = await this.resolveForExecutor(args);

      const functionAddress = argString(args, 'functionAddress');
      const functionName = argString(args, 'functionName');
      const argsRaw = args['args'];
      const maxSteps = argNumber(args, 'maxSteps') ?? DART_EXEC_MAX_STEPS;
      const traceExecution = argBool(args, 'traceExecution') ?? false;

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
      if (resolved.snapshot) {
        executor.loadFromSnapshot(resolved.snapshot);
      } else {
        await executor.load(resolved.path!);
      }

      const result = await executor.call({
        address: functionAddress ? parseHexAddress(functionAddress, 'functionAddress') : undefined,
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
      const poolAddress = argStringRequired(args, 'poolAddress');
      const snapshot = await this.resolveSnapshot(args);

      const addr = parseHexAddress(poolAddress, 'poolAddress');
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

      const resolved = await this.resolveForExecutor(args);

      const functionAddress = argString(args, 'functionAddress');
      const functionName = argString(args, 'functionName');
      const maxSteps = argNumber(args, 'maxSteps') ?? DART_TRACE_MAX_STEPS;
      const argsRaw = args['args'];

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
      if (resolved.snapshot) {
        executor.loadFromSnapshot(resolved.snapshot);
      } else {
        await executor.load(resolved.path!);
      }

      const result = await executor.call({
        address: functionAddress ? parseHexAddress(functionAddress, 'functionAddress') : undefined,
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

  handleDartCreateSession(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const apkPath = argString(args, 'apkPath');
      const libappPath = argString(args, 'libappPath');
      if (!apkPath && !libappPath) {
        throw new ToolError('VALIDATION', 'Either apkPath or libappPath must be provided');
      }

      const session = await this.sessions.createSession(apkPath ?? libappPath!);
      const snapshot = session.snapshot;

      return {
        sessionId: session.id,
        path: session.path,
        statistics: {
          totalClusters: snapshot.clusters.length,
          codeObjectCount: snapshot.codeObjects.length,
          objectPoolCount: snapshot.objectPools.length,
        },
        hint: 'Pass this sessionId to dart_load_snapshot / dart_list_functions / dart_call_graph / dart_inspect_object_pool / dart_call_function / dart_trace_execution to reuse the cached snapshot.',
      };
    });
  }

  handleDartDestroySession(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const sessionId = argStringRequired(args, 'sessionId');
      const destroyed = this.sessions.destroySession(sessionId);
      return { sessionId, destroyed };
    });
  }

  /**
   * Resolve a parsed snapshot for the read-only dynamic tools. When `sessionId`
   * is present the cached snapshot is reused (skipping the libapp.so re-parse);
   * otherwise the file is parsed fresh — the backward-compatible path.
   */
  private async resolveSnapshot(args: Record<string, unknown>): Promise<LoadedSnapshot> {
    const sessionId = argString(args, 'sessionId');
    if (sessionId) {
      return this.resolveCachedSnapshot(sessionId);
    }
    const apkPath = argString(args, 'apkPath');
    const libappPath = argString(args, 'libappPath');
    if (!apkPath && !libappPath) {
      throw new ToolError('VALIDATION', 'Provide sessionId, or apkPath/libappPath');
    }
    const { DartAotLoader } = await import('@modules/native-emulator/dart/DartAotLoader');
    const loader = new DartAotLoader();
    return loader.loadSnapshot(apkPath ?? libappPath!);
  }

  /**
   * Look up a cached snapshot by sessionId. Throws ToolError(NOT_FOUND) when
   * the session is unknown or already swept by the idle TTL — not a generic
   * Error — so the MCP response carries the right error code.
   */
  private resolveCachedSnapshot(sessionId: string): LoadedSnapshot {
    const session = this.sessions.getSession(sessionId);
    if (!session) {
      throw new ToolError('NOT_FOUND', `Unknown dart snapshot session: ${sessionId}`);
    }
    return session.snapshot;
  }

  /**
   * Resolve either a cached snapshot or a source path for the executor-backed
   * tools (`dart_call_function`, `dart_trace_execution`). The executor is
   * built fresh per call (register state is per-call, never shared), but when
   * a session is supplied the heavy `loadSnapshot` is skipped via
   * `DartAotExecutor.loadFromSnapshot`.
   */
  private async resolveForExecutor(
    args: Record<string, unknown>,
  ): Promise<{ snapshot?: LoadedSnapshot; path?: string }> {
    const sessionId = argString(args, 'sessionId');
    if (sessionId) {
      return { snapshot: this.resolveCachedSnapshot(sessionId) };
    }
    const apkPath = argString(args, 'apkPath');
    const libappPath = argString(args, 'libappPath');
    if (!apkPath && !libappPath) {
      throw new ToolError('VALIDATION', 'Provide sessionId, or apkPath/libappPath');
    }
    return { path: apkPath ?? libappPath! };
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

/** Human-readable label for PcDescriptor kind. */
function pcDescriptorKindLabel(kind: number): string {
  switch (kind) {
    case 0:
      return 'deopt';
    case 1:
      return 'icCall';
    case 2:
      return 'unoptStaticCall';
    case 3:
      return 'runtimeCall';
    case 4:
      return 'osrEntry';
    case 5:
      return 'rewind';
    case 6:
      return 'bssRelaxation';
    case 7:
      return 'other';
    default:
      return `unknown(${kind})`;
  }
}
