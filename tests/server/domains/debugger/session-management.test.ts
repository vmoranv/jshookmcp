import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManagementHandlers } from '@server/domains/debugger/handlers/session-management';
import type { DebuggerManager } from '@server/domains/shared/modules';

type SessionManagementDebuggerManager = Pick<
  DebuggerManager,
  | 'saveSession'
  | 'listBreakpoints'
  | 'loadSessionFromFile'
  | 'importSession'
  | 'getPauseOnExceptionsState'
  | 'exportSession'
  | 'listSavedSessions'
>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return JSON.parse(firstContent!.text) as any;
}

describe('SessionManagementHandlers', () => {
  const debuggerManager = {
    saveSession: vi.fn<SessionManagementDebuggerManager['saveSession']>(),
    listBreakpoints: vi.fn<SessionManagementDebuggerManager['listBreakpoints']>(),
    loadSessionFromFile: vi.fn<SessionManagementDebuggerManager['loadSessionFromFile']>(),
    importSession: vi.fn<SessionManagementDebuggerManager['importSession']>(),
    getPauseOnExceptionsState:
      vi.fn<SessionManagementDebuggerManager['getPauseOnExceptionsState']>(),
    exportSession: vi.fn<SessionManagementDebuggerManager['exportSession']>(),
    listSavedSessions: vi.fn<SessionManagementDebuggerManager['listSavedSessions']>(),
  } satisfies SessionManagementDebuggerManager;

  function createHandlers() {
    return new SessionManagementHandlers({
      debuggerManager: debuggerManager as unknown as DebuggerManager,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    debuggerManager.listBreakpoints.mockReturnValue([{ breakpointId: 'bp-1' }] as ReturnType<
      SessionManagementDebuggerManager['listBreakpoints']
    >);
    debuggerManager.getPauseOnExceptionsState.mockReturnValue(
      'all' as ReturnType<SessionManagementDebuggerManager['getPauseOnExceptionsState']>
    );
  });

  it('saves a session and reports the current breakpoint count', async () => {
    debuggerManager.saveSession.mockResolvedValueOnce('/tmp/session.json');
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
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
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleSaveSession({}));

    expect(body).toEqual({
      success: false,
      message: 'Failed to save session',
      error: 'disk full',
    });
  });

  it('loads a session from file when filePath is provided', async () => {
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleLoadSession({ filePath: '/tmp/session.json' }));

    expect(debuggerManager.loadSessionFromFile).toHaveBeenCalledWith('/tmp/session.json');
    expect(debuggerManager.importSession).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      message: 'Session loaded successfully',
      breakpointCount: 1,
      pauseOnExceptions: 'all',
    });
  });

  it('loads a session from raw session data', async () => {
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleLoadSession({ sessionData: '{"breakpoints":[]}' }));

    expect(debuggerManager.importSession).toHaveBeenCalledWith('{"breakpoints":[]}');
    expect(body).toMatchObject({ success: true });
  });

  it('returns a structured error when load arguments are missing', async () => {
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleLoadSession({}));

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
    } as unknown as ReturnType<SessionManagementDebuggerManager['exportSession']>);
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleExportSession({ metadata: { label: 'snapshot' } }));

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
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleListSessions({}));

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
