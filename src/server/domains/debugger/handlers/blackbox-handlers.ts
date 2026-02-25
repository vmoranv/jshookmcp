import type { DebuggerManager } from '../../../../modules/debugger/DebuggerManager.js';
import type { BlackboxManager } from '../../../../modules/debugger/BlackboxManager.js';

interface BlackboxHandlersDeps {
  debuggerManager: DebuggerManager;
}

export class BlackboxHandlers {
  constructor(private deps: BlackboxHandlersDeps) {}

  private async ensureAdvancedFeaturesIfSupported(): Promise<void> {
    const debuggerManager = this.deps.debuggerManager as DebuggerManager & {
      ensureAdvancedFeatures?: () => Promise<void>;
    };
    if (typeof debuggerManager.ensureAdvancedFeatures === 'function') {
      await debuggerManager.ensureAdvancedFeatures();
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to add blackbox pattern',
                error: error.message || String(error),
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to add common blackbox patterns',
                error: error.message || String(error),
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
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Failed to list blackbox patterns',
                error: error.message || String(error),
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
