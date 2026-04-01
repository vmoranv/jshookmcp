import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());

vi.stubGlobal('fetch', mockFetch);
vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

class MockWebSocket {
  private listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  private lastExpression = '';

  constructor(_url: string) {
    queueMicrotask(() => {
      this.emit('open');
    });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(payload: string) {
    try {
      const parsed = JSON.parse(payload) as { params?: { expression?: string } };
      this.lastExpression = parsed.params?.expression ?? '';
    } catch {
      this.lastExpression = '';
    }

    queueMicrotask(() => {
      let value: unknown = 'hooks_installed';
      if (this.lastExpression.includes('JSON.stringify(captured)')) {
        value = JSON.stringify([
          { timestamp: 1, method: 'invoke', channel: 'auth.login', args: ['user', 'pw'] },
          { timestamp: 2, method: 'send', channel: 'metrics.track', args: ['open'] },
        ]);
      } else if (this.lastExpression.includes('__ipcSnifferCaptured.length = 0')) {
        value = '2';
      }

      this.emit('message', {
        data: JSON.stringify({
          id: 1,
          result: { result: { value } },
        }),
      });
    });
  }

  close() {
    return undefined;
  }

  private emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

async function loadModule() {
  vi.resetModules();
  return await import('@server/domains/platform/handlers/electron-ipc-sniffer');
}

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

describe('electron_ipc_sniff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/json/version')) {
        return {
          json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' }),
        } as unknown;
      }

      if (url.endsWith('/json')) {
        return {
          json: async () => [
            {
              id: 'page1',
              type: 'page',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
            },
          ],
        } as unknown;
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('action = guide', () => {
    it('should return guide when no action specified', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(await handleElectronIPCSniff({}));
      expect(result.success).toBe(true);
      expect(result.guide).toBeDefined();
      const guide = result.guide as Record<string, unknown>;
      expect(guide.what).toContain('IPC');
      expect(guide.actions).toContain('start');
      expect(guide.actions).toContain('dump');
      expect(guide.actions).toContain('stop');
    });

    it('should return guide when action is explicitly guide', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(await handleElectronIPCSniff({ action: 'guide' }));
      expect(result.success).toBe(true);
      expect(result.guide).toBeDefined();
      const guide = result.guide as Record<string, unknown>;
      expect(guide.workflow).toBeDefined();
      expect(guide.limitations).toBeDefined();
    });
  });

  describe('action = start', () => {
    it('should error when CDP port is unreachable', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = parse(
        await handleElectronIPCSniff({
          action: 'start',
          port: 9333,
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot connect to CDP');
      expect(result.error).toContain('9333');
      expect(result.hint).toContain('electron_launch_debug');
    });

    it('should use default port 9222', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = parse(
        await handleElectronIPCSniff({
          action: 'start',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('9222');
    });

    it('should start, dump, list and stop a session', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const start = parse(await handleElectronIPCSniff({ action: 'start' }));
      expect(start.success).toBe(true);
      expect(start.sessionId).toMatch(/^ipc-sniff-9222-/);
      expect(start.hookStatus).toBe('hooks_installed');

      const dump = parse(await handleElectronIPCSniff({ action: 'dump', port: 9222 }));
      expect(dump.success).toBe(true);
      expect(dump.messageCount).toBe(2);
      expect(dump.channelSummary).toEqual({ 'auth.login': 1, 'metrics.track': 1 });

      const list = parse(await handleElectronIPCSniff({ action: 'list' }));
      expect(list.success).toBe(true);
      expect(list.count).toBe(1);

      const stop = parse(
        await handleElectronIPCSniff({
          action: 'stop',
          sessionId: String(start.sessionId),
        }),
      );
      expect(stop.success).toBe(true);
      expect(stop.message).toContain('stopped');

      const empty = parse(await handleElectronIPCSniff({ action: 'list' }));
      expect(empty.count).toBe(0);
    });
  });

  describe('action = dump', () => {
    it('should error when no session exists', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'dump',
          sessionId: 'nonexistent-session',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active IPC sniff session');
      expect(result.hint).toContain('Start a session first');
    });

    it('should error when no sessions exist at all', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'dump',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active IPC sniff session');
    });
  });

  describe('action = stop', () => {
    it('should require sessionId', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'stop',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId is required');
    });

    it('should error for non-existent session', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'stop',
          sessionId: 'ipc-sniff-nonexistent',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });
  });

  describe('action = list', () => {
    it('should return empty list when no sessions active', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'list',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('list');
      expect(result.count).toBe(0);
      expect(Array.isArray(result.sessions)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle unknown action as guide', async () => {
      const { handleElectronIPCSniff } = await loadModule();
      const result = parse(
        await handleElectronIPCSniff({
          action: 'nonexistent_action',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.guide).toBeDefined();
    });
  });
});
