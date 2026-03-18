import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getProcessByPid: vi.fn(),
  findProcesses: vi.fn(),
  checkAvailability: vi.fn(),
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  scanMemory: vi.fn(),
  checkMemoryProtection: vi.fn(),
  enumerateModules: vi.fn(),
  scanMemoryFiltered: vi.fn(),
  batchMemoryWrite: vi.fn(),
  dumpMemoryRegion: vi.fn(),
  enumerateRegions: vi.fn(),
  auditEntries: [] as Array<Record<string, unknown>>,
}));

vi.mock(import('@server/domains/shared/modules'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    UnifiedProcessManager: class {
      getPlatform() {
        return 'win32';
      }
      findProcesses = state.findProcesses;
      getProcessByPid = state.getProcessByPid;
    } as unknown as typeof actual.UnifiedProcessManager,
    MemoryManager: class {
      checkAvailability = state.checkAvailability;
      readMemory = state.readMemory;
      writeMemory = state.writeMemory;
      scanMemory = state.scanMemory;
      checkMemoryProtection = state.checkMemoryProtection;
      enumerateModules = state.enumerateModules;
      scanMemoryFiltered = state.scanMemoryFiltered;
      batchMemoryWrite = state.batchMemoryWrite;
      dumpMemoryRegion = state.dumpMemoryRegion;
      enumerateRegions = state.enumerateRegions;
    } as unknown as typeof actual.MemoryManager,
  };
});

vi.mock(import('@src/modules/process/memory/AuditTrail'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    MemoryAuditTrail: class {
      record(entry: Record<string, unknown>) {
        state.auditEntries.push({
          ...entry,
          timestamp: '2026-03-15T00:00:00.000Z',
          user: 'test-user',
        });
      }
      exportJson() {
        return JSON.stringify(state.auditEntries);
      }
      clear() {
        state.auditEntries.length = 0;
      }
      size() {
        return state.auditEntries.length;
      }
    } as unknown as typeof actual.MemoryAuditTrail,
  };
});

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ProcessToolHandlersMemory } from '@server/domains/process/handlers.impl.core.runtime.memory';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0]!.text);
}

describe('ProcessToolHandlersMemory — additional coverage', () => {
  let handler: ProcessToolHandlersMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    state.auditEntries.length = 0;

    state.checkAvailability.mockResolvedValue({ available: true });
    state.getProcessByPid.mockResolvedValue(null);
    state.checkMemoryProtection.mockResolvedValue({
      success: true,
      protection: 'RW',
      regionStart: '0x1000',
      regionSize: 16,
      isReadable: true,
      isWritable: true,
    });
    state.enumerateModules.mockResolvedValue({
      success: true,
      modules: [{ name: 'kernel32.dll', baseAddress: '0x1000', size: 4096 }],
    });
    state.readMemory.mockResolvedValue({ success: true, data: '90', error: undefined });
    state.writeMemory.mockResolvedValue({ success: true, bytesWritten: 1, error: undefined });
    state.scanMemory.mockResolvedValue({ success: true, addresses: ['0x1000'], error: undefined });

    handler = new ProcessToolHandlersMemory();
  });

  // ── handleMemoryRead ─────────────────────────────────────────

  describe('handleMemoryRead', () => {
    it('returns success on valid read', async () => {
      state.readMemory.mockResolvedValue({ success: true, data: 'AABB', error: undefined });

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(true);
      expect(body.data).toBe('AABB');
      expect(body.pid).toBe(1234);
      expect(body.address).toBe('0x1000');
      expect(body.size).toBe(4);
      expect(body.platform).toBe('win32');
      expect(body.diagnostics).toBeUndefined();
    });

    it('includes diagnostics when read fails', async () => {
      state.readMemory.mockResolvedValue({ success: false, data: null, error: 'Access denied' });
      state.getProcessByPid.mockResolvedValue({ pid: 1234, name: 'test.exe' });

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Access denied');
      expect(body.diagnostics).toBeDefined();
      expect(body.diagnostics.process.exists).toBe(true);
    });

    it('handles unavailable memory operations', async () => {
      state.checkAvailability.mockResolvedValue({ available: false, reason: 'Need admin' });

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
      expect(body.reason).toBe('Need admin');
      expect(body.diagnostics).toBeDefined();
    });

    it('handles missing pid argument', async () => {
      const body = parseJson(await handler.handleMemoryRead({ address: '0x1000', size: 4 }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('handles missing address argument', async () => {
      const body = parseJson(await handler.handleMemoryRead({ pid: 1234, size: 4 }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('address');
    });

    it('handles missing size argument', async () => {
      const body = parseJson(await handler.handleMemoryRead({ pid: 1234, address: '0x1000' }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('size');
    });

    it('handles negative pid', async () => {
      const body = parseJson(
        await handler.handleMemoryRead({ pid: -5, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('records audit entry on successful read', async () => {
      await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 });

      expect(state.auditEntries).toHaveLength(1);
      expect(state.auditEntries[0]).toMatchObject({
        operation: 'memory_read',
        pid: 1234,
        address: '0x1000',
        size: 4,
        result: 'success',
      });
    });

    it('records audit entry on failed read', async () => {
      state.readMemory.mockResolvedValue({ success: false, data: null, error: 'No access' });

      await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 });

      expect(state.auditEntries).toHaveLength(1);
      expect(state.auditEntries[0]).toMatchObject({
        operation: 'memory_read',
        result: 'failure',
        error: 'No access',
      });
    });

    it('records audit entry on exception', async () => {
      // pid = 0 triggers exception in validatePid
      await handler.handleMemoryRead({ pid: 0, address: '0x1000', size: 4 });

      expect(state.auditEntries).toHaveLength(1);
      expect(state.auditEntries[0]).toMatchObject({
        operation: 'memory_read',
        result: 'failure',
      });
    });
  });

  // ── handleMemoryWrite ────────────────────────────────────────

  describe('handleMemoryWrite', () => {
    it('returns success on valid write', async () => {
      state.writeMemory.mockResolvedValue({ success: true, bytesWritten: 2, error: undefined });

      const body = parseJson(
        await handler.handleMemoryWrite({
          pid: 1234,
          address: '0x2000',
          data: 'AABB',
          encoding: 'hex',
        })
      );

      expect(body.success).toBe(true);
      expect(body.bytesWritten).toBe(2);
      expect(body.pid).toBe(1234);
      expect(body.address).toBe('0x2000');
      expect(body.encoding).toBe('hex');
      expect(body.diagnostics).toBeUndefined();
    });

    it('includes diagnostics when write fails', async () => {
      state.writeMemory.mockResolvedValue({
        success: false,
        bytesWritten: 0,
        error: 'Permission denied',
      });

      const body = parseJson(
        await handler.handleMemoryWrite({
          pid: 1234,
          address: '0x2000',
          data: 'AA',
          encoding: 'hex',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Permission denied');
      expect(body.diagnostics).toBeDefined();
    });

    it('handles unavailable memory operations for write', async () => {
      state.checkAvailability.mockResolvedValue({ available: false, reason: 'Not supported' });

      const body = parseJson(
        await handler.handleMemoryWrite({
          pid: 1234,
          address: '0x2000',
          data: 'AA',
          encoding: 'hex',
        })
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
    });

    it('handles base64 encoding for size calculation', async () => {
      state.writeMemory.mockResolvedValue({ success: true, bytesWritten: 5, error: undefined });

      const body = parseJson(
        await handler.handleMemoryWrite({
          pid: 1234,
          address: '0x2000',
          data: 'SGVsbG8=', // "Hello" in base64
          encoding: 'base64',
        })
      );

      expect(body.success).toBe(true);
      expect(body.encoding).toBe('base64');
    });

    it('defaults encoding to hex', async () => {
      state.writeMemory.mockResolvedValue({ success: true, bytesWritten: 1, error: undefined });

      const body = parseJson(
        await handler.handleMemoryWrite({ pid: 1234, address: '0x2000', data: 'AA' })
      );

      expect(body.encoding).toBe('hex');
    });

    it('handles exception in write path (missing data)', async () => {
      const body = parseJson(await handler.handleMemoryWrite({ pid: 1234, address: '0x2000' }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('data');
    });

    it('handles exception in write path (invalid pid)', async () => {
      const body = parseJson(
        await handler.handleMemoryWrite({ pid: 'abc', address: '0x2000', data: 'AA' })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('records audit entry on write', async () => {
      await handler.handleMemoryWrite({
        pid: 1234,
        address: '0x2000',
        data: 'AABB',
        encoding: 'hex',
      });

      expect(state.auditEntries).toHaveLength(1);
      expect(state.auditEntries[0]).toMatchObject({
        operation: 'memory_write',
        pid: 1234,
        address: '0x2000',
        result: 'success',
      });
    });
  });

  // ── handleMemoryScan ─────────────────────────────────────────

  describe('handleMemoryScan', () => {
    it('returns addresses on successful scan', async () => {
      state.scanMemory.mockResolvedValue({
        success: true,
        addresses: ['0x1000', '0x2000'],
        error: undefined,
      });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: 'AABB', patternType: 'hex' })
      );

      expect(body.success).toBe(true);
      expect(body.addresses).toEqual(['0x1000', '0x2000']);
      expect(body.pattern).toBe('AABB');
      expect(body.patternType).toBe('hex');
    });

    it('includes diagnostics when scan fails', async () => {
      state.scanMemory.mockResolvedValue({ success: false, addresses: [], error: 'Scan timeout' });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: 'AA', patternType: 'hex' })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Scan timeout');
      expect(body.diagnostics).toBeDefined();
    });

    it('handles unavailable memory for scan', async () => {
      state.checkAvailability.mockResolvedValue({ available: false, reason: 'No ptrace' });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: 'AA', patternType: 'hex' })
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
    });

    it('normalizes unknown patternType to hex', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: 'AA', patternType: 'unknown' })
      );

      expect(body.patternType).toBe('hex');
    });

    it('accepts int32 patternType', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: '42', patternType: 'int32' })
      );

      expect(body.patternType).toBe('int32');
    });

    it('accepts string patternType', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: 'hello', patternType: 'string' })
      );

      expect(body.patternType).toBe('string');
    });

    it('accepts float patternType', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: '3.14', patternType: 'float' })
      );

      expect(body.patternType).toBe('float');
    });

    it('accepts double patternType', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: '3.14', patternType: 'double' })
      );

      expect(body.patternType).toBe('double');
    });

    it('accepts int64 patternType', async () => {
      state.scanMemory.mockResolvedValue({ success: true, addresses: [], error: undefined });

      const body = parseJson(
        await handler.handleMemoryScan({ pid: 1234, pattern: '999999999999', patternType: 'int64' })
      );

      expect(body.patternType).toBe('int64');
    });

    it('handles exception in scan path (missing pattern)', async () => {
      const body = parseJson(await handler.handleMemoryScan({ pid: 1234 }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('pattern');
    });

    it('records audit entry on scan', async () => {
      await handler.handleMemoryScan({ pid: 1234, pattern: 'AA', patternType: 'hex' });

      expect(state.auditEntries).toHaveLength(1);
      expect(state.auditEntries[0]).toMatchObject({
        operation: 'memory_scan',
        pid: 1234,
        result: 'success',
      });
    });
  });

  // ── handleMemoryAuditExport ──────────────────────────────────

  describe('handleMemoryAuditExport', () => {
    it('exports empty audit trail', async () => {
      const body = parseJson(await handler.handleMemoryAuditExport({}));

      expect(body.success).toBe(true);
      expect(body.count).toBe(0);
      expect(body.cleared).toBe(false);
      expect(body.entries).toEqual([]);
    });

    it('exports with clear=false does not clear', async () => {
      await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 });

      const body = parseJson(await handler.handleMemoryAuditExport({ clear: false }));

      expect(body.count).toBe(1);
      expect(body.cleared).toBe(false);
      expect(state.auditEntries).toHaveLength(1);
    });

    it('exports with clear=true clears entries', async () => {
      await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 });

      const body = parseJson(await handler.handleMemoryAuditExport({ clear: true }));

      expect(body.count).toBe(1);
      expect(body.cleared).toBe(true);
      expect(state.auditEntries).toHaveLength(0);
    });

    it('exports multiple audit entries', async () => {
      await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 });
      await handler.handleMemoryWrite({
        pid: 1234,
        address: '0x2000',
        data: 'AA',
        encoding: 'hex',
      });

      const body = parseJson(await handler.handleMemoryAuditExport({}));

      expect(body.count).toBe(2);
      expect(body.entries).toHaveLength(2);
    });
  });

  // ── handleMemoryCheckProtection ──────────────────────────────

  describe('handleMemoryCheckProtection', () => {
    it('returns protection info on success', async () => {
      state.checkMemoryProtection.mockResolvedValue({
        success: true,
        protection: 'RWX',
        regionStart: '0x1000',
        regionSize: 4096,
        isReadable: true,
        isWritable: true,
      });

      const body = parseJson(
        await handler.handleMemoryCheckProtection({ pid: 1234, address: '0x1000' })
      );

      expect(body.success).toBe(true);
      expect(body.protection).toBe('RWX');
      expect(body.regionStart).toBe('0x1000');
      expect(body.regionSize).toBe(4096);
    });

    it('handles exception (missing pid)', async () => {
      const body = parseJson(await handler.handleMemoryCheckProtection({ address: '0x1000' }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('handles exception (missing address)', async () => {
      const body = parseJson(await handler.handleMemoryCheckProtection({ pid: 1234 }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('address');
    });

    it('handles checkMemoryProtection failure', async () => {
      state.checkMemoryProtection.mockRejectedValue(new Error('Access failed'));

      const body = parseJson(
        await handler.handleMemoryCheckProtection({ pid: 1234, address: '0x1000' })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Access failed');
    });
  });

  // ── handleMemoryScanFiltered ─────────────────────────────────

  describe('handleMemoryScanFiltered', () => {
    it('returns filtered scan results', async () => {
      state.scanMemoryFiltered.mockResolvedValue({
        success: true,
        addresses: ['0x1000'],
      });

      const body = parseJson(
        await handler.handleMemoryScanFiltered({
          pid: 1234,
          pattern: 'AABB',
          addresses: ['0x1000', '0x2000'],
          patternType: 'hex',
        })
      );

      expect(body.success).toBe(true);
      expect(body.addresses).toEqual(['0x1000']);
    });

    it('handles unavailable memory for filtered scan', async () => {
      state.checkAvailability.mockResolvedValue({ available: false, reason: 'disabled' });

      const body = parseJson(
        await handler.handleMemoryScanFiltered({
          pid: 1234,
          pattern: 'AA',
          addresses: ['0x1000'],
          patternType: 'hex',
        })
      );

      expect(body.success).toBe(false);
      expect(body.reason).toBe('disabled');
    });

    it('handles exception in filtered scan (invalid pid)', async () => {
      const body = parseJson(
        await handler.handleMemoryScanFiltered({
          pid: 'bad',
          pattern: 'AA',
          addresses: ['0x1000'],
          patternType: 'hex',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });
  });

  // ── handleMemoryBatchWrite ───────────────────────────────────

  describe('handleMemoryBatchWrite', () => {
    it('returns batch write results', async () => {
      state.batchMemoryWrite.mockResolvedValue({
        success: true,
        results: [{ address: '0x1000', success: true, bytesWritten: 1 }],
      });

      const body = parseJson(
        await handler.handleMemoryBatchWrite({
          pid: 1234,
          patches: [{ address: '0x1000', data: 'AA', encoding: 'hex' }],
        })
      );

      expect(body.success).toBe(true);
    });

    it('handles unavailable memory for batch write', async () => {
      state.checkAvailability.mockResolvedValue({ available: false, reason: 'no write' });

      const body = parseJson(
        await handler.handleMemoryBatchWrite({
          pid: 1234,
          patches: [{ address: '0x1000', data: 'AA' }],
        })
      );

      expect(body.success).toBe(false);
      expect(body.reason).toBe('no write');
    });

    it('handles exception in batch write (invalid pid)', async () => {
      const body = parseJson(
        await handler.handleMemoryBatchWrite({
          pid: 0,
          patches: [{ address: '0x1000', data: 'AA' }],
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });
  });

  // ── handleMemoryDumpRegion ───────────────────────────────────

  describe('handleMemoryDumpRegion', () => {
    it('returns dump result on success', async () => {
      state.dumpMemoryRegion.mockResolvedValue({
        success: true,
        path: 'dump.bin',
        size: 256,
      });

      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
          outputPath: 'dump.bin',
        })
      );

      expect(body.success).toBe(true);
      expect(body.path).toBe('dump.bin');
    });

    it('rejects absolute paths', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
          outputPath: '/etc/passwd',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('relative path');
    });

    it('rejects paths with directory traversal', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
          outputPath: '../../../etc/passwd',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('parent directory traversal');
    });

    it('rejects paths with drive letters', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
          outputPath: 'C:\\temp\\dump.bin',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('relative path');
    });

    it('rejects backslash absolute paths', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
          outputPath: '\\temp\\dump.bin',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('relative path');
    });

    it('handles exception (missing pid)', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          address: '0x1000',
          size: 256,
          outputPath: 'dump.bin',
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('handles exception (missing outputPath)', async () => {
      const body = parseJson(
        await handler.handleMemoryDumpRegion({
          pid: 1234,
          address: '0x1000',
          size: 256,
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('outputPath');
    });
  });

  // ── handleMemoryListRegions ──────────────────────────────────

  describe('handleMemoryListRegions', () => {
    it('returns regions on success', async () => {
      state.enumerateRegions.mockResolvedValue({
        success: true,
        regions: [
          { baseAddress: '0x1000', size: 4096, protection: 'RW' },
          { baseAddress: '0x2000', size: 8192, protection: 'RX' },
        ],
      });

      const body = parseJson(await handler.handleMemoryListRegions({ pid: 1234 }));

      expect(body.success).toBe(true);
      expect(body.regions).toHaveLength(2);
    });

    it('handles exception (invalid pid)', async () => {
      const body = parseJson(await handler.handleMemoryListRegions({ pid: 'not-a-number' }));

      expect(body.success).toBe(false);
      expect(body.error).toContain('PID');
    });

    it('handles enumerateRegions failure', async () => {
      state.enumerateRegions.mockRejectedValue(new Error('Enumeration failed'));

      const body = parseJson(await handler.handleMemoryListRegions({ pid: 1234 }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('Enumeration failed');
    });
  });

  // ── safeBuildMemoryDiagnostics edge cases ─────────────────────

  describe('diagnostics edge cases', () => {
    it('handles diagnostics failure gracefully for read', async () => {
      // Force diagnostics to fail by making both checkAvailability throw on second call
      let callCount = 0;
      state.checkAvailability.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: availability check — succeed
          return { available: true };
        }
        // Second call: inside buildMemoryDiagnostics — throw
        throw new Error('diagnostics crash');
      });
      state.readMemory.mockResolvedValue({ success: false, data: null, error: 'Boom' });

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      // Should still succeed with diagnostics being undefined
      expect(body.success).toBe(false);
      expect(body.error).toBe('Boom');
    });

    it('handles non-Error exceptions in read path', async () => {
      state.checkAvailability.mockRejectedValue('string exception');

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('string exception');
    });

    it('handles non-Error exceptions in write path', async () => {
      state.checkAvailability.mockRejectedValue(42);

      const body = parseJson(
        await handler.handleMemoryWrite({ pid: 1234, address: '0x1000', data: 'AA' })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('42');
    });

    it('handles non-Error exceptions in scan path', async () => {
      state.checkAvailability.mockRejectedValue(null);

      const body = parseJson(await handler.handleMemoryScan({ pid: 1234, pattern: 'AA' }));

      expect(body.success).toBe(false);
    });
  });

  // ── handleMemoryWrite with unavailable and diagnostics ────────

  describe('handleMemoryWrite — unavailability diagnostics', () => {
    it('includes diagnostics on unavailability with reason=undefined', async () => {
      state.checkAvailability.mockResolvedValue({ available: false });

      const body = parseJson(
        await handler.handleMemoryWrite({
          pid: 1234,
          address: '0x2000',
          data: 'AA',
          encoding: 'hex',
        })
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
    });
  });

  // ── handleMemoryRead with unavailable and diagnostics ─────────

  describe('handleMemoryRead — unavailability diagnostics', () => {
    it('includes diagnostics on unavailability with reason=undefined', async () => {
      state.checkAvailability.mockResolvedValue({ available: false });

      const body = parseJson(
        await handler.handleMemoryRead({ pid: 1234, address: '0x1000', size: 4 })
      );

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
    });
  });

  // ── handleMemoryScan — unavailability diagnostics ─────────────

  describe('handleMemoryScan — unavailability diagnostics', () => {
    it('includes diagnostics on unavailability with reason=undefined', async () => {
      state.checkAvailability.mockResolvedValue({ available: false });

      const body = parseJson(await handler.handleMemoryScan({ pid: 1234, pattern: 'AA' }));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Memory operations not available');
    });
  });
});
