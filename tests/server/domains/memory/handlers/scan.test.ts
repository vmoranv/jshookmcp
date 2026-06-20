import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanHandlers } from '../../../../../src/server/domains/memory/handlers/scan';

describe('ScanHandlers', () => {
  let handlers: ScanHandlers;
  // Valid args covering every field the handlers read. Individual tests override
  // only the fields relevant to the scenario under test.
  const dummyArgs = {
    pid: 1234,
    value: '1.2',
    valueType: 'float',
    mode: 'exact',
    sessionId: 'test-session',
    targetAddress: '0x7FF612340000',
    alignment: 4,
    maxResults: 100,
    pattern: [
      { offset: 0, value: '100', type: 'int32' },
      { offset: 4, value: '3.14', type: 'float' },
    ],
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
      mockscanner.firstScan = vi
        .fn()
        .mockReturnValue({ totalMatches: 0, sessionId: 's1', results: [] });

      const response = await handlers.handleFirstScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.firstScan).toHaveBeenCalledWith(
        1234,
        '1.2',
        expect.objectContaining({ valueType: 'float', alignment: 4, maxResults: 100 }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.firstScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleFirstScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing valueType with a contextual error', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({ pid: 1234, value: '1.2' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_first_scan');
      expect(parsed.error).toContain('valueType');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('rejects invalid valueType with the allowed set in the message', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({
        pid: 1234,
        value: '1.2',
        valueType: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid valueType');
      expect(parsed.error).toContain('"bogus"');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('rejects missing value', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({ pid: 1234, valueType: 'float' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"value"');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });
  });

  describe('handleNextScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.nextScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handleNextScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.nextScan).toHaveBeenCalledWith('test-session', 'exact', '1.2', undefined);
    });

    it('returns error response on failure', async () => {
      mockscanner.nextScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleNextScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing sessionId', async () => {
      mockscanner.nextScan = vi.fn();
      const response = await handlers.handleNextScan({ mode: 'exact' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_next_scan');
      expect(parsed.error).toContain('sessionId');
      expect(mockscanner.nextScan).not.toHaveBeenCalled();
    });

    it('rejects invalid mode', async () => {
      mockscanner.nextScan = vi.fn();
      const response = await handlers.handleNextScan({ sessionId: 's1', mode: 'bogus' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid mode');
      expect(mockscanner.nextScan).not.toHaveBeenCalled();
    });
  });

  describe('handleUnknownScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handleUnknownScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.unknownInitialScan).toHaveBeenCalledWith(
        1234,
        expect.objectContaining({ valueType: 'float' }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleUnknownScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing valueType', async () => {
      mockscanner.unknownInitialScan = vi.fn();
      const response = await handlers.handleUnknownScan({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_unknown_scan');
      expect(parsed.error).toContain('valueType');
      expect(mockscanner.unknownInitialScan).not.toHaveBeenCalled();
    });
  });

  describe('handlePointerScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.pointerScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handlePointerScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.pointerScan).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        expect.objectContaining({ moduleOnly: false }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.pointerScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid targetAddress', async () => {
      mockscanner.pointerScan = vi.fn();
      const response = await handlers.handlePointerScan({ pid: 1234, targetAddress: 'not-hex' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('targetAddress must be a hex address');
      expect(mockscanner.pointerScan).not.toHaveBeenCalled();
    });
  });

  describe('handleGroupScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.groupScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handleGroupScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.groupScan).toHaveBeenCalledWith(
        1234,
        [
          { offset: 0, value: '100', type: 'int32' },
          { offset: 4, value: '3.14', type: 'float' },
        ],
        expect.objectContaining({ alignment: 4, maxResults: 100 }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.groupScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleGroupScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects empty pattern', async () => {
      mockscanner.groupScan = vi.fn();
      const response = await handlers.handleGroupScan({ pid: 1234, pattern: [] });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_group_scan');
      expect(parsed.error).toContain('pattern');
      expect(mockscanner.groupScan).not.toHaveBeenCalled();
    });

    it('rejects pattern element with invalid type', async () => {
      mockscanner.groupScan = vi.fn();
      const response = await handlers.handleGroupScan({
        pid: 1234,
        pattern: [{ offset: 0, value: '1', type: 'bogus' }],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('index 0');
      expect(parsed.error).toContain('"type"');
      expect(mockscanner.groupScan).not.toHaveBeenCalled();
    });
  });
});
