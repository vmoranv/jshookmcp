import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { DebuggerSession } from '../../../../types/index.js';

interface SessionManagementHandlersDeps {
  debuggerManager: DebuggerManager;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export class SessionManagementHandlers {
  constructor(private deps: SessionManagementHandlersDeps) {}

  async handleSaveSession(args: Record<string, unknown>) {
    const filePath = args.filePath as string | undefined;
    const metadata = args.metadata as DebuggerSession['metadata'] | undefined;

    try {
      const savedPath = await this.deps.debuggerManager.saveSession(filePath, metadata);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Session saved successfully',
                filePath: savedPath,
                breakpointCount: this.deps.debuggerManager.listBreakpoints().length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to save session',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleLoadSession(args: Record<string, unknown>) {
    const filePath = args.filePath as string | undefined;
    const sessionData = args.sessionData as string | undefined;

    try {
      if (filePath) {
        await this.deps.debuggerManager.loadSessionFromFile(filePath);
      } else if (sessionData) {
        await this.deps.debuggerManager.importSession(sessionData);
      } else {
        throw new Error('Either filePath or sessionData must be provided');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Session loaded successfully',
                breakpointCount: this.deps.debuggerManager.listBreakpoints().length,
                pauseOnExceptions: this.deps.debuggerManager.getPauseOnExceptionsState(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to load session',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleExportSession(args: Record<string, unknown>) {
    const metadata = args.metadata as DebuggerSession['metadata'] | undefined;

    try {
      const session = this.deps.debuggerManager.exportSession(metadata);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Session exported successfully',
                session,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to export session',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleListSessions(_args: Record<string, unknown>) {
    try {
      const sessions = await this.deps.debuggerManager.listSavedSessions();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                count: sessions.length,
                sessions: sessions.map((s) => ({
                  path: s.path,
                  timestamp: s.timestamp,
                  date: new Date(s.timestamp).toISOString(),
                  metadata: s.metadata,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to list sessions',
                error: getErrorMessage(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
