import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { BlackboxManager } from '../../../../modules/debugger/BlackboxManager.js';

interface BlackboxHandlersDeps {
  debuggerManager: DebuggerManager;
}

interface AdvancedFeatureCapable {
  ensureAdvancedFeatures: () => Promise<void>;
}

function hasEnsureAdvancedFeatures(
  manager: DebuggerManager
): manager is DebuggerManager & AdvancedFeatureCapable {
  return typeof (manager as { ensureAdvancedFeatures?: unknown }).ensureAdvancedFeatures === 'function';
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
  constructor(private deps: BlackboxHandlersDeps) {}

  private async ensureAdvancedFeaturesIfSupported(): Promise<void> {
    if (hasEnsureAdvancedFeatures(this.deps.debuggerManager)) {
      await this.deps.debuggerManager.ensureAdvancedFeatures();
    }
  }

  private async getBlackboxManager(): Promise<BlackboxManager> {
    await this.ensureAdvancedFeaturesIfSupported();
    return this.deps.debuggerManager.getBlackboxManager();
  }

  async handleBlackboxAdd(args: Record<string, unknown>) {
    try {
      const urlPattern = args.urlPattern as string;
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
                message: 'Failed to add blackbox pattern',
                error: getErrorMessage(error),
              },
              null,
              2
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
                message: 'Failed to add common blackbox patterns',
                error: getErrorMessage(error),
              },
              null,
              2
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
                message: 'Failed to list blackbox patterns',
                error: getErrorMessage(error),
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
