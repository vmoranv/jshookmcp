import type { DebuggerManager } from '@server/domains/shared/modules';
import type { RuntimeInspector } from '@server/domains/shared/modules';

interface DebuggerControlHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

export class DebuggerControlHandlers {
  constructor(private deps: DebuggerControlHandlersDeps) {}

  async handleDebuggerLifecycle(args: Record<string, unknown>) {
    const action = args.action as 'enable' | 'disable';

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
}
