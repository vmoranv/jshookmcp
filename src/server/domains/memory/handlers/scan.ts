/**
 * ScanHandlers — first/next/unknown/pointer/group scans.
 */
import type { MemoryScanner } from '@native/MemoryScanner';
import type {
  ScanCompareMode,
  ScanOptions,
  ScanValueType,
} from '@native/NativeMemoryManager.types';
import { MEMORY_SCAN_MAX_RESULTS } from '@src/constants';

/** SECURITY: Cap user-supplied maxResults to prevent OOM */
function capMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return MEMORY_SCAN_MAX_RESULTS;
  return Math.min(value, MEMORY_SCAN_MAX_RESULTS);
}

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

export class ScanHandlers {
  constructor(private readonly scanner: MemoryScanner) {}

  async handleFirstScan(args: Record<string, unknown>) {
    try {
      const options: ScanOptions = {
        valueType: args.valueType as ScanValueType,
        alignment: args.alignment as number | undefined,
        maxResults: capMaxResults(args.maxResults as number | undefined),
        regionFilter: args.regionFilter as ScanOptions['regionFilter'],
        onProgress: args.onProgress as ((p: number, t?: number) => void) | undefined,
      };
      const result = await this.scanner.firstScan(
        args.pid as number,
        args.value as string,
        options,
      );
      return toTextResponse({
        success: true,
        ...result,
        hint:
          result.totalMatches > 0
            ? `Found ${result.totalMatches} matches. Use memory_next_scan with sessionId "${result.sessionId}" to narrow down.`
            : 'No matches found. Try a different value or type.',
      });
    } catch (error) {
      return toErrorResponse('memory_first_scan', error);
    }
  }

  async handleNextScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.nextScan(
        args.sessionId as string,
        args.mode as ScanCompareMode,
        args.value as string | undefined,
        args.value2 as string | undefined,
      );
      return toTextResponse({
        success: true,
        ...result,
        hint:
          result.totalMatches <= 10
            ? 'Few matches remaining — inspect these addresses.'
            : `${result.totalMatches} matches remain. Continue narrowing with memory_next_scan.`,
      });
    } catch (error) {
      return toErrorResponse('memory_next_scan', error);
    }
  }

  async handleUnknownScan(args: Record<string, unknown>) {
    try {
      const options: ScanOptions = {
        valueType: args.valueType as ScanValueType,
        alignment: args.alignment as number | undefined,
        maxResults: capMaxResults(args.maxResults as number | undefined),
        regionFilter: args.regionFilter as ScanOptions['regionFilter'],
        onProgress: args.onProgress as ((p: number, t?: number) => void) | undefined,
      };
      const result = await this.scanner.unknownInitialScan(args.pid as number, options);
      return toTextResponse({
        success: true,
        ...result,
        hint: `Captured ${result.totalMatches} addresses. Use memory_next_scan with changed/unchanged/increased/decreased to narrow.`,
      });
    } catch (error) {
      return toErrorResponse('memory_unknown_scan', error);
    }
  }

  async handlePointerScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.pointerScan(
        args.pid as number,
        args.targetAddress as string,
        {
          maxResults: capMaxResults(args.maxResults as number | undefined),
          moduleOnly: args.moduleOnly as boolean | undefined,
        },
      );
      return toTextResponse({ success: true, ...result });
    } catch (error) {
      return toErrorResponse('memory_pointer_scan', error);
    }
  }

  async handleGroupScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.groupScan(
        args.pid as number,
        args.pattern as Array<{ offset: number; value: string; type: ScanValueType }>,
        {
          alignment: args.alignment as number | undefined,
          maxResults: capMaxResults(args.maxResults as number | undefined),
        },
      );
      return toTextResponse({ success: true, ...result });
    } catch (error) {
      return toErrorResponse('memory_group_scan', error);
    }
  }
}
