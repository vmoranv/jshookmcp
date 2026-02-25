import { CamoufoxBrowserManager } from '../../../../modules/browser/CamoufoxBrowserManager.js';
import { logger } from '../../../../utils/logger.js';

interface CamoufoxBrowserHandlersDeps {
  getCamoufoxManager: () => CamoufoxBrowserManager | null;
  setCamoufoxManager: (manager: CamoufoxBrowserManager) => void;
  closeCamoufox: () => Promise<void>;
}

/**
 * Check if camoufox-js is available and has all required dependencies.
 * Returns error message if not available, null if available.
 */
async function checkCamoufoxDependencies(): Promise<string | null> {
  try {
    // Try to import camoufox-js
    await import('camoufox-js');
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check for better-sqlite3 missing
    if (errorMsg.includes('better-sqlite3') || errorMsg.includes('bindings file')) {
      return `Camoufox requires native dependencies that are not installed. Run: pnpm add better-sqlite3 or npm rebuild better-sqlite3. Original error: ${errorMsg}`;
    }

    // Check for camoufox-js not installed
    if (errorMsg.includes("Cannot find package 'camoufox-js'")) {
      return "camoufox-js package is not installed. Run: pnpm add camoufox-js && npx camoufox-js fetch";
    }

    return `Camoufox dependencies check failed: ${errorMsg}`;
  }
}

export class CamoufoxBrowserHandlers {
  constructor(private deps: CamoufoxBrowserHandlersDeps) {}

  async handleCamoufoxServerLaunch(args: Record<string, unknown>) {
    // Check dependencies first
    const depError = await checkCamoufoxDependencies();
    if (depError) {
      logger.warn(`Camoufox dependencies not available: ${depError}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: depError,
                hint: 'Camoufox is optional. Use browser_launch with Chrome driver instead, or install dependencies.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const port = args.port as number | undefined;
    const ws_path = args.ws_path as string | undefined;
    const headless = (args.headless as boolean) ?? true;
    const os = (args.os as 'windows' | 'macos' | 'linux') ?? 'windows';

    let camoufoxManager = this.deps.getCamoufoxManager();
    if (!camoufoxManager) {
      camoufoxManager = new CamoufoxBrowserManager({ headless, os });
      this.deps.setCamoufoxManager(camoufoxManager);
    }

    try {
      const wsEndpoint = await camoufoxManager.launchAsServer(port, ws_path);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                wsEndpoint,
                message:
                  'Camoufox server launched. Connect with: browser_launch(driver="camoufox", mode="connect", wsEndpoint=<wsEndpoint>)',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to launch Camoufox server: ${errorMsg}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMsg,
                hint: 'Try running: npx camoufox-js fetch to download browser binaries',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleCamoufoxServerClose(_args: Record<string, unknown>) {
    const camoufoxManager = this.deps.getCamoufoxManager();
    if (!camoufoxManager) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: 'No camoufox server is running.' },
              null,
              2
            ),
          },
        ],
      };
    }

    await camoufoxManager.closeBrowserServer();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, message: 'Camoufox server closed.' }, null, 2),
        },
      ],
    };
  }

  async handleCamoufoxServerStatus(_args: Record<string, unknown>) {
    const camoufoxManager = this.deps.getCamoufoxManager();
    const wsEndpoint = camoufoxManager?.getBrowserServerEndpoint() ?? null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              running: wsEndpoint !== null,
              wsEndpoint,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
