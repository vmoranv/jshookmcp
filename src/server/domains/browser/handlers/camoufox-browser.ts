import { CamoufoxBrowserManager } from '@server/domains/shared/modules';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { formatBetterSqlite3Error, isBetterSqlite3RelatedError } from '@utils/betterSqlite3';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { logger } from '@utils/logger';

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

    if (isBetterSqlite3RelatedError(error)) {
      return `Camoufox requires the same native SQLite backend used by trace tooling. ${formatBetterSqlite3Error(error)}`;
    }

    // Check for camoufox-js not installed
    if (errorMsg.includes("Cannot find package 'camoufox-js'")) {
      return 'camoufox-js package is not installed. Run: pnpm add camoufox-js && npx camoufox-js fetch';
    }

    return `Camoufox dependencies check failed: ${errorMsg}`;
  }
}

export class CamoufoxBrowserHandlers {
  constructor(private deps: CamoufoxBrowserHandlersDeps) {}

  async handleCamoufoxServerLaunch(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      // Check dependencies first
      const depError = await checkCamoufoxDependencies();
      if (depError) {
        logger.warn(`Camoufox dependencies not available: ${depError}`);
        return R.fail(depError)
          .set(
            'hint',
            'Camoufox is optional. Use browser_launch with Chrome driver instead, or install dependencies.',
          )
          .json();
      }

      const port = argNumber(args, 'port');
      const ws_path = argString(args, 'ws_path');
      const headless = argBool(args, 'headless', true);
      const os = argString(args, 'os', 'windows') as 'windows' | 'macos' | 'linux';

      let camoufoxManager = this.deps.getCamoufoxManager();
      if (!camoufoxManager) {
        camoufoxManager = new CamoufoxBrowserManager({ headless, os });
        this.deps.setCamoufoxManager(camoufoxManager);
      }

      const wsEndpoint = await camoufoxManager.launchAsServer(port, ws_path);
      return R.ok()
        .merge({
          wsEndpoint,
          message:
            'Camoufox server launched. Connect with: browser_launch(driver="camoufox", mode="connect", wsEndpoint=<wsEndpoint>)',
        })
        .json();
    } catch (error) {
      return R.fail(error)
        .set('hint', 'Try running: npx camoufox-js fetch to download browser binaries')
        .json();
    }
  }

  async handleCamoufoxServerClose(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const camoufoxManager = this.deps.getCamoufoxManager();
      if (!camoufoxManager) {
        return R.fail('No camoufox server is running.').json();
      }

      await camoufoxManager.closeBrowserServer();

      return R.ok().set('message', 'Camoufox server closed.').json();
    } catch (e) {
      return R.fail(e).json();
    }
  }

  async handleCamoufoxServerStatus(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const camoufoxManager = this.deps.getCamoufoxManager();
      const wsEndpoint = camoufoxManager?.getBrowserServerEndpoint() ?? null;

      return R.ok()
        .merge({
          running: wsEndpoint !== null,
          wsEndpoint,
        })
        .json();
    } catch (e) {
      return R.fail(e).json();
    }
  }
}
