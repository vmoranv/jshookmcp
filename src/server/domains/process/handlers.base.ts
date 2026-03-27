/**
 * ProcessHandlersBase — top of the process domain handler chain.
 *
 * Inherits:
 *   ProcessHandlersCore → constructor, diagnostics, process handlers (find/get/windows/kill/debug)
 *
 * This file adds: memory handlers (read/write/scan/audit/protection/filtered/batch/dump/regions).
 *
 * Split history:
 *   handlers.base.types.ts   — shared types, interfaces, helper functions
 *   handlers.base.process.ts — ProcessHandlersCore (base class)
 *   handlers.base.ts         — ProcessHandlersBase (extends Core) ← this file
 */

import { logger } from '@utils/logger';
import { ProcessHandlersCore } from './handlers.base.process';
import {
  validatePid,
  requireString,
  requirePositiveNumber,
  normalizePatternType,
  getOptionalPid,
  getOptionalString,
  getOptionalPositiveNumber,
  getWriteSize,
} from './handlers.base.types';

export { validatePid, requireString, requirePositiveNumber } from './handlers.base.types';

export class ProcessHandlersBase extends ProcessHandlersCore {
  // ── Memory Handler Methods ──

  async handleMemoryRead(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          address,
          size,
          operation: 'memory_read',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_read',
          pid,
          address,
          size,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  requestedSize: size,
                  pid,
                  diagnostics,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.readMemory(pid, address, size);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            address,
            size,
            operation: 'memory_read',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_read',
        pid,
        address,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        data: result.data,
        error: result.error,
        pid,
        address,
        size,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory read failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const address = getOptionalString(args.address);
      const size = getOptionalPositiveNumber(args.size);
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        address,
        size,
        operation: 'memory_read',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_read',
        pid: pid ?? null,
        address: address ?? null,
        size: size ?? null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const data = requireString(args.data, 'data');
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      const size = getWriteSize(data, encoding);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          address,
          size,
          operation: 'memory_write',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_write',
          pid,
          address,
          size,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  dataLength: data !== undefined && data !== null ? data.length : 0,
                  encoding,
                  pid,
                  diagnostics,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.writeMemory(pid, address, data, encoding);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            address,
            size,
            operation: 'memory_write',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_write',
        pid,
        address,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        bytesWritten: result.bytesWritten,
        error: result.error,
        pid,
        address,
        dataLength: data.length,
        encoding,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory write failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const address = getOptionalString(args.address);
      const data = getOptionalString(args.data);
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      const size = data ? getWriteSize(data, encoding) : undefined;
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        address,
        size,
        operation: 'memory_write',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_write',
        pid: pid ?? null,
        address: address ?? null,
        size: size ?? null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const patternType = normalizePatternType(args.patternType);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          operation: 'memory_scan',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_scan',
          pid,
          address: null,
          size: null,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedPattern: pattern,
                  patternType,
                  pid,
                  diagnostics,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemory(pid, pattern, patternType);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            operation: 'memory_scan',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_scan',
        pid,
        address: null,
        size: null,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        addresses: result.addresses,
        error: result.error,
        pid,
        pattern,
        patternType,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        operation: 'memory_scan',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_scan',
        pid: pid ?? null,
        address: null,
        size: null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryAuditExport(args: Record<string, unknown>) {
    try {
      const exportedJson = this.auditTrail.exportJson();
      const entries = JSON.parse(exportedJson) as unknown[];
      const clear = args.clear === true;
      const count = this.auditTrail.size();

      if (clear) {
        this.auditTrail.clear();
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                count,
                cleared: clear,
                entries,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory audit export failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');

      const result = await this.memoryManager.checkMemoryProtection(pid, address);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory check protection failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const addresses = args.addresses as string[];
      const patternType = normalizePatternType(args.patternType);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemoryFiltered(
        pid,
        pattern,
        addresses,
        patternType,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan filtered failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const patches = args.patches as {
        address: string;
        data: string;
        encoding?: 'hex' | 'base64';
      }[];

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.batchMemoryWrite(pid, patches);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory batch write failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');
      const outputPath = requireString(args.outputPath, 'outputPath');

      if (/^[/\\]/.test(outputPath) || /\.\./.test(outputPath) || /^[A-Za-z]:/.test(outputPath)) {
        throw new Error(
          'outputPath must be a relative path without parent directory traversal or drive letters',
        );
      }

      const result = await this.memoryManager.dumpMemoryRegion(pid, address, size, outputPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory dump region failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleMemoryListRegions(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);

      const result = await this.memoryManager.enumerateRegions(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory list regions failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2,
            ),
          },
        ],
      };
    }
  }
}
