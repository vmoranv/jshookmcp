import { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import { type PageNavigationWaitUntil } from '@modules/browser/navigation-wait-until';
import { parsePageNavigationWaitUntil } from '@server/domains/browser/page-navigation-wait-until';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { emitBusEvent, type EventBus, type ServerEventMap } from '@server/EventBus';
import { extractCamoufoxConfig } from './camoufox-config';

export type CamoufoxWaitUntil = PageNavigationWaitUntil;

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
  eventBus?: EventBus<ServerEventMap>;
}

export async function handleCamoufoxLaunchFlow(
  context: CamoufoxLaunchFlowContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const config = extractCamoufoxConfig(args);
    const mode = argString(args, 'mode', 'launch');

    if (mode === 'connect') {
      const wsEndpoint = argString(args, 'wsEndpoint');
      if (!wsEndpoint) throw new Error('wsEndpoint is required for connect mode.');

      const manager = new CamoufoxBrowserManager(config);
      await manager.connectToServer(wsEndpoint);
      context.setCamoufoxManager(manager);
      context.setActiveDriver('camoufox');
      context.clearCamoufoxPage();

      emitBusEvent(context.eventBus, 'session:browser_launched', {
        mode: 'connect',
        timestamp: new Date().toISOString(),
      });

      return {
        driver: 'camoufox',
        mode: 'connect',
        wsEndpoint,
        message: 'Connected to Camoufox server.',
      };
    }

    const manager = new CamoufoxBrowserManager(config);
    await manager.launch();
    context.setCamoufoxManager(manager);
    context.setActiveDriver('camoufox');
    context.clearCamoufoxPage();

    emitBusEvent(context.eventBus, 'session:browser_launched', {
      mode: 'launch',
      timestamp: new Date().toISOString(),
    });

    return {
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
    };
  });
}

export interface CamoufoxNavigateFlowContext {
  getCamoufoxPage: () => Promise<CamoufoxPage>;
  setConsoleMonitorPage: (page: CamoufoxPage) => void;
}

export async function handleCamoufoxNavigateFlow(
  context: CamoufoxNavigateFlowContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const url = argString(args, 'url', '');
    const waitUntil = parsePageNavigationWaitUntil(args);
    const timeout = argNumber(args, 'timeout');

    const page = await context.getCamoufoxPage();
    await page.goto(url, { waitUntil, timeout });
    context.setConsoleMonitorPage(page);

    return { driver: 'camoufox', url: page.url(), title: await page.title() };
  });
}
