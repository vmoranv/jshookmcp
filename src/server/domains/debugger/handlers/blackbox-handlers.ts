import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { BlackboxManager } from '@modules/debugger/BlackboxManager';
import { argString } from '@server/domains/shared/parse-args';

interface BlackboxHandlersDeps {
  debuggerManager: DebuggerManager;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export class BlackboxHandlers {
  private deps: BlackboxHandlersDeps;
  constructor(deps: BlackboxHandlersDeps) {
    this.deps = deps;
  }

  private async getBlackboxManager(): Promise<BlackboxManager> {
    await (this.deps.debuggerManager as any).ensureAdvancedFeatures?.();
    return this.deps.debuggerManager.getBlackboxManager();
  }

  async handleBlackboxAdd(args: Record<string, unknown>) {
    try {
      const urlPattern = argString(args, 'urlPattern', '');
      const blackboxManager = await this.getBlackboxManager();
      await blackboxManager.blackboxByPattern(urlPattern);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Script pattern blackboxed',
                urlPattern,
              },
              null,
              2,
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
                message: 'Failed to add blackbox pattern',
                error: getErrorMessage(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleBlackboxAddCommon(_args: Record<string, unknown>) {
    try {
      const blackboxManager = await this.getBlackboxManager();
      await blackboxManager.blackboxCommonLibraries();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Blackboxed common library patterns',
              },
              null,
              2,
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
                message: 'Failed to add common blackbox patterns',
                error: getErrorMessage(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleBlackboxList(_args: Record<string, unknown>) {
    try {
      const blackboxManager = await this.getBlackboxManager();
      const patterns = blackboxManager.getAllBlackboxedPatterns();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Found ${patterns.length} blackboxed pattern(s)`,
                patterns,
              },
              null,
              2,
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
                message: 'Failed to list blackbox patterns',
                error: getErrorMessage(error),
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
