import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcemapToolHandlersExtension } from '../../../../src/server/domains/sourcemap/handlers.impl.sourcemap-extension';
import { CodeCollector } from '../../../../src/modules/collector/CodeCollector';

describe('SourcemapToolHandlersExtension', () => {
  let handlers: SourcemapToolHandlersExtension;
  let mockcollector: any;
  let mockSession: any;
  let mockAttachedSession: any;
  let mockPage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // We only need getActivePage on the collector
    mockcollector = { getActivePage: vi.fn() };

    mockSession = {
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
      connection: vi.fn(),
    };
    mockAttachedSession = {
      send: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    mockSession.connection.mockReturnValue({
      session: vi.fn((sessionId: string) => (sessionId === 'ses2' ? mockAttachedSession : null)),
    });

    mockPage = {
      createCDPSession: vi.fn().mockResolvedValue(mockSession),
    };

    mockcollector.getActivePage.mockResolvedValue(mockPage);
    handlers = new SourcemapToolHandlersExtension(mockcollector as unknown as CodeCollector);
  });

  const dummyArgs = {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    code: 'console.log("test")',
    returnByValue: true,
  };

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(SourcemapToolHandlersExtension);
  });

  describe('extractExtensionId', () => {
    it('extracts valid ID', async () => {
      expect(
        (handlers as any).extractExtensionId(
          'chrome-extension://abcdefghijklmnopabcdefghijklmnop/foo',
        ),
      ).toBe('abcdefghijklmnopabcdefghijklmnop');
    });
    it('returns null for invalid url', async () => {
      expect((handlers as any).extractExtensionId('http://example.com')).toBe(null);
    });
    it('returns null for malformed ID', async () => {
      expect((handlers as any).extractExtensionId('chrome-extension://123/foo')).toBe(null);
    });
  });

  describe('pickPreferredExtensionTarget', () => {
    it('prefers service_worker', async () => {
      const targets: any[] = [
        { type: 'background_page', url: 'A' },
        { type: 'service_worker', url: 'B' },
      ];
      expect((handlers as any).pickPreferredExtensionTarget(targets).url).toBe('B');
    });
    it('falls back to background_page', async () => {
      const targets: any[] = [{ type: 'background_page', url: 'A' }];
      expect((handlers as any).pickPreferredExtensionTarget(targets).url).toBe('A');
    });
  });

  describe('getExtensionTargets', () => {
    it('fetches targets and sorts them', async () => {
      mockSession.send.mockResolvedValue({
        targetInfos: [
          { targetId: '1', type: 'page', url: 'http://example.com' }, // filtered
          {
            targetId: '2',
            type: 'background_page',
            url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/bg',
          },
          {
            targetId: '3',
            type: 'service_worker',
            url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/sw',
          },
          { targetId: '4', type: 'service_worker', url: 'invalid' }, // filtered by ID
        ],
      });

      const targets = await (handlers as any).getExtensionTargets(mockSession);
      expect(targets).toHaveLength(2);
      expect(targets[0].type).toBe('service_worker'); // SW sorted first
      expect(targets[0].extensionId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(targets[1].type).toBe('background_page');
    });

    it('filters by expectedExtensionId', async () => {
      mockSession.send.mockResolvedValue({
        targetInfos: [
          {
            targetId: '2',
            type: 'background_page',
            url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/bg',
          },
          {
            targetId: '3',
            type: 'service_worker',
            url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/sw',
          },
        ],
      });

      const targets = await (handlers as any).getExtensionTargets(
        mockSession,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(targets).toHaveLength(1);
      expect(targets[0].extensionId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    it('handles unexpected formats', async () => {
      mockSession.send.mockResolvedValue({ targetInfos: 'not array' });
      const targets = await (handlers as any).getExtensionTargets(mockSession);
      expect(targets).toHaveLength(0);

      mockSession.send.mockResolvedValue({ targetInfos: [{ targetId: null }] });
      const targets2 = await (handlers as any).getExtensionTargets(mockSession);
      expect(targets2).toHaveLength(0);
    });
  });

  describe('evaluateInAttachedTarget', () => {
    it('evaluates and captures response', async () => {
      mockSession.send.mockResolvedValue({
        result: { value: 42 },
      });

      const res = await (handlers as any).evaluateInAttachedTarget(mockSession, '1+1', true);
      expect(res.result).toBe(42);
      expect(res.exceptionDetails).toBeNull();
    });

    it('returns remote object when returnByValue is false', async () => {
      mockSession.send.mockResolvedValue({
        result: { type: 'function', objectId: 'remote-1', description: 'f()' },
      });

      const res = await (handlers as any).evaluateInAttachedTarget(mockSession, 'f', false);
      expect(res.result).toEqual({
        type: 'function',
        objectId: 'remote-1',
        description: 'f()',
      });
    });

    it('rejects on runtime evaluate transport error', async () => {
      mockSession.send.mockRejectedValue(new Error('Session closed'));
      await expect(
        (handlers as any).evaluateInAttachedTarget(mockSession, '', true),
      ).rejects.toThrow('Session closed');
    });
  });

  describe('handleExtensionListInstalled', () => {
    it('returns targets in text payload', async () => {
      mockSession.send.mockResolvedValue({
        targetInfos: [
          {
            targetId: '1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw',
          },
        ],
      });
      const res = await handlers.handleExtensionListInstalled(dummyArgs);
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].extensionId).toBe('abcdefghijklmnopabcdefghijklmnop');
    });

    it('throws when getActivePage fails', async () => {
      mockcollector.getActivePage.mockRejectedValue(new Error('fail'));
      await expect(handlers.handleExtensionListInstalled(dummyArgs)).rejects.toThrow('fail');
    });
  });

  describe('handleExtensionExecuteInContext', () => {
    it('executes in context', async () => {
      mockSession.send.mockImplementation(async (method: string) => {
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [
              {
                targetId: '1',
                type: 'service_worker',
                url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw',
              },
            ],
          };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'ses2' };
        return {};
      });
      mockAttachedSession.send.mockResolvedValue({
        result: { value: 'works' },
      });

      const res = await handlers.handleExtensionExecuteInContext(dummyArgs);
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.result).toBe('works');
      expect(mockAttachedSession.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'console.log("test")',
        returnByValue: true,
        awaitPromise: true,
      });
      expect(mockAttachedSession.detach).toHaveBeenCalledOnce();
    });

    it('throws if no target found', async () => {
      // Mock session send to return empty targets array
      mockSession.send.mockResolvedValue({ targetInfos: [] });
      const res = await handlers.handleExtensionExecuteInContext(dummyArgs);
      const message = (res.content[0] as any).text;
      expect(message).toContain('No background target found');
    });

    it('throws when getActivePage fails', async () => {
      mockcollector.getActivePage.mockRejectedValue(new Error('fail2'));
      await expect(handlers.handleExtensionExecuteInContext(dummyArgs)).rejects.toThrow('fail2');
    });
  });
});
