import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionHandlers } from '../../../../../src/server/domains/memory/handlers/session';

describe('SessionHandlers', () => {
  let handlers: SessionHandlers;
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

  const mocksessionManager = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocksessionManager).forEach((key) => delete mocksessionManager[key]);
    handlers = new SessionHandlers(mocksessionManager);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(SessionHandlers);
  });

  describe('handleScanList', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.listSessions = vi.fn().mockReturnValue({
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

      const response = await handlers.handleScanList(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mocksessionManager.listSessions = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanList(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleScanDelete', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.deleteSession = vi.fn().mockReturnValue({
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

      const response = await handlers.handleScanDelete(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mocksessionManager.deleteSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanDelete(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleScanExport', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.exportSession = vi.fn().mockReturnValue({
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

      const response = await handlers.handleScanExport(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mocksessionManager.exportSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanExport(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });
});
