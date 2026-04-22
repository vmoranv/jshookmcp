import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrityHandlers } from '../../../../../src/server/domains/memory/handlers/integrity';

describe('IntegrityHandlers', () => {
  let handlers: IntegrityHandlers;
  const dummyArgs = {
    sessionId: 'test-session',
    pattern: '12 34',
    pid: 1234,
    structure: '{"fields":[]}',
    name: 'test',
    type: 'float',
    size: 4,
    value: '1.2',
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
      mockspeedhackEngine.apply = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleSpeedhackApply(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockspeedhackEngine.apply = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleSpeedhackApply(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleSpeedhackSet', () => {
    it('returns success response on happy path', async () => {
      mockspeedhackEngine.setSpeed = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleSpeedhackSet(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockspeedhackEngine.setSpeed = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleSpeedhackSet(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleHeapEnumerate', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.enumerateHeaps = vi.fn().mockReturnValue({ heaps: [] });

      const response = await handlers.handleHeapEnumerate(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.enumerateHeaps = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapEnumerate(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleHeapStats', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.getStats = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleHeapStats(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.getStats = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapStats(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleHeapAnomalies', () => {
    it('returns success response on happy path', async () => {
      mockheapAnalyzer.detectAnomalies = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleHeapAnomalies(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockheapAnalyzer.detectAnomalies = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleHeapAnomalies(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePEHeaders', () => {
    it('returns success response on happy path', async () => {
      mockpeAnalyzer.parseHeaders = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handlePEHeaders(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.parseHeaders = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePEHeaders(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePEImportsExports', () => {
    it('returns success response on happy path', async () => {
      mockpeAnalyzer.parseImports = vi.fn().mockReturnValue([]);
      mockpeAnalyzer.parseExports = vi.fn().mockReturnValue([]);

      const response = await handlers.handlePEImportsExports(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.parseImports = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePEImportsExports(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleInlineHookDetect', () => {
    it('returns success response on happy path', async () => {
      mockpeAnalyzer.detectInlineHooks = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleInlineHookDetect(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockpeAnalyzer.detectInlineHooks = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleInlineHookDetect(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleAntiCheatDetect', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.detect = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleAntiCheatDetect(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.detect = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleAntiCheatDetect(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleGuardPages', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.findGuardPages = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handleGuardPages(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.findGuardPages = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleGuardPages(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleIntegrityCheck', () => {
    it('returns success response on happy path', async () => {
      mockantiCheatDetector.checkIntegrity = vi.fn().mockReturnValue([{ isModified: true }]);

      const response = await handlers.handleIntegrityCheck(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockantiCheatDetector.checkIntegrity = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleIntegrityCheck(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });
});
