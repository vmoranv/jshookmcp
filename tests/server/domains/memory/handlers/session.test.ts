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
      mocksessionManager.listSessions = vi.fn().mockReturnValue([{ id: 's1' }]);

      const response = await handlers.handleScanList(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);
    });

    it('returns error response on failure', async () => {
      mocksessionManager.listSessions = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanList(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleScanDelete', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.deleteSession = vi.fn().mockReturnValue(true);

      const response = await handlers.handleScanDelete(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.deleted).toBe(true);
      expect(mocksessionManager.deleteSession).toHaveBeenCalledWith('test-session');
    });

    it('returns error response on failure', async () => {
      mocksessionManager.deleteSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanDelete(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing sessionId', async () => {
      mocksessionManager.deleteSession = vi.fn();
      const response = await handlers.handleScanDelete({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_scan_session');
      expect(parsed.error).toContain('sessionId');
      expect(mocksessionManager.deleteSession).not.toHaveBeenCalled();
    });
  });

  describe('handleScanExport', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.exportSession = vi.fn().mockReturnValue('exported-blob');

      const response = await handlers.handleScanExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.exportedData).toBe('exported-blob');
      expect(mocksessionManager.exportSession).toHaveBeenCalledWith('test-session');
    });

    it('returns error response on failure', async () => {
      mocksessionManager.exportSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects empty sessionId', async () => {
      mocksessionManager.exportSession = vi.fn();
      const response = await handlers.handleScanExport({ sessionId: '' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_scan_session');
      expect(mocksessionManager.exportSession).not.toHaveBeenCalled();
    });
  });
});
