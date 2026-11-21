import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import { argString } from '@server/domains/shared/parse-args';

interface BreakpointExceptionHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class BreakpointExceptionHandlers {
  private deps: BreakpointExceptionHandlersDeps;
  constructor(deps: BreakpointExceptionHandlersDeps) {
    this.deps = deps;
  }

  async handleBreakpointSetOnException(args: Record<string, unknown>) {
    const state = argString(args, 'state', 'none') as 'none' | 'uncaught' | 'all';

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
            2,
          ),
        },
      ],
    };
  }
}
