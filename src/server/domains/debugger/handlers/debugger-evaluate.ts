import type { RuntimeInspector } from '../../../../modules/debugger/RuntimeInspector.js';

interface DebuggerEvaluateHandlersDeps {
  runtimeInspector: RuntimeInspector;
}

export class DebuggerEvaluateHandlers {
  constructor(private deps: DebuggerEvaluateHandlersDeps) {}

  async handleDebuggerEvaluate(args: Record<string, unknown>) {
    const expression = args.expression as string;
    const callFrameId = args.callFrameId as string | undefined;

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
            2
          ),
        },
      ],
    };
  }

  async handleDebuggerEvaluateGlobal(args: Record<string, unknown>) {
    const expression = args.expression as string;

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
            2
          ),
        },
      ],
    };
  }
}
