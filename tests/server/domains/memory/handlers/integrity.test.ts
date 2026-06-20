import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrityHandlers } from '../../../../../src/server/domains/memory/handlers/integrity';

describe('IntegrityHandlers', () => {
  let handlers: IntegrityHandlers;
  const dummyArgs = {
    pid: 1234,
    speed: 2.5,
    moduleBase: '0x7FF612340000',
    moduleName: 'test.exe',
    maxRegions: 10000,
    maxSections: 100,
  };

  const mockspeedhackEngine = {
    /* mock */
  } as any;
  const mockheapAnalyzer = {
    /* mock */
  } as any;
  const mockpeAnalyzer = {
    /* mock */
  } as any;
  const mockantiCheatDetector = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockspeedhackEngine).forEach((key) => delete mockspeedhackEngine[key]);
    Object.keys(mockheapAnalyzer).forEach((key) => delete mockheapAnalyzer[key]);
    Object.keys(mockpeAnalyzer).forEach((key) => delete mockpeAnalyzer[key]);
    Object.keys(mockantiCheatDetector).forEach((key) => delete mockantiCheatDetector[key]);
    handlers = new IntegrityHandlers(
      mockspeedhackEngine,
      mockheapAnalyzer,
      mockpeAnalyzer,
      mockantiCheatDetector,
    );
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(IntegrityHandlers);
  });

  describe('handleSpeedhackApply', () => {
    it('returns success response on happy path', async () => {
      mockspeedhackEngine.apply = vi.fn().mockReturnValue({ active: true });

      const response = await handlers.handleSpeedhackApply(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockspeedhackEngine.apply).toHaveBeenCalledWith(1234, 2.5);
    });

    it('returns error response on failure', async () => {
      mockspeedhackEngine.apply = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleSpeedhackApply(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive speed', async () => {
      mockspeedhackEngine.apply = vi.fn();
      const response = await handlers.handleSpeedhackApply({ pid: 1234, speed: 0 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"speed"');
      expect(mockspeedhackEngine.apply).not.toHaveBeenCalled();
    });

    it('throws when speedhackEngine is null (unsupported platform)', async () => {
      handlers = new IntegrityHandlers(null, null, null, null);
      const response = await handlers.handleSpeedhackApply(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('only supported on Windows');
    });
  });

  describe('handleSpeedhackSet', () => {
    it('returns success response on happy path', async () => {
      mockspeedhackEngine.setSpeed = vi.fn().mockReturnValue(true);

      const response = await handlers.handleSpeedhackSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.newSpeed).toBe(2.5);
      expect(mockspeedhackEngine.setSpeed).toHaveBeenCalledWith(1234, 2.5);
    });

    it('returns error response on failure', async () => {
      mockspeedhackEngine.setSpeed = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleSpeedhackSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing speed', async () => {
      mockspeedhackEngine.setSpeed = vi.fn();
      const response = await handlers.handleSpeedhackSet({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"speed"');
      expect(mockspeedhackEngine.setSpeed).not.toHaveBeenCalled();
    });
  });

  describe('handleHeapEnumerate', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.enumerateHeaps = vi.fn().mockReturnValue({ heaps: [] });

      const response = await handlers.handleHeapEnumerate(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.enumerateHeaps = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapEnumerate(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleHeapStats', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.getStats = vi.fn().mockReturnValue({ totalBlocks: 0 });

      const response = await handlers.handleHeapStats(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.getStats = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapStats(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleHeapAnomalies', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.detectAnomalies = vi.fn().mockReturnValue([]);

      const response = await handlers.handleHeapAnomalies(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.detectAnomalies = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapAnomalies(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePEHeaders', () => {
    it('returns success response on happy path', async () => {
      mockpeAnalyzer.parseHeaders = vi.fn().mockReturnValue({ machine: 'x64' });

      const response = await handlers.handlePEHeaders(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockpeAnalyzer.parseHeaders).toHaveBeenCalledWith(1234, '0x7FF612340000');
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.parseHeaders = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePEHeaders(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid moduleBase', async () => {
      mockpeAnalyzer.parseHeaders = vi.fn();
      const response = await handlers.handlePEHeaders({ pid: 1234, moduleBase: 'xyz' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('moduleBase must be a hex address');
      expect(mockpeAnalyzer.parseHeaders).not.toHaveBeenCalled();
    });
  });

  describe('handlePEImportsExports', () => {
    it('returns success response on happy path (default both)', async () => {
      mockpeAnalyzer.parseImports = vi.fn().mockReturnValue([]);
      mockpeAnalyzer.parseExports = vi.fn().mockReturnValue([]);

      const response = await handlers.handlePEImportsExports(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockpeAnalyzer.parseImports).toHaveBeenCalled();
      expect(mockpeAnalyzer.parseExports).toHaveBeenCalled();
    });

    it('honors table=imports', async () => {
      mockpeAnalyzer.parseImports = vi.fn().mockReturnValue([]);
      mockpeAnalyzer.parseExports = vi.fn().mockReturnValue([]);

      await handlers.handlePEImportsExports({ ...dummyArgs, table: 'imports' });
      expect(mockpeAnalyzer.parseImports).toHaveBeenCalled();
      expect(mockpeAnalyzer.parseExports).not.toHaveBeenCalled();
    });

    it('rejects invalid table enum', async () => {
      mockpeAnalyzer.parseImports = vi.fn();
      mockpeAnalyzer.parseExports = vi.fn();
      const response = await handlers.handlePEImportsExports({
        pid: 1234,
        moduleBase: '0x1',
        table: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid table');
      expect(mockpeAnalyzer.parseImports).not.toHaveBeenCalled();
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.parseImports = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePEImportsExports(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleInlineHookDetect', () => {
    it('returns success response on happy path', async () => {
      mockpeAnalyzer.detectInlineHooks = vi.fn().mockReturnValue([]);

      const response = await handlers.handleInlineHookDetect(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockpeAnalyzer.detectInlineHooks).toHaveBeenCalledWith(1234, 'test.exe');
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.detectInlineHooks = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleInlineHookDetect(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleAntiCheatDetect', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.detect = vi.fn().mockReturnValue([]);

      const response = await handlers.handleAntiCheatDetect(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.detect = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleAntiCheatDetect(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleGuardPages', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.scanGuardPages = vi.fn().mockReturnValue({
        guardPages: [{ address: '0x123', size: 4096, moduleName: 'test.exe', nearbySymbol: null }],
        stats: {
          scannedRegions: 1,
          queryFailures: 0,
          durationMs: 1,
          timedOut: false,
          truncated: false,
          maxRegions: 100,
          timeoutMs: 1000,
        },
      });

      const response = await handlers.handleGuardPages(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.scan.truncated).toBe(false);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.scanGuardPages = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleGuardPages(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive maxRegions', async () => {
      mockantiCheatDetector.scanGuardPages = vi.fn();
      const response = await handlers.handleGuardPages({ pid: 1234, maxRegions: 0 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"maxRegions" must be a positive number');
      expect(mockantiCheatDetector.scanGuardPages).not.toHaveBeenCalled();
    });
  });

  describe('handleIntegrityCheck', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.scanIntegrity = vi.fn().mockReturnValue({
        sections: [{ isModified: true }],
        stats: {
          scannedModules: 1,
          scannedSections: 1,
          hashedBytes: 32,
          skippedModules: 0,
          skippedSections: 0,
          durationMs: 1,
          timedOut: false,
          truncated: false,
          maxModules: 10,
          maxSections: 10,
          maxBytes: 1024,
          timeoutMs: 1000,
        },
      });

      const response = await handlers.handleIntegrityCheck(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.scan.truncated).toBe(false);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.scanIntegrity = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleIntegrityCheck(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive maxSections', async () => {
      mockantiCheatDetector.scanIntegrity = vi.fn();
      const response = await handlers.handleIntegrityCheck({ pid: 1234, maxSections: -1 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"maxSections" must be a positive number');
      expect(mockantiCheatDetector.scanIntegrity).not.toHaveBeenCalled();
    });
  });
});
