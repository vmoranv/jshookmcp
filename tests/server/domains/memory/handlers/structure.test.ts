import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureHandlers } from '../../../../../src/server/domains/memory/handlers/structure';

describe('StructureHandlers', () => {
  let handlers: StructureHandlers;
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

  const mockstructAnalyzer = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockstructAnalyzer).forEach((key) => delete mockstructAnalyzer[key]);
    handlers = new StructureHandlers(mockstructAnalyzer);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(StructureHandlers);
  });

  describe('handleStructureAnalyze', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockReturnValue({
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

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleVtableParse', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockReturnValue({
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

      const response = await handlers.handleVtableParse(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleVtableParse(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleStructureExportC', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
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

      const response = await handlers.handleStructureExportC(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureExportC(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleStructureCompare', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockReturnValue({
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

      const response = await handlers.handleStructureCompare(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureCompare(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });
});
