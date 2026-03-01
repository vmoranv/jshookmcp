import { logger } from '../../../utils/logger.js';
import {
  ProcessToolHandlersBase,
  requirePositiveNumber,
  requireString,
  validatePid,
} from './handlers.impl.core.runtime.base.js';

type MemoryPatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';

const MEMORY_PATTERN_TYPES: Set<MemoryPatternType> = new Set([
  'hex',
  'int32',
  'int64',
  'float',
  'double',
  'string',
]);

function normalizePatternType(value: unknown): MemoryPatternType {
  if (typeof value === 'string' && MEMORY_PATTERN_TYPES.has(value as MemoryPatternType)) {
    return value as MemoryPatternType;
  }
  return 'hex';
}

export class ProcessToolHandlersMemory extends ProcessToolHandlersBase {
  async handleMemoryRead(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');

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
                  requestedAddress: address,
                  requestedSize: size,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.readMemory(pid, address, size);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                data: result.data,
                error: result.error,
                pid,
                address,
                size,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory read failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const data = requireString(args.data, 'data');
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';

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
                  requestedAddress: address,
                  dataLength: data != null ? data.length : 0,
                  encoding,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.writeMemory(pid, address, data, encoding);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                bytesWritten: result.bytesWritten,
                error: result.error,
                pid,
                address,
                dataLength: data.length,
                encoding,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory write failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
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
                  requestedPattern: pattern,
                  patternType,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemory(pid, pattern, patternType);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                addresses: result.addresses,
                error: result.error,
                pid,
                pattern,
                patternType,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
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
              2
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
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemoryFiltered(pid, pattern, addresses, patternType);

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
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const patches = args.patches as { address: string; data: string; encoding?: 'hex' | 'base64' }[];

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
                2
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
              2
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
        throw new Error('outputPath must be a relative path without parent directory traversal or drive letters');
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
              2
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
              2
            ),
          },
        ],
      };
    }
  }
}
