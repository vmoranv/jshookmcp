import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { ToolError } from '@errors/ToolError';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';

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
  private deps: ScopeInspectionHandlersDeps;
  constructor(deps: ScopeInspectionHandlersDeps) {
    this.deps = deps;
  }

  async handleGetScopeVariablesEnhanced(args: Record<string, unknown>) {
    const callFrameId = argString(args, 'callFrameId');
    const includeObjectProperties = argBool(args, 'includeObjectProperties');
    const maxDepth = argNumber(args, 'maxDepth');
    const skipErrors = argBool(args, 'skipErrors', true);

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
      // Let classified ToolErrors (including PrerequisiteError) propagate
      // to MCPServer's unified error handler (same convention as debugger-state)
      if (error instanceof ToolError) {
        throw error;
      }
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
              2,
            ),
          },
        ],
      };
    }
  }

  async handleGetObjectProperties(args: Record<string, unknown>) {
    const objectId = argString(args, 'objectId', '');
    if (!objectId) {
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
              2,
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
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof ToolError) {
        throw error;
      }
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
              2,
            ),
          },
        ],
      };
    }
  }
}
