import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';

interface BreakpointExceptionHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class BreakpointExceptionHandlers {
  constructor(private deps: BreakpointExceptionHandlersDeps) {}

  async handleBreakpointSetOnException(args: Record<string, unknown>) {
    const state = (args.state as 'none' | 'uncaught' | 'all') || 'none';

    await this.deps.debuggerManager.setPauseOnExceptions(state);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Pause on exceptions set to: ${state}`,
              state,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
