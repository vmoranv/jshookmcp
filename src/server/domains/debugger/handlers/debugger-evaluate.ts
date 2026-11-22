import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { argString } from '@server/domains/shared/parse-args';

interface DebuggerEvaluateHandlersDeps {
  runtimeInspector: RuntimeInspector;
}

export class DebuggerEvaluateHandlers {
  private deps: DebuggerEvaluateHandlersDeps;
  constructor(deps: DebuggerEvaluateHandlersDeps) {
    this.deps = deps;
  }

  async handleDebuggerEvaluate(args: Record<string, unknown>) {
    const expression = argString(args, 'expression', '');
    const callFrameId = argString(args, 'callFrameId');

    const result = await this.deps.runtimeInspector.evaluate(expression, callFrameId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              expression,
              result,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleDebuggerEvaluateGlobal(args: Record<string, unknown>) {
    const expression = argString(args, 'expression', '');

    const result = await this.deps.runtimeInspector.evaluateGlobal(expression);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              expression,
              result,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
