// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManagementHandlers } from '@server/domains/debugger/handlers/session-management';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('SessionManagementHandlers', () => {
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
    debuggerManager.listBreakpoints.mockReturnValue([{ breakpointId: 'bp-1' }]);
    debuggerManager.getPauseOnExceptionsState.mockReturnValue('all');
  });

  it('saves a session and reports the current breakpoint count', async () => {
    debuggerManager.saveSession.mockResolvedValueOnce('/tmp/session.json');
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleSaveSession({
        filePath: '/tmp/session.json',
        metadata: { label: 'debug' },
      })
    );

    expect(debuggerManager.saveSession).toHaveBeenCalledWith('/tmp/session.json', {
      label: 'debug',
    });
    expect(body).toEqual({
      success: true,
      message: 'Session saved successfully',
      filePath: '/tmp/session.json',
      breakpointCount: 1,
    });
  });

  it('returns a structured error when saving a session fails', async () => {
    debuggerManager.saveSession.mockRejectedValueOnce(new Error('disk full'));
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleSaveSession({}));

    expect(body).toEqual({
      success: false,
      message: 'Failed to save session',
      error: 'disk full',
    });
  });

  it('loads a session from file when filePath is provided', async () => {
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleLoadSession({ filePath: '/tmp/session.json' })
    );

    expect(debuggerManager.loadSessionFromFile).toHaveBeenCalledWith(
      '/tmp/session.json'
    );
    expect(debuggerManager.importSession).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      message: 'Session loaded successfully',
      breakpointCount: 1,
      pauseOnExceptions: 'all',
    });
  });

  it('loads a session from raw session data', async () => {
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleLoadSession({ sessionData: '{"breakpoints":[]}' })
    );

    expect(debuggerManager.importSession).toHaveBeenCalledWith(
      '{"breakpoints":[]}'
    );
    expect(body.success).toBe(true);
  });

  it('returns a structured error when load arguments are missing', async () => {
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleLoadSession({}));

    expect(body).toEqual({
      success: false,
      message: 'Failed to load session',
      error: 'Either filePath or sessionData must be provided',
    });
  });

  it('exports the current session snapshot', async () => {
    debuggerManager.exportSession.mockReturnValueOnce({
      metadata: { label: 'snapshot' },
      breakpoints: [],
    });
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleExportSession({ metadata: { label: 'snapshot' } })
    );

    expect(debuggerManager.exportSession).toHaveBeenCalledWith({
      label: 'snapshot',
    });
    expect(body).toEqual({
      success: true,
      message: 'Session exported successfully',
      session: {
        metadata: { label: 'snapshot' },
        breakpoints: [],
      },
    });
  });

  it('lists saved sessions with ISO dates', async () => {
    debuggerManager.listSavedSessions.mockResolvedValueOnce([
      {
        path: '/tmp/session.json',
        timestamp: 1700000000000,
        metadata: { label: 'snapshot' },
      },
    ]);
    const handlers = new SessionManagementHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleListSessions({}));

    expect(body).toEqual({
      success: true,
      count: 1,
      sessions: [
        {
          path: '/tmp/session.json',
          timestamp: 1700000000000,
          date: new Date(1700000000000).toISOString(),
          metadata: { label: 'snapshot' },
        },
      ],
    });
  });
});
