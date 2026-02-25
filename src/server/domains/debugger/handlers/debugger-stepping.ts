import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import { logger } from '../../../../utils/logger.js';

interface DebuggerSteppingHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class DebuggerSteppingHandlers {
  constructor(private deps: DebuggerSteppingHandlersDeps) {}

  async handleDebuggerStepInto(_args: Record<string, unknown>) {
    const mgr = this.deps.debuggerManager;

    // Check if debugger is enabled and paused
    if (!mgr.isEnabled()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Debugger not enabled',
                hint: 'Call debugger_enable() first to enable the debugger',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (!mgr.isPaused()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Cannot step while not paused',
                hint: 'The debugger must be paused at a breakpoint to perform step operations. Set a breakpoint with breakpoint_set() or pause with debugger_pause().',
                currentState: 'running',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      await mgr.stepInto();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Stepped into',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Step into failed: ${errorMsg}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMsg,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleDebuggerStepOver(_args: Record<string, unknown>) {
    const mgr = this.deps.debuggerManager;

    // Check if debugger is enabled and paused
    if (!mgr.isEnabled()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Debugger not enabled',
                hint: 'Call debugger_enable() first to enable the debugger',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (!mgr.isPaused()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Cannot step while not paused',
                hint: 'The debugger must be paused at a breakpoint to perform step operations. Set a breakpoint with breakpoint_set() or pause with debugger_pause().',
                currentState: 'running',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      await mgr.stepOver();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Stepped over',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Step over failed: ${errorMsg}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMsg,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleDebuggerStepOut(_args: Record<string, unknown>) {
    const mgr = this.deps.debuggerManager;

    // Check if debugger is enabled and paused
    if (!mgr.isEnabled()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Debugger not enabled',
                hint: 'Call debugger_enable() first to enable the debugger',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (!mgr.isPaused()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Cannot step out while not paused',
                hint: 'The debugger must be paused at a breakpoint to perform step out. Set a breakpoint with breakpoint_set() or pause with debugger_pause().',
                currentState: 'running',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      await mgr.stepOut();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Stepped out',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Step out failed: ${errorMsg}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMsg,
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
