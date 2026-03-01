import { CamoufoxBrowserManager } from '../../../../modules/browser/CamoufoxBrowserManager.js';

export type CamoufoxWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export type CamoufoxPage = Awaited<ReturnType<CamoufoxBrowserManager['newPage']>> & {
  url(): string;
  title(): Promise<string>;
  goto(url: string, options?: { waitUntil?: CamoufoxWaitUntil; timeout?: number }): Promise<unknown>;
};

export interface CamoufoxLaunchFlowContext {
  setCamoufoxManager: (manager: CamoufoxBrowserManager) => void;
  setActiveDriver: (driver: 'chrome' | 'camoufox') => void;
  clearCamoufoxPage: () => void;
}

export async function handleCamoufoxLaunchFlow(
  context: CamoufoxLaunchFlowContext,
  args: Record<string, unknown>
) {
  const headless = (args.headless as boolean) ?? true;
  const os = (args.os as 'windows' | 'macos' | 'linux') ?? 'windows';
  const mode = (args.mode as string) ?? 'launch';

  if (mode === 'connect') {
    const wsEndpoint = args.wsEndpoint as string | undefined;
    if (!wsEndpoint) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'wsEndpoint is required for connect mode.',
          }, null, 2),
        }],
      };
    }

    const manager = new CamoufoxBrowserManager({ headless, os });
    await manager.connectToServer(wsEndpoint);
    context.setCamoufoxManager(manager);
    context.setActiveDriver('camoufox');
    context.clearCamoufoxPage();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          driver: 'camoufox',
          mode: 'connect',
          wsEndpoint,
          message: 'Connected to Camoufox server.',
        }, null, 2),
      }],
    };
  }

  const manager = new CamoufoxBrowserManager({ headless, os });
  await manager.launch();
  context.setCamoufoxManager(manager);
  context.setActiveDriver('camoufox');
  context.clearCamoufoxPage();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        driver: 'camoufox',
        mode: 'launch',
        message: 'Camoufox (Firefox) browser launched',
      }, null, 2),
    }],
  };
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
  args: Record<string, unknown>
) {
  const url = args.url as string;
  const rawWaitUntil = (args.waitUntil as string) || 'networkidle';
  const timeout = args.timeout as number | undefined;

  const page = await context.getCamoufoxPage();
  await page.goto(url, { waitUntil: normalizeWaitUntil(rawWaitUntil), timeout });
  context.setConsoleMonitorPage(page);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        driver: 'camoufox',
        captcha_detected: false,
        url: page.url(),
        title: await page.title(),
      }, null, 2),
    }],
  };
}
