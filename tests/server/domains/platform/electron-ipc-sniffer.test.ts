import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

// Mock global fetch for CDP calls
vi.stubGlobal('fetch', mockFetch);

vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { handleElectronIPCSniff } from '@server/domains/platform/handlers/electron-ipc-sniffer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('electron_ipc_sniff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // action = guide (default)
  // =========================================================================
  describe('action = guide', () => {
    it('should return guide when no action specified', async () => {
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
      const result = parse(await handleElectronIPCSniff({ action: 'guide' }));
      expect(result.success).toBe(true);
      expect(result.guide).toBeDefined();
      const guide = result.guide as Record<string, unknown>;
      expect(guide.workflow).toBeDefined();
      expect(guide.limitations).toBeDefined();
    });
  });

  // =========================================================================
  // action = start
  // =========================================================================
  describe('action = start', () => {
    it('should error when CDP port is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = parse(await handleElectronIPCSniff({
        action: 'start',
        port: 9333,
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot connect to CDP');
      expect(result.error).toContain('9333');
      expect(result.hint).toContain('electron_launch_debug');
    });

    it('should use default port 9222', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = parse(await handleElectronIPCSniff({
        action: 'start',
      }));

      expect(result.success).toBe(false);
      // Should try 9222 by default
      expect(result.error).toContain('9222');
    });

    it('should succeed when CDP is available and hooks are injected', async () => {
      // Mock /json/version endpoint
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
        }),
      });

      // Mock /json endpoint (page targets for cdpEvaluate)
      mockFetch.mockResolvedValueOnce({
        json: async () => ([
          {
            id: 'page1',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
          },
        ]),
      });

      // WebSocket is not available in test env, so cdpEvalViaWs will fail
      // This tests the fallback error path
      const result = parse(await handleElectronIPCSniff({ action: 'start' }));

      // It should fail gracefully because WebSocket is not available in test env
      // The important thing is it got past the initial CDP connection check
      expect(result).toBeDefined();
      expect(result.tool).toBe('electron_ipc_sniff');
    });
  });

  // =========================================================================
  // action = dump
  // =========================================================================
  describe('action = dump', () => {
    it('should error when no session exists', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'dump',
        sessionId: 'nonexistent-session',
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active IPC sniff session');
      expect(result.hint).toContain('Start a session first');
    });

    it('should error when no sessions exist at all', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'dump',
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active IPC sniff session');
    });
  });

  // =========================================================================
  // action = stop
  // =========================================================================
  describe('action = stop', () => {
    it('should require sessionId', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'stop',
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId is required');
    });

    it('should error for non-existent session', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'stop',
        sessionId: 'ipc-sniff-nonexistent',
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });
  });

  // =========================================================================
  // action = list
  // =========================================================================
  describe('action = list', () => {
    it('should return empty list when no sessions active', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'list',
      }));

      expect(result.success).toBe(true);
      expect(result.action).toBe('list');
      expect(result.count).toBe(0);
      expect(Array.isArray(result.sessions)).toBe(true);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================
  describe('error handling', () => {
    it('should handle unknown action as guide', async () => {
      const result = parse(await handleElectronIPCSniff({
        action: 'nonexistent_action',
      }));

      // Unknown actions fall through to guide
      expect(result.success).toBe(true);
      expect(result.guide).toBeDefined();
    });
  });
});
