import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { RuntimeInspector } from '../../../../modules/debugger/RuntimeInspector.js';

interface ScopeInspectionHandlersDeps {
  debuggerManager: DebuggerManager;
  runtimeInspector: RuntimeInspector;
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return fallback;
};

export class ScopeInspectionHandlers {
  constructor(private deps: ScopeInspectionHandlersDeps) {}

  async handleGetScopeVariablesEnhanced(args: Record<string, unknown>) {
    const callFrameId = args.callFrameId as string | undefined;
    const includeObjectProperties = args.includeObjectProperties as boolean | undefined;
    const maxDepth = args.maxDepth as number | undefined;
    const skipErrors = args.skipErrors !== false;

    try {
      const result = await this.deps.debuggerManager.getScopeVariables({
        callFrameId,
        includeObjectProperties,
        maxDepth,
        skipErrors,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
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
                message: getErrorMessage(error, 'Failed to get scope variables'),
                error: String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleGetObjectProperties(args: Record<string, unknown>) {
    const objectId = args.objectId as string;
    if (!objectId || typeof objectId !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'objectId parameter is required',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      const properties = await this.deps.debuggerManager.getObjectPropertiesById(objectId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                propertyCount: properties.length,
                properties,
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
                message: getErrorMessage(error, 'Failed to get object properties'),
                error: String(error),
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
