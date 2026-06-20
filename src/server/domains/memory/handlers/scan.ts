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
import { argBool, argEnum, argNumber, argObject } from '@server/domains/shared/parse-args';
import { validateHexAddress, requireStringArg } from './validation';

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

const SCAN_COMPARE_MODES = new Set<ScanCompareMode>([
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
]);

const TOOL_FIRST_SCAN = 'memory_first_scan';
const TOOL_NEXT_SCAN = 'memory_next_scan';
const TOOL_UNKNOWN_SCAN = 'memory_unknown_scan';
const TOOL_GROUP_SCAN = 'memory_group_scan';

function capMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return MEMORY_SCAN_MAX_RESULTS;
  return Math.min(value, MEMORY_SCAN_MAX_RESULTS);
}

export class ScanHandlers {
  constructor(
    private readonly scanner: MemoryScanner,
    private readonly eventBus?: EventBus<ServerEventMap>,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
  ) {}

  private async resolvePid(value: unknown): Promise<number> {
    if (!this.processManager) {
      return value as number;
    }
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
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
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const regionFilter = argObject(args, 'regionFilter') as ScanOptions['regionFilter'];
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const options: ScanOptions = { valueType, alignment, maxResults, regionFilter, onProgress };
      const result = await this.scanner.firstScan(pid, value, options);
      void this.eventBus?.emit('memory:scan_completed', {
        scanType: 'first',
        resultCount: result.totalMatches ?? 0,
        timestamp: new Date().toISOString(),
      });
      return {
        ...result,
        hint:
          result.totalMatches > 0
            ? `Found ${result.totalMatches} matches. Use memory_next_scan with sessionId "${result.sessionId}" to narrow down.`
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
      const value = typeof args.value === 'string' ? args.value : undefined;
      const value2 = typeof args.value2 === 'string' ? args.value2 : undefined;
      const result = await this.scanner.nextScan(sessionId, mode, value, value2);
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
      const result = await this.scanner.pointerScan(pid, targetAddress, {
        maxResults: capMaxResults(argNumber(args, 'maxResults')),
        moduleOnly,
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
      const pattern: Array<{ offset: number; value: string; type: ScanValueType }> = [];
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
}
