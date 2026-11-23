/**
 * Memory operation handlers — read/write/scan/audit/protection/filtered/batch/dump/regions.
 */

import { logger } from '@utils/logger';
import type { MemoryOperationHost, ProcessHandlerDeps } from './shared-types';
import {
  requireString,
  requirePositiveNumber,
  normalizePatternType,
  getOptionalPid,
  getOptionalString,
  getOptionalBinaryEncoding,
  getOptionalPositiveNumber,
  getWriteSize,
  normalizeBinaryEncoding,
} from '../handlers.base.types';
import { resolvePidOrAttachedRenderer } from '@server/runtime/renderer-pid';

type AuditedMemoryOperation = 'memory_read' | 'memory_write' | 'memory_scan';
type MemoryToolResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};
type MemoryPatch = {
  address: string;
  data: string;
  encoding?: 'hex' | 'base64';
};

export class MemoryOperationHandlers {
  private readonly memoryManager: ProcessHandlerDeps['memoryManager'];
  private readonly processManager: ProcessHandlerDeps['processManager'];
  private readonly platform: string;
  private readonly host: MemoryOperationHost;
  private readonly ctx?: ProcessHandlerDeps['ctx'];

  constructor(deps: ProcessHandlerDeps, host: MemoryOperationHost) {
    this.memoryManager = deps.memoryManager;
    this.processManager = deps.processManager;
    this.platform = deps.platform;
    this.host = host;
    this.ctx = deps.ctx;
  }

  async handleMemoryRead(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    const startedAt = Date.now();
    try {
      const pid = await this.resolvePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return this.auditedUnavailableResponse({
          operation: 'memory_read',
          pid,
          address,
          size,
          startedAt,
          reason: availability.reason,
          extra: {
            requestedAddress: address,
            requestedSize: size,
          },
        });
      }

      const result = await this.memoryManager.readMemory(pid, address, size);
      return this.auditedResultResponse({
        operation: 'memory_read',
        pid,
        address,
        size,
        startedAt,
        result,
        payload: {
          success: result.success,
          data: result.data,
          error: result.error,
          pid,
          address,
          size,
          platform: this.platform,
        },
      });
    } catch (error) {
      logger.error('Memory read failed:', error);
      return this.auditedExceptionResponse({
        operation: 'memory_read',
        pid: getOptionalPid(args.pid) ?? null,
        address: getOptionalString(args.address) ?? null,
        size: getOptionalPositiveNumber(args.size) ?? null,
        startedAt,
        error,
      });
    }
  }

  async handleMemoryWrite(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    const startedAt = Date.now();
    try {
      const pid = await this.resolvePid(args.pid);
      const address = requireString(args.address, 'address');
      const data = requireString(args.data, 'data');
      const encoding = normalizeBinaryEncoding(args.encoding, 'encoding') ?? 'hex';
      const size = getWriteSize(data, encoding);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return this.auditedUnavailableResponse({
          operation: 'memory_write',
          pid,
          address,
          size,
          startedAt,
          reason: availability.reason,
          extra: {
            requestedAddress: address,
            dataLength: data.length,
            encoding,
          },
        });
      }

      const result = await this.memoryManager.writeMemory(pid, address, data, encoding);
      return this.auditedResultResponse({
        operation: 'memory_write',
        pid,
        address,
        size,
        startedAt,
        result,
        payload: {
          success: result.success,
          bytesWritten: result.bytesWritten,
          error: result.error,
          pid,
          address,
          dataLength: data.length,
          encoding,
          platform: this.platform,
        },
      });
    } catch (error) {
      logger.error('Memory write failed:', error);
      const data = getOptionalString(args.data);
      const encoding = getOptionalBinaryEncoding(args.encoding) ?? 'hex';
      return this.auditedExceptionResponse({
        operation: 'memory_write',
        pid: getOptionalPid(args.pid) ?? null,
        address: getOptionalString(args.address) ?? null,
        size: data ? getWriteSize(data, encoding) : null,
        startedAt,
        error,
      });
    }
  }

  async handleMemoryScan(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    const startedAt = Date.now();
    try {
      const pid = await this.resolvePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const patternType = normalizePatternType(args.patternType);
      const suspendTarget = args.suspendTarget === true;

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return this.auditedUnavailableResponse({
          operation: 'memory_scan',
          pid,
          address: null,
          size: null,
          startedAt,
          reason: availability.reason,
          extra: {
            requestedPattern: pattern,
            patternType,
            addresses: [],
          },
        });
      }

      const result = await this.memoryManager.scanMemory(pid, pattern, patternType, suspendTarget);
      return this.auditedResultResponse({
        operation: 'memory_scan',
        pid,
        address: null,
        size: null,
        startedAt,
        result,
        payload: {
          success: result.success,
          addresses: result.addresses,
          error: result.error,
          pid,
          pattern,
          patternType,
          platform: this.platform,
        },
      });
    } catch (error) {
      logger.error('Memory scan failed:', error);
      return this.auditedExceptionResponse({
        operation: 'memory_scan',
        pid: getOptionalPid(args.pid) ?? null,
        address: null,
        size: null,
        startedAt,
        error,
      });
    }
  }

  async handleMemoryAuditExport(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const entries = this.host.exportMemoryAuditEntries();
      const clear = args.clear === true;
      const count = this.host.getMemoryAuditCount();

      if (clear) {
        this.host.clearMemoryAuditEntries();
      }

      return this.jsonResponse({
        success: true,
        count,
        cleared: clear,
        entries,
      });
    } catch (error) {
      logger.error('Memory audit export failed:', error);
      return this.errorResponse(error);
    }
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const pid = await this.resolvePid(args.pid);
      const address = requireString(args.address, 'address');
      const result = await this.memoryManager.checkMemoryProtection(pid, address);
      return this.jsonResponse(result);
    } catch (error) {
      logger.error('Memory check protection failed:', error);
      return this.errorResponse(error);
    }
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const pid = await this.resolvePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const addresses = this.requireStringArray(args.addresses, 'addresses');
      const patternType = normalizePatternType(args.patternType);
      if (addresses.length === 0) {
        return this.jsonResponse({
          success: false,
          error: 'addresses must contain at least one address',
        });
      }

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return this.unavailableResponse(pid, availability.reason);
      }

      const result = await this.memoryManager.scanMemoryFiltered(
        pid,
        pattern,
        addresses,
        patternType,
      );
      return this.jsonResponse(result);
    } catch (error) {
      logger.error('Memory scan filtered failed:', error);
      return this.errorResponse(error);
    }
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const pid = await this.resolvePid(args.pid);
      const patches = this.requirePatches(args.patches);
      // An empty batch performs no OS write, so it must not require elevated
      // memory access just to report success with zero results.
      if (patches.length === 0) {
        return this.jsonResponse({ success: true, results: [] });
      }

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return this.unavailableResponse(pid, availability.reason);
      }

      const result = await this.memoryManager.batchMemoryWrite(pid, patches);
      return this.jsonResponse(result);
    } catch (error) {
      logger.error('Memory batch write failed:', error);
      return this.errorResponse(error);
    }
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const pid = await this.resolvePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');
      const outputPath = requireString(args.outputPath, 'outputPath');

      this.ensureRelativeOutputPath(outputPath);

      const result = await this.memoryManager.dumpMemoryRegion(pid, address, size, outputPath);
      return this.jsonResponse(result);
    } catch (error) {
      logger.error('Memory dump region failed:', error);
      return this.errorResponse(error);
    }
  }

  async handleMemoryListRegions(args: Record<string, unknown>): Promise<MemoryToolResponse> {
    try {
      const pid = await this.resolvePid(args.pid);
      const result = await this.memoryManager.enumerateRegions(pid);
      return this.jsonResponse(result);
    } catch (error) {
      logger.error('Memory list regions failed:', error);
      return this.errorResponse(error);
    }
  }

  private jsonResponse(payload: unknown): MemoryToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private errorResponse(error: unknown): MemoryToolResponse {
    return this.jsonResponse({
      success: false,
      error: this.errorMessage(error),
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolvePidOrAttachedRenderer(value, this.processManager, this.ctx);
  }

  private async auditedUnavailableResponse(params: {
    operation: AuditedMemoryOperation;
    pid: number;
    address: string | null;
    size: number | null;
    startedAt: number;
    reason?: string;
    extra?: Record<string, unknown>;
  }): Promise<MemoryToolResponse> {
    const errorMessage = params.reason ?? 'Memory operations not available';
    const diagnostics = await this.host.safeBuildMemoryDiagnostics({
      pid: params.pid,
      address: params.address ?? undefined,
      size: params.size ?? undefined,
      operation: params.operation,
      error: errorMessage,
    });

    this.host.recordMemoryAudit({
      operation: params.operation,
      pid: params.pid,
      address: params.address,
      size: params.size,
      result: 'failure',
      error: errorMessage,
      durationMs: Date.now() - params.startedAt,
    });

    return this.jsonResponse({
      success: false,
      message: 'Memory operations not available',
      reason: params.reason,
      platform: this.platform,
      pid: params.pid,
      ...(params.address !== null ? { address: params.address } : {}),
      ...(params.size !== null ? { size: params.size } : {}),
      ...params.extra,
      diagnostics,
    });
  }

  private async auditedResultResponse(params: {
    operation: AuditedMemoryOperation;
    pid: number;
    address: string | null;
    size: number | null;
    startedAt: number;
    result: {
      success: boolean;
      error?: string;
    };
    payload: Record<string, unknown>;
  }): Promise<MemoryToolResponse> {
    const diagnostics = !params.result.success
      ? await this.host.safeBuildMemoryDiagnostics({
          pid: params.pid,
          address: params.address ?? undefined,
          size: params.size ?? undefined,
          operation: params.operation,
          error: params.result.error,
        })
      : undefined;

    this.host.recordMemoryAudit({
      operation: params.operation,
      pid: params.pid,
      address: params.address,
      size: params.size,
      result: params.result.success ? 'success' : 'failure',
      error: params.result.error,
      durationMs: Date.now() - params.startedAt,
    });

    if (!params.result.success) {
      params.payload.diagnostics = diagnostics;
    }

    return this.jsonResponse(params.payload);
  }

  private async auditedExceptionResponse(params: {
    operation: AuditedMemoryOperation;
    pid: number | null;
    address: string | null;
    size: number | null;
    startedAt: number;
    error: unknown;
  }): Promise<MemoryToolResponse> {
    const errorMessage = this.errorMessage(params.error);
    const diagnostics = await this.host.safeBuildMemoryDiagnostics({
      pid: params.pid ?? undefined,
      address: params.address ?? undefined,
      size: params.size ?? undefined,
      operation: params.operation,
      error: errorMessage,
    });

    this.host.recordMemoryAudit({
      operation: params.operation,
      pid: params.pid,
      address: params.address,
      size: params.size,
      result: 'failure',
      error: errorMessage,
      durationMs: Date.now() - params.startedAt,
    });

    return this.jsonResponse({
      success: false,
      error: errorMessage,
      diagnostics,
    });
  }

  private unavailableResponse(pid: number, reason?: string): MemoryToolResponse {
    return this.jsonResponse({
      success: false,
      message: 'Memory operations not available',
      reason,
      platform: this.platform,
      pid,
    });
  }

  private requireStringArray(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value)) {
      throw new Error(`${fieldName} must be an array of strings`);
    }

    return value.map((entry, index) => requireString(entry, `${fieldName}[${index}]`));
  }

  private requirePatches(value: unknown): MemoryPatch[] {
    if (!Array.isArray(value)) {
      throw new Error('patches must be an array');
    }

    return value.map((entry, index) => {
      if (entry === null || typeof entry !== 'object') {
        throw new Error(`patches[${index}] must be an object`);
      }

      const patch = entry as Record<string, unknown>;
      const encoding = normalizeBinaryEncoding(patch.encoding, `patches[${index}].encoding`);
      return {
        address: requireString(patch.address, `patches[${index}].address`),
        data: requireString(patch.data, `patches[${index}].data`),
        ...(encoding ? { encoding } : {}),
      };
    });
  }

  private ensureRelativeOutputPath(outputPath: string): void {
    if (/^[/\\]/.test(outputPath) || /\.\./.test(outputPath) || /^[A-Za-z]:/.test(outputPath)) {
      throw new Error(
        'outputPath must be a relative path without parent directory traversal or drive letters',
      );
    }
  }
}
