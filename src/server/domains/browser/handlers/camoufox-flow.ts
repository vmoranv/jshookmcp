import { CamoufoxBrowserManager } from '@server/domains/shared/modules';
import type { CamoufoxBrowserConfig } from '@modules/browser/CamoufoxBrowserManager';
import {
  argString,
  argNumber,
  argBool,
  argStringArray,
  argObject,
} from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

function extractCamoufoxConfig(args: Record<string, unknown>): CamoufoxBrowserConfig {
  const addons = argStringArray(args, 'addons');
  const excludeAddons = argStringArray(args, 'excludeAddons');
  const fonts = argStringArray(args, 'fonts');
  return {
    headless: argBool(args, 'headless', true),
    os: argString(args, 'os', 'windows') as 'windows' | 'macos' | 'linux',
    geoip: argBool(args, 'geoip', false),
    humanize: argBool(args, 'humanize', false),
    proxy: argString(args, 'proxy') || undefined,
    blockImages: argBool(args, 'blockImages', false),
    blockWebrtc: argBool(args, 'blockWebrtc', false),
    blockWebgl: argBool(args, 'blockWebgl', false),
    locale: argString(args, 'locale') || undefined,
    addons: addons.length > 0 ? addons : undefined,
    fonts: fonts.length > 0 ? fonts : undefined,
    excludeAddons: excludeAddons.length > 0 ? excludeAddons : undefined,
    customFontsOnly: argBool(args, 'customFontsOnly', false),
    screen: args.screen as { width: number; height: number } | undefined,
    window: args.window as { width: number; height: number } | undefined,
    fingerprint: argObject(args, 'fingerprint'),
    webglConfig: argObject(args, 'webglConfig'),
    firefoxUserPrefs: argObject(args, 'firefoxUserPrefs'),
    mainWorldEval: argBool(args, 'mainWorldEval', false),
    enableCache: argBool(args, 'enableCache', false),
  };
}

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
    const config = extractCamoufoxConfig(args);
    const mode = argString(args, 'mode', 'launch');

    if (mode === 'connect') {
      const wsEndpoint = argString(args, 'wsEndpoint');
      if (!wsEndpoint) {
        return R.fail('wsEndpoint is required for connect mode.').build();
      }

      const manager = new CamoufoxBrowserManager(config);
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

    const manager = new CamoufoxBrowserManager(config);
    await manager.launch();
    context.setCamoufoxManager(manager);
    context.setActiveDriver('camoufox');
    context.clearCamoufoxPage();

    return R.ok().build({
      driver: 'camoufox',
      mode: 'launch',
      config: {
        os: config.os,
        headless: config.headless,
        geoip: config.geoip,
        humanize: config.humanize,
        locale: config.locale,
        blockWebgl: config.blockWebgl,
        blockImages: config.blockImages,
        blockWebrtc: config.blockWebrtc,
      },
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
