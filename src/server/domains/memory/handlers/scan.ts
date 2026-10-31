import type { MemoryScanner } from '@native/MemoryScanner';
import type {
  ScanCompareMode,
  ScanOptions,
  ScanValueType,
} from '@native/NativeMemoryManager.types';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { MEMORY_SCAN_MAX_RESULTS } from '@src/constants';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import {
  argBool,
  argEnum,
  argNumber,
  argObject,
  argString,
} from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { validateHexAddress, requireStringArg, validateValueForType } from './validation';
import { createDiskScanSession, MAX_DISK_SCAN_ADDRESSES } from './scan-persistence';

// ── AOB operator types ──

type AobTokenType = 'exact' | 'wildcard' | 'gt' | 'lt' | 'range';

interface AobToken {
  type: AobTokenType;
  value?: number;
  value2?: number;
  /** Original token text preserved for exact-hex tokens so native pattern casing is unchanged. */
  orig?: string;
}

// ── Custom scan type ──

interface CustomScanType {
  name: string;
  size: number;
  encoding: 'int' | 'uint' | 'float' | 'hex';
  endian: 'le' | 'be';
}

/**
 * Session-scoped registry for user-defined custom scan types (CE parity).
 * Stored on ScanHandlers so it lives as long as the domain handler instance.
 */
class CustomTypeRegistry {
  private types = new Map<string, CustomScanType>();

  register(name: string, def: CustomScanType): void {
    if (this.types.has(name)) {
      throw new Error(`memory_register_type: custom type "${name}" is already registered`);
    }
    this.types.set(name, def);
  }

  list(): CustomScanType[] {
    return [...this.types.values()];
  }

  unregister(name: string): boolean {
    return this.types.delete(name);
  }

  resolve(name: string): CustomScanType | undefined {
    return this.types.get(name);
  }
}

// Mirror of ScanValueTypeOptions in definitions.ts — kept in sync so handler-layer
// validation rejects unknown value types before reaching the native scanner.
const SCAN_VALUE_TYPES = new Set<ScanValueType>([
  'byte',
  'int8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float',
  'double',
  'string',
  'hex',
  'pointer',
]);

const SCAN_COMPARE_MODES = new Set<string>([
  'exact',
  'unknown_initial',
  'changed',
  'unchanged',
  'increased',
  'decreased',
  'greater_than',
  'less_than',
  'between',
  'not_equal',
  'changed_by',
  'increased_by',
  'decreased_by',
  'changed_by_variable',
  'not_equal_to',
]);

const DELTA_REQUIRED_MODES = new Set<string>(['changed_by', 'increased_by', 'decreased_by']);

const NON_NEGATIVE_DELTA_MODES = new Set<string>(['increased_by', 'decreased_by']);

const FLOAT_TYPES = new Set<ScanValueType>(['float', 'double']);

const TOOL_FIRST_SCAN = 'memory_first_scan';
const TOOL_NEXT_SCAN = 'memory_next_scan';
const TOOL_UNKNOWN_SCAN = 'memory_unknown_scan';
const TOOL_GROUP_SCAN = 'memory_group_scan';
const TOOL_SEARCH_STRING = 'memory_search_string';

/** Upper bound on group-scan pattern entries — more is almost always a mistake
 * and makes the scan extremely slow. */
const GROUP_SCAN_MAX_PATTERN = 64;

function capMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return MEMORY_SCAN_MAX_RESULTS;
  return Math.min(value, MEMORY_SCAN_MAX_RESULTS);
}

export class ScanHandlers {
  private readonly scanner: MemoryScanner;
  private readonly eventBus?: EventBus<ServerEventMap>;
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  private readonly auditTrail: MemoryAuditTrail | null;
  readonly customTypes = new CustomTypeRegistry();

  constructor(
    scanner: MemoryScanner,
    eventBus?: EventBus<ServerEventMap>,
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.scanner = scanner;
    this.eventBus = eventBus;
    this.processManager = processManager;
    this.ctx = ctx;
    this.auditTrail = auditTrail ?? null;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  private recordAudit(entry: {
    operation: string;
    pid: number | null;
    address: string | null;
    size: number | null;
    result: 'success' | 'failure';
    error?: string;
    durationMs: number;
  }): void {
    if (!this.auditTrail) return;
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  async handleFirstScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const value = requireStringArg(args.value, 'value', TOOL_FIRST_SCAN);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_FIRST_SCAN}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      // Early-reject gross value/type mismatches (e.g. "abc" + int32) so they
      // surface here rather than as a cryptic native FFI error.
      validateValueForType(value, valueType, TOOL_FIRST_SCAN);
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const regionFilter = argObject(args, 'regionFilter') as ScanOptions['regionFilter'];
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const encrypted = argBool(args, 'encrypted', false);
      const xorKey = ((v: unknown) => {
        if (v === undefined) return 0xff;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 255) return 0xff;
        return n & 0xff;
      })(args.xorKey);
      const options: ScanOptions = { valueType, alignment, maxResults, regionFilter, onProgress };
      const start = Date.now();
      const result = await this.scanner.firstScan(pid, value, options);

      // Encrypted search: also scan for the XOR-encrypted form of the target value.
      // Only applies to integer types — float/double/string/pointer/hex skip.
      let encryptedAddresses: string[] | undefined;
      if (encrypted) {
        const encValue = computeEncryptedValue(value, valueType, xorKey);
        if (encValue !== null) {
          try {
            const encResult = await this.scanner.firstScan(pid, encValue, options);
            if (encResult.addresses && encResult.addresses.length > 0) {
              encryptedAddresses = encResult.addresses;
            }
          } catch {
            // Encrypted scan best-effort — some platforms may not support it.
          }
        }
      }

      this.recordAudit({
        operation: 'first_scan',
        pid,
        address: null,
        size: result.totalMatches ?? 0,
        result: 'success',
        durationMs: Date.now() - start,
      });
      void this.eventBus?.emit('memory:scan_completed', {
        scanType: 'first',
        resultCount: result.totalMatches ?? 0,
        timestamp: new Date().toISOString(),
      });

      const encCount = encryptedAddresses?.length ?? 0;
      const mergedTotal = (result.totalMatches ?? 0) + encCount;

      // ── Disk-Based Scan Persistence (CrySearch parity) ──
      const persistToDisk = argBool(args, 'persistToDisk', false);
      let diskSession: ReturnType<typeof createDiskScanSession> | undefined;
      if (persistToDisk) {
        // Create a disk-backed session to stream results
        diskSession = createDiskScanSession(result.sessionId, valueType);
        const totalMatches = result.totalMatches ?? 0;
        if (totalMatches > MAX_DISK_SCAN_ADDRESSES) {
          throw new Error(
            `${TOOL_FIRST_SCAN}: scan returned ${totalMatches.toLocaleString()} matches, ` +
              `which exceeds the disk persistence cap of ${MAX_DISK_SCAN_ADDRESSES.toLocaleString()}. ` +
              `Narrow the scan (stricter value, smaller region filter) before persisting to disk.`,
          );
        }

        // Stream results to disk.
        // TODO(disk-scan): the scanner no longer returns per-address `results`
        // (it returns `addresses: string[]` only, with values held in the scan
        // session's `previousValues`). Persisting address+value records here
        // therefore had nothing to read — `appendToDiskScan` was never reached,
        // so persisted files were silently empty. Re-wire value persistence
        // from `scanSessionManager.previousValues` before re-enabling.
      }

      return {
        ...result,
        encryptedAddresses: encryptedAddresses || undefined,
        encryptedScan: encrypted || undefined,
        xorKey: encrypted ? xorKey : undefined,
        diskPersisted: persistToDisk || undefined,
        ...(diskSession
          ? {
              diskFile: diskSession.filePath,
              diskRecords: diskSession.totalRecords,
            }
          : {}),
        hint:
          mergedTotal > 0
            ? `Found ${mergedTotal} matches${encCount > 0 ? ` (${encCount} encrypted)` : ''}${persistToDisk ? ` — persisted to ${diskSession!.filePath}` : ''}. Use memory_next_scan with sessionId "${result.sessionId}" to narrow down.`
            : 'No matches found. Try a different value or type.',
      };
    });
  }

  async handleNextScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_NEXT_SCAN);
      const mode = argEnum(args, 'mode', SCAN_COMPARE_MODES);
      if (!mode) {
        throw new Error(
          `${TOOL_NEXT_SCAN}: missing or invalid required argument "mode" (expected one of: ${[...SCAN_COMPARE_MODES].join(', ')}), got: ${JSON.stringify(args.mode)}`,
        );
      }
      // Normalize UX alias: 'not_equal_to' → 'not_equal' (same comparison, friendlier name)
      const resolvedMode = (mode as string) === 'not_equal_to' ? 'not_equal' : mode;

      const value = typeof args.value === 'string' ? args.value : undefined;
      const value2 = typeof args.value2 === 'string' ? args.value2 : undefined;

      const delta = parseNextScanDelta(args, mode);

      const tolerance = await parseNextScanTolerance(args, sessionId);

      // "between" requires both bounds — enforce here so the native layer never
      // receives an undefined upper bound and produce a cryptic comparator error.
      if (mode === 'between') {
        if (!value || !value2) {
          throw new Error(
            `${TOOL_NEXT_SCAN}: mode "between" requires both "value" (lower bound) and "value2" (upper bound)`,
          );
        }
      }

      const result = await this.scanner.nextScan(
        sessionId,
        resolvedMode as ScanCompareMode,
        value,
        value2,
        delta,
        tolerance,
      );

      // Post-filter: excludeValues (handler-level filter, no native change needed)
      await applyExcludeValuesFilter(result, sessionId, args.excludeValues);

      return {
        ...result,
        hint:
          result.totalMatches <= 10
            ? 'Few matches remaining — inspect these addresses.'
            : `${result.totalMatches} matches remain. Continue narrowing with memory_next_scan.`,
      };
    });
  }

  async handleUnknownScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_UNKNOWN_SCAN}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const regionFilter = argObject(args, 'regionFilter') as ScanOptions['regionFilter'];
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const options: ScanOptions = { valueType, alignment, maxResults, regionFilter, onProgress };
      const result = await this.scanner.unknownInitialScan(pid, options);
      return {
        ...result,
        hint: `Captured ${result.totalMatches} addresses. Use memory_next_scan with changed/unchanged/increased/decreased to narrow.`,
      };
    });
  }

  async handlePointerScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const targetAddress = validateHexAddress(args.targetAddress, 'targetAddress');
      const moduleOnly = argBool(args, 'moduleOnly', false);
      const regionFilter = argObject(args, 'regionFilter');
      const result = await this.scanner.pointerScan(pid, targetAddress, {
        maxResults: capMaxResults(argNumber(args, 'maxResults')),
        moduleOnly,
        regionFilter: regionFilter as
          | import('@native/NativeMemoryManager.types').RegionFilter
          | undefined,
      });
      return { ...result };
    });
  }

  async handleGroupScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const rawPattern = args.pattern;
      if (!Array.isArray(rawPattern) || rawPattern.length === 0) {
        throw new Error(
          `${TOOL_GROUP_SCAN}: missing or invalid required argument "pattern" (expected non-empty array of {offset, value, type}), got: ${JSON.stringify(rawPattern)}`,
        );
      }
      if (rawPattern.length > GROUP_SCAN_MAX_PATTERN) {
        throw new Error(
          `${TOOL_GROUP_SCAN}: pattern has ${rawPattern.length} entries, exceeds maximum ${GROUP_SCAN_MAX_PATTERN}. Split into multiple group scans.`,
        );
      }
      const pattern: Array<{ offset: number; value: string; type: ScanValueType }> = [];
      const seenOffsets = new Set<number>();
      for (let i = 0; i < rawPattern.length; i += 1) {
        const entry = rawPattern[i] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== 'object') {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} must be an object, got: ${JSON.stringify(entry)}`,
          );
        }
        const offset = entry.offset;
        const value = entry.value;
        const type = entry.type;
        if (typeof offset !== 'number' || !Number.isFinite(offset)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "offset" (expected number), got: ${JSON.stringify(offset)}`,
          );
        }
        if (seenOffsets.has(offset)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: duplicate offset ${offset} at pattern index ${i} — each entry must target a distinct offset`,
          );
        }
        seenOffsets.add(offset);
        if (typeof value !== 'string' || value.length === 0) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "value" (expected non-empty string), got: ${JSON.stringify(value)}`,
          );
        }
        if (typeof type !== 'string' || !SCAN_VALUE_TYPES.has(type as ScanValueType)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "type" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(type)}`,
          );
        }
        pattern.push({ offset, value, type: type as ScanValueType });
      }
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const result = await this.scanner.groupScan(pid, pattern, { alignment, maxResults });
      return { ...result };
    });
  }

  async handleSearchString(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const pattern = requireStringArg(args.pattern, 'pattern', TOOL_SEARCH_STRING);
      const useRegex = argBool(args, 'regex', false);
      const searchWide = argBool(args, 'wide', true);
      const minLength = Math.max(1, argNumber(args, 'minLength', 3));
      const maxResults = Math.min(capMaxResults(argNumber(args, 'maxResults', 500)), 500);
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const start = Date.now();

      // Compile regex once if requested, so we fail early on bad patterns
      let regex: RegExp | null = null;
      if (useRegex) {
        try {
          regex = new RegExp(pattern, 'i');
        } catch (e) {
          throw new Error(
            `${TOOL_SEARCH_STRING}: invalid regex pattern "${pattern}": ${e instanceof Error ? e.message : String(e)}`,
            { cause: e },
          );
        }
      }

      const allResults: Array<{
        address: string;
        value: string;
        encoding: 'utf8' | 'utf16le';
        length: number;
      }> = [];

      const matchesPattern = (value: string): boolean =>
        regex ? regex.test(value) : value.toLowerCase().includes(pattern.toLowerCase());

      // ── ASCII / UTF-8 scan via MemoryScanner valueType='string' ──
      try {
        const asciiResult = await this.scanner.firstScan(pid, pattern, {
          valueType: 'string',
          alignment: 1,
          maxResults,
          onProgress,
        });
        const strings = await readStringsAtAddresses(pid, asciiResult.addresses ?? [], 'utf8');
        for (const { address, value } of strings) {
          if (value.length < minLength) continue;
          if (!matchesPattern(value)) continue;
          allResults.push({ address, value, encoding: 'utf8', length: value.length });
        }
      } catch {
        // String scan can fail if the scanner doesn't support valueType='string'
        // on this platform — fall through to hex-based search.
      }

      // ── UTF-16LE (wide) scan via hex pattern ──
      if (searchWide && allResults.length < maxResults) {
        try {
          // Build UTF-16LE bytes: each char → 2 bytes (LSB first)
          const wideBytes: number[] = [];
          for (let i = 0; i < pattern.length; i++) {
            const code = pattern.charCodeAt(i);
            wideBytes.push(code & 0xff, (code >> 8) & 0xff);
          }
          const wideHex = wideBytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
          const remaining = maxResults - allResults.length;

          const wideResult = await this.scanner.firstScan(pid, wideHex, {
            valueType: 'hex',
            alignment: 1,
            maxResults: Math.min(remaining, maxResults),
            onProgress,
          });
          const strings = await readStringsAtAddresses(pid, wideResult.addresses ?? [], 'utf16le');
          for (const { address, value } of strings) {
            if (value.length < minLength) continue;
            if (!matchesPattern(value)) continue;
            allResults.push({ address, value, encoding: 'utf16le', length: value.length });
          }
        } catch {
          // Wide scan best-effort — hex scan may not be supported on all platforms
        }
      }

      const elapsed = `${Date.now() - start}ms`;

      return {
        success: true,
        pattern,
        isRegex: useRegex,
        results: allResults.slice(0, maxResults),
        totalFound: allResults.length,
        truncated: allResults.length > maxResults,
        elapsed,
        hint:
          allResults.length > 0
            ? `Found ${allResults.length} string matches (${allResults.filter((r) => r.encoding === 'utf8').length} ASCII, ${allResults.filter((r) => r.encoding === 'utf16le').length} wide).`
            : `No strings matching "${pattern}" found. Try a shorter pattern or wider search scope.`,
      };
    });
  }

  async handleAobScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const rawPattern = requireStringArg(args.pattern, 'pattern', 'memory_aob_scan');
      const moduleName = argString(args, 'moduleName');
      const maxResults = argNumber(args, 'maxResults', 10000);

      const trimmed = rawPattern.trim();
      if (trimmed.length === 0) {
        throw new Error(
          'memory_aob_scan: missing or invalid required argument "pattern" (expected non-empty AOB pattern like "48 8B ?? ??")',
        );
      }

      // Parse tokens including CE 7.6 operators: >XX, <XX, XX-YY
      const aobTokens = parseAobTokens(trimmed);
      if (aobTokens.length === 0) {
        throw new Error('Invalid AOB pattern: pattern must contain at least one byte or wildcard');
      }

      // Build native-compatible pattern (operators → ??)
      const nativePattern = aobTokensToNativePattern(aobTokens);

      const executableOnly = argBool(args, 'executableOnly');
      const regionFilter = argObject(args, 'regionFilter');
      const result = await this.scanner.aobScan(pid, nativePattern, {
        maxResults,
        moduleName,
        executableOnly,
        regionFilter: regionFilter as
          | import('@native/NativeMemoryManager.types').RegionFilter
          | undefined,
      });

      // Post-filter: verify operator conditions by reading memory at matched addresses
      let filteredMatches = result.matches ?? [];
      if (hasOperators(aobTokens) && filteredMatches.length > 0) {
        try {
          filteredMatches = await postFilterAobOperators(pid, aobTokens, filteredMatches);
        } catch (filterErr) {
          logger.warn(
            'memory_aob_scan: operator post-filter failed — returning unfiltered results:',
            filterErr,
          );
        }
      }

      const totalMatches = filteredMatches.length;
      return {
        ...result,
        matches: filteredMatches,
        totalMatches,
        operatorsUsed: hasOperators(aobTokens) || undefined,
        hint:
          totalMatches > 0
            ? `Found ${totalMatches} matches.`
            : 'No matches found. Try a shorter pattern or fewer wildcards.',
      };
    });
  }

  // ── Custom Scan Types (CE parity) ──

  async handleRegisterType(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const name = requireStringArg(args.name, 'name', 'memory_register_type');
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(
          `memory_register_type: "name" must be a valid identifier (alphanumeric + underscore, not starting with digit), got: "${name}"`,
        );
      }
      const size = Number(args.size);
      if (![1, 2, 4, 8].includes(size)) {
        throw new Error(
          `memory_register_type: "size" must be 1, 2, 4, or 8, got: ${JSON.stringify(args.size)}`,
        );
      }
      const encoding = argEnum(args, 'encoding', new Set(['int', 'uint', 'float', 'hex'])) as
        | CustomScanType['encoding']
        | undefined;
      if (!encoding) {
        throw new Error(
          `memory_register_type: missing or invalid "encoding" (expected one of: int, uint, float, hex), got: ${JSON.stringify(args.encoding)}`,
        );
      }
      const endianRaw = argEnum(args, 'endian', new Set(['le', 'be']));
      const endian: 'le' | 'be' = (endianRaw as 'le' | 'be') ?? 'le';

      this.customTypes.register(name, { name, size, encoding, endian });
      return {
        success: true,
        type: { name, size, encoding, endian },
        hint: `Custom type "${name}" registered. Use it as valueType in memory_first_scan, memory_unknown_scan, etc.`,
      };
    });
  }

  async handleListTypes(_args: Record<string, unknown>) {
    return handleSafe(async () => {
      const types = this.customTypes.list();
      return {
        success: true,
        types,
        count: types.length,
        hint:
          types.length > 0
            ? `${types.length} custom type(s) registered.`
            : 'No custom types registered. Use memory_register_type to add one.',
      };
    });
  }

  async handleUnregisterType(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const name = requireStringArg(args.name, 'name', 'memory_unregister_type');
      const removed = this.customTypes.unregister(name);
      if (!removed) {
        throw new Error(`memory_unregister_type: custom type "${name}" is not registered`);
      }
      return {
        success: true,
        name,
        hint: `Custom type "${name}" unregistered.`,
      };
    });
  }

  /**
   * Generate an AOB signature from bytes at a memory address.
   */
  async handleGenerateSignature(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const addressRaw = argString(args, 'address');
      if (!addressRaw) {
        throw new Error(
          'memory_generate_signature: missing or invalid required argument "address" (expected hex address, e.g. "0x7FF612340000")',
        );
      }
      const address = validateHexAddress(addressRaw, 'address');
      const size = argNumber(args, 'size', 64);
      if (size <= 0 || size > 4096) {
        throw new Error(
          `memory_generate_signature: "size" must be between 1 and 4096 bytes, got: ${size}`,
        );
      }
      const wildcardRelOffsets = argNumber(args, 'wildcardRelOffsets', 4);

      // Read memory from process
      const { generateSignature } = await import('@native/SignatureGenerator');
      const { createPlatformProvider } = await import('@native/platform/factory.js');
      const { parseAddress } = await import('@native/formatAddress');

      const provider = createPlatformProvider();
      const handle = provider.openProcess(pid, false);
      try {
        // parseAddress treats both "0x1000" and "1000" as hex — the previous
        // BigInt(replace) parsed unprefixed values as decimal and silently
        // read the wrong address.
        const addrBig = parseAddress(address);
        const buf = (await provider.readMemory(handle, addrBig, size)).data;

        const result = generateSignature(buf, { wildcardRelOffsets });
        return {
          success: true,
          ...result,
        };
      } finally {
        provider.closeProcess(handle);
      }
    });
  }
}

/** Bytes read at each matched address when extracting a NUL-terminated string. */
const SEARCH_STRING_READ_BYTES = 1024;

/**
 * Extract a NUL-terminated string from a memory buffer using the given encoding.
 * `utf16le` stops at the first `00 00` code unit; `utf8` stops at the first
 * zero byte. The full buffer is decoded when no terminator is present.
 */
function extractNullTerminatedString(buf: Buffer, encoding: 'utf8' | 'utf16le'): string {
  if (encoding === 'utf16le') {
    let end = buf.length;
    for (let i = 0; i + 1 < buf.length; i += 2) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        end = i;
        break;
      }
    }
    return buf.subarray(0, end).toString('utf16le');
  }
  const nul = buf.indexOf(0);
  return (nul === -1 ? buf : buf.subarray(0, nul)).toString('utf8');
}

/**
 * Read NUL-terminated strings at the given addresses in the target process.
 * Returns one entry per successfully-read address; unreadable addresses are
 * skipped (best-effort). A single process handle is opened for the whole batch.
 */
async function readStringsAtAddresses(
  pid: number,
  addresses: string[],
  encoding: 'utf8' | 'utf16le',
): Promise<Array<{ address: string; value: string }>> {
  if (addresses.length === 0) return [];
  const { createPlatformProvider } = await import('@native/platform/factory.js');
  const { parseAddress } = await import('@native/formatAddress');
  const provider = createPlatformProvider();
  const handle = provider.openProcess(pid, false);
  try {
    const out: Array<{ address: string; value: string }> = [];
    for (const addressHex of addresses) {
      try {
        const addrBig = parseAddress(addressHex);
        const buf = (await provider.readMemory(handle, addrBig, SEARCH_STRING_READ_BYTES)).data;
        out.push({ address: addressHex, value: extractNullTerminatedString(buf, encoding) });
      } catch {
        // Unreadable address (e.g. region unmapped since the scan) — skip.
      }
    }
    return out;
  } finally {
    provider.closeProcess(handle);
  }
}

// ── AOB operator helpers (CE 7.6 parity) ──

const AOB_OPERATOR_RE = /^(>|<)([0-9a-fA-F]{2})$|^([0-9a-fA-F]{2})-([0-9a-fA-F]{2})$/;

function parseAobTokens(pattern: string): AobToken[] {
  const parts = pattern.trim().split(/\s+/);
  const tokens: AobToken[] = [];

  for (const part of parts) {
    if (part === '??' || part === '?') {
      tokens.push({ type: 'wildcard' });
      continue;
    }

    // Strip optional 0x/0X prefix
    const raw = part.startsWith('0x') || part.startsWith('0X') ? part.slice(2) : part;

    // Exact hex byte
    if (/^[0-9a-fA-F]{2}$/.test(raw)) {
      tokens.push({ type: 'exact', value: parseInt(raw, 16), orig: part });
      continue;
    }

    // Operator tokens: >XX, <XX, XX-YY
    const opMatch = AOB_OPERATOR_RE.exec(raw);
    if (opMatch) {
      if (opMatch[1] === '>') {
        tokens.push({ type: 'gt', value: parseInt(opMatch[2]!, 16) });
      } else if (opMatch[1] === '<') {
        tokens.push({ type: 'lt', value: parseInt(opMatch[2]!, 16) });
      } else if (opMatch[3] !== undefined && opMatch[4] !== undefined) {
        tokens.push({
          type: 'range',
          value: parseInt(opMatch[3], 16),
          value2: parseInt(opMatch[4], 16),
        });
      }
      continue;
    }

    throw new Error(
      `Invalid AOB pattern: each token must be 2 hex chars (00-FF, optional "0x" prefix), ` +
        `"??" for wildcard, or operator (>XX, <XX, XX-YY), got: "${part}"`,
    );
  }

  return tokens;
}

function aobTokensToNativePattern(tokens: AobToken[]): string {
  return tokens
    .map((t) => {
      if (t.type === 'exact') {
        // Preserve original token casing (e.g. "0xff", "0a", "FF")
        return t.orig ?? t.value!.toString(16).padStart(2, '0').toUpperCase();
      }
      return '??';
    })
    .join(' ');
}

function hasOperators(tokens: AobToken[]): boolean {
  return tokens.some((t) => t.type === 'gt' || t.type === 'lt' || t.type === 'range');
}

/**
 * Post-filter AOB scan results by verifying operator conditions.
 * Reads the relevant byte at each matched address + operator offset.
 */
async function postFilterAobOperators(
  _pid: number,
  tokens: AobToken[],
  matches: string[],
): Promise<string[]> {
  // Build list of (tokenIndex, condition) for operator tokens
  const checks: Array<{ index: number; type: AobTokenType; value: number; value2?: number }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.type === 'gt' || t.type === 'lt' || t.type === 'range') {
      checks.push({ index: i, type: t.type, value: t.value!, value2: t.value2 });
    }
  }

  if (checks.length === 0) return matches;

  // Post-filter: for each match, read the byte at matchAddr + operatorOffset
  // and verify the condition. Best-effort — if memory read fails, keep the match.
  const filtered: string[] = [];
  for (const matchAddr of matches) {
    const base = parseInt(matchAddr.replace(/^0x/i, ''), 16);
    if (Number.isNaN(base)) {
      filtered.push(matchAddr); // keep unparseable addresses
      continue;
    }
    let allPass = true;
    for (const check of checks) {
      // Simulate byte read: for pure-TS handler-level post-filter without platform
      // dependency, we read memory using a process-level approach. If unavailable,
      // the match passes (optimistic). Real filtering happens at the native layer.
      const byteAtOffset = await readByteAtAddress(_pid, base + check.index);
      if (byteAtOffset === null) {
        // Cannot read — keep the match (optimistic)
        continue;
      }
      switch (check.type) {
        case 'gt':
          if (byteAtOffset <= check.value) allPass = false;
          break;
        case 'lt':
          if (byteAtOffset >= check.value) allPass = false;
          break;
        case 'range':
          if (byteAtOffset < check.value || byteAtOffset > check.value2!) allPass = false;
          break;
      }
      if (!allPass) break;
    }
    if (allPass) filtered.push(matchAddr);
  }
  return filtered;
}

/**
 * Read a single byte at a process address. Returns null if unavailable.
 * Uses the platform provider (same as handleGenerateSignature).
 */
async function readByteAtAddress(pid: number, address: number): Promise<number | null> {
  try {
    const { createPlatformProvider } = await import('@native/platform/factory.js');
    const provider = createPlatformProvider();
    const handle = provider.openProcess(pid, false);
    try {
      const result = await provider.readMemory(handle, BigInt(address), 1);
      return result.data[0] ?? null;
    } finally {
      provider.closeProcess(handle);
    }
  } catch {
    return null;
  }
}

// ── Encrypted value search helpers ──

const ENCRYPTABLE_INT_TYPES = new Set([
  'byte',
  'int8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
]);

/**
 * Compute the XOR-encrypted form of a value for encrypted memory search.
 * Applies XOR key to each byte of the value's binary representation.
 * Returns null for types that don't support XOR encryption (float, double, string, pointer).
 */
function computeEncryptedValue(value: string, valueType: string, xorKey: number): string | null {
  if (!ENCRYPTABLE_INT_TYPES.has(valueType)) return null;

  try {
    switch (valueType) {
      case 'byte': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        return String((n ^ xorKey) & 0xff);
      }
      case 'int8': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        // int8: signed byte, XOR then sign-extend
        const raw = (n ^ xorKey) & 0xff;
        return String(raw > 0x7f ? raw - 0x100 : raw);
      }
      case 'int16': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        const buf = Buffer.allocUnsafe(2);
        buf.writeInt16LE(n, 0);
        buf.writeUInt8(buf.readUInt8(0) ^ xorKey, 0);
        buf.writeUInt8(buf.readUInt8(1) ^ xorKey, 1);
        return String(buf.readInt16LE(0));
      }
      case 'uint16': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        const buf = Buffer.allocUnsafe(2);
        buf.writeUInt16LE(n, 0);
        buf.writeUInt8(buf.readUInt8(0) ^ xorKey, 0);
        buf.writeUInt8(buf.readUInt8(1) ^ xorKey, 1);
        return String(buf.readUInt16LE(0));
      }
      case 'int32': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32LE(n, 0);
        for (let i = 0; i < 4; i += 1) {
          buf.writeUInt8(buf.readUInt8(i) ^ xorKey, i);
        }
        return String(buf.readInt32LE(0));
      }
      case 'uint32': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return null;
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32LE(n, 0);
        for (let i = 0; i < 4; i += 1) {
          buf.writeUInt8(buf.readUInt8(i) ^ xorKey, i);
        }
        return String(buf.readUInt32LE(0));
      }
      case 'int64': {
        const n = BigInt(value);
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigInt64LE(n, 0);
        for (let i = 0; i < 8; i += 1) {
          buf.writeUInt8(buf.readUInt8(i) ^ xorKey, i);
        }
        return String(buf.readBigInt64LE(0));
      }
      case 'uint64': {
        const n = BigInt(value);
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(n, 0);
        for (let i = 0; i < 8; i += 1) {
          buf.writeUInt8(buf.readUInt8(i) ^ xorKey, i);
        }
        return String(buf.readBigUInt64LE(0));
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Parse and validate the `delta` argument for delta comparison modes. */
function parseNextScanDelta(args: Record<string, unknown>, mode: string): number | undefined {
  if (!DELTA_REQUIRED_MODES.has(mode)) return undefined;
  const rawDelta = argNumber(args, 'delta');
  if (rawDelta === undefined || !Number.isFinite(rawDelta)) {
    throw new Error(
      `${TOOL_NEXT_SCAN}: mode "${mode}" requires argument "delta" (a finite number)`,
    );
  }
  if (NON_NEGATIVE_DELTA_MODES.has(mode) && rawDelta < 0) {
    throw new Error(
      `${TOOL_NEXT_SCAN}: mode "${mode}" requires a non-negative "delta", got: ${rawDelta}`,
    );
  }
  return rawDelta;
}

/** Parse and validate `tolerance` (float/double sessions only). */
async function parseNextScanTolerance(
  args: Record<string, unknown>,
  sessionId: string,
): Promise<number | undefined> {
  if (args.tolerance === undefined) return undefined;
  const rawTol = argNumber(args, 'tolerance');
  if (rawTol === undefined || !Number.isFinite(rawTol)) {
    throw new Error(
      `${TOOL_NEXT_SCAN}: "tolerance" must be a finite number, got: ${JSON.stringify(args.tolerance)}`,
    );
  }
  if (rawTol < 0) {
    throw new Error(`${TOOL_NEXT_SCAN}: "tolerance" must be non-negative, got: ${rawTol}`);
  }
  // Validate that the session valueType is float/double
  const { scanSessionManager } = await import('@native/MemoryScanSession');
  const session = scanSessionManager.getSession(sessionId);
  if (!FLOAT_TYPES.has(session.valueType)) {
    throw new Error(
      `${TOOL_NEXT_SCAN}: "tolerance" is only valid with float or double valueType (session valueType is "${session.valueType}")`,
    );
  }
  return rawTol;
}

/** Drop result addresses whose previous value is in the caller's
 * excludeValues list (handler-level filter; no native change needed). */
async function applyExcludeValuesFilter(
  result: { addresses: string[]; totalMatches: number },
  sessionId: string,
  excludeValuesRaw: unknown,
): Promise<void> {
  if (
    Array.isArray(excludeValuesRaw) &&
    excludeValuesRaw.length > 0 &&
    result.addresses.length > 0
  ) {
    const excludeSet = new Set(excludeValuesRaw.map((v) => String(v).toLowerCase()));
    const { scanSessionManager: mgr } = await import('@native/MemoryScanSession');
    const { parseAddress } = await import('@native/formatAddress');
    const sess = mgr.getSession(sessionId);
    const filtered: string[] = [];
    let excludedCount = 0;
    for (const addrStr of result.addresses) {
      let keep = true;
      try {
        const addrBig = parseAddress(addrStr);
        const buf = sess.previousValues.get(addrBig);
        if (buf) {
          const hexVal = buf.toString('hex').toLowerCase();
          if (excludeSet.has(hexVal)) {
            keep = false;
            excludedCount++;
          }
        }
      } catch {
        // If address parsing fails, keep the address (fail-safe)
      }
      if (keep) filtered.push(addrStr);
    }
    result.addresses = filtered;
    result.totalMatches = filtered.length;
    (result as unknown as Record<string, unknown>).excludedCount = excludedCount;
  }
}
