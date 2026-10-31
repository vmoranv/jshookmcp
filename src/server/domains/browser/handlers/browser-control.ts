import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { PageController } from '@server/domains/shared/modules/collector';
import type { ConsoleMonitor } from '@server/domains/shared/modules/collector';
import type { CamoufoxBrowserManager } from '@server/domains/shared/modules';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { argBool, argNumber, argString, argStringArray } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { emitBusEvent, type EventBus, type ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';
import { readFile, writeFile } from 'node:fs/promises';
import type { BrowserAttachRuntimeSnapshot } from '@server/runtime/ServerRuntimeState';
import type { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';
import type { BrowserFleetRouter } from '@server/runtime/BrowserFleetRouter';
import { readEnvBoolean } from '@src/config/environment';
import { bootstrapRuntimeEnv } from '@src/config/env-bootstrap';

const projectEnvPath = bootstrapRuntimeEnv().envPath;
const CHROME_CHANNELS = new Set(['stable', 'beta', 'dev', 'canary'] as const);
const BROWSER_DRIVERS = new Set(['chrome', 'camoufox'] as const);
const BROWSER_LAUNCH_MODES = new Set(['launch', 'connect'] as const);

type ChromeChannel = 'stable' | 'beta' | 'dev' | 'canary';
type BrowserDriver = 'chrome' | 'camoufox';
type BrowserLaunchMode = 'launch' | 'connect';

type ChromeConnectRequest = {
  browserURL?: string;
  wsEndpoint?: string;
  autoConnect?: boolean;
  channel?: ChromeChannel;
  userDataDir?: string;
};

type ChromeLaunchRequest = {
  headless?: boolean;
  args?: string[];
  enableV8NativesSyntax?: boolean;
};

interface BrowserControlHandlersDeps {
  collector: CodeCollector;
  pageController: PageController;
  consoleMonitor: ConsoleMonitor;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxManager: () => CamoufoxBrowserManager | null;
  getCamoufoxPage: () => Promise<unknown>;
  getTabRegistry: () => TabRegistry;
  clearAttachedTargetContext: (context: string) => Promise<{
    detached: boolean;
    targetId: string | null;
    type: string | null;
  }>;
  sessionCoordinator?: BrowserSessionCoordinator;
  fleetRouter?: BrowserFleetRouter;
  eventBus?: EventBus<ServerEventMap>;
  onBrowserAttachStateChanged?: (snapshot: Partial<BrowserAttachRuntimeSnapshot>) => void;
}

export class BrowserControlHandlers {
  private deps: BrowserControlHandlersDeps;
  constructor(deps: BrowserControlHandlersDeps) {
    this.deps = deps;
  }

  private pickPreferredAttachPage(
    pages: Array<{ index: number; url: string; title: string }>,
    requestedIndex: number | null,
  ): { selectedIndex: number; selected: { index: number; url: string; title: string } | null } {
    if (pages.length === 0) {
      return { selectedIndex: 0, selected: null };
    }

    if (requestedIndex !== null && requestedIndex >= 0 && requestedIndex < pages.length) {
      return {
        selectedIndex: requestedIndex,
        selected: pages[requestedIndex] ?? null,
      };
    }

    const firstUsableIndex = pages.findIndex(
      (page) => page.url.trim().length > 0 && page.url !== 'about:blank',
    );
    if (firstUsableIndex >= 0) {
      return {
        selectedIndex: firstUsableIndex,
        selected: pages[firstUsableIndex] ?? null,
      };
    }

    return {
      selectedIndex: 0,
      selected: pages[0] ?? null,
    };
  }

  private markMonitoringContextChanged(context: string): void {
    try {
      this.deps.consoleMonitor.markContextChanged();
    } catch (error) {
      logger.warn(
        `[${context}] Failed to mark monitoring context as stale: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async syncTabRegistryWithCollectorPages(context: string): Promise<string | null> {
    try {
      const pages = await this.deps.collector.listPages();
      const registry = this.deps.getTabRegistry();
      for (const page of pages) {
        const known = registry.getTabByIndex(page.index);
        if (known) registry.upsertPage(known.page, page);
      }

      const selected = this.deps.collector.getSelectedPageHandle();
      if (!selected) return registry.getCurrentPageId();
      const meta = pages[selected.index];
      if (!meta) return registry.getCurrentPageId();
      const pageId = registry.upsertPage(selected.page, meta);
      registry.setCurrentPageId(pageId);
      return pageId;
    } catch (error) {
      logger.warn(
        `[${context}] Failed to sync attached tabs into TabRegistry: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private getCurrentSessionId(): string | null {
    return this.deps.sessionCoordinator?.getCurrentSessionId() ?? null;
  }

  /**
   * Announce that `browser_launch` established a browser session for this
   * session. `mode` is the resolved launch mode the handler actually used
   * (`launch` | `connect`), not a literal — the same value the tool response
   * reports. Fire-and-forget: a missing bus (partial/degraded startup) or a
   * throwing subscriber must never break the launch path.
   */
  private emitBrowserLaunched(mode: BrowserLaunchMode): void {
    emitBusEvent(this.deps.eventBus, 'session:browser_launched', {
      mode,
      timestamp: new Date().toISOString(),
    });
  }

  private parseHeadlessArg(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return undefined;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return undefined;
  }

  private parseChromeConnectRequest(args: Record<string, unknown>): ChromeConnectRequest {
    const channelValue = argString(args, 'channel');
    if (channelValue && !CHROME_CHANNELS.has(channelValue as ChromeChannel)) {
      throw new Error(
        `Invalid channel "${channelValue}". Expected one of: stable, beta, dev, canary.`,
      );
    }

    return {
      browserURL: argString(args, 'browserURL'),
      wsEndpoint: argString(args, 'wsEndpoint'),
      autoConnect: argBool(args, 'autoConnect'),
      userDataDir: argString(args, 'userDataDir'),
      channel: channelValue as ChromeChannel | undefined,
    };
  }

  private parseChromeLaunchRequest(args: Record<string, unknown>): ChromeLaunchRequest {
    const baseArgs = argStringArray(args, 'args');
    const sslKeyLogFile = argString(args, 'sslKeyLogFile');
    // Chrome emits NSS-format TLS secrets to this file when launched with
    // --ssl-key-log; tls_keylog_parse can then decrypt captured traffic.
    const mergedArgs = sslKeyLogFile
      ? [...(baseArgs ?? []), `--ssl-key-log=${sslKeyLogFile}`]
      : baseArgs;
    return {
      headless: this.parseHeadlessArg(args.headless),
      args: mergedArgs,
      enableV8NativesSyntax: argBool(args, 'enableV8NativesSyntax'),
    };
  }

  private parseBrowserLaunchEnum<T extends string>(
    args: Record<string, unknown>,
    key: string,
    allowed: ReadonlySet<T>,
    fallback: T,
  ): T {
    const value = args[key];
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== 'string' || !allowed.has(value as T)) {
      const actual = typeof value === 'string' ? `"${value}"` : String(value);
      throw new Error(`Invalid ${key} ${actual}. Expected one of: ${[...allowed].join(', ')}.`);
    }
    return value as T;
  }

  private parseBrowserDriver(args: Record<string, unknown>): BrowserDriver {
    return this.parseBrowserLaunchEnum(args, 'driver', BROWSER_DRIVERS, 'chrome');
  }

  private parseBrowserLaunchMode(args: Record<string, unknown>): BrowserLaunchMode {
    return this.parseBrowserLaunchEnum(args, 'mode', BROWSER_LAUNCH_MODES, 'launch');
  }

  private hasChromeConnectRequest(request: ChromeConnectRequest): boolean {
    return Boolean(
      request.browserURL ||
      request.wsEndpoint ||
      request.autoConnect ||
      request.userDataDir ||
      request.channel,
    );
  }

  private describeChromeConnectRequest(request: ChromeConnectRequest): string {
    if (request.wsEndpoint) {
      return request.wsEndpoint;
    }
    if (request.browserURL) {
      return request.browserURL;
    }
    if (request.userDataDir) {
      return `autoConnect:${request.userDataDir}`;
    }
    return `autoConnect:${request.channel ?? 'stable'}`;
  }

  private isAutoConnectRequest(request: ChromeConnectRequest): boolean {
    return Boolean(request.autoConnect || request.userDataDir || request.channel);
  }

  private getAutoConnectApprovalHint(request: ChromeConnectRequest): string | null {
    if (!this.isAutoConnectRequest(request)) {
      return null;
    }
    return (
      'Chrome 144+ autoConnect may prompt for manual approval. Switch to Chrome and click Allow for this client if ' +
      'prompted.'
    );
  }

  private shouldAttemptLinuxHeadfulFallback(
    headlessArg: boolean | undefined,
    error: unknown,
  ): boolean {
    const requestedHeadful =
      headlessArg === false ||
      (headlessArg === undefined && !readEnvBoolean('PUPPETEER_HEADLESS', false));
    const linuxRuntime =
      process.platform === 'linux' || readEnvBoolean('JSHOOK_FORCE_LINUX_FALLBACK', false);
    if (!requestedHeadful || !linuxRuntime) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /Missing X server|cannot open display|Failed to launch the browser process|ozone|No protocol specified|X11|Wayland|DevToolsActivePort/i.test(
      message,
    );
  }

  private async persistHeadlessEnv(value: 'true' | 'false'): Promise<void> {
    try {
      let envContent = '';
      try {
        envContent = await readFile(projectEnvPath, 'utf-8');
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }

      const nextLine = `PUPPETEER_HEADLESS=${value}`;
      const updated = /^PUPPETEER_HEADLESS=.*$/m.test(envContent)
        ? envContent.replace(/^PUPPETEER_HEADLESS=.*$/m, nextLine)
        : `${envContent.trimEnd()}\n${nextLine}\n`;

      await writeFile(projectEnvPath, updated, 'utf-8');
    } catch (error) {
      logger.warn(`Failed to persist PUPPETEER_HEADLESS=${value} to .env: ${String(error)}`);
    }
  }

  async handleBrowserLaunch(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const driver = this.parseBrowserDriver(args);
      const mode = this.parseBrowserLaunchMode(args);
      const sessionId = this.getCurrentSessionId();
      const lease = this.deps.sessionCoordinator?.getBrowserLease(sessionId);

      const leaseBlock = browserLaunchLeaseBlock(mode, lease);
      if (leaseBlock) return leaseBlock;

      if (driver === 'camoufox') {
        return camoufoxLaunchResponse(mode, args);
      }

      if (mode === 'connect') {
        const connectRequest = this.parseChromeConnectRequest(args);

        if (!this.hasChromeConnectRequest(connectRequest)) {
          return R.fail(
            'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required for chrome connect mode.',
          ).json();
        }

        await this.deps.collector.connect(connectRequest);
        const claim = this.deps.sessionCoordinator?.claimBrowserLease(sessionId);
        const status = await this.deps.collector.getStatus();

        this.emitBrowserLaunched('connect');

        return R.ok()
          .merge({
            driver: 'chrome',
            mode: 'connect',
            endpoint: this.describeChromeConnectRequest(connectRequest),
            autoConnect: this.isAutoConnectRequest(connectRequest),
            channel: connectRequest.channel ?? null,
            userDataDir: connectRequest.userDataDir ?? null,
            manualApprovalMayBeRequired: this.isAutoConnectRequest(connectRequest),
            approvalHint: this.getAutoConnectApprovalHint(connectRequest),
            message: 'Connected to existing Chrome browser successfully',
            browserSessionOwners: claim?.totalOwners ?? 1,
            status,
          })
          .json();
      }

      const launchRequest = this.parseChromeLaunchRequest(args);
      try {
        const launch = await this.deps.collector.launch(launchRequest);
        if (launch.action === 'relaunched') {
          this.markMonitoringContextChanged('browser_launch_relaunch');
        }

        // Auto-select the first tab so page_navigate / page_evaluate work immediately after launch.
        const pages = await this.deps.collector.listPages();
        if (pages.length > 0) {
          await this.deps.collector.selectPage(0);
          await this.syncTabRegistryWithCollectorPages('browser_launch');
        }
        const claim = this.deps.sessionCoordinator?.claimBrowserLease(sessionId);
        const currentPage = pages[0];
        this.deps.onBrowserAttachStateChanged?.({
          endpoint: null,
          selectedIndex: pages.length > 0 ? 0 : null,
          selectedUrl: currentPage?.url ?? null,
          selectedTitle: currentPage?.title ?? null,
          selectedTargetId: null,
          browserPid: this.deps.collector.getChromePid(),
          rendererPid: null,
          attachedAt: new Date().toISOString(),
        });

        const status = await this.deps.collector.getStatus();

        this.emitBrowserLaunched('launch');

        return R.ok()
          .merge({
            driver: 'chrome',
            message:
              launch.action === 'relaunched'
                ? 'Browser relaunched successfully'
                : 'Browser launched successfully',
            launchAction: launch.action,
            relaunchReason: launch.reason ?? null,
            v8NativeSyntaxEnabled: launch.launchOptions.v8NativeSyntaxEnabled,
            launchArgs: launch.launchOptions.args,
            selectedIndex: pages.length > 0 ? 0 : null,
            currentUrl: currentPage?.url ?? null,
            currentTitle: currentPage?.title ?? null,
            totalPages: pages.length,
            browserSessionOwners: claim?.totalOwners ?? 1,
            status,
          })
          .json();
      } catch (error) {
        if (!this.shouldAttemptLinuxHeadfulFallback(launchRequest.headless, error)) {
          throw error;
        }

        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`Headful launch failed on Linux, fallback to headless=true: ${reason}`);
        await this.persistHeadlessEnv('true');
        const launch = await this.deps.collector.launch({
          ...launchRequest,
          headless: true,
        });
        const pages = await this.deps.collector.listPages();
        if (pages.length > 0) {
          await this.deps.collector.selectPage(0);
          await this.syncTabRegistryWithCollectorPages('browser_launch_fallback');
        }
        const claim = this.deps.sessionCoordinator?.claimBrowserLease(sessionId);
        const currentPage = pages[0];
        this.deps.onBrowserAttachStateChanged?.({
          endpoint: null,
          selectedIndex: pages.length > 0 ? 0 : null,
          selectedUrl: currentPage?.url ?? null,
          selectedTitle: currentPage?.title ?? null,
          selectedTargetId: null,
          browserPid: this.deps.collector.getChromePid(),
          rendererPid: null,
          attachedAt: new Date().toISOString(),
        });
        const fallbackStatus = await this.deps.collector.getStatus();

        this.emitBrowserLaunched('launch');

        return R.ok()
          .merge({
            driver: 'chrome',
            message: 'Browser launched with Linux fallback (headless=true)',
            launchAction: launch.action,
            relaunchReason: launch.reason ?? null,
            v8NativeSyntaxEnabled: launch.launchOptions.v8NativeSyntaxEnabled,
            launchArgs: launch.launchOptions.args,
            selectedIndex: pages.length > 0 ? 0 : null,
            currentUrl: currentPage?.url ?? null,
            currentTitle: currentPage?.title ?? null,
            totalPages: pages.length,
            browserSessionOwners: claim?.totalOwners ?? 1,
            status: fallbackStatus,
            fallback: {
              applied: true,
              reason:
                'Headful browser is unavailable in current Linux runtime; switched to headless and updated .env',
              newEnv: 'PUPPETEER_HEADLESS=true',
            },
          })
          .json();
      }
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleBrowserClose(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const sessionId = this.getCurrentSessionId();
      try {
        await this.deps.consoleMonitor.disable();
      } catch (error) {
        logger.warn(
          `[browser_close] Failed to disable the calling session monitor: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const release = this.deps.sessionCoordinator?.releaseBrowserLease(sessionId);
      this.deps.sessionCoordinator?.clearSessionContext(sessionId);
      if (release && release.remainingOwners > 0) {
        return R.ok()
          .merge({
            message: 'Browser session released; shared Chrome connection remains active',
            browserClosed: false,
            remainingSessionOwners: release.remainingOwners,
          })
          .json();
      }
      await this.deps.collector.close();
      this.deps.sessionCoordinator?.clearBrowserLeases();
      // Only reachable when this session was the last owner, so the browser was
      // actually torn down (the shared-lease branch above returns early). The
      // reason is the operation that caused the close — the `browser_close`
      // tool this handler serves — not a fabricated value.
      emitBusEvent(this.deps.eventBus, 'session:browser_closed', {
        reason: 'browser_close',
        timestamp: new Date().toISOString(),
      });
      return R.ok()
        .merge({
          message: 'Browser closed successfully',
          browserClosed: true,
          remainingSessionOwners: 0,
        })
        .json();
    } catch (e) {
      return R.fail(e).json();
    }
  }

  async handleBrowserStatus(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const status = await this.deps.collector.getStatus();
      return R.ok()
        .merge({
          driver: 'chrome',
          ...status,
          scheduler: this.deps.sessionCoordinator?.getQueueStats(),
          fleet: this.deps.fleetRouter?.getStats(),
        })
        .json();
    } catch (e) {
      return R.fail(e).json();
    }
  }

  async handleBrowserListTabs(args: Record<string, unknown>): Promise<ToolResponse> {
    const connectRequest = this.parseChromeConnectRequest(args);
    try {
      if (this.hasChromeConnectRequest(connectRequest)) {
        await this.deps.collector.connect(connectRequest);
      }

      const pages = await this.deps.collector.listPages();
      const registry = this.deps.getTabRegistry();
      await this.syncTabRegistryWithCollectorPages('browser_list_tabs');

      const enrichedPages = pages.map((page: { index: number; url: string; title: string }) => {
        const tab = registry.getTabByIndex(page.index);
        return {
          ...page,
          pageId: tab?.pageId ?? null,
          aliases: tab?.aliases ?? [],
        };
      });

      const currentInfo = registry.getContextMeta();

      return R.ok()
        .merge({
          count: pages.length,
          pages: enrichedPages,
          currentPageId: currentInfo.pageId,
          currentIndex: currentInfo.tabIndex,
          autoConnect: this.isAutoConnectRequest(connectRequest),
          manualApprovalMayBeRequired: this.isAutoConnectRequest(connectRequest),
          approvalHint: this.getAutoConnectApprovalHint(connectRequest),
          hint: 'Use browser_select_tab(index=N) to switch to a specific tab',
        })
        .json();
    } catch (error) {
      return R.fail(error)
        .set(
          'hint',
          'Make sure browser is attached via browser_attach first, or provide browserURL/autoConnect. Chrome 144+' +
            ' autoConnect may require manual approval in the Chrome window.',
        )
        .set('approvalHint', this.getAutoConnectApprovalHint(connectRequest))
        .json();
    }
  }

  async handleBrowserSelectTab(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const index = argNumber(args, 'index');
      const urlPattern = argString(args, 'urlPattern');
      const titlePattern = argString(args, 'titlePattern');
      const registry = this.deps.getTabRegistry();

      if (index !== undefined) {
        const clearedTarget = await this.deps.clearAttachedTargetContext('browser_select_tab');
        await this.deps.collector.selectPage(index);
        const pages = await this.deps.collector.listPages();
        await this.syncTabRegistryWithCollectorPages('browser_select_tab');
        const selected = pages[index];
        const tab = registry.setCurrentByIndex(index);
        if (tab?.pageId || clearedTarget.detached) {
          this.markMonitoringContextChanged('browser_select_tab');
        }
        return R.ok()
          .merge({
            selectedIndex: index,
            selectedPageId: tab?.pageId ?? null,
            url: selected?.url,
            title: selected?.title,
            contextSwitched: true,
            detachedCdpTarget: clearedTarget.detached,
            detachedCdpTargetId: clearedTarget.targetId,
            monitoringBindingDeferred: Boolean(tab?.pageId),
            networkMonitoringEnabled: false,
            consoleMonitoringEnabled: false,
          })
          .json();
      }

      const pages = await this.deps.collector.listPages();
      let matchIndex = -1;
      for (const page of pages) {
        if (urlPattern && page.url.includes(urlPattern)) {
          matchIndex = page.index;
          break;
        }
        if (titlePattern && page.title.includes(titlePattern)) {
          matchIndex = page.index;
          break;
        }
      }

      if (matchIndex === -1) {
        return R.fail('No matching tab found').set('availablePages', pages).json();
      }

      const clearedTarget = await this.deps.clearAttachedTargetContext('browser_select_tab');
      await this.deps.collector.selectPage(matchIndex);
      await this.syncTabRegistryWithCollectorPages('browser_select_tab');
      const selected = pages[matchIndex];
      const tab = registry.setCurrentByIndex(matchIndex);
      if (tab?.pageId || clearedTarget.detached) {
        this.markMonitoringContextChanged('browser_select_tab');
      }
      return R.ok()
        .merge({
          selectedIndex: matchIndex,
          selectedPageId: tab?.pageId ?? null,
          url: selected?.url,
          title: selected?.title,
          contextSwitched: true,
          detachedCdpTarget: clearedTarget.detached,
          detachedCdpTargetId: clearedTarget.targetId,
          monitoringBindingDeferred: Boolean(tab?.pageId),
          networkMonitoringEnabled: false,
          consoleMonitoringEnabled: false,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleBrowserAttach(args: Record<string, unknown>): Promise<ToolResponse> {
    let connectRequest: ChromeConnectRequest | null = null;
    try {
      connectRequest = this.parseChromeConnectRequest(args);

      if (!this.hasChromeConnectRequest(connectRequest)) {
        return R.fail(
          'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required',
        ).json();
      }

      const clearedTarget = await this.deps.clearAttachedTargetContext('browser_attach');
      const sessionId = this.getCurrentSessionId();
      const existingLease = this.deps.sessionCoordinator?.getBrowserLease(sessionId);
      await this.deps.collector.connect(connectRequest);

      const rawPageIndex = args.pageIndex;
      const pageIndexProvided =
        rawPageIndex !== undefined &&
        rawPageIndex !== null &&
        !(typeof rawPageIndex === 'string' && rawPageIndex.trim() === '');
      const pageIndex =
        typeof rawPageIndex === 'number'
          ? rawPageIndex
          : typeof rawPageIndex === 'string' && rawPageIndex.trim() !== ''
            ? Number(rawPageIndex)
            : 0;
      const requestedIndex = Number.isFinite(pageIndex) ? pageIndex : 0;

      let pages = await this.deps.collector.listPages();
      let isolatedTabCreated = false;
      if (
        !pageIndexProvided &&
        existingLease &&
        !existingLease.owned &&
        existingLease.otherOwners > 0
      ) {
        await this.deps.collector.createPage();
        pages = await this.deps.collector.listPages();
        isolatedTabCreated = pages.length > 0;
      }
      const preferred = isolatedTabCreated
        ? { selectedIndex: pages.length - 1, selected: pages.at(-1) ?? null }
        : this.pickPreferredAttachPage(pages, pageIndexProvided ? requestedIndex : null);
      const selectedIndex = preferred.selectedIndex;

      if (pages.length > 0) {
        await this.deps.collector.selectPage(selectedIndex);
        if (requestedIndex !== selectedIndex) {
          logger.warn(
            `[browser_attach] requested pageIndex ${requestedIndex} resolved to ${selectedIndex}; ` +
              `preferred non-blank target when available`,
          );
        }
      }

      const registry = this.deps.getTabRegistry();
      const syncedPageId = await this.syncTabRegistryWithCollectorPages('browser_attach');
      const actualIndex = pages.length > 0 ? Math.min(selectedIndex, pages.length - 1) : 0;
      const tab = syncedPageId
        ? registry.getTabById(syncedPageId)
        : pages.length > 0
          ? registry.setCurrentByIndex(actualIndex)
          : null;
      const selected = pages[actualIndex];
      const pageHandleReady = Boolean(tab?.pageId);
      const browserPid = this.deps.collector.getChromePid();
      const capabilities = {
        pageControllerReady: pageHandleReady,
        v8InspectorReady: pageHandleReady,
        memoryRendererPidReady: browserPid !== null,
      };
      if (pageHandleReady) {
        this.markMonitoringContextChanged('browser_attach');
      }

      const status = await this.deps.collector.getStatus();
      const claim = this.deps.sessionCoordinator?.claimBrowserLease(sessionId);
      const attachedTargetInfo = this.deps.collector.getAttachedTargetInfo();
      this.deps.onBrowserAttachStateChanged?.({
        endpoint: this.describeChromeConnectRequest(connectRequest),
        selectedIndex: actualIndex,
        selectedUrl: selected?.url ?? null,
        selectedTitle: selected?.title ?? null,
        selectedTargetId: attachedTargetInfo?.targetId ?? null,
        browserPid,
        attachedAt: new Date().toISOString(),
      });

      return R.ok()
        .merge({
          message: 'Attached to existing browser successfully',
          endpoint: this.describeChromeConnectRequest(connectRequest),
          autoConnect: this.isAutoConnectRequest(connectRequest),
          channel: connectRequest.channel ?? null,
          userDataDir: connectRequest.userDataDir ?? null,
          manualApprovalMayBeRequired: this.isAutoConnectRequest(connectRequest),
          approvalHint: this.getAutoConnectApprovalHint(connectRequest),
          selectedIndex: actualIndex,
          selectedPageId: tab?.pageId ?? null,
          currentUrl: selected?.url ?? null,
          currentTitle: selected?.title ?? null,
          totalPages: pages.length,
          connectionReused: Boolean(existingLease?.owned || existingLease?.otherOwners),
          sessionIsolation: isolatedTabCreated
            ? 'dedicated-tab'
            : pageIndexProvided && existingLease?.otherOwners
              ? 'explicit-shared-tab'
              : 'existing-tab',
          browserSessionOwners: claim?.totalOwners ?? 1,
          contextSwitched: pages.length > 0,
          detachedCdpTarget: clearedTarget.detached,
          detachedCdpTargetId: clearedTarget.targetId,
          monitoringBindingDeferred: pageHandleReady,
          networkMonitoringEnabled: false,
          consoleMonitoringEnabled: false,
          takeoverReady: pageHandleReady,
          capabilities,
          note: pageHandleReady
            ? 'Monitoring will auto-rebind on the next console/network operation for the selected tab.'
            : 'Connected to existing Chrome, but the selected tab does not currently expose a stable Puppeteer Page' +
              ' handle. Tab discovery still works; try selecting a different tab or navigate the tab and retry. ' +
              'V8/page-bound tools will degrade until a stable Page handle is available.',
          status,
        })
        .json();
    } catch (error) {
      this.deps.onBrowserAttachStateChanged?.({
        endpoint: connectRequest ? this.describeChromeConnectRequest(connectRequest) : null,
      });
      return R.fail(error)
        .set('approvalHint', this.getAutoConnectApprovalHint(connectRequest ?? {}))
        .json();
    }
  }
}

/** Refuse launch/connect combinations that would steal or hijack another
 * session's browser lease. Returns the failure response or null when allowed. */
function browserLaunchLeaseBlock(
  mode: string,
  lease: { owned?: boolean; otherOwners: number } | null | undefined,
): ReturnType<typeof R.fail>['json'] extends () => infer T ? T | null : never {
  if (mode === 'launch' && lease && lease.otherOwners > 0) {
    return R.fail(
      `browser_launch is blocked while ${lease.otherOwners} other browser session(s) are active. ` +
        'Use browser_attach to share the existing Chrome connection without replacing it.',
    ).json();
  }
  if (mode === 'connect' && lease && !lease.owned && lease.otherOwners > 0) {
    return R.fail(
      'browser_launch(mode="connect") cannot join a browser owned by another session because it does not ' +
        'allocate an isolated tab. Use browser_attach instead.',
    ).json();
  }
  return null;
}

/** Camoufox launch/connect responses (no Chrome session coordination). */
function camoufoxLaunchResponse(mode: string, args: Record<string, unknown>) {
  if (mode === 'connect') {
    const wsEndpoint = argString(args, 'wsEndpoint');
    if (!wsEndpoint) {
      return R.fail(
        'wsEndpoint is required for connect mode. Use camoufox_server({ action: "launch" }) first to get a ' +
          'wsEndpoint.',
      ).json();
    }
    return R.ok()
      .merge({
        driver: 'camoufox',
        mode: 'connect',
        wsEndpoint,
        message: 'Connected to Camoufox server. Use page_navigate to begin.',
      })
      .json();
  }

  return R.ok()
    .merge({
      driver: 'camoufox',
      mode: 'launch',
      message: 'Camoufox (Firefox) browser launched',
      note:
        'Use page_navigate to begin. CDP debugger is limited in Firefox; network_enable and console_monitor({ ' +
        'action: "enable" }) use Playwright events and are fully supported.',
    })
    .json();
}
