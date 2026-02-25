import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { RuntimeInspector } from '../../../../modules/debugger/RuntimeInspector.js';

interface DebuggerControlHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

export class DebuggerControlHandlers {
  constructor(private deps: DebuggerControlHandlersDeps) {}

  async handleDebuggerEnable(_args: Record<string, unknown>) {
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
            2
          ),
        },
      ],
    };
  }

  async handleDebuggerDisable(_args: Record<string, unknown>) {
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
            2
          ),
        },
      ],
    };
  }

  async handleDebuggerPause(_args: Record<string, unknown>) {
    await this.deps.debuggerManager.pause();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Execution paused',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleDebuggerResume(_args: Record<string, unknown>) {
    await this.deps.debuggerManager.resume();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Execution resumed',
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
