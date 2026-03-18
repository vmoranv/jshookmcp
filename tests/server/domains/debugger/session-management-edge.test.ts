import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManagementHandlers } from '@server/domains/debugger/handlers/session-management';

function parseJson(response: { content: Array<{ text: string }> }) {
  const firstContent = response.content[0];
  if (!firstContent) {
    throw new Error('Expected response content to include a text entry');
  }
  return JSON.parse(firstContent.text);
}

describe('SessionManagementHandlers – edge cases', () => {
  const debuggerManager = {
    saveSession: vi.fn(),
    listBreakpoints: vi.fn(),
    loadSessionFromFile: vi.fn(),
    importSession: vi.fn(),
    getPauseOnExceptionsState: vi.fn(),
    exportSession: vi.fn(),
    listSavedSessions: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    debuggerManager.listBreakpoints.mockReturnValue([]);
    debuggerManager.getPauseOnExceptionsState.mockReturnValue('none');
  });

  // ── handleSaveSession ───────────────────────────────────────

  describe('handleSaveSession', () => {
    it('saves without explicit filePath or metadata', async () => {
      debuggerManager.saveSession.mockResolvedValueOnce('/auto-generated/path.json');
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleSaveSession({}));

      expect(debuggerManager.saveSession).toHaveBeenCalledWith(undefined, undefined);
      expect(body.success).toBe(true);
      expect(body.filePath).toBe('/auto-generated/path.json');
      expect(body.breakpointCount).toBe(0);
    });

    it('reports correct breakpoint count when breakpoints exist', async () => {
      debuggerManager.saveSession.mockResolvedValueOnce('/tmp/s.json');
      debuggerManager.listBreakpoints.mockReturnValueOnce([
        { breakpointId: 'bp-1' },
        { breakpointId: 'bp-2' },
        { breakpointId: 'bp-3' },
      ]);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleSaveSession({}));

      expect(body.breakpointCount).toBe(3);
    });

    it('handles non-Error rejection in save', async () => {
      debuggerManager.saveSession.mockRejectedValueOnce('unknown failure');
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleSaveSession({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('unknown failure');
    });

    it('handles error object without message property', async () => {
      debuggerManager.saveSession.mockRejectedValueOnce({ code: 'ENOENT' });
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleSaveSession({}));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to save session');
    });

    it('handles error with empty string message', async () => {
      const err = new Error('');
      debuggerManager.saveSession.mockRejectedValueOnce(err);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleSaveSession({}));

      expect(body.success).toBe(false);
      // Empty message falls through to String(error)
      expect(typeof body.error).toBe('string');
    });
  });

  // ── handleLoadSession ───────────────────────────────────────

  describe('handleLoadSession', () => {
    it('prefers filePath over sessionData when both are provided', async () => {
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(
        await handlers.handleLoadSession({
          filePath: '/tmp/session.json',
          sessionData: '{"breakpoints":[]}',
        })
      );

      expect(debuggerManager.loadSessionFromFile).toHaveBeenCalledWith('/tmp/session.json');
      expect(debuggerManager.importSession).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
    });

    it('reports pauseOnExceptions state after loading', async () => {
      debuggerManager.getPauseOnExceptionsState.mockReturnValueOnce('uncaught');
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleLoadSession({ filePath: '/tmp/s.json' }));

      expect(body.pauseOnExceptions).toBe('uncaught');
    });

    it('returns structured error when loadSessionFromFile throws', async () => {
      debuggerManager.loadSessionFromFile.mockRejectedValueOnce(new Error('file not found'));
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleLoadSession({ filePath: '/nonexistent.json' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('file not found');
      expect(body.message).toBe('Failed to load session');
    });

    it('returns structured error when importSession throws', async () => {
      debuggerManager.importSession.mockRejectedValueOnce(new Error('invalid JSON'));
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleLoadSession({ sessionData: '{invalid}' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('invalid JSON');
    });

    it('handles non-Error rejection in load', async () => {
      debuggerManager.loadSessionFromFile.mockRejectedValueOnce(404);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleLoadSession({ filePath: '/tmp/missing.json' }));

      expect(body.success).toBe(false);
    });
  });

  // ── handleExportSession ─────────────────────────────────────

  describe('handleExportSession', () => {
    it('exports session without metadata', async () => {
      debuggerManager.exportSession.mockReturnValueOnce({
        breakpoints: [{ id: 'bp-1' }],
      });
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleExportSession({}));

      expect(debuggerManager.exportSession).toHaveBeenCalledWith(undefined);
      expect(body.success).toBe(true);
      expect(body.session).toEqual({ breakpoints: [{ id: 'bp-1' }] });
    });

    it('returns structured error when exportSession throws', async () => {
      debuggerManager.exportSession.mockImplementationOnce(() => {
        throw new Error('serialization error');
      });
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleExportSession({}));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to export session');
      expect(body.error).toBe('serialization error');
    });

    it('handles non-Error thrown in export', async () => {
      debuggerManager.exportSession.mockImplementationOnce(() => {
        throw 'crash';
      });
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleExportSession({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('crash');
    });
  });

  // ── handleListSessions ──────────────────────────────────────

  describe('handleListSessions', () => {
    it('returns empty session list', async () => {
      debuggerManager.listSavedSessions.mockResolvedValueOnce([]);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleListSessions({}));

      expect(body.success).toBe(true);
      expect(body.count).toBe(0);
      expect(body.sessions).toEqual([]);
    });

    it('returns multiple sessions with correct date formatting', async () => {
      const ts1 = 1700000000000;
      const ts2 = 1710000000000;
      debuggerManager.listSavedSessions.mockResolvedValueOnce([
        { path: '/a.json', timestamp: ts1, metadata: {} },
        { path: '/b.json', timestamp: ts2, metadata: { label: 'B' } },
      ]);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleListSessions({}));

      expect(body.count).toBe(2);
      expect(body.sessions[0].date).toBe(new Date(ts1).toISOString());
      expect(body.sessions[1].date).toBe(new Date(ts2).toISOString());
      expect(body.sessions[1].metadata).toEqual({ label: 'B' });
    });

    it('returns structured error when listSavedSessions throws', async () => {
      debuggerManager.listSavedSessions.mockRejectedValueOnce(new Error('fs permission denied'));
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleListSessions({}));

      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to list sessions');
      expect(body.error).toBe('fs permission denied');
    });

    it('handles non-Error rejection in list', async () => {
      debuggerManager.listSavedSessions.mockRejectedValueOnce(null);
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const body = parseJson(await handlers.handleListSessions({}));

      expect(body.success).toBe(false);
    });
  });

  // ── Response structure ──────────────────────────────────────

  describe('response structure', () => {
    it('every handler returns content array with text type', async () => {
      debuggerManager.saveSession.mockResolvedValueOnce('/tmp/s.json');
      const handlers = new SessionManagementHandlers({ debuggerManager } as any);

      const result = await handlers.handleSaveSession({});
      const firstContent = result.content[0];

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(firstContent).toBeDefined();
      expect(firstContent?.type).toBe('text');
      expect(typeof firstContent?.text).toBe('string');
      // Verify the text is valid JSON
      expect(() => JSON.parse(firstContent?.text ?? '')).not.toThrow();
    });
  });
});
