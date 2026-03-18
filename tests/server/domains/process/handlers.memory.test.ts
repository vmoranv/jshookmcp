import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getProcessByPid: vi.fn(),
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
          timestamp: '2026-03-10T00:00:00.000Z',
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

describe('handlers.impl.core.runtime.memory', () => {
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

  it('records failed memory reads and exports the audit trail with diagnostics', async () => {
    const readBody = parseJson(
      await handler.handleMemoryRead({ pid: 0, address: '0x1234', size: 8 })
    );
    expect(readBody.success).toBe(false);
    expect(readBody.error).toBe('Invalid PID: 0');
    expect(readBody.diagnostics.permission.available).toBe(true);
    expect(readBody.diagnostics.address.queried).toBe(false);

    const auditBody = parseJson(await handler.handleMemoryAuditExport({ clear: false }));
    expect(auditBody.success).toBe(true);
    expect(auditBody.count).toBe(1);
    expect(auditBody.entries[0]).toMatchObject({
      operation: 'memory_read',
      address: '0x1234',
      size: 8,
      result: 'failure',
      error: 'Invalid PID: 0',
    });
  });

  it('includes diagnostics and audit entries when memory write is unavailable', async () => {
    state.checkAvailability.mockResolvedValue({ available: false, reason: 'Need admin' });

    const body = parseJson(
      await handler.handleMemoryWrite({ pid: 1234, address: '0x2000', data: '90', encoding: 'hex' })
    );

    expect(body.success).toBe(false);
    expect(body.reason).toBe('Need admin');
    expect(body.diagnostics.permission.reason).toBe('Need admin');
    expect(body.diagnostics.recommendedActions).toContain('Run as administrator');
    expect(state.auditEntries[0]).toMatchObject({
      operation: 'memory_write',
      pid: 1234,
      address: '0x2000',
      size: 1,
      result: 'failure',
      error: 'Need admin',
    });
  });

  it('adds diagnostics when memory scans fail after reaching the memory manager', async () => {
    state.getProcessByPid.mockResolvedValue({ pid: 1234, name: 'game.exe' });
    state.scanMemory.mockResolvedValue({
      success: false,
      addresses: [],
      error: 'Access denied',
    });

    const body = parseJson(
      await handler.handleMemoryScan({ pid: 1234, pattern: 'AA', patternType: 'hex' })
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe('Access denied');
    expect(body.diagnostics.process).toMatchObject({ exists: true, pid: 1234, name: 'game.exe' });
    expect(body.diagnostics.aslr.note).toContain('Enumerated 1 module');
    expect(body.diagnostics.recommendedActions).toContain('Run as administrator');
    expect(state.auditEntries[0]).toMatchObject({
      operation: 'memory_scan',
      pid: 1234,
      result: 'failure',
      error: 'Access denied',
    });
  });

  it('exports and clears audit entries when requested', async () => {
    await handler.handleMemoryRead({ pid: 0, address: '0x9999', size: 4 });
    expect(state.auditEntries).toHaveLength(1);

    const body = parseJson(await handler.handleMemoryAuditExport({ clear: true }));
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.cleared).toBe(true);
    expect(state.auditEntries).toHaveLength(0);
  });

  it('returns availability failures for filtered scans', async () => {
    state.checkAvailability.mockResolvedValue({ available: false, reason: 'ptrace required' });

    const body = parseJson(
      await handler.handleMemoryScanFiltered({
        pid: 1234,
        pattern: 'AA',
        addresses: ['0x1000'],
        patternType: 'hex',
      })
    );

    expect(body.success).toBe(false);
    expect(body.reason).toBe('ptrace required');
    expect(body.pid).toBe(1234);
  });

  it('returns availability failures for batch writes', async () => {
    state.checkAvailability.mockResolvedValue({ available: false, reason: 'write access denied' });

    const body = parseJson(
      await handler.handleMemoryBatchWrite({
        pid: 1234,
        patches: [{ address: '0x1000', data: '90', encoding: 'hex' }],
      })
    );

    expect(body.success).toBe(false);
    expect(body.reason).toBe('write access denied');
    expect(body.pid).toBe(1234);
  });
});
