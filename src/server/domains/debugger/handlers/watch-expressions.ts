import type { DebuggerManager } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';

interface WatchExpressionsHandlersDeps {
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

export class WatchExpressionsHandlers {
  constructor(private deps: WatchExpressionsHandlersDeps) {}

  async handleWatchAdd(args: Record<string, unknown>) {
    try {
      const expression = argString(args, 'expression', '');
      const name = argString(args, 'name');

      const watchManager = this.deps.debuggerManager.getWatchManager();
      const watchId = watchManager.addWatch(expression, name);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Watch expression added',
                watchId,
                expression,
                name: name || expression,
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
                message: 'Failed to add watch expression',
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

  async handleWatchRemove(args: Record<string, unknown>) {
    try {
      const watchId = argString(args, 'watchId', '');
      const watchManager = this.deps.debuggerManager.getWatchManager();
      const removed = watchManager.removeWatch(watchId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: removed,
                message: removed ? 'Watch expression removed' : 'Watch expression not found',
                watchId,
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
                message: 'Failed to remove watch expression',
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

  async handleWatchList(_args: Record<string, unknown>) {
    try {
      const watchManager = this.deps.debuggerManager.getWatchManager();
      const watches = watchManager.getAllWatches();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Found ${watches.length} watch expression(s)`,
                watches,
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
                message: 'Failed to list watch expressions',
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

  async handleWatchEvaluateAll(args: Record<string, unknown>) {
    try {
      const callFrameId = argString(args, 'callFrameId');
      const watchManager = this.deps.debuggerManager.getWatchManager();
      const results = await watchManager.evaluateAll(callFrameId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Evaluated ${results.length} watch expression(s)`,
                results,
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
                message: 'Failed to evaluate watch expressions',
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

  async handleWatchClearAll(_args: Record<string, unknown>) {
    try {
      const watchManager = this.deps.debuggerManager.getWatchManager();
      watchManager.clearAll();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'All watch expressions cleared',
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
                message: 'Failed to clear watch expressions',
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
