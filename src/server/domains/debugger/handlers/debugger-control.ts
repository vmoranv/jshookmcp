import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS } from '@src/constants/analysis';
import { argNumber, argNumberRequired, argString } from '@server/domains/shared/parse-args';

interface DebuggerControlHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

type PausedState = Awaited<ReturnType<DebuggerManager['waitForPaused']>>;
type BreakpointInfo = Awaited<ReturnType<DebuggerManager['setBreakpoint']>>;

export class DebuggerControlHandlers {
  private deps: DebuggerControlHandlersDeps;
  constructor(deps: DebuggerControlHandlersDeps) {
    this.deps = deps;
  }

  async handleDebuggerLifecycle(args: Record<string, unknown>) {
    const action = argString(args, 'action');

    if (action !== 'enable' && action !== 'disable') {
      throw new Error(
        `Invalid debugger lifecycle action: ${String(args.action ?? '')}. Expected one of: enable, disable`,
      );
    }

    if (action === 'enable') {
      await this.deps.debuggerManager.init();
      await this.deps.runtimeInspector.init();
      await this.deps.debuggerManager.initAdvancedFeatures(this.deps.runtimeInspector);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Debugger enabled',
                enabled: this.deps.debuggerManager.isEnabled(),
              },
              null,
              2,
            ),
          },
        ],
      };
    } else {
      await this.deps.debuggerManager.disable();
      await this.deps.runtimeInspector.disable();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Debugger disabled',
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleDebuggerPause(_args: Record<string, unknown>) {
    await this.deps.debuggerManager.pause();
    try {
      const pausedState = await this.deps.debuggerManager.waitForPaused(500);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                paused: true,
                message: 'Execution paused',
                reason: pausedState.reason,
                location: pausedState.callFrames[0]?.location,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                paused: false,
                message: 'Pause requested; no paused event observed yet',
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleDebuggerResume(_args: Record<string, unknown>) {
    const wasPaused = this.deps.debuggerManager.getPausedState() !== null;
    await this.deps.debuggerManager.resume();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              resumed: wasPaused,
              message: wasPaused
                ? 'Execution resumed'
                : 'Resume requested; debugger was not paused',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleDebuggerRunToLocation(args: Record<string, unknown>) {
    const url = argString(args, 'url');
    const scriptId = argString(args, 'scriptId');
    const lineNumber = argNumberRequired(args, 'lineNumber');
    const columnNumber = argNumber(args, 'columnNumber');
    const condition = argString(args, 'condition');
    const timeout = argNumber(args, 'timeout', DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS);

    if (!url && !scriptId) {
      throw new Error('Either url or scriptId must be provided');
    }

    const temporaryBreakpoint = url
      ? await this.deps.debuggerManager.setBreakpointByUrl({
          url,
          lineNumber,
          columnNumber,
          condition,
        })
      : await this.deps.debuggerManager.setBreakpoint({
          scriptId: scriptId!,
          lineNumber,
          columnNumber,
          condition,
        });

    const previousPausedAt = this.deps.debuggerManager.getPausedState()?.timestamp;
    let pausedState: PausedState | undefined;
    let runError: unknown;

    try {
      await this.deps.debuggerManager.resume();
      pausedState = await this.waitForNewPausedState(timeout, previousPausedAt);
    } catch (error) {
      runError = error;
    }

    const cleanup = await this.removeTemporaryBreakpoint(temporaryBreakpoint.breakpointId);
    if (runError) {
      return this.runToLocationFailure(runError, temporaryBreakpoint, cleanup);
    }

    if (!cleanup.removed) {
      throw new Error(cleanup.error ?? 'Failed to remove temporary breakpoint');
    }

    const topFrame = pausedState?.callFrames[0];
    const topLocation = topFrame?.location;
    const hitBreakpoints = pausedState?.hitBreakpoints ?? [];
    const hitTarget =
      hitBreakpoints.includes(temporaryBreakpoint.breakpointId) ||
      this.frameMatchesLocation(topFrame, temporaryBreakpoint.location);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: hitTarget,
              paused: true,
              hitTarget,
              message: hitTarget
                ? 'Execution paused at target location'
                : 'Execution paused before target location',
              reason: pausedState?.reason,
              url: topFrame?.url,
              location: topLocation,
              hitBreakpoints,
              temporaryBreakpoint: {
                breakpointId: temporaryBreakpoint.breakpointId,
                location: temporaryBreakpoint.location,
              },
              removedTemporaryBreakpoint: cleanup.removed,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async waitForNewPausedState(
    timeout: number,
    previousTimestamp: number | undefined,
  ): Promise<PausedState> {
    const deadline = Date.now() + timeout;

    while (true) {
      const remaining = Math.max(1, deadline - Date.now());
      const pausedState = await this.deps.debuggerManager.waitForPaused(remaining);
      if (previousTimestamp === undefined || pausedState.timestamp !== previousTimestamp) {
        return pausedState;
      }

      if (Date.now() >= deadline) {
        throw new Error('Timeout waiting for paused event');
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))),
      );
    }
  }

  private async removeTemporaryBreakpoint(
    breakpointId: string,
  ): Promise<{ removed: boolean; error?: string }> {
    try {
      await this.deps.debuggerManager.removeBreakpoint(breakpointId);
      return { removed: true };
    } catch (error) {
      return {
        removed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private runToLocationFailure(
    error: unknown,
    temporaryBreakpoint: BreakpointInfo,
    cleanup: { removed: boolean; error?: string },
  ) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              paused: false,
              message: error instanceof Error ? error.message : String(error),
              temporaryBreakpoint: {
                breakpointId: temporaryBreakpoint.breakpointId,
                location: temporaryBreakpoint.location,
              },
              removedTemporaryBreakpoint: cleanup.removed,
              cleanupError: cleanup.error,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private frameMatchesLocation(
    actual: PausedState['callFrames'][number] | undefined,
    target: BreakpointInfo['location'],
  ): boolean {
    if (!actual) {
      return false;
    }

    if (target.scriptId && actual.location.scriptId !== target.scriptId) {
      return false;
    }

    if (target.url && actual.url !== target.url) {
      return false;
    }

    return (
      actual.location.lineNumber === target.lineNumber &&
      (target.columnNumber === undefined || actual.location.columnNumber === target.columnNumber)
    );
  }
}
