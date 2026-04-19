import { CamoufoxBrowserManager } from '@server/domains/shared/modules';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

export type CamoufoxWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export type CamoufoxPage = Awaited<ReturnType<CamoufoxBrowserManager['newPage']>> & {
  url(): string;
  title(): Promise<string>;
  goto(
    url: string,
    options?: { waitUntil?: CamoufoxWaitUntil; timeout?: number },
  ): Promise<unknown>;
};

export interface CamoufoxLaunchFlowContext {
  setCamoufoxManager: (manager: CamoufoxBrowserManager) => void;
  setActiveDriver: (driver: 'chrome' | 'camoufox') => void;
  clearCamoufoxPage: () => void;
}

export async function handleCamoufoxLaunchFlow(
  context: CamoufoxLaunchFlowContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const headless = argBool(args, 'headless', true);
    const os = argString(args, 'os', 'windows') as 'windows' | 'macos' | 'linux';
    const mode = argString(args, 'mode', 'launch');

    if (mode === 'connect') {
      const wsEndpoint = argString(args, 'wsEndpoint');
      if (!wsEndpoint) {
        return R.fail('wsEndpoint is required for connect mode.').build();
      }

      const manager = new CamoufoxBrowserManager({ headless, os });
      await manager.connectToServer(wsEndpoint);
      context.setCamoufoxManager(manager);
      context.setActiveDriver('camoufox');
      context.clearCamoufoxPage();

      return R.ok().build({
        driver: 'camoufox',
        mode: 'connect',
        wsEndpoint,
        message: 'Connected to Camoufox server.',
      });
    }

    const manager = new CamoufoxBrowserManager({ headless, os });
    await manager.launch();
    context.setCamoufoxManager(manager);
    context.setActiveDriver('camoufox');
    context.clearCamoufoxPage();

    return R.ok().build({
      driver: 'camoufox',
      mode: 'launch',
      message: 'Camoufox (Firefox) browser launched',
    });
  } catch (e) {
    return R.fail(e).build();
  }
}

export interface CamoufoxNavigateFlowContext {
  getCamoufoxPage: () => Promise<CamoufoxPage>;
  setConsoleMonitorPage: (page: CamoufoxPage) => void;
}

function normalizeWaitUntil(waitUntil: string): CamoufoxWaitUntil {
  if (waitUntil === 'networkidle2') return 'networkidle';
  if (waitUntil === 'load') return 'load';
  if (waitUntil === 'domcontentloaded') return 'domcontentloaded';
  if (waitUntil === 'commit') return 'commit';
  return 'networkidle';
}

export async function handleCamoufoxNavigateFlow(
  context: CamoufoxNavigateFlowContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const url = argString(args, 'url', '');
    const rawWaitUntil = argString(args, 'waitUntil', 'networkidle');
    const timeout = argNumber(args, 'timeout');

    const page = await context.getCamoufoxPage();
    await page.goto(url, { waitUntil: normalizeWaitUntil(rawWaitUntil), timeout });
    context.setConsoleMonitorPage(page);

    return R.ok().build({
      driver: 'camoufox',
      url: page.url(),
      title: await page.title(),
    });
  } catch (e) {
    return R.fail(e).build();
  }
}
