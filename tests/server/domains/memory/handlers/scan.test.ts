import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanHandlers } from '../../../../../src/server/domains/memory/handlers/scan';

describe('ScanHandlers', () => {
  let handlers: ScanHandlers;
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

  const mockscanner = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockscanner).forEach((key) => delete mockscanner[key]);
    handlers = new ScanHandlers(mockscanner);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(ScanHandlers);
  });

  describe('handleFirstScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.firstScan = vi.fn().mockReturnValue({ matchCount: 0, results: [] });

      const response = await handlers.handleFirstScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockscanner.firstScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleFirstScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleNextScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.nextScan = vi.fn().mockReturnValue({
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

      const response = await handlers.handleNextScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockscanner.nextScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleNextScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleUnknownScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockReturnValue({ regionCount: 0, byteCount: 0 });

      const response = await handlers.handleUnknownScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleUnknownScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePointerScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.pointerScan = vi.fn().mockReturnValue({
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

      const response = await handlers.handlePointerScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockscanner.pointerScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleGroupScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.groupScan = vi.fn().mockReturnValue({
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

      const response = await handlers.handleGroupScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockscanner.groupScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleGroupScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });
});
